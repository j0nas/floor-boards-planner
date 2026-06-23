/**
 * Polygon room layout (v3): a row-based field clipped to the outline.
 *
 *  1. Inset the outline by the expansion gap (Clipper2) → usable region.
 *  2. Balance the rows across the cross extent so the leftover never becomes a
 *     sliver (reuses the same border-balancing as the quad engine).
 *  3. Tile each row with staggered boards whose run-direction seams come from the
 *     quad engine's `planRowPieces`, rebalancing any sub-minimum tail piece so we
 *     never cut a run-direction sliver. Each board is clipped to the region, so
 *     concave corners and cavities split it into the right pieces.
 *  4. Pack the resulting cut lengths onto boards with offcut reuse (the quad
 *     engine's cutting pass), so the board count and waste are realistic.
 *  5. Flag any remaining slivers (small fragments clipping leaves around concave
 *     corners) so they are highlighted rather than silently mislabelled.
 */
import { balanceRows } from "./balance.ts";
import { type DemandPiece, assignCuts } from "./cutting.ts";
import { type Ring, clipRings, insetRoom, ringsArea } from "./poly.ts";
import { roomOutline } from "./room.ts";
import { markUndersized, undersizedDiagnostic } from "./slivers.ts";
import { planRowPieces } from "./stagger.ts";
import { resolveBoardsPerPack } from "./validate.ts";
import { computeMaterial } from "./waste.ts";
import type {
  Axis,
  Diagnostic,
  Geometry,
  Inputs,
  Piece,
  Plan,
  PlanScore,
  Point,
  StaggerInfo,
} from "./types.ts";
import { EPS, type Mm, approxEq, gte } from "./units.ts";

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function bboxOf(rings: readonly Ring[]): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rings)
    for (const p of r) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  return { minX, minY, maxX, maxY };
}

/** Axis-aligned board rectangle (run along X or Y) of the given run length × width. */
function boardRect(runStart: number, crossStart: number, runLen: number, w: number, runIsX: boolean): Ring {
  if (runIsX) {
    return [
      { x: runStart, y: crossStart },
      { x: runStart + runLen, y: crossStart },
      { x: runStart + runLen, y: crossStart + w },
      { x: runStart, y: crossStart + w },
    ];
  }
  return [
    { x: crossStart, y: runStart },
    { x: crossStart + w, y: runStart },
    { x: crossStart + w, y: runStart + runLen },
    { x: crossStart, y: runStart + runLen },
  ];
}

/** Run/cross extents of a ring's bounding box. */
function extentOf(ring: Ring, runIsX: boolean): { runLen: number; crossLen: number } {
  const b = bboxOf([ring]);
  const dx = b.maxX - b.minX;
  const dy = b.maxY - b.minY;
  return runIsX ? { runLen: dx, crossLen: dy } : { runLen: dy, crossLen: dx };
}

/** Min/max of a ring's bounding box along the run axis. */
function runRange(ring: Ring, runIsX: boolean): { min: number; max: number } {
  const b = bboxOf([ring]);
  return runIsX ? { min: b.minX, max: b.maxX } : { min: b.minY, max: b.maxY };
}

/**
 * Run-direction piece lengths for one row span, starting with a `startLen` piece
 * then full boards, with a sub-minimum tail piece rebalanced into its neighbour
 * (split if that would exceed a board, else merged) so no run-direction sliver
 * is cut. A board is never longer than `bl`, so the split keeps both halves cuttable.
 */
function runSegments(span: Mm, bl: Mm, startLen: Mm, minPiece: Mm): Mm[] {
  const ls = planRowPieces(span, bl, Math.min(startLen, span));
  if (ls.length >= 2 && ls[ls.length - 1]! < minPiece - EPS) {
    const last = ls.pop()!;
    const prev = ls.pop()!;
    const combined = prev + last;
    if (combined <= bl + EPS) ls.push(combined);
    else ls.push(combined / 2, combined / 2);
  }
  return ls;
}

/** Min distance between two interior-seam sets (absolute run coords); ∞ if either is empty. */
function seamGap(a: readonly number[], b: readonly number[]): number {
  if (!a.length || !b.length) return Number.POSITIVE_INFINITY;
  let mn = Number.POSITIVE_INFINITY;
  for (const x of a) for (const y of b) mn = Math.min(mn, Math.abs(x - y));
  return mn;
}

/** Run-direction segment lengths (per coverage span) and the absolute interior seams they produce. */
function rowTiling(
  spans: readonly { min: Mm; max: Mm }[],
  bl: Mm,
  startLen: Mm,
  minPiece: Mm,
): { perSpan: Mm[][]; seams: number[] } {
  const perSpan: Mm[][] = [];
  const seams: number[] = [];
  for (const span of spans) {
    const segs = runSegments(span.max - span.min, bl, startLen, minPiece);
    perSpan.push(segs);
    let acc = span.min;
    for (let i = 0; i < segs.length - 1; i++) {
      acc += segs[i]!;
      seams.push(acc);
    }
  }
  return { perSpan, seams };
}

/**
 * Choose a row's start-piece length so its seams clear the rows already laid,
 * validated on the ACTUAL seam positions (rebalanced tail and all) rather than a
 * generating offset — the bug the fixed schedule had was that a rebalanced tail
 * could drop a seam a quarter-board from its neighbour while the plan still
 * claimed a healthy stagger.
 *
 * The search saturates each clearance at `minStagger` (once a row is far enough
 * it stops competing) and is lexicographic: clear the immediately adjacent row
 * first, then the skip row (avoids the every-other-row ladder), then maximise the
 * overall spread.
 */
function chooseRowStart(
  spans: readonly { min: Mm; max: Mm }[],
  prev: readonly number[],
  prev2: readonly number[],
  bl: Mm,
  minPiece: Mm,
  minStagger: Mm,
): { startLen: Mm; seams: number[]; perSpan: Mm[][]; gapPrev: number } {
  // Candidate starts: a full-board start (no leading cut), plus a fine sweep over
  // the legal start-piece range — fine enough to resolve a ~minStagger window.
  const candidates: Mm[] = [bl];
  const steps = 64;
  for (let i = 0; i <= steps; i++) candidates.push(minPiece + ((bl - minPiece) * i) / steps);

  let best: { startLen: Mm; seams: number[]; perSpan: Mm[][]; gapPrev: number } | null = null;
  let bestKey: readonly [number, number, number] | null = null;
  for (const startLen of candidates) {
    const { perSpan, seams } = rowTiling(spans, bl, startLen, minPiece);
    const gapPrev = seamGap(seams, prev);
    const gapPrev2 = seamGap(seams, prev2);
    // Tertiary objective: maximise the true smallest clearance, which centres the
    // row within its feasible band instead of hugging the minStagger floor.
    const trueMin = Math.min(gapPrev, gapPrev2);
    const key = [
      Math.min(gapPrev, minStagger),
      Math.min(gapPrev2, minStagger),
      Number.isFinite(trueMin) ? trueMin : bl,
    ] as const;
    if (
      !bestKey ||
      key[0] > bestKey[0] + EPS ||
      (approxEq(key[0], bestKey[0]) && key[1] > bestKey[1] + EPS) ||
      (approxEq(key[0], bestKey[0]) && approxEq(key[1], bestKey[1]) && key[2] > bestKey[2] + EPS)
    ) {
      bestKey = key;
      best = { startLen, seams, perSpan, gapPrev };
    }
  }
  return best!;
}

/** Uniform perimeter gap for a polygon room (the largest of the four walls). */
function uniformGapMm(inputs: Inputs): number {
  const g = inputs.gap;
  return Math.max(g.near, g.far, g.left, g.right);
}

/**
 * Build a polygon-room plan for one run axis, or null when no usable region
 * remains (gap too large / degenerate outline).
 */
export function buildPolygonPlan(inputs: Inputs, runAxis: Axis): Plan | null {
  const { board, tunables: t } = inputs;
  const bl = board.length;
  const bw = board.width;
  const region = insetRoom(roomOutline(inputs.room), uniformGapMm(inputs)).filter(
    (r) => Math.abs(ringsArea([r])) > 1,
  );
  if (!region.length) return null;

  const bb = bboxOf(region);
  const runIsX = runAxis === "X";
  const runMin = runIsX ? bb.minX : bb.minY;
  const runMax = runIsX ? bb.maxX : bb.maxY;
  const crossMin = runIsX ? bb.minY : bb.minX;
  const crossMax = runIsX ? bb.maxY : bb.maxX;
  const runSpan = runMax - runMin;

  // Balance the rows across the cross extent so the leftover row isn't a sliver.
  const drafts = balanceRows(crossMax - crossMin, bw, t.minRowWidth);
  const balanced = (drafts.find((d) => d.recommended) ?? drafts[0])?.rowWidths ?? [];
  // Flip mirrors the cross-axis row order, moving the cut/border row to the
  // opposite wall. Every row is clipped to the outline either way, so this is a
  // waste-neutral mirror — it only changes which wall the narrow row sits against.
  const rowWidths = inputs.flip === true ? [...balanced].reverse() : balanced;

  const pieces: Piece[] = [];
  const demand: DemandPiece[] = [];

  // Stagger is chosen per row against the actual seam positions of the rows
  // already laid (not a fixed schedule keyed on row index): each row's start
  // piece is picked so its butt joints clear the previous one or two rows by at
  // least `minStagger` wherever the run geometry allows.
  const startLens: Mm[] = [];
  let prevSeams: number[] = [];
  let prevSeams2: number[] = [];
  let minObservedStagger = Number.POSITIVE_INFINITY;

  let crossStart = crossMin;
  rowWidths.forEach((rw, k) => {
    const w = rw.width;
    const rowCross = crossStart;
    crossStart += w;
    // Clip the full-run strip to the region first: a cavity wall (e.g. the inner
    // wall of an L) shortens this row, so we tile within its *actual* coverage
    // rather than the global bbox — that's what stops the notch cutting a sliver.
    const strip = boardRect(runMin, rowCross, runSpan, w, runIsX);
    const coverage = clipRings([strip], region).filter((r) => Math.abs(ringsArea([r])) > 1);
    const spans = coverage.map((cover) => runRange(cover, runIsX));

    const choice = chooseRowStart(spans, prevSeams, prevSeams2, bl, t.minPiece, t.minStagger);
    startLens.push(choice.startLen);
    if (Number.isFinite(choice.gapPrev))
      minObservedStagger = Math.min(minObservedStagger, choice.gapPrev);
    prevSeams2 = prevSeams;
    prevSeams = choice.seams;

    let idx = 0;
    spans.forEach((span, s) => {
      let runPos = span.min;
      for (const segLen of choice.perSpan[s]!) {
        const rect = boardRect(runPos, rowCross, segLen, w, runIsX);
        runPos += segLen;
        const clipped = clipRings([rect], region).filter((r) => Math.abs(ringsArea([r])) > 1);
        for (const ring of clipped) {
          const { runLen, crossLen } = extentOf(ring, runIsX);
          const area = Math.abs(ringsArea([ring]));
          const isFull =
            approxEq(runLen, bl, 2) && approxEq(crossLen, bw, 2) && approxEq(area, bl * bw, 2);
          const id = `r${k}-p${idx++}`;
          const kind: Piece["kind"] = isFull ? "full" : "cut-length";
          pieces.push({
            id,
            rowIndex: k,
            indexInRow: idx,
            poly: ring,
            faceLength: runLen,
            faceWidth: crossLen,
            kind,
            isRipped: crossLen < bw - EPS,
          });
          // One cut-demand per piece: cut to its run length, at the row's width.
          demand.push({ pieceId: id, rowIndex: k, indexInRow: idx, length: runLen, width: crossLen, kind });
        }
      }
    });
  });
  if (!pieces.length) return null;

  // Pack the cut lengths onto boards with offcut reuse → realistic board count.
  const cut = assignCuts(demand, bl, t.kerf, t.minPiece);
  const sourceById = new Map(cut.cutList.map((c) => [c.pieceId, c]));
  for (const p of pieces) {
    const c = sourceById.get(p.id);
    if (!c) continue;
    if (c.reused) p.fromOffcutId = c.source;
    else p.sourceBoardId = c.source;
  }

  // Highlight any leftover slivers (small fragments around concave corners).
  markUndersized(pieces, t.minPiece, t.minRowWidth);

  const coveredAreaMm2 = region.reduce((s, r) => s + Math.abs(ringsArea([r])), 0);
  const material = computeMaterial({
    cut,
    board,
    boardsPerPack: resolveBoardsPerPack(inputs.pack, board),
    boardsOnHand: inputs.boardsOnHand,
    coveredAreaMm2,
    safetyMarginPct: t.safetyMarginPct,
  });

  const geometry: Geometry = {
    runAxis,
    crossAxis: runIsX ? "Y" : "X",
    runLength: runSpan,
    crossWidthStart: crossMax - crossMin,
    crossWidthEnd: crossMax - crossMin,
    crossVaries: false,
    innerOrigin: { x: bb.minX, y: bb.minY } as Point,
  };
  // A single-piece row (or a one-row layout) has no interior seams, so the
  // stagger is vacuously fine — only finite observations gate validity.
  const staggerValid =
    !Number.isFinite(minObservedStagger) || gte(minObservedStagger, t.minStagger);
  const observed = Number.isFinite(minObservedStagger) ? minObservedStagger : bl;
  const stagger: StaggerInfo = {
    achievedStagger: observed,
    minObservedStagger,
    phases: new Set(startLens.map((s) => Math.round(s))).size,
    naturalStagger: observed,
    nearMultipleTrap: false,
    usedMultiPiecePattern: false,
  };
  const score: PlanScore = {
    valid: staggerValid,
    staggerScore: observed,
    balanceScore: 1,
    wastePct: material.consumedWastePct,
  };
  const diagnostics: Diagnostic[] = [
    {
      severity: "info",
      code: "poly.heuristic",
      message:
        "Custom shape: rows are balanced and boards are clipped to the outline, with offcut reuse. Cut pieces around concave corners are an estimate — verify the trickier cuts on site.",
    },
  ];
  if (!staggerValid)
    diagnostics.push({
      severity: "warn",
      code: "stagger.belowMin",
      message: `Adjacent-row stagger (${Math.round(minObservedStagger)} mm) is below the minimum (${t.minStagger} mm). On this shape no start offset clears it — increase the expansion gap, change the board length, or accept the closer joint.`,
    });
  const sliver = undersizedDiagnostic(pieces, t.minPiece, t.minRowWidth);
  if (sliver) diagnostics.push(sliver);

  return {
    runAxis,
    geometry,
    layoutOptions: [
      {
        kind: "unbalanced",
        recommended: true,
        reason: "Boards laid straight and clipped to the room outline.",
        rows: [],
      },
    ],
    chosenOptionIndex: 0,
    rows: [],
    pieces,
    stagger,
    taper: undefined,
    cutList: cut.cutList,
    reuseMap: cut.reuseMap,
    material,
    valid: staggerValid,
    diagnostics,
    score,
  };
}
