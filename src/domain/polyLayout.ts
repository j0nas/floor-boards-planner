/**
 * Polygon room layout (v3): a row-based field clipped to the outline.
 *
 *  1. Inset the outline by the expansion gap (Clipper2) → usable region.
 *  2. Balance the rows across the cross extent so the leftover never becomes a
 *     sliver (reuses the same border-balancing as the quad engine).
 *  3. Tile each row with staggered boards whose run-direction seams come from the
 *     quad engine's `planRowPieces`, choosing each row's start so no piece is a
 *     run-direction sliver where the geometry allows. Each board is clipped to the
 *     region, so concave corners and cavities split it into the right pieces.
 *  4. Pack the resulting cut lengths onto boards with offcut reuse (the quad
 *     engine's end-aware cutting pass), so the board count and waste are realistic.
 *  5. Flag any remaining slivers (small fragments clipping leaves around concave
 *     corners) so they are highlighted rather than silently mislabelled.
 */
import { balanceRows } from "./balance.ts";
import { assignCuts, demandFromPieces } from "./cutting.ts";
import { openingOnly, passes, withOpenings } from "./openings.ts";
import {
  type Ring,
  bboxOf,
  clipRings,
  insetRoom,
  isConvexRing,
  measurePiece,
  ringsArea,
  unionRings,
} from "./poly.ts";
import { roomOutline } from "./room.ts";
import { markUndersized, undersizedDiagnostic } from "./slivers.ts";
import { pickStaggerIndex, planRowPieces } from "./stagger.ts";
import { resolveBoardsPerPack } from "./validate.ts";
import { computeMaterial } from "./waste.ts";
import type {
  Axis,
  Diagnostic,
  Geometry,
  Inputs,
  Piece,
  PieceRole,
  Plan,
  PlanScore,
  StaggerInfo,
} from "./types.ts";
import { EPS, type Mm, approxEq, gte, makeRng } from "./units.ts";

/** Axis-aligned board rectangle (run along X or Y) of the given run length × width. */
function boardRect(
  runStart: number,
  crossStart: number,
  runLen: number,
  w: number,
  runIsX: boolean,
): Ring {
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

/** Min/max of a ring's bounding box along the run axis. */
function runRange(ring: Ring, runIsX: boolean): { min: number; max: number } {
  const b = bboxOf([ring]);
  return runIsX ? { min: b.minX, max: b.maxX } : { min: b.minY, max: b.maxY };
}

/**
 * Roles for one row's pieces, read from which of their ends butt against
 * another piece of the row (clipping around a notch or doorway can leave a
 * segment's piece at the end of the row, so position alone can't tell).
 * A piece spanning a whole board is "full" wherever it sits.
 */
export function assignRoles(row: readonly Piece[], runIsX: boolean, bl: Mm): void {
  const span = (p: Piece) => {
    const b = bboxOf([p.poly]);
    return runIsX
      ? { u0: b.minX, u1: b.maxX, v0: b.minY, v1: b.maxY }
      : { u0: b.minY, u1: b.maxY, v0: b.minX, v1: b.maxX };
  };
  const s = row.map(span);
  const touches = (a: (typeof s)[number], b: (typeof s)[number]) =>
    Math.min(a.v1, b.v1) - Math.max(a.v0, b.v0) > 0.01;
  row.forEach((p, i) => {
    const me = s[i]!;
    const low = s.some((o, j) => j !== i && Math.abs(o.u1 - me.u0) <= EPS && touches(o, me));
    const high = s.some((o, j) => j !== i && Math.abs(o.u0 - me.u1) <= EPS && touches(o, me));
    const whole = p.faceLength >= bl - EPS && (p.faceLengthShort ?? p.faceLength) >= bl - EPS;
    p.role = whole ? "full" : low ? (high ? "full" : "end") : high ? "start" : "free";
  });
}

/**
 * Run-direction piece lengths for one row span: a `startLen` piece, then full
 * boards, then the end piece. (A short tail is avoided by choosing the start,
 * never by splitting it into two shorter pieces: a piece in the middle of a row
 * must be a whole board, or its cut end has no profile to click into.)
 */
function runSegments(span: Mm, bl: Mm, startLen: Mm): Mm[] {
  return planRowPieces(span, bl, Math.min(startLen, span));
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
): { perSpan: Mm[][]; seams: number[]; minPiece: Mm } {
  const perSpan: Mm[][] = [];
  const seams: number[] = [];
  let minPiece = Number.POSITIVE_INFINITY;
  for (const span of spans) {
    const segs = runSegments(span.max - span.min, bl, startLen);
    // A span too short for more than one piece is what it is, whatever the start.
    if (segs.length > 1) minPiece = Math.min(minPiece, ...segs);
    perSpan.push(segs);
    let acc = span.min;
    for (let i = 0; i < segs.length - 1; i++) {
      acc += segs[i]!;
      seams.push(acc);
    }
  }
  return { perSpan, seams, minPiece };
}

/**
 * Choose a row's start-piece length so its seams clear the rows already laid,
 * validated on the ACTUAL seam positions (rebalanced tail and all) rather than a
 * generating offset — the bug the fixed schedule had was that a rebalanced tail
 * could drop a seam a quarter-board from its neighbour while the plan still
 * claimed a healthy stagger.
 *
 * Starts that would cut a run-direction sliver are dropped first. The picker
 * then saturates each clearance at `minStagger` (once a row is far enough
 * it stops competing) and is lexicographic: clear the immediately adjacent row
 * first, then the skip row (avoids the every-other-row ladder), then maximise the
 * overall spread. `randomness > 0` instead picks a seeded-random start from the
 * still-valid band (`rand` is one PRNG draw), for a less symmetric pattern.
 */
export function chooseRowStart(
  spans: readonly { min: Mm; max: Mm }[],
  prev: readonly number[],
  prev2: readonly number[],
  bl: Mm,
  minPiece: Mm,
  minStagger: Mm,
  randomness: number,
  rand: number,
): { startLen: Mm; seams: number[]; perSpan: Mm[][]; gapPrev: number } {
  // Candidate starts: a full-board start (no leading cut), plus a fine sweep over
  // the legal start-piece range — fine enough to resolve a ~minStagger window.
  const candidates: Mm[] = [bl];
  const steps = 64;
  for (let i = 0; i <= steps; i++) candidates.push(minPiece + ((bl - minPiece) * i) / steps);

  const all = candidates.map((startLen) => {
    const tiling = rowTiling(spans, bl, startLen);
    return {
      startLen,
      ...tiling,
      gapPrev: seamGap(tiling.seams, prev),
      gapPrev2: seamGap(tiling.seams, prev2),
    };
  });
  // Keep only starts that leave no run-direction sliver; when none can, keep the
  // starts whose shortest piece is longest (the sliver is then flagged).
  const bestMin = Math.max(...all.map((c) => Math.min(c.minPiece, minPiece)));
  const scored = all.filter((c) => Math.min(c.minPiece, minPiece) >= bestMin - EPS);
  const idx = pickStaggerIndex(scored, minStagger, bl, randomness, rand);
  const c = scored[idx]!;
  return { startLen: c.startLen, seams: c.seams, perSpan: c.perSpan, gapPrev: c.gapPrev };
}

/** Uniform perimeter gap for a polygon room (the largest of the four walls). */
function uniformGapMm(inputs: Inputs): number {
  const g = inputs.gap;
  return Math.max(g.near, g.far, g.left, g.right);
}

/** Overrides for laying a quad room with this engine. */
export interface PolygonPlanOptions {
  /** The usable floor, when it is known exactly (a quad inset by per-wall gaps). */
  region?: readonly Ring[];
  /** Replaces the custom-shape note, to say why this engine was used. */
  note?: string;
}

/**
 * Build a polygon-room plan for one run axis, or null when no usable region
 * remains (gap too large / degenerate outline).
 */
export function buildPolygonPlan(
  inputs: Inputs,
  runAxis: Axis,
  opts: PolygonPlanOptions = {},
): Plan | null {
  const { board, tunables: t } = inputs;
  const bl = board.length;
  const bw = board.width;
  const main = (opts.region ?? insetRoom(roomOutline(inputs.room), uniformGapMm(inputs))).filter(
    (r) => Math.abs(ringsArea([r])) > 1,
  );
  if (!main.length) return null;
  // Doorways join onto the floor. Rows are balanced over the room itself and
  // carried on outward into any doorway beyond it; a doorway alongside the rows
  // simply lengthens the spans of the rows passing it.
  const region = withOpenings(main, inputs).filter((r) => Math.abs(ringsArea([r])) > 1);
  const doors = openingOnly(main, inputs);
  // A row reaches into a doorway only if it passes the clear opening — one that
  // would only clip the part under the door frame keeps to the room.
  const regionFor = (band: Ring): Ring[] => {
    const reach = doors.filter((d) => passes(band, d));
    if (reach.length === doors.length) return region;
    return reach.length ? unionRings([...main, ...reach.map((d) => d.full)]) : main;
  };
  const openingOf = (ring: Ring): number | undefined =>
    doors.find((d) => clipRings([ring], d.rings).some((r) => Math.abs(ringsArea([r])) > 1))?.index;

  const bb = bboxOf(main);
  const all = bboxOf(region);
  const runIsX = runAxis === "X";
  const runMin = runIsX ? all.minX : all.minY;
  const runMax = runIsX ? all.maxX : all.maxY;
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

  // Stagger is chosen per row against the actual seam positions of the rows
  // already laid (not a fixed schedule keyed on row index): each row's start
  // piece is picked so its butt joints clear the previous one or two rows by at
  // least `minStagger` wherever the run geometry allows.
  const startLens: Mm[] = [];
  let minObservedStagger = Number.POSITIVE_INFINITY;
  const randomness = t.staggerRandomness ?? 0;
  const rng = makeRng(t.staggerSeed ?? 1);

  /** Lay row `k` across [rowCross, rowCross + w]; returns its seams. */
  const lay = (k: number, rowCross: Mm, w: Mm, prev: number[], prev2: number[]): number[] => {
    const first = pieces.length;
    // Clip the full-run strip to the region first: a cavity wall (e.g. the inner
    // wall of an L) shortens this row, so we tile within its *actual* coverage
    // rather than the global bbox — that's what stops the notch cutting a sliver.
    const strip = boardRect(runMin, rowCross, runSpan, w, runIsX);
    const floor = regionFor(strip);
    const coverage = clipRings([strip], floor).filter((r) => Math.abs(ringsArea([r])) > 1);
    const spans = coverage.map((cover) => runRange(cover, runIsX));
    if (!spans.length) return [];
    // Each span's pieces are clipped to that span's own coverage: where a notch
    // splits the row lengthwise, two spans can share run positions.

    const rand = randomness > 0 ? rng() : 0;
    const choice = chooseRowStart(
      spans,
      prev,
      prev2,
      bl,
      t.minPiece,
      t.minStagger,
      randomness,
      rand,
    );
    startLens.push(choice.startLen);
    if (Number.isFinite(choice.gapPrev))
      minObservedStagger = Math.min(minObservedStagger, choice.gapPrev);

    let idx = 0;
    spans.forEach((span, s) => {
      const segs = choice.perSpan[s]!;
      let runPos = span.min;
      segs.forEach((segLen, j) => {
        const rect = boardRect(runPos, rowCross, segLen, w, runIsX);
        runPos += segLen;
        const clipped = clipRings([rect], [coverage[s]!]).filter(
          (r) => Math.abs(ringsArea([r])) > 1,
        );
        for (const ring of clipped) {
          const m = measurePiece(ring, runIsX);
          const whole = approxEq(m.lenA, bl) && approxEq(m.lenB, bl);
          const kind: Piece["kind"] =
            whole && approxEq(m.faceWidth, bw) && m.faceWidthNarrow === undefined
              ? "full"
              : "cut-length";
          // Its place in the span decides which factory end a cut piece keeps.
          const role: PieceRole = whole
            ? "full"
            : segs.length === 1
              ? "free"
              : j === 0
                ? "start"
                : j === segs.length - 1
                  ? "end"
                  : "full";
          const opening = openingOf(ring);
          pieces.push({
            id: `r${k}-p${idx}`,
            rowIndex: k,
            indexInRow: idx++,
            poly: ring,
            faceLength: m.faceLength,
            faceLengthShort: m.faceLengthShort,
            faceWidth: m.faceWidth,
            faceWidthNarrow: m.faceWidthNarrow,
            narrowAtEnd: m.narrowAtEnd,
            kind,
            role,
            isRipped: Math.min(m.faceWidth, m.faceWidthNarrow ?? m.faceWidth) < bw - EPS,
            ...(opening === undefined ? {} : { opening, notched: !isConvexRing(ring) }),
          });
        }
      });
    });
    assignRoles(pieces.slice(first), runIsX, bl);
    return choice.seams;
  };

  // The room's rows, then rows carried on beyond either side into doorways.
  const seams: number[][] = [];
  let crossStart = crossMin;
  rowWidths.forEach((rw, k) => {
    seams.push(lay(k, crossStart, rw.width, seams[k - 1] ?? [], seams[k - 2] ?? []));
    crossStart += rw.width;
  });
  const allCrossMin = runIsX ? all.minY : all.minX;
  const allCrossMax = runIsX ? all.maxY : all.maxX;
  let prev = seams[seams.length - 1] ?? [];
  let prev2 = seams[seams.length - 2] ?? [];
  for (let k = seams.length, c = crossMax; c < allCrossMax - 1; k++, c += bw) {
    const next = lay(k, c, bw, prev, prev2);
    prev2 = prev;
    prev = next;
  }
  prev = seams[0] ?? [];
  prev2 = seams[1] ?? [];
  for (let k = -1, c = crossMin; c > allCrossMin + 1; k--, c -= bw) {
    const next = lay(k, c - bw, bw, prev, prev2);
    prev2 = prev;
    prev = next;
  }
  if (!pieces.length) return null;
  const demand = demandFromPieces(pieces, rowWidths.length);

  // Pack the cut lengths onto boards with offcut reuse → realistic board count.
  const cut = assignCuts(demand, bl, t.kerf);
  const sourceById = new Map(cut.cutList.map((c) => [c.pieceId, c]));
  for (const p of pieces) {
    const c = sourceById.get(p.id);
    if (!c) continue;
    if (c.reused) p.fromOffcutId = c.source;
    else p.sourceBoardId = c.source;
  }

  // Highlight any leftover slivers (small fragments around concave corners).
  markUndersized(pieces, t.minPiece, t.minRowWidth);

  // The floor plus whatever the doorway pieces cover (clear openings, and under
  // the frames where they reach).
  const coveredAreaMm2 = doors.length
    ? pieces.reduce((s, p) => s + Math.abs(ringsArea([p.poly])), 0)
    : region.reduce((s, r) => s + Math.abs(ringsArea([r])), 0);
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
    runLengthEnd: runSpan,
    crossWidthStart: crossMax - crossMin,
    crossWidthEnd: crossMax - crossMin,
    crossVaries: false,
    runVaries: false,
    innerOrigin: { x: bb.minX, y: bb.minY },
    inner: region[0] ?? [],
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
        opts.note ??
        "Custom shape: rows are balanced and boards are clipped to the outline, with offcut reuse. Cut pieces around concave corners are an estimate — verify the trickier cuts on site.",
    },
  ];
  // A custom outline is inset by ONE perimeter gap (the largest of the four), so
  // be explicit when the per-wall gaps differ — tighter walls get the wider gap.
  const g = inputs.gap;
  const gMin = Math.min(g.near, g.far, g.left, g.right);
  const gMax = Math.max(g.near, g.far, g.left, g.right);
  if (!opts.region && gMax - gMin > EPS)
    diagnostics.push({
      severity: "info",
      code: "poly.uniformGap",
      message: `Custom shapes use a single perimeter gap — the largest you set (${Math.round(gMax)} mm) is applied to every wall, so walls set tighter (down to ${Math.round(gMin)} mm) get the wider gap.`,
    });
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
        valid: true,
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
