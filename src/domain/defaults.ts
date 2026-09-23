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
  // Geometry always follows the measurements exactly (every row gets its own
  // length, the last row its real taper). This only decides when the last row
  // is presented as a taper row and the flip toggle is locked: within 15 mm
  // (≈0.3° over 3 m) the border row may still be flipped to the other wall.
  squareTol: 15,
  // Hard floor for the gap along a slanted wall (below it the taper is invalid).
  // Pergo allows as little as 3 mm when laying in very dry air, so 5 mm is a
  // floor, not a target — the gap warning uses Pergo's normal 8 mm.
  minGap: 5,
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
  openings: [],
  tunables: DEFAULT_TUNABLES,
};

/** Expand a single gap value to all four walls. */
export function uniformGap(value: number): ExpansionGap {
  return { near: value, far: value, left: value, right: value };
}

/** Perimeter expansion-gap range (mm), Norway: Pergo's 8 mm at normal humidity, 10 mm when humid / under doors. */
export const GAP_RANGE = { min: 8, max: 10, large: 13 } as const;

/**
 * Largest single floating span (mm) before an intermediate expansion joint
 * (T-moulding) is needed. Industry guidance: laminate up to ~10–12 m per span.
 */
export const MAX_FLOATING_SPAN_MM = 12000;

/**
 * Recommended minimum perimeter expansion gap (mm) for Norway. Pergo's
 * ORIGINAL LAMINATE installation guide (NO, 01.2023) sets the gap by the
 * humidity when laying: 8 mm at normal indoor air (≈50% RH), 3 mm only when
 * laying in very dry air (<30% RH, the boards are shrunk), 10 mm when humid
 * (>70% RH) and at least 10 mm under doors. So 8 mm is the normal minimum, and
 * long spans need ~1 mm per metre on top of that.
 */
export function recommendedMinGap(spanMm: number): number {
  return Math.max(8, Math.round(spanMm / 1000));
}
