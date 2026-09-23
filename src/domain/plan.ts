import { balanceRows, type LayoutOptionDraft, type RowWidth } from "./balance.ts";
import { chooseAxis } from "./compare.ts";
import { assignCuts, demandFromPieces } from "./cutting.ts";
import { computeGeometry, crossWidthAt, runLengthAt, toLocal, toRoom } from "./geometry.ts";
import { type Doorway, openingOnly, passes } from "./openings.ts";
import {
  type Ring,
  clipRings,
  differenceRings,
  isConvexRing,
  measurePiece,
  ringsArea,
  unionRings,
} from "./poly.ts";
import { assignRoles, buildPolygonPlan, chooseRowStart } from "./polyLayout.ts";
import { asRect, longAxis } from "./room.ts";
import { markUndersized, undersizedDiagnostic } from "./slivers.ts";
import { type RowRun, planStagger, seamsOf, tileRun } from "./stagger.ts";
import { computeTaper } from "./taper.ts";
import type {
  Axis,
  Diagnostic,
  Geometry,
  Inputs,
  LayoutOption,
  Piece,
  PieceRole,
  Plan,
  PlanResult,
  PlanScore,
  Row,
} from "./types.ts";
import { resolveBoardsPerPack, validateInputs } from "./validate.ts";
import { computeMaterial } from "./waste.ts";
import { EPS, type Mm, approxEq, differsOnTape, gte, lt } from "./units.ts";

// ───────────────────────── doorways ─────────────────────────

/** Far enough to span any room, for bands clipped against a doorway. */
const BIG: Mm = 1e6;

/**
 * The door openings of a quad room, sorted by how the rows meet them. An
 * opening in a run-start or run-end wall is reached by the rows passing it: their
 * first or last piece runs on into the doorway. An opening in a cross-start or
 * cross-end wall lies beyond the first or last row, so it gets strip rows of its
 * own, clicked onto that row.
 */
interface Doorways {
  runSide: (Doorway & { side: "start" | "end" })[];
  crossSide: (Doorway & { side: "start" | "end" })[];
}

function doorways(inputs: Inputs, geom: Geometry): Doorways {
  // Walls in outline order (0 near, 1 right, 2 far, 3 left) → local side.
  const sides =
    geom.runAxis === "X"
      ? (["crossStart", "runEnd", "crossEnd", "runStart"] as const)
      : (["runStart", "crossEnd", "runEnd", "crossStart"] as const);
  const runSide: Doorways["runSide"] = [];
  const crossSide: Doorways["crossSide"] = [];
  for (const o of openingOnly([geom.inner], inputs)) {
    const side = sides[inputs.openings![o.index]!.wall]!;
    if (side === "crossStart" || side === "crossEnd")
      crossSide.push({ ...o, side: side === "crossStart" ? "start" : "end" });
    else runSide.push({ ...o, side: side === "runStart" ? "start" : "end" });
  }
  return { runSide, crossSide };
}

/** Local (run, cross) bounds of a ring set. */
function localBounds(geom: Geometry, rings: readonly Ring[]) {
  let uMin = Infinity;
  let uMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;
  for (const r of rings)
    for (const p of r) {
      const { u, v } = toLocal(geom, p);
      uMin = Math.min(uMin, u);
      uMax = Math.max(uMax, u);
      vMin = Math.min(vMin, v);
      vMax = Math.max(vMax, v);
    }
  return { uMin, uMax, vMin, vMax };
}

/** A local (run, cross) rectangle in room mm. */
function localRect(geom: Geometry, u0: Mm, u1: Mm, v0: Mm, v1: Mm): Ring {
  return [toRoom(geom, u0, v0), toRoom(geom, u1, v0), toRoom(geom, u1, v1), toRoom(geom, u0, v1)];
}

/** The largest ring of a clip result (null when nothing is left). */
function largest(rings: readonly Ring[]): Ring | null {
  return (
    rings
      .filter((r) => Math.abs(ringsArea([r])) > 1)
      .sort((a, b) => Math.abs(ringsArea([b])) - Math.abs(ringsArea([a])))[0] ?? null
  );
}

// ───────────────────────── materialisation ─────────────────────────

/** A row's cross position, width and usable run, before stagger. */
interface RowFrame {
  crossStart: Mm;
  width: Mm;
  narrow: Mm;
  run: RowRun;
  isEndRow: boolean;
  isRipped: boolean;
  isTaper: boolean;
  /** The doorways its first / last piece reaches into (a row can pass two). */
  leadOpenings: number[];
  trailOpenings: number[];
}

/**
 * Place a draft's rows across the usable floor and measure each row's own run:
 * the run-end wall may slant, so each row (and each of its two long edges) can
 * end at a different length. The row's outer edge stops at the far corner. A row
 * passing a doorway in a run-start / run-end wall reaches into it (lead / trail).
 */
function frameRows(draft: LayoutOptionDraft, geom: Geometry, bw: Mm, doors: Doorways): RowFrame[] {
  const lastIdx = draft.rowWidths.length - 1;
  const crossMin = Math.min(geom.crossWidthStart, geom.crossWidthEnd);
  let acc = 0;
  return draft.rowWidths.map((rw: RowWidth, i): RowFrame => {
    const v0 = acc;
    acc += rw.width;
    const v1 = acc;
    const edgeA = runLengthAt(geom, v0);
    const edgeB = runLengthAt(geom, Math.min(v1, geom.crossWidthEnd));
    const narrow = Math.min(v1, crossMin) - v0;
    const run: RowRun = { length: Math.max(edgeA, edgeB), short: Math.min(edgeA, edgeB) };
    const frame: RowFrame = {
      crossStart: v0,
      width: rw.width,
      narrow,
      run,
      isEndRow: rw.isEndRow,
      isRipped: rw.isRipped || lt(narrow, bw),
      isTaper: geom.crossVaries && i === lastIdx,
      leadOpenings: [],
      trailOpenings: [],
    };
    const band = localRect(geom, -BIG, BIG, v0, v1);
    for (const door of doors.runSide) {
      if (!passes(band, door)) continue; // only clips the frame: no tab under it
      const reach = clipRings([band], door.rings).filter((r) => Math.abs(ringsArea([r])) > 1);
      if (!reach.length) continue;
      // A row passing the doorway is clipped with it joined on, even where a
      // slanted wall leaves the doorway within the row's reach already.
      const { uMin, uMax } = localBounds(geom, reach);
      if (door.side === "start") {
        run.lead = Math.max(run.lead ?? 0, -uMin, 0);
        frame.leadOpenings.push(door.index);
      } else {
        run.trail = Math.max(run.trail ?? 0, uMax - run.length, 0);
        frame.trailOpenings.push(door.index);
      }
    }
    return frame;
  });
}

/** Build full Row objects (frames + stagger → piece lengths and seams). */
function buildRows(frames: readonly RowFrame[], startOffsets: readonly Mm[], bl: Mm): Row[] {
  return frames.map((f, i): Row => {
    const startOffset = startOffsets[i] ?? f.run.length;
    const pieceLengths = tileRun(f.run, bl, startOffset);
    return {
      index: i,
      crossStart: f.crossStart,
      rowWidth: f.width,
      rowWidthNarrow: f.narrow,
      runLength: f.run.length,
      runLengthShort: f.run.short,
      isEndRow: f.isEndRow,
      isRipped: f.isRipped,
      isTaper: f.isTaper,
      pieceLengths,
      seamPositions: seamsOf(pieceLengths, f.run.length),
      startOffset,
      ...(f.run.lead ? { lead: f.run.lead } : {}),
      ...(f.run.trail ? { trail: f.run.trail } : {}),
    };
  });
}

/** A second edge measurement, reported only when it reads differently on a tape. */
function ifDiffers(a: Mm, b: Mm): Mm | undefined {
  return differsOnTape(a, b) ? Math.min(a, b) : undefined;
}

/** Role of piece `j` of `n` in a row or span, unless it spans a whole board. */
function roleAt(j: number, n: number, whole: boolean): PieceRole {
  if (whole) return "full";
  if (n === 1) return "free";
  return j === 0 ? "start" : j === n - 1 ? "end" : "full";
}

/** A row's first / last piece where it reaches into a doorway. */
function doorwayPiece(
  geom: Geometry,
  row: Row,
  j: number,
  n: number,
  poly: Ring,
  bl: Mm,
  bw: Mm,
  frame: RowFrame,
  intoLead: boolean,
): Piece {
  const m = measurePiece(poly, geom.runAxis === "X");
  const whole = approxEq(m.lenA, bl) && approxEq(m.lenB, bl);
  return {
    id: `r${row.index}-p${j}`,
    rowIndex: row.index,
    indexInRow: j,
    poly,
    faceLength: m.faceLength,
    faceLengthShort: m.faceLengthShort,
    faceWidth: m.faceWidth,
    faceWidthNarrow: m.faceWidthNarrow,
    narrowAtEnd: m.narrowAtEnd,
    kind: row.isTaper ? "taper" : whole ? "full" : "cut-length",
    role: roleAt(j, n, whole),
    isRipped: lt(Math.min(m.faceWidth, m.faceWidthNarrow ?? m.faceWidth), bw),
    opening: (intoLead ? frame.leadOpenings : frame.trailOpenings)[0],
    notched: !isConvexRing(poly),
  };
}

/**
 * Strip rows for doorways beyond the first or last row: the floor carries on
 * into the opening as extra rows (usually one narrow strip), clicked onto that
 * row and staggered against it. Rows are numbered on outward from the room's
 * (−1, −2, … before the first row; n, n+1, … after the last).
 */
function doorwayStrips(
  geom: Geometry,
  rows: readonly Row[],
  doors: Doorways,
  t: Inputs["tunables"],
  bl: Mm,
  bw: Mm,
): Piece[] {
  const pieces: Piece[] = [];
  const runIsX = geom.runAxis === "X";
  for (const door of doors.crossSide) {
    const { vMin, vMax } = localBounds(geom, door.rings);
    const start = door.side === "start";
    const edge = rows[start ? 0 : rows.length - 1];
    if (!edge) continue;
    const total = start ? -vMin : vMax - vMin;
    const drafts = balanceRows(total, bw, t.minRowWidth);
    const widths = (drafts.find((d) => d.recommended) ?? drafts[0])!.rowWidths.map((w) => w.width);
    let prev: number[] = [...edge.seamPositions];
    let prev2: number[] = [];
    let acc = 0;
    widths.forEach((w, k) => {
      const [va, vb] = start ? [-(acc + w), -acc] : [vMin + acc, vMin + acc + w];
      acc += w;
      const rowIndex = start ? -1 - k : rows.length + k;
      const coverage = clipRings([localRect(geom, -BIG, BIG, va, vb)], door.rings).filter(
        (r) => Math.abs(ringsArea([r])) > 1,
      );
      const spans = coverage.map((r) => {
        const b = localBounds(geom, [r]);
        return { min: b.uMin, max: b.uMax };
      });
      const choice = chooseRowStart(spans, prev, prev2, bl, t.minPiece, t.minStagger, 0, 0);
      let idx = 0;
      const first = pieces.length;
      spans.forEach((span, s) => {
        const segs = choice.perSpan[s]!;
        let u = span.min;
        segs.forEach((len, j) => {
          const poly = largest(clipRings([localRect(geom, u, u + len, va, vb)], door.rings));
          u += len;
          if (!poly) return;
          const m = measurePiece(poly, runIsX);
          const whole = approxEq(m.lenA, bl) && approxEq(m.lenB, bl);
          pieces.push({
            id: `d${door.index}-r${rowIndex}-p${idx}`,
            rowIndex,
            indexInRow: idx++,
            poly,
            faceLength: m.faceLength,
            faceLengthShort: m.faceLengthShort,
            faceWidth: m.faceWidth,
            faceWidthNarrow: m.faceWidthNarrow,
            narrowAtEnd: m.narrowAtEnd,
            kind: whole && approxEq(m.faceWidth, bw) ? "full" : "cut-length",
            role: roleAt(j, segs.length, whole),
            isRipped: lt(Math.min(m.faceWidth, m.faceWidthNarrow ?? m.faceWidth), bw),
            opening: door.index,
            notched: !isConvexRing(poly),
          });
        });
      });
      assignRoles(pieces.slice(first), runIsX, bl);
      prev2 = prev;
      prev = choice.seams;
    });
  }
  return pieces;
}

/**
 * Build the pieces for a set of rows. Each piece is its board rectangle clipped
 * to the usable floor, so a slanted wall is followed exactly. Dimensions are
 * measured the way they are marked on a board (cut to length first, then rip):
 * the length along each long edge (they differ for an angled end cut) and the
 * width at each end (they differ for a taper rip).
 */
function buildPieces(
  geom: Geometry,
  rows: readonly Row[],
  frames: readonly RowFrame[],
  bl: Mm,
  bw: Mm,
  doors: Doorways,
): Piece[] {
  const pieces: Piece[] = [];
  for (const row of rows) {
    const v0 = row.crossStart;
    const v1 = v0 + row.rowWidth;
    const vOuter = Math.min(v1, geom.crossWidthEnd); // outer edge stops at the far corner
    const n = row.pieceLengths.length;
    let u0 = 0;
    row.pieceLengths.forEach((len, j) => {
      const u1 = u0 + len;
      // A first / last piece reaching into a doorway is its rectangle clipped to
      // the floor with the doorway joined on, measured from the shape it takes.
      const frame = frames[row.index]!;
      const intoLead = j === 0 && frame.leadOpenings.length > 0;
      const intoTrail = j === n - 1 && frame.trailOpenings.length > 0;
      if (intoLead || intoTrail) {
        const lead = intoLead ? (row.lead ?? 0) : 0;
        const trail = intoTrail ? (row.trail ?? 0) : 0;
        const passed = doors.runSide.filter(
          (d) =>
            (intoLead && frame.leadOpenings.includes(d.index)) ||
            (intoTrail && frame.trailOpenings.includes(d.index)),
        );
        // Join the whole opening (it overlaps the floor's edge), not just the
        // part beyond it: two shapes that merely touch may not merge.
        const floor = unionRings([geom.inner, ...passed.map((d) => d.full)]);
        const poly = largest(clipRings([localRect(geom, u0 - lead, u1 + trail, v0, v1)], floor));
        if (poly) pieces.push(doorwayPiece(geom, row, j, n, poly, bl, bw, frame, intoLead));
        u0 = u1;
        return;
      }
      const lenA = Math.min(u1, runLengthAt(geom, v0)) - u0;
      const lenB = Math.min(u1, runLengthAt(geom, vOuter)) - u0;
      const wStart = Math.min(v1, crossWidthAt(geom, u0)) - v0;
      const wEnd = Math.min(v1, crossWidthAt(geom, Math.min(u1, geom.runLengthEnd))) - v0;
      const faceLength = Math.max(lenA, lenB);
      const faceWidth = Math.max(wStart, wEnd);
      const faceWidthNarrow = ifDiffers(wStart, wEnd);

      const rect = [
        toRoom(geom, u0, v0),
        toRoom(geom, u1, v0),
        toRoom(geom, u1, v1),
        toRoom(geom, u0, v1),
      ];
      // Only pieces a slanted wall reaches need clipping; the rest are exact rects.
      const inside =
        u1 <= Math.min(runLengthAt(geom, v0), runLengthAt(geom, v1)) + 1e-6 &&
        v1 <= Math.min(crossWidthAt(geom, u0), crossWidthAt(geom, u1)) + 1e-6;
      const poly = inside
        ? rect
        : clipRings([rect], [geom.inner])
            .filter((r) => Math.abs(ringsArea([r])) > 1)
            .sort((a, b) => Math.abs(ringsArea([b])) - Math.abs(ringsArea([a])))[0];
      if (!poly) {
        u0 = u1;
        return; // wholly outside the floor (only in an invalid layout)
      }

      const whole = approxEq(lenA, bl) && approxEq(lenB, bl);
      const role = roleAt(j, n, whole);
      pieces.push({
        id: `r${row.index}-p${j}`,
        rowIndex: row.index,
        indexInRow: j,
        poly,
        faceLength,
        faceLengthShort: ifDiffers(lenA, lenB),
        faceWidth,
        faceWidthNarrow,
        narrowAtEnd: faceWidthNarrow === undefined ? undefined : wEnd < wStart,
        kind: row.isTaper ? "taper" : whole ? "full" : "cut-length",
        role,
        isRipped: lt(Math.min(wStart, wEnd), bw),
      });
      u0 = u1;
    });
  }
  return pieces;
}

// ───────────────────────── per-axis plan ─────────────────────────

function scorePlan(
  rows: readonly Row[],
  bw: Mm,
  minObservedStagger: Mm,
  achievedStagger: Mm,
  valid: boolean,
  wastePct: number,
): PlanScore {
  const endRows = rows.filter((r) => r.isEndRow);
  const minEnd = endRows.length ? Math.min(...endRows.map((r) => r.rowWidthNarrow)) : bw;
  // Any border at least half a board is "good-looking"; below that it is
  // penalised so balance only overrides waste when a border is genuinely thin.
  const half = bw / 2;
  const balanceScore = gte(minEnd, half) ? 1 : minEnd / half;
  return {
    valid,
    staggerScore: Number.isFinite(minObservedStagger) ? minObservedStagger : achievedStagger,
    balanceScore,
    wastePct,
  };
}

/** Layout options (balanced / unbalanced border rows) for a quad-room orientation. */
function layoutDrafts(inputs: Inputs, geom: Geometry): LayoutOptionDraft[] {
  const t = inputs.tunables;
  // Balance at the wide end; the last row absorbs the whole taper.
  const wWide = Math.max(geom.crossWidthStart, geom.crossWidthEnd);
  const taper = Math.abs(geom.crossWidthStart - geom.crossWidthEnd);
  const balanced = balanceRows(wWide, inputs.board.width, t.minRowWidth, taper);
  // Flip mirrors the cross-axis row order (cut row against the opposite wall).
  // For a rectangle it is a pure mirror — same pieces, same waste. Suppressed
  // when the cross width tapers: there the cut/taper row is pinned to the
  // slanted wall and can't be freely swapped.
  const flip = inputs.flip === true && !geom.crossVaries;
  return flip ? balanced.map((d) => ({ ...d, rowWidths: [...d.rowWidths].reverse() })) : balanced;
}

/**
 * Build the plan for one orientation of a quad room. `optionIndex` selects a
 * layout option (balanced / unbalanced borders); by default the recommended one.
 * Everything in the result — pieces, cut list, material — belongs to that option.
 */
export function buildPlanForAxis(inputs: Inputs, runAxis: Axis, optionIndex?: number): Plan {
  const { board, gap, tunables: t } = inputs;
  const rect = asRect(inputs.room);
  if (!rect) throw new Error("buildPlanForAxis requires a rectangular/quad room outline");
  const geom = computeGeometry(rect, gap, runAxis, t.squareTol);
  if (!geom) throw new Error("buildPlanForAxis requires a convex quad with usable floor");

  const drafts = layoutDrafts(inputs, geom);
  const recommendedIdx = Math.max(
    0,
    drafts.findIndex((d) => d.recommended),
  );
  const chosenIdx =
    optionIndex !== undefined && optionIndex >= 0 && optionIndex < drafts.length
      ? optionIndex
      : recommendedIdx;
  const draft = drafts[chosenIdx]!;

  const layoutOptions: LayoutOption[] = drafts.map((d) => ({
    kind: d.kind,
    recommended: d.recommended,
    reason: d.reason,
    valid: d.valid,
  }));

  // Rows, each with its own run (row ends differ where the run-end wall slants,
  // and rows passing a doorway reach into it).
  const doors = doorways(inputs, geom);
  const frames = frameRows(draft, geom, board.width, doors);
  const stagger = planStagger(
    frames.map((f) => f.run),
    board.length,
    t.minPiece,
    t.minStagger,
    t.idealStagger,
    t.staggerRandomness ?? 0,
    t.staggerSeed ?? 1,
  );
  const rows = buildRows(frames, stagger.startOffsets, board.length);

  const pieces = [
    ...buildPieces(geom, rows, frames, board.length, board.width, doors),
    ...doorwayStrips(geom, rows, doors, t, board.length, board.width),
  ];
  markUndersized(pieces, t.minPiece, t.minRowWidth);

  // Taper.
  const slantWallGap = geom.crossAxis === "X" ? gap.right : gap.far;
  const lastRow = rows[rows.length - 1]!;
  const taper = geom.crossVaries
    ? computeTaper(geom, lastRow.rowWidth, t.minRowWidth, t.minGap, slantWallGap)
    : undefined;

  // Cutting.
  const cut = assignCuts(demandFromPieces(pieces), board.length, t.kerf);
  // Attach sources back onto pieces.
  const sourceById = new Map(cut.cutList.map((c) => [c.pieceId, c]));
  for (const p of pieces) {
    const c = sourceById.get(p.id);
    if (!c) continue;
    if (c.reused) p.fromOffcutId = c.source;
    else p.sourceBoardId = c.source;
  }

  // Material — covered area is the exact usable (gap-inset) floor, plus whatever
  // the doorway pieces cover (the clear openings, and under the frames they reach).
  const coveredAreaMm2 =
    Math.abs(ringsArea([geom.inner])) +
    pieces
      .filter((p) => p.opening !== undefined)
      .reduce(
        (s, p) => s + Math.abs(ringsArea([differenceRings([p.poly], [geom.inner])].flat())),
        0,
      );
  const material = computeMaterial({
    cut,
    board,
    boardsPerPack: resolveBoardsPerPack(inputs.pack, board),
    boardsOnHand: inputs.boardsOnHand,
    coveredAreaMm2,
    safetyMarginPct: t.safetyMarginPct,
  });

  // Validity gate + diagnostics.
  const diagnostics: Diagnostic[] = [];
  // A doorway strip clicks onto the long edge of the row beside it — impossible
  // when that edge was ripped off to fit the wall.
  for (const door of doors.crossSide) {
    const edge = rows[door.side === "start" ? 0 : rows.length - 1];
    if (edge?.isRipped)
      diagnostics.push({
        severity: "warn",
        code: "opening.rippedEdge",
        message: `The row along door ${door.index + 1}'s wall is ripped on the doorway side, so the doorway strip can't click onto it — flip the border row to the other wall, or glue the strip.`,
      });
  }
  const shortest = (p: Piece) => Math.min(p.faceLength, p.faceLengthShort ?? p.faceLength);
  const minPieceLen = pieces.length ? Math.min(...pieces.map(shortest)) : board.length;
  const draftValid = draft.valid;
  const staggerValid =
    !Number.isFinite(stagger.info.minObservedStagger) ||
    gte(stagger.info.minObservedStagger, t.minStagger);
  const pieceValid = gte(minPieceLen, t.minPiece);
  const noSlivers = !pieces.some((p) => p.undersized);
  const taperValid = taper ? taper.ok : true;
  const valid = draftValid && staggerValid && pieceValid && noSlivers && taperValid;

  if (!draftValid)
    diagnostics.push({
      severity: "error",
      code: "row.belowMin",
      message: `A first/last row falls below the minimum row width (${t.minRowWidth} mm).`,
    });
  if (!staggerValid)
    diagnostics.push({
      severity: "warn",
      code: "stagger.belowMin",
      message: `Adjacent-row stagger (${Math.round(stagger.info.minObservedStagger)} mm) is below the minimum (${t.minStagger} mm).`,
    });
  if (!pieceValid)
    diagnostics.push({
      severity: "warn",
      code: "piece.belowMin",
      message: `A cut piece (${Math.round(minPieceLen)} mm) is below the minimum piece length (${t.minPiece} mm).`,
    });
  if (stagger.info.nearMultipleTrap) {
    const obs = Number.isFinite(stagger.info.minObservedStagger)
      ? stagger.info.minObservedStagger
      : stagger.info.achievedStagger;
    diagnostics.push({
      severity: "info",
      code: "stagger.trap",
      message: stagger.info.usedMultiPiecePattern
        ? `Run length is close to a board multiple (a simple 2-piece pattern would only stagger ~${Math.round(stagger.info.naturalStagger)} mm). Using a ${stagger.info.phases}-piece pattern staggered ${Math.round(stagger.info.achievedStagger)} mm instead.`
        : `Run length is close to a board multiple (a simple 2-piece pattern would only stagger ~${Math.round(stagger.info.naturalStagger)} mm). The randomised pattern keeps adjacent joints ≥ ${Math.round(obs)} mm.`,
    });
  }
  if (taper && !taper.ok)
    diagnostics.push({
      severity: "warn",
      code: "taper.tight",
      message: `Taper row narrows to ${Math.round(taper.taperNarrowMm)} mm at the tight end (min row ${t.minRowWidth} mm, min gap ${t.minGap} mm) — verify on site or try the other orientation.`,
    });
  else if (taper)
    diagnostics.push({
      severity: "info",
      code: "taper.ok",
      message: `Out-of-square ${Math.round(taper.outOfSquareMm)} mm over ${(geom.runLengthEnd / 1000).toFixed(2)} m (≈${taper.approxAngleDeg.toFixed(2)}°): last row tapers ${Math.round(taper.taperWideMm)} → ${Math.round(taper.taperNarrowMm)} mm, gap held at ${Math.round(taper.tightGapMm)} mm.`,
    });
  const rowSpread =
    Math.max(...rows.map((r) => r.runLength)) - Math.min(...rows.map((r) => r.runLengthShort));
  if (geom.runVaries && rowSpread >= 1)
    diagnostics.push({
      severity: "info",
      code: "run.angled",
      message: `The wall at the row ends is ${Math.round(Math.abs(geom.runLength - geom.runLengthEnd))} mm out of square, so rows end at different lengths (${Math.round(Math.min(...rows.map((r) => r.runLengthShort)))}–${Math.round(Math.max(...rows.map((r) => r.runLength)))} mm). Each row's end piece is sized for its own row — cut to the cut list, not to one length.`,
    });
  if (pieceValid && draftValid && taperValid && !noSlivers) {
    const sliver = undersizedDiagnostic(pieces, t.minPiece, t.minRowWidth);
    if (sliver) diagnostics.push(sliver);
  }

  const score = scorePlan(
    rows,
    board.width,
    stagger.info.minObservedStagger,
    stagger.info.achievedStagger,
    valid,
    material.consumedWastePct,
  );

  return {
    runAxis,
    geometry: geom,
    layoutOptions,
    chosenOptionIndex: chosenIdx,
    rows,
    pieces,
    stagger: stagger.info,
    taper,
    cutList: cut.cutList,
    reuseMap: cut.reuseMap,
    material,
    valid,
    diagnostics,
    score,
  };
}

// ───────────────────────── public API ─────────────────────────

function feasibleAxis(inputs: Inputs, axis: Axis): Plan | null {
  const rect = asRect(inputs.room);
  if (!rect) return buildPolygonPlan(inputs, axis); // multi-wall / non-canonical outline
  const t = inputs.tunables;
  const geom = computeGeometry(rect, inputs.gap, axis, t.squareTol);
  // A concave (or collapsed) quad isn't a rows-and-one-taper floor: clip it.
  if (!geom) return buildPolygonPlan(inputs, axis);
  const runMax = Math.max(geom.runLength, geom.runLengthEnd);
  const crossMax = Math.max(geom.crossWidthStart, geom.crossWidthEnd);
  if (lt(runMax, t.minPiece) || lt(crossMax, EPS)) return null;
  // A slant no single tapered row can absorb (too steep, or no first-row width
  // leaves the last row within a board and above the minimum at both ends) cuts
  // across several rows: lay it with the clip-to-outline engine, on the exact
  // per-wall floor.
  const taper = Math.abs(geom.crossWidthStart - geom.crossWidthEnd);
  if (taper > EPS && !layoutDrafts(inputs, geom).some((d) => d.valid))
    return buildPolygonPlan(inputs, axis, {
      region: [geom.inner],
      note: `The ${axis === "Y" ? "right" : "far"} wall is ${Math.round(taper)} mm out of square — more than one tapered row can absorb here — so several rows are cut along it. Boards are clipped to the outline; verify the angled cuts on site.`,
    });
  return buildPlanForAxis(inputs, axis);
}

/** Detect a general (two-axis) out-of-square quadrilateral. */
function generalQuadDiagnostic(inputs: Inputs): Diagnostic | null {
  const rect = asRect(inputs.room);
  if (!rect) return null;
  const dx = Math.abs(rect.widthNear - rect.widthFar);
  const dy = Math.abs(rect.lengthLeft - rect.lengthRight);
  const tol = inputs.tunables.squareTol;
  if (dx > tol && dy > tol) {
    return {
      severity: "warn",
      code: "room.generalQuad",
      message: `Both wall pairs are out of square (widths differ by ${Math.round(dx)} mm, lengths by ${Math.round(dy)} mm). The plan follows these measurements exactly — one wall tapers the last row, the other angles the row ends — so double-check them: a mis-measured wall looks exactly like this. The near-left corner is assumed square.`,
    };
  }
  return null;
}

/** Compute plans for both orientations and choose the better (unless forced). */
export function computePlans(inputs: Inputs): PlanResult {
  const diagnostics = validateInputs(inputs);
  const hardError = diagnostics.some((d) => d.severity === "error");

  const quad = generalQuadDiagnostic(inputs);
  if (quad) diagnostics.push(quad);

  const planX = hardError ? null : feasibleAxis(inputs, "X");
  const planY = hardError ? null : feasibleAxis(inputs, "Y");

  const forced = inputs.orientation.mode === "forced" ? inputs.orientation.runAxis : null;
  const { axis, comparison } = chooseAxis(planX, planY, forced, longAxis(inputs.room));

  return {
    plans: { X: planX, Y: planY },
    chosenAxis: axis,
    forced: forced !== null,
    comparison,
    diagnostics,
  };
}
