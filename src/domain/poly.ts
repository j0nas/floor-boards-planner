/**
 * Polygon geometry for arbitrary room outlines, backed by Clipper2 (clipper2-ts).
 *
 * Pure TS, no DOM — safe to import from the domain layer. We use Clipper's
 * double-precision (`*D`) API so coordinates stay in plain millimetres
 * (fractional gaps/dimensions are fine); `PRECISION` sets the internal grid.
 *
 * A `Ring` is one closed loop of points in room mm (winding either way). A set
 * of rings models a room with holes, or several disjoint pieces — exactly what
 * clipping a plank against an L-shaped room can produce.
 */
import {
  EndType,
  FillRule,
  JoinType,
  type PathsD,
  areaPathsD,
  differenceD,
  inflatePathsD,
  intersectD,
  unionD,
} from "clipper2-ts";
import { type Mm, type Mm2, differsOnTape } from "./units.ts";
import type { Point } from "./types.ts";

/** One closed ring of points in room millimetres. */
export type Ring = readonly Point[];

/** Decimal places Clipper keeps internally → a 0.001 mm grid (sub-saw-kerf). */
const PRECISION = 3;

const toPaths = (rings: readonly Ring[]): PathsD =>
  rings.map((r) => r.map((p) => ({ x: p.x, y: p.y })));

const fromPaths = (paths: PathsD): Ring[] =>
  paths.map((path) => path.map((p) => ({ x: p.x, y: p.y })));

/**
 * Offset a set of rings by `delta` mm: positive grows outward, negative shrinks
 * inward. Miter joins keep right-angle wall corners crisp. An inset can split a
 * thin polygon into several rings, or empty it entirely — hence `Ring[]`.
 */
export function offsetRings(rings: readonly Ring[], delta: Mm): Ring[] {
  return fromPaths(
    inflatePathsD(toPaths(rings), delta, JoinType.Miter, EndType.Polygon, 2, PRECISION),
  );
}

/** Inset a room outline by a uniform perimeter expansion gap (mm). */
export function insetRoom(outline: Ring, gap: Mm): Ring[] {
  return offsetRings([outline], -gap);
}

/** Intersect two ring sets (e.g. clip a plank row to the usable floor). */
export function clipRings(subject: readonly Ring[], clip: readonly Ring[]): Ring[] {
  return fromPaths(intersectD(toPaths(subject), toPaths(clip), FillRule.NonZero, PRECISION));
}

/** Union of a ring set (overlaps merged). */
export function unionRings(rings: readonly Ring[]): Ring[] {
  return fromPaths(unionD(toPaths(rings), [], FillRule.NonZero, PRECISION));
}

/** The part of `subject` outside `clip`. */
export function differenceRings(subject: readonly Ring[], clip: readonly Ring[]): Ring[] {
  return fromPaths(differenceD(toPaths(subject), toPaths(clip), FillRule.NonZero, PRECISION));
}

/** Total signed area of a ring set in mm² (holes subtract by winding). */
export function ringsArea(rings: readonly Ring[]): Mm2 {
  return areaPathsD(toPaths(rings));
}

/** The ring wound counter-clockwise (positive area), so unions never cancel. */
export function ccw(ring: Ring): Ring {
  return ringsArea([ring]) < 0 ? [...ring].reverse() : ring;
}

/** True when the ring is convex (either winding); an L-shaped (notched) piece is not. */
export function isConvexRing(ring: Ring): boolean {
  let sign = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const c = ring[(i + 2) % ring.length]!;
    const z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(z) < 1e-6) continue;
    if (sign === 0) sign = Math.sign(z);
    else if (Math.sign(z) !== sign) return false;
  }
  return true;
}

/** Axis-aligned bounds of a ring set. */
export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function bboxOf(rings: readonly Ring[]): Box {
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

/**
 * Extent of a ring along one axis where it crosses a line: with `fixCross` the
 * line is cross = `at` and the run extent is returned, otherwise the line is
 * run = `at` and the cross extent is returned (0 when the line misses).
 */
function chordAt(ring: Ring, runIsX: boolean, fixCross: boolean, at: number): number {
  const fixed = (p: Point) => (runIsX ? p.y : p.x);
  const other = (p: Point) => (runIsX ? p.x : p.y);
  const get = fixCross ? fixed : other;
  const measure = fixCross ? other : fixed;
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const fa = get(a) - at;
    const fb = get(b) - at;
    if (fa > 0 === fb > 0 && fa !== 0 && fb !== 0) continue;
    if (fa === fb) {
      lo = Math.min(lo, measure(a), measure(b));
      hi = Math.max(hi, measure(a), measure(b));
      continue;
    }
    const m = measure(a) + (fa / (fa - fb)) * (measure(b) - measure(a));
    lo = Math.min(lo, m);
    hi = Math.max(hi, m);
  }
  return hi > lo ? hi - lo : 0;
}

/**
 * Cut dimensions of a clipped piece, the way they are marked on a board: the
 * length along each long edge (they differ where a wall cuts the end at an
 * angle) and the width at each end (they differ where a wall tapers it).
 */
export function measurePiece(ring: Ring, runIsX: boolean) {
  const b = bboxOf([ring]);
  const [uMin, uMax, vMin, vMax] = runIsX
    ? [b.minX, b.maxX, b.minY, b.maxY]
    : [b.minY, b.maxY, b.minX, b.maxX];
  const du = Math.min(0.05, (uMax - uMin) / 4);
  const dv = Math.min(0.05, (vMax - vMin) / 4);
  const lenA = chordAt(ring, runIsX, true, vMin + dv);
  const lenB = chordAt(ring, runIsX, true, vMax - dv);
  const wStart = chordAt(ring, runIsX, false, uMin + du);
  const wEnd = chordAt(ring, runIsX, false, uMax - du);
  const faceLength = uMax - uMin;
  const faceWidth = vMax - vMin;
  const shortLen = Math.min(lenA, lenB);
  const narrow = Math.min(wStart, wEnd);
  return {
    lenA,
    lenB,
    faceLength,
    faceLengthShort: differsOnTape(faceLength, shortLen) ? shortLen : undefined,
    faceWidth,
    faceWidthNarrow: differsOnTape(faceWidth, narrow) ? narrow : undefined,
    narrowAtEnd: differsOnTape(faceWidth, narrow) ? wEnd < wStart : undefined,
  };
}
