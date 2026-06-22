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
import { EPS, type Mm, approxEq } from "./units.ts";

const PHASES = 3; // staggered start offsets cycle through bl/3 steps

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

  const phaseOffset = Math.round(bl / PHASES);
  const pieces: Piece[] = [];
  const demand: DemandPiece[] = [];

  let crossStart = crossMin;
  rowWidths.forEach((rw, k) => {
    const w = rw.width;
    const rowCross = crossStart;
    crossStart += w;
    // Phase-staggered start piece: rows cycle bl, 2·bl/3, bl/3 → ~bl/3 stagger.
    const startLen = bl - (k % PHASES) * phaseOffset;
    // Clip the full-run strip to the region first: a cavity wall (e.g. the inner
    // wall of an L) shortens this row, so we tile within its *actual* coverage
    // rather than the global bbox — that's what stops the notch cutting a sliver.
    const strip = boardRect(runMin, rowCross, runSpan, w, runIsX);
    const coverage = clipRings([strip], region).filter((r) => Math.abs(ringsArea([r])) > 1);
    let idx = 0;
    for (const cover of coverage) {
      const span = runRange(cover, runIsX);
      let runPos = span.min;
      for (const segLen of runSegments(span.max - span.min, bl, startLen, t.minPiece)) {
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
    }
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
  const stagger: StaggerInfo = {
    achievedStagger: phaseOffset,
    minObservedStagger: phaseOffset,
    phases: PHASES,
    naturalStagger: phaseOffset,
    nearMultipleTrap: false,
    usedMultiPiecePattern: false,
  };
  const score: PlanScore = {
    valid: true,
    staggerScore: phaseOffset,
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
    valid: true,
    diagnostics,
    score,
  };
}
