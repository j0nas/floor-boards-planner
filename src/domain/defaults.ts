import type { Board, ExpansionGap, Inputs, Pack, RectMeasurements, Tunables } from "./types.ts";
import { rectRoom } from "./room.ts";

/** Realistic default board: ~2050 × 211 mm, 8 mm thick. */
export const DEFAULT_BOARD: Board = {
  length: 2050,
  width: 211,
  thickness: 8,
};

/**
 * Boards per pack is the single purchasing input; area/pack is derived from it
 * and the board coverage, so it isn't stored.
 */
export const DEFAULT_PACK: Pack = {
  boardsPerPack: 6,
};

/** Uniform 10 mm expansion gap on every wall. */
export const DEFAULT_GAP: ExpansionGap = {
  near: 10,
  far: 10,
  left: 10,
  right: 10,
};

export const DEFAULT_TUNABLES: Tunables = {
  minRowWidth: 50,
  minPiece: 300,
  minStagger: 300,
  idealStagger: Math.round(2050 / 3), // ≈ 683 mm, ~1/3 board
  kerf: 0, // laminate is typically scored & snapped; expose for saw cuts
  // Treat a wall pair as parallel within 15 mm (≈0.3° over 3 m). Real tape
  // measurements of a square room vary by more than a few mm, so a tight
  // tolerance spuriously tapers near-square rooms; 15 mm only flags a genuine slant.
  squareTol: 15,
  minGap: 5, // residual gap at the tight taper point — Pergo's ~5 mm baseline (NO)
  safetyMarginPct: 0.1,
  staggerRandomness: 0, // default to the regular, deterministic pattern
  staggerSeed: 1, // any positive integer; "reshuffle" just increments it
};

/** Default room as edge measurements (≈ 4.0 × 3.0 m square). */
export const DEFAULT_RECT: RectMeasurements = {
  widthNear: 4000,
  widthFar: 4000,
  lengthLeft: 3000,
  lengthRight: 3000,
};

/** A ready-to-use default scenario (≈ 4.0 × 3.0 m square room). */
export const DEFAULT_INPUTS: Inputs = {
  room: rectRoom(DEFAULT_RECT),
  board: DEFAULT_BOARD,
  gap: DEFAULT_GAP,
  pack: DEFAULT_PACK,
  boardsOnHand: 0,
  orientation: { mode: "auto" },
  flip: false,
  tunables: DEFAULT_TUNABLES,
};

/** Expand a single gap value to all four walls. */
export function uniformGap(value: number): ExpansionGap {
  return { near: value, far: value, left: value, right: value };
}

/** Perimeter expansion-gap range (mm), Norway: ~5 mm manufacturer minimum, 8–10 mm recommended. */
export const GAP_RANGE = { min: 5, max: 10, large: 13 } as const;

/**
 * Largest single floating span (mm) before an intermediate expansion joint
 * (T-moulding) is needed. Industry guidance: laminate up to ~10–12 m per span.
 */
export const MAX_FLOATING_SPAN_MM = 12000;

/**
 * Practical minimum perimeter expansion gap (mm) for Norway. Manufacturers such
 * as Pergo specify a ~5 mm baseline clearance (down to 3 mm when laying in very
 * dry winter air, up to 8 mm in humid conditions); 8–10 mm is the common
 * Norwegian retailer recommendation, not a hard floor. So we treat ~5 mm plus
 * ~1 mm per metre of span as the minimum below which buckling becomes a real
 * risk: a normal room is fine at 5 mm, and only long spans push it higher.
 */
export function recommendedMinGap(spanMm: number): number {
  return Math.max(5, Math.round(spanMm / 1000));
}
