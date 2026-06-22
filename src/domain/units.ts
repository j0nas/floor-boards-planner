/**
 * Scalar / numeric helpers for the domain layer.
 *
 * Every length in the domain is a plain `number` of millimetres (`Mm`).
 * Areas are mm² internally; the UI converts to m² for display.
 */

export type Mm = number;
export type Mm2 = number;

/** Tolerance for treating two millimetre lengths as equal (half a millimetre). */
export const EPS: Mm = 0.5;

/** `true` when |a - b| is within `tol`. */
export function approxEq(a: number, b: number, tol: number = EPS): boolean {
  return Math.abs(a - b) <= tol;
}

/** `true` when `a` is greater than `b` by more than `tol`. */
export function gt(a: number, b: number, tol: number = EPS): boolean {
  return a - b > tol;
}

/** `true` when `a` is less than `b` by more than `tol`. */
export function lt(a: number, b: number, tol: number = EPS): boolean {
  return b - a > tol;
}

/** `true` when `a >= b` allowing a `tol` slack. */
export function gte(a: number, b: number, tol: number = EPS): boolean {
  return a - b >= -tol;
}

/** `true` when `a <= b` allowing a `tol` slack. */
export function lte(a: number, b: number, tol: number = EPS): boolean {
  return a - b <= tol;
}

/** Clamp `v` into the inclusive range [`min`, `max`]. */
export function clamp(v: number, min: number, max: number): number {
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

/** Linear interpolation between `a` (t=0) and `b` (t=1). */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Sum of an array of numbers. */
export function sum(xs: readonly number[]): number {
  let total = 0;
  for (const x of xs) total += x;
  return total;
}

/** Round to a sensible display precision (default 1 mm). */
export function roundTo(v: number, step: number = 1): number {
  return Math.round(v / step) * step;
}

/** mm² → m² for display. */
export function mm2ToM2(area: Mm2): number {
  return area / 1_000_000;
}

/** m² → mm² for input normalisation. */
export function m2ToMm2(area: number): Mm2 {
  return area * 1_000_000;
}
