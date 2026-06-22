import { balanceRows, type LayoutOptionDraft, type RowWidth } from "./balance.ts";
import { chooseAxis } from "./compare.ts";
import { type DemandPiece, assignCuts } from "./cutting.ts";
import { computeGeometry, crossWidthAt, toRoom } from "./geometry.ts";
import { buildPolygonPlan } from "./polyLayout.ts";
import { asRect, longAxis } from "./room.ts";
import { markUndersized } from "./slivers.ts";
import { planRowPieces, planStagger, seamsOf } from "./stagger.ts";
import { computeTaper } from "./taper.ts";
import type {
  Axis,
  Diagnostic,
  Geometry,
  Inputs,
  LayoutOption,
  Piece,
  Plan,
  PlanResult,
  PlanScore,
  Point,
  Row,
} from "./types.ts";
import { resolveBoardsPerPack, validateInputs } from "./validate.ts";
import { computeMaterial } from "./waste.ts";
import { EPS, type Mm, approxEq, gte, lt } from "./units.ts";

// ───────────────────────── materialisation ─────────────────────────

/** Build full Row objects (widths, flags, piece lengths, seams) for a draft. */
function rowsFromDraft(
  draft: LayoutOptionDraft,
  geom: Geometry,
  startOffsets: readonly Mm[],
  bl: Mm,
): Row[] {
  const rowWidths = draft.rowWidths;
  const lastIdx = rowWidths.length - 1;
  return rowWidths.map((rw: RowWidth, i): Row => {
    const startOffset = startOffsets[i] ?? geom.runLength;
    const pieceLengths = planRowPieces(geom.runLength, bl, startOffset);
    const isTaper = geom.crossVaries && i === lastIdx;
    const outOfSquare = geom.crossWidthStart - geom.crossWidthEnd;
    // Cross widths sum so far → this row's outer boundary at run-end.
    const rowWidthEnd = isTaper ? rw.width - outOfSquare : rw.width;
    return {
      index: i,
      rowWidth: rw.width,
      rowWidthEnd,
      isEndRow: rw.isEndRow,
      isRipped: rw.isRipped || isTaper,
      isTaper,
      pieceLengths,
      seamPositions: seamsOf(pieceLengths, geom.runLength),
      startOffset,
    };
  });
}

/** Cumulative cross start position (from the straight wall) for each row. */
function crossStarts(rows: readonly Row[]): Mm[] {
  const starts: Mm[] = [];
  let acc = 0;
  for (const r of rows) {
    starts.push(acc);
    acc += r.rowWidth;
  }
  return starts;
}

function pieceKind(row: Row, length: Mm, bl: Mm): Piece["kind"] {
  if (row.isTaper) return "taper";
  if (approxEq(length, bl)) return "full";
  return "cut-length";
}

/** Build drawable pieces (polygons in room mm) for a set of rows. */
export function piecesForOption(geom: Geometry, rows: readonly Row[], bl: Mm): Piece[] {
  const starts = crossStarts(rows);
  const pieces: Piece[] = [];
  rows.forEach((row, i) => {
    const crossStart = starts[i]!;
    let runPos = 0;
    row.pieceLengths.forEach((len, j) => {
      const runEnd = runPos + len;
      let poly: Point[];
      let faceWidthNarrow: number | undefined;
      if (row.isTaper) {
        // Outer cross edge follows the slanted wall (varies along the run).
        const outerAtStart = crossWidthAt(geom, runPos / geom.runLength);
        const outerAtEnd = crossWidthAt(geom, runEnd / geom.runLength);
        poly = [
          toRoom(geom, runPos, crossStart),
          toRoom(geom, runEnd, crossStart),
          toRoom(geom, runEnd, outerAtEnd),
          toRoom(geom, runPos, outerAtStart),
        ];
        faceWidthNarrow = Math.min(outerAtStart, outerAtEnd) - crossStart;
      } else {
        const crossEnd = crossStart + row.rowWidth;
        poly = [
          toRoom(geom, runPos, crossStart),
          toRoom(geom, runEnd, crossStart),
          toRoom(geom, runEnd, crossEnd),
          toRoom(geom, runPos, crossEnd),
        ];
      }
      pieces.push({
        id: `r${i}-p${j}`,
        rowIndex: i,
        indexInRow: j,
        poly,
        faceLength: len,
        faceWidth: row.rowWidth,
        faceWidthNarrow,
        kind: pieceKind(row, len, bl),
        isRipped: row.isRipped,
      });
      runPos = runEnd;
    });
  });
  return pieces;
}

function demandFromPieces(pieces: readonly Piece[]): DemandPiece[] {
  return pieces.map((p) => ({
    pieceId: p.id,
    rowIndex: p.rowIndex,
    indexInRow: p.indexInRow,
    length: p.faceLength,
    width: p.faceWidth,
    kind: p.kind,
  }));
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
  const minEnd = endRows.length ? Math.min(...endRows.map((r) => r.rowWidth)) : bw;
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

export function buildPlanForAxis(inputs: Inputs, runAxis: Axis): Plan {
  const { board, gap, tunables: t } = inputs;
  const rect = asRect(inputs.room);
  if (!rect) throw new Error("buildPlanForAxis requires a rectangular/quad room outline");
  const geom = computeGeometry(rect, gap, runAxis, t.squareTol);

  // Balance using the wide end so no row goes sub-min there.
  const wWide = Math.max(geom.crossWidthStart, geom.crossWidthEnd);
  const balanced = balanceRows(wWide, board.width, t.minRowWidth);
  // Flip mirrors the cross-axis row order (cut row against the opposite wall).
  // It is a pure mirror — same pieces, same waste — so it only moves seams, not
  // material. Suppressed when the cross width tapers: there the cut/taper row is
  // pinned to the slanted wall and can't be freely swapped.
  const flip = inputs.flip === true && !geom.crossVaries;
  const drafts = flip
    ? balanced.map((d) => ({ ...d, rowWidths: [...d.rowWidths].reverse() }))
    : balanced;

  // Stagger (identical row count across options → planned once).
  const rowCount = drafts[0]?.rowWidths.length ?? 1;
  const stagger = planStagger(
    geom.runLength,
    board.length,
    rowCount,
    t.minPiece,
    t.minStagger,
    t.idealStagger,
  );

  // Build rows + options.
  const optionRows = drafts.map((d) => rowsFromDraft(d, geom, stagger.startOffsets, board.length));
  const chosenIdx = Math.max(
    0,
    drafts.findIndex((d) => d.recommended),
  );
  const chosenRows = optionRows[chosenIdx]!;

  const layoutOptions: LayoutOption[] = drafts.map((d, i) => ({
    kind: d.kind,
    recommended: d.recommended,
    reason: d.reason,
    rows: optionRows[i]!,
  }));

  const pieces = piecesForOption(geom, chosenRows, board.length);
  markUndersized(pieces, t.minPiece, t.minRowWidth);
  const demand = demandFromPieces(pieces);

  // Taper.
  const slantWallGap = geom.crossAxis === "X" ? gap.right : gap.far;
  const lastRow = chosenRows[chosenRows.length - 1]!;
  const taper = geom.crossVaries
    ? computeTaper(geom, lastRow.rowWidth, t.minRowWidth, t.minGap, slantWallGap)
    : undefined;

  // Cutting.
  const cut = assignCuts(demand, board.length, t.kerf, t.minPiece);
  // Attach sources back onto pieces.
  const sourceById = new Map(cut.cutList.map((c) => [c.pieceId, c]));
  for (const p of pieces) {
    const c = sourceById.get(p.id);
    if (!c) continue;
    if (c.reused) p.fromOffcutId = c.source;
    else p.sourceBoardId = c.source;
  }

  // Material — covered area is the trapezoid (gap-excluded) usable floor.
  const coveredAreaMm2 = ((geom.crossWidthStart + geom.crossWidthEnd) / 2) * geom.runLength;
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
  const minPieceLen = pieces.length ? Math.min(...pieces.map((p) => p.faceLength)) : board.length;
  const draftValid = drafts[chosenIdx]?.valid ?? false;
  const staggerValid =
    !Number.isFinite(stagger.info.minObservedStagger) ||
    gte(stagger.info.minObservedStagger, t.minStagger);
  const pieceValid = gte(minPieceLen, t.minPiece);
  const taperValid = taper ? taper.ok : true;
  const valid = draftValid && staggerValid && pieceValid && taperValid;

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
  if (stagger.info.nearMultipleTrap)
    diagnostics.push({
      severity: "info",
      code: "stagger.trap",
      message: `Run length is close to a board multiple (a simple 2-piece pattern would only stagger ~${Math.round(stagger.info.naturalStagger)} mm). Using a ${stagger.info.phases}-piece pattern staggered ${Math.round(stagger.info.achievedStagger)} mm instead.`,
    });
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
      message: `Out-of-square ${Math.round(taper.outOfSquareMm)} mm over ${(geom.runLength / 1000).toFixed(2)} m (≈${taper.approxAngleDeg.toFixed(2)}°): last row tapers ${Math.round(taper.taperWideMm)} → ${Math.round(taper.taperNarrowMm)} mm, gap held at ${Math.round(taper.tightGapMm)} mm.`,
    });

  const score = scorePlan(
    chosenRows,
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
    rows: chosenRows,
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
  const geom = computeGeometry(rect, inputs.gap, axis, inputs.tunables.squareTol);
  if (lt(geom.runLength, inputs.tunables.minPiece) || lt(geom.crossWidthStart, EPS)) return null;
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
      message:
        "Both axes are out of square (general quadrilateral). The field is laid parallel to the straighter pair and one row is tapered; verify the second taper on site.",
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
