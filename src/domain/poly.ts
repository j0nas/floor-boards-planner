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
  inflatePathsD,
  intersectD,
} from "clipper2-ts";
import type { Mm, Mm2 } from "./units.ts";
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

/** Total signed area of a ring set in mm² (holes subtract by winding). */
export function ringsArea(rings: readonly Ring[]): Mm2 {
  return areaPathsD(toPaths(rings));
}
