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
  squareTol: Mm; // axis treated as square if |near-far| <= this
  minGap: Mm; // min residual expansion gap at the tight taper point
  safetyMarginPct: number; // extra material fraction (e.g. 0.1 = +10%)
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

/** Resolved per-orientation geometry in room coordinates. */
export interface Geometry {
  runAxis: Axis;
  crossAxis: Axis;
  /** Usable run length (board-length direction), gap-subtracted; constant across rows. */
  runLength: Mm;
  /** Usable cross width at the run-start end (t=0). */
  crossWidthStart: Mm;
  /** Usable cross width at the run-end end (t=1). */
  crossWidthEnd: Mm;
  /** True when the cross width varies along the run (out-of-square → taper). */
  crossVaries: boolean;
  /** Inner usable rectangle/quad corners in room mm (after gaps), for drawing. */
  innerOrigin: Point; // run-start, cross-start corner
}

// ───────────────────────────── Pieces & rows ─────────────────────────────

export type PieceKind =
  | "full" // uncut field board
  | "cut-length" // cut along its length (a start/middle/end piece)
  | "taper"; // tapered (trapezoid) piece following a non-parallel wall
// (Ripping to a narrower row is carried by `Piece.isRipped`, not a kind — a
// ripped piece is still a "full" or "cut-length" board, just narrowed.)

export interface Piece {
  id: string;
  rowIndex: number;
  indexInRow: number;
  /** Polygon in room mm (4 points; rect or trapezoid). */
  poly: readonly Point[];
  /** Nominal labelled run-length of the piece. */
  faceLength: Mm;
  /** Cross width (for taper, the wider end). */
  faceWidth: Mm;
  /** Taper only: cross width at the narrow end. */
  faceWidthNarrow?: Mm;
  kind: PieceKind;
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
  /** Cross width at run-start. */
  rowWidth: Mm;
  /** Cross width at run-end (differs from rowWidth only for a taper row). */
  rowWidthEnd: Mm;
  isEndRow: boolean; // first or last
  isRipped: boolean;
  isTaper: boolean;
  /** Run-length of each piece in order. */
  pieceLengths: readonly Mm[];
  /** Interior seam positions along the run (cumulative, excludes 0 and runLength). */
  seamPositions: readonly Mm[];
  /** Start-piece length (offset that drives the stagger). */
  startOffset: Mm;
}

export interface LayoutOption {
  kind: "balanced" | "unbalanced";
  recommended: boolean;
  reason: string;
  rows: Row[];
}

// ───────────────────────────── Cutting & material ─────────────────────────────

/** One required cut piece (demand) with provenance after assignment. */
export interface CutItem {
  pieceId: string;
  rowIndex: number;
  indexInRow: number;
  length: Mm;
  width: Mm;
  kind: PieceKind;
  /** Board (or offcut) it was cut from. */
  source: string;
  /** True when this piece reused a prior offcut rather than a fresh board. */
  reused: boolean;
}

export interface ReuseEntry {
  offcutId: string;
  fromBoardId: string;
  fromPieceId: string;
  usedByPieceId: string;
  lengthUsed: Mm;
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
