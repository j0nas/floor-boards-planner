import type { Mm, Mm2 } from "./units.ts";

// ───────────────────────────── Inputs ─────────────────────────────

/** Room coordinate axes. X = width axis, Y = length axis. */
export type Axis = "X" | "Y";

/**
 * Rectangle/quad room measured at both ends of each axis (the legacy model and
 * the on-plan edit form). A single slanted wall shows up as differing pairs.
 * - width is the X extent, measured near the door (Y=0) and at the far wall (Y=max)
 * - length is the Y extent, measured on the left (X=0) and right (X=max) sides
 * A true rectangle has widthNear == widthFar and lengthLeft == lengthRight.
 */
export interface RectMeasurements {
  widthNear: Mm;
  widthFar: Mm;
  lengthLeft: Mm;
  lengthRight: Mm;
}

/**
 * The room as an arbitrary closed polygon outline — the canonical model. A
 * rectangle/quad is just the four-corner case (see `rectRoom` / `asRect`);
 * multi-wall outlines are planned by the polygon path.
 */
export interface RoomShape {
  /** Corner ring in room mm, not closed — the last point connects to the first. */
  outline: readonly Point[];
}

/** Board visible coverage face (excludes tongue). Thickness is build-up only. */
export interface Board {
  length: Mm;
  width: Mm;
  thickness?: Mm;
}

/** Expansion gap per wall (uniform input expands to all-equal). */
export interface ExpansionGap {
  near: Mm; // Y = 0 wall
  far: Mm; // Y = max wall
  left: Mm; // X = 0 wall
  right: Mm; // X = max wall
}

/** Purchasing pack. Either boards/pack or area/pack (mm²) may be given. */
export interface Pack {
  boardsPerPack?: number;
  areaPerPack?: Mm2;
}

export type Orientation = { mode: "auto" } | { mode: "forced"; runAxis: Axis };

/** Tunables with sensible defaults; all lengths in mm. */
export interface Tunables {
  minRowWidth: Mm; // min first/last row width
  minPiece: Mm; // min installed piece length (start/middle/end)
  minStagger: Mm; // min offset between adjacent-row end joints
  idealStagger: Mm; // preferred stagger (~1/3 board)
  kerf: Mm; // saw kerf removed per cut
  squareTol: Mm; // last row shown as a taper (and flip locked) only if |near-far| > this
  minGap: Mm; // min residual expansion gap at the tight taper point
  safetyMarginPct: number; // extra material fraction (e.g. 0.1 = +10%)
  /**
   * How much to randomise the seam pattern, 0..1. 0 keeps the deterministic,
   * regular stagger (every row centred in its feasible band → a symmetric look);
   * higher values pick a seeded-random row start within the *still-valid* band
   * (adjacent stagger ≥ minStagger, every piece ≥ minPiece), for an organic,
   * less repetitive pattern. Never trades away validity for variety.
   */
  staggerRandomness: number;
  /**
   * Seed for the stagger randomisation. The domain stays pure and reproducible
   * (no Math.random): same seed → same pattern. Bump it to "reshuffle".
   */
  staggerSeed: number;
}

export interface Inputs {
  room: RoomShape;
  board: Board;
  gap: ExpansionGap;
  pack: Pack;
  boardsOnHand: number;
  orientation: Orientation;
  /**
   * Mirror the row order across the cross axis, putting the cut (ripped) border
   * row against the opposite wall. Ignored for out-of-square rooms, where the
   * tapered row is pinned to the slanted wall.
   */
  flip?: boolean;
  tunables: Tunables;
}

// ───────────────────────────── Diagnostics ─────────────────────────────

export type Severity = "info" | "warn" | "error";

/** A supporting reference for a recommendation (rendered as a link in the UI). */
export interface Citation {
  /** Short human label, e.g. "Quick-Step (manufacturer)". */
  label: string;
  url: string;
}

export interface Diagnostic {
  severity: Severity;
  code: string;
  message: string;
  /** Sources backing a recommendation, where one applies. */
  sources?: readonly Citation[];
}

// ───────────────────────────── Geometry ─────────────────────────────

export interface Point {
  x: Mm;
  y: Mm;
}

/**
 * Resolved per-orientation geometry. The usable floor (the room inset by each
 * wall's own gap) is a quad in local (run, cross) coordinates measured from the
 * inner corner of the two straight walls:
 *
 *   (0, 0) — (runLength, 0) — (runLengthEnd, crossWidthEnd) — (0, crossWidthStart)
 *
 * The run-end wall joins (runLength, 0)→(runLengthEnd, crossWidthEnd), so row
 * lengths vary across the rows when it slants; the cross-end wall joins
 * (0, crossWidthStart)→(runLengthEnd, crossWidthEnd), so the last row tapers
 * when it slants. A rectangle has runLength == runLengthEnd and
 * crossWidthStart == crossWidthEnd.
 */
export interface Geometry {
  runAxis: Axis;
  crossAxis: Axis;
  /** Usable run length (board-length direction) along the straight cross-start wall. */
  runLength: Mm;
  /** Usable run length along the far (cross-end) side, at the far corner. */
  runLengthEnd: Mm;
  /** Usable cross width along the straight run-start wall. */
  crossWidthStart: Mm;
  /** Usable cross width at the far (run-end) corner. */
  crossWidthEnd: Mm;
  /** True when the cross width varies by more than `squareTol` (the last row is a taper). */
  crossVaries: boolean;
  /** True when the run length varies across the rows (row ends are cut at an angle). */
  runVaries: boolean;
  /** Inner corner of the two straight walls, in room mm (local origin). */
  innerOrigin: Point;
  /** The usable floor polygon in room mm (CCW). */
  inner: readonly Point[];
}

// ───────────────────────────── Pieces & rows ─────────────────────────────

export type PieceKind =
  | "full" // uncut field board
  | "cut-length" // cut along its length (a start/middle/end piece)
  | "taper"; // tapered (trapezoid) piece following a non-parallel wall
// (Ripping to a narrower row is carried by `Piece.isRipped`, not a kind — a
// ripped piece is still a "full" or "cut-length" board, just narrowed.)

/**
 * Where a piece sits in its row, which decides which factory end it must keep.
 * Click boards join end-to-end through profiled short ends, so a row laid from
 * the start wall needs its cut START piece to keep the end that joins the next
 * board, and its cut END piece to keep the end that joins the previous one.
 * One board can therefore give at most one start and one end piece — the classic
 * "the offcut from a row's end starts another row".
 */
export type PieceRole =
  | "full" // a whole-length board: both factory ends are used
  | "start" // first piece of a row, cut: keeps the joining end facing into the row
  | "end" // last piece of a row, cut: keeps the joining end facing back into the row
  | "free"; // the only piece in its row: both ends meet walls, cut from anywhere

export interface Piece {
  id: string;
  rowIndex: number;
  indexInRow: number;
  /** Polygon in room mm (rect, or clipped where a wall slants). */
  poly: readonly Point[];
  /** Run length to cut — the longer of the piece's two long edges. */
  faceLength: Mm;
  /** The shorter long edge, when the end is cut at an angle to follow a slanted wall. */
  faceLengthShort?: Mm;
  /** Cross width — the wider end. */
  faceWidth: Mm;
  /** Cross width at the narrow end, when ripped on a taper. */
  faceWidthNarrow?: Mm;
  /** Taper only: true when the narrow end is the far end (in laying direction). */
  narrowAtEnd?: boolean;
  kind: PieceKind;
  role: PieceRole;
  isRipped: boolean;
  /**
   * True when the piece is below a recommended minimum (shorter than the min
   * piece length, or narrower than the min row width) — an awkward-to-install
   * sliver, highlighted in the plan. Set by the domain from the tunables.
   */
  undersized?: boolean;
  /** Source assignment from the cutting pass. */
  sourceBoardId?: string;
  fromOffcutId?: string;
}

export interface Row {
  index: number;
  /** Cross position of the row's inner edge, from the straight cross-start wall. */
  crossStart: Mm;
  /** Cross width the row is cut to (the wider end, for a taper row). */
  rowWidth: Mm;
  /** Cross width at the narrow end (equals rowWidth unless the row tapers). */
  rowWidthNarrow: Mm;
  /** Usable run length of this row — the longer of its two long edges. */
  runLength: Mm;
  /** The shorter long edge (differs from runLength when the run-end wall slants). */
  runLengthShort: Mm;
  isEndRow: boolean; // first or last
  isRipped: boolean;
  isTaper: boolean;
  /** Run-length of each piece in order (the last one along the longer edge). */
  pieceLengths: readonly Mm[];
  /** Interior seam positions along the run (cumulative, excludes 0 and the row end). */
  seamPositions: readonly Mm[];
  /** Start-piece length (offset that drives the stagger). */
  startOffset: Mm;
}

export interface LayoutOption {
  kind: "balanced" | "unbalanced";
  recommended: boolean;
  reason: string;
  /** Every row meets the minimum row width. */
  valid: boolean;
}

// ───────────────────────────── Cutting & material ─────────────────────────────

/** One required cut piece (demand) with provenance after assignment. */
export interface CutItem {
  pieceId: string;
  rowIndex: number;
  indexInRow: number;
  /** Length to cut (the longer long edge). */
  length: Mm;
  /** Shorter long edge of an angled end cut. */
  lengthShort?: Mm;
  /** Width (the wider end). */
  width: Mm;
  /** Narrow-end width of a taper rip. */
  widthNarrow?: Mm;
  /** Taper only: the narrow end is the far end (in laying direction). */
  narrowAtEnd?: boolean;
  kind: PieceKind;
  role: PieceRole;
  /** Board it is cut from (B1, B2, … numbered in laying order). */
  source: string;
  /** True when the board was already opened for an earlier piece (this uses its offcut). */
  reused: boolean;
}

/** A piece cut from the offcut of a board that was opened for an earlier piece. */
export interface ReuseEntry {
  fromBoardId: string;
  /** The piece the board was first opened for. */
  fromPieceId: string;
  usedByPieceId: string;
  lengthUsed: Mm;
  /** What is left of the board after this cut (waste unless reused again). */
  remainder: Mm;
}

export interface MaterialSummary {
  boardsConsumed: number;
  fullBoards: number;
  cutPieces: number;
  /** Waste against boards actually consumed. */
  consumedWastePct: number;
  /** Waste against the recommended purchase. */
  purchaseWastePct: number;
  coveredAreaMm2: Mm2;
  boardsPerPack: number;
  packsConsumed: number;
  safetyBoards: number;
  /** Boards recommended to buy after on-hand & pack rounding. */
  recommendedPurchaseBoards: number;
  recommendedPurchasePacks: number;
  dyeLotNote: string;
}

// ───────────────────────────── Plan & result ─────────────────────────────

export interface StaggerInfo {
  /** Achieved adjacent-row stagger (mm). */
  achievedStagger: Mm;
  /** Min stagger actually present across the layout. */
  minObservedStagger: Mm;
  /** Number of distinct offset phases used. */
  phases: number;
  /** Natural stagger a simple 2-piece reuse pattern would give. */
  naturalStagger: Mm;
  /** Run length is near a board multiple → 2-piece pattern would fail. */
  nearMultipleTrap: boolean;
  usedMultiPiecePattern: boolean;
}

export interface TaperInfo {
  axis: Axis;
  outOfSquareMm: Mm;
  approxAngleDeg: number;
  taperWideMm: Mm;
  taperNarrowMm: Mm;
  tightGapMm: Mm;
  ok: boolean;
}

export interface Plan {
  runAxis: Axis;
  geometry: Geometry;
  layoutOptions: LayoutOption[];
  /** Index of the chosen option within layoutOptions. */
  chosenOptionIndex: number;
  rows: Row[]; // chosen option's rows
  pieces: Piece[]; // materialised for the chosen option
  stagger: StaggerInfo;
  taper?: TaperInfo;
  cutList: CutItem[];
  reuseMap: ReuseEntry[];
  material: MaterialSummary;
  /** Hard-validity gate: false plans are ineligible for auto-selection. */
  valid: boolean;
  diagnostics: Diagnostic[];
  /** Lexicographic comparison score components (higher is better). */
  score: PlanScore;
}

export interface PlanScore {
  valid: boolean;
  staggerScore: number; // achieved stagger margin over minimum
  balanceScore: number; // 0..1, end-row closeness to full board
  wastePct: number; // lower better
}

export interface PlanResult {
  plans: Record<Axis, Plan | null>;
  chosenAxis: Axis;
  forced: boolean;
  /** Human-readable comparison verdict between orientations. */
  comparison: Diagnostic[];
  /** Input-level diagnostics. */
  diagnostics: Diagnostic[];
}
