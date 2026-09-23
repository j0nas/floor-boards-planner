import type { Axis, ExpansionGap, Geometry, Point, RectMeasurements } from "./types.ts";
import { EPS, type Mm, clamp } from "./units.ts";

/** The other axis. */
export function otherAxis(a: Axis): Axis {
  return a === "X" ? "Y" : "X";
}

type Line = readonly [Point, Point];

/** Wall a→b of a CCW outline, shifted `gap` mm toward the room interior (its left side). */
function insetWall(a: Point, b: Point, gap: Mm): Line {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const nx = -(b.y - a.y) / len;
  const ny = (b.x - a.x) / len;
  return [
    { x: a.x + nx * gap, y: a.y + ny * gap },
    { x: b.x + nx * gap, y: b.y + ny * gap },
  ];
}

/** Intersection of two infinite lines (null when parallel). */
function meet([p, q]: Line, [r, s]: Line): Point | null {
  const d1x = q.x - p.x;
  const d1y = q.y - p.y;
  const d2x = s.x - r.x;
  const d2y = s.y - r.y;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((r.x - p.x) * d2y - (r.y - p.y) * d2x) / den;
  return { x: p.x + t * d1x, y: p.y + t * d1y };
}

/**
 * The usable floor of a canonical quad room: every wall inset by its own gap,
 * corners found by intersecting the inset wall lines (exact — a slanted wall's
 * gap is held perpendicular to that wall). Returns [nearLeft, nearRight,
 * farRight, farLeft] in room mm, or null when the inset collapses.
 */
export function innerQuad(room: RectMeasurements, gap: ExpansionGap): Point[] | null {
  const nl = { x: 0, y: 0 };
  const nr = { x: room.widthNear, y: 0 };
  const fr = { x: room.widthFar, y: room.lengthRight };
  const fl = { x: 0, y: room.lengthLeft };
  if (room.widthNear <= 0 || room.widthFar <= 0 || room.lengthLeft <= 0 || room.lengthRight <= 0)
    return null;
  const near = insetWall(nl, nr, gap.near);
  const right = insetWall(nr, fr, gap.right);
  const far = insetWall(fr, fl, gap.far);
  const left = insetWall(fl, nl, gap.left);
  const corners = [meet(left, near), meet(near, right), meet(right, far), meet(far, left)];
  if (corners.some((c) => c === null)) return null;
  return corners as Point[];
}

/** True when the ring is strictly convex and counter-clockwise. */
export function isConvexCcw(ring: readonly Point[]): boolean {
  const n = ring.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    const c = ring[(i + 2) % n]!;
    if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) <= 1e-9) return false;
  }
  return true;
}

/**
 * Resolve per-orientation geometry. `runAxis` is the axis the board *length*
 * runs along; rows stack along the perpendicular cross axis, starting from the
 * straight wall (near wall for run=X, left wall for run=Y). Rows are laid from
 * the other straight wall (left for run=X, near for run=Y), so any slant is at
 * the run end (row ends cut at an angle) or the cross end (last row tapers).
 *
 * Returns null when the gaps leave no usable floor, or when the inset floor is
 * not convex (such rooms are planned by the polygon engine instead).
 */
export function computeGeometry(
  room: RectMeasurements,
  gap: ExpansionGap,
  runAxis: Axis,
  squareTol: Mm,
): Geometry | null {
  const inner = innerQuad(room, gap);
  if (!inner || !isConvexCcw(inner)) return null;
  const [a, b, c, d] = inner as [Point, Point, Point, Point];
  // Local (run, cross) extents from the inner corner `a` of the two straight walls.
  const local =
    runAxis === "Y"
      ? { u0: d.y - a.y, v0: b.x - a.x, uC: c.y - a.y, vC: c.x - a.x }
      : { u0: b.x - a.x, v0: d.y - a.y, uC: c.x - a.x, vC: c.y - a.y };
  return {
    runAxis,
    crossAxis: runAxis === "Y" ? "X" : "Y",
    runLength: local.u0,
    runLengthEnd: local.uC,
    crossWidthStart: local.v0,
    crossWidthEnd: local.vC,
    crossVaries: Math.abs(local.v0 - local.vC) > squareTol,
    runVaries: Math.abs(local.u0 - local.uC) > EPS,
    innerOrigin: a,
    inner,
  };
}

/**
 * Usable run length at cross position `v` (the run-end wall line). Linear
 * between the straight wall (v=0) and the far corner.
 */
export function runLengthAt(geom: Geometry, v: Mm): Mm {
  if (geom.crossWidthEnd <= 0) return geom.runLength;
  return geom.runLength + ((geom.runLengthEnd - geom.runLength) * v) / geom.crossWidthEnd;
}

/**
 * Usable cross width at run position `u` (the cross-end wall line). `u` is
 * clamped to the run so the line is never extrapolated past the far corner.
 */
export function crossWidthAt(geom: Geometry, u: Mm): Mm {
  if (geom.runLengthEnd <= 0) return geom.crossWidthStart;
  const t = clamp(u / geom.runLengthEnd, 0, 1);
  return geom.crossWidthStart + (geom.crossWidthEnd - geom.crossWidthStart) * t;
}

/**
 * Map a local (runPos, crossPos) coordinate — both measured from the inner
 * usable corner — to room mm coordinates for the given orientation.
 */
export function toRoom(geom: Geometry, runPos: Mm, crossPos: Mm): Point {
  const { innerOrigin } = geom;
  if (geom.runAxis === "Y") {
    // run = Y, cross = X
    return { x: innerOrigin.x + crossPos, y: innerOrigin.y + runPos };
  }
  // run = X, cross = Y
  return { x: innerOrigin.x + runPos, y: innerOrigin.y + crossPos };
}

/** Inverse of `toRoom`: room mm → local (run, cross). */
export function toLocal(geom: Geometry, p: Point): { u: Mm; v: Mm } {
  const dx = p.x - geom.innerOrigin.x;
  const dy = p.y - geom.innerOrigin.y;
  return geom.runAxis === "Y" ? { u: dy, v: dx } : { u: dx, v: dy };
}
