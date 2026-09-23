/**
 * Door openings: gaps in a wall that the floor runs through, up to a threshold.
 *
 * An opening is the clear width between a door's jambs at some position along
 * a wall. The floor fills it from the room side to `depth` past the wall's
 * room-side face — typically to a threshold profile under the closed door —
 * and may reach `tuck` further on each side, sliding under the undercut frame.
 * The clear part must be floored; the part under the frame is covered only by
 * pieces that come through the clear opening anyway (a row that would only
 * clip it would get a useless, fragile tab).
 */
import { isConvexCcw } from "./geometry.ts";
import { type Ring, ccw, clipRings, differenceRings, ringsArea, unionRings } from "./poly.ts";
import { asRect } from "./room.ts";
import type { Inputs, Opening } from "./types.ts";
import type { Mm } from "./units.ts";

/**
 * True when the room keeps a separate gap per wall: a convex four-wall room.
 * Other outlines are inset by one uniform gap (the largest), as the polygon
 * engine does.
 */
export function perWallGaps(inputs: Inputs): boolean {
  return asRect(inputs.room) !== null && isConvexCcw(inputs.room.outline);
}

/** The expansion gap the floor keeps from wall `i` (outline order). */
export function wallGap(inputs: Inputs, i: number): Mm {
  const g = inputs.gap;
  if (perWallGaps(inputs)) return [g.near, g.right, g.far, g.left][i] ?? 0;
  return Math.max(g.near, g.far, g.left, g.right);
}

/** Length of wall `i` (outline order), or 0 when it doesn't exist. */
export function wallLength(inputs: Inputs, i: number): Mm {
  const o = inputs.room.outline;
  const a = o[i];
  const b = o[(i + 1) % o.length];
  return a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
}

/**
 * The floor inside one opening, in room mm (CCW): from the threshold, `depth`
 * past the wall face, back into the room to just past the floor's own edge at
 * the wall's gap — so it joins onto the usable floor. Null for a wall that
 * doesn't exist.
 */
export function openingRing(inputs: Inputs, o: Opening, clear = false): Ring | null {
  const pts = inputs.room.outline;
  const n = pts.length;
  if (!Number.isInteger(o.wall) || o.wall < 0 || o.wall >= n) return null;
  const a = pts[o.wall]!;
  const b = pts[(o.wall + 1) % n]!;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1e-6) return null;
  const dx = (b.x - a.x) / len;
  const dy = (b.y - a.y) / len;
  const orient = Math.sign(ringsArea([pts])) || 1;
  const nx = -dy * orient; // toward the room
  const ny = dx * orient;
  const tuck = clear ? 0 : o.tuck;
  const s0 = o.offset - tuck;
  const s1 = o.offset + o.width + tuck;
  const inward = wallGap(inputs, o.wall) + 1; // overlap the floor's edge so they join
  const at = (s: Mm, t: Mm) => ({ x: a.x + dx * s + nx * t, y: a.y + dy * s + ny * t });
  return ccw([at(s0, -o.depth), at(s1, -o.depth), at(s1, inward), at(s0, inward)]);
}

/** Every opening's ring, with its index in `inputs.openings` (invalid ones skipped). */
export function openingRings(inputs: Inputs): { index: number; ring: Ring }[] {
  const out: { index: number; ring: Ring }[] = [];
  (inputs.openings ?? []).forEach((o, index) => {
    const ring = openingRing(inputs, o);
    if (ring) out.push({ index, ring });
  });
  return out;
}

/** The usable floor with every opening joined on. */
export function withOpenings(floor: readonly Ring[], inputs: Inputs): Ring[] {
  const rings = openingRings(inputs).map((o) => o.ring);
  return rings.length ? unionRings([...floor.map(ccw), ...rings]) : [...floor];
}

/** A doorway beyond the usable floor: all it may cover, and the clear part it must. */
export interface Doorway {
  index: number;
  /** The whole opening, overlapping the floor's edge — join this onto a floor. */
  full: Ring;
  /** Beyond the floor, including under the frame. */
  rings: Ring[];
  /** Beyond the floor, between the jambs only. */
  clear: Ring[];
}

/** The part of each opening beyond the usable floor — what the doorway adds. */
export function openingOnly(floor: readonly Ring[], inputs: Inputs): Doorway[] {
  const beyond = (ring: Ring | null) =>
    ring ? differenceRings([ring], floor).filter((r) => Math.abs(ringsArea([r])) > 1) : [];
  const out: Doorway[] = [];
  (inputs.openings ?? []).forEach((o, index) => {
    const full = openingRing(inputs, o);
    const rings = beyond(full);
    if (full && rings.length)
      out.push({ index, full, rings, clear: beyond(openingRing(inputs, o, true)) });
  });
  return out;
}

/** True when a band (e.g. a row) passes the doorway's clear part, not just the frame. */
export function passes(band: Ring, door: Doorway): boolean {
  return clipRings([band], door.clear).some((r) => Math.abs(ringsArea([r])) > 1);
}
