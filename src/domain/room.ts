/**
 * The room shape model: an arbitrary polygon outline, with bridges to the
 * legacy four-measurement quad that the current layout engine still consumes.
 *
 * Canonical form is `RoomShape` (a corner ring). A rectangle/quad round-trips
 * losslessly through `rectRoom` ⇄ `asRect`; anything with more walls returns
 * null from `asRect` and is handled by the polygon layout path.
 */
import type { Axis, Point, RectMeasurements, RoomShape } from "./types.ts";
import { type Mm, approxEq } from "./units.ts";
import { ringsArea } from "./poly.ts";

/**
 * Build the canonical quad outline from the four edge measurements. Corner order
 * matches the historical model: nearLeft at the origin, the near wall along +X
 * (y=0) and the left wall along +Y (x=0). A slanted wall is a shifted far corner.
 */
export function rectRoom(m: RectMeasurements): RoomShape {
  return {
    outline: [
      { x: 0, y: 0 }, // nearLeft
      { x: m.widthNear, y: 0 }, // nearRight
      { x: m.widthFar, y: m.lengthRight }, // farRight
      { x: 0, y: m.lengthLeft }, // farLeft
    ],
  };
}

/**
 * Recover the four edge measurements when the outline is a canonical quad
 * (origin corner, axis-aligned near & left walls). Returns null for any other
 * polygon — those go through the polygon layout path, not the quad engine.
 */
export function asRect(room: RoomShape): RectMeasurements | null {
  const o = room.outline;
  if (o.length !== 4) return null;
  const [nl, nr, fr, fl] = o as [Point, Point, Point, Point];
  if (!approxEq(nl.x, 0) || !approxEq(nl.y, 0)) return null;
  if (!approxEq(nr.y, 0)) return null; // near wall horizontal
  if (!approxEq(fl.x, 0)) return null; // left wall vertical
  return { widthNear: nr.x, widthFar: fr.x, lengthLeft: fl.y, lengthRight: fr.y };
}

/** The drawable outline ring (room mm). */
export function roomOutline(room: RoomShape): readonly Point[] {
  return room.outline;
}

/** True when the outline is a canonical quad the current engine can plan. */
export function isQuadRoom(room: RoomShape): boolean {
  return asRect(room) !== null;
}

/** Signed area of the outline (mm²); positive when wound counter-clockwise. */
export function roomArea(room: RoomShape): number {
  return ringsArea([room.outline]);
}

/**
 * The axis spanning the longer room dimension — the one we call "length" (the
 * shorter is "width"). Ties resolve to X. Used purely for orientation labels, so
 * "length"/"width" track the room's actual proportions instead of a fixed axis.
 */
export function longAxis(room: RoomShape): Axis {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of room.outline) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return maxX - minX >= maxY - minY ? "X" : "Y";
}

/** One wall of the room, as the editor manipulates it. */
export interface Wall {
  /** Edge length (mm), from corner i to corner i+1. */
  length: Mm;
  /** Interior angle (degrees) at corner i — >180° at a concave (reflex) corner. */
  interiorAngleDeg: number;
}

/**
 * Per-wall lengths and per-corner interior angles — the perimeter-walk view the
 * editor edits ("this wall is N mm, turn θ° here"). Derived from the outline so
 * the polygon stays the single source of truth.
 */
export function roomWalls(room: RoomShape): Wall[] {
  const o = room.outline;
  const n = o.length;
  if (n < 3) return [];
  const orient = Math.sign(ringsArea([o])) || 1; // +1 CCW, -1 CW
  const walls: Wall[] = [];
  for (let i = 0; i < n; i++) {
    const prev = o[(i - 1 + n) % n]!;
    const cur = o[i]!;
    const next = o[(i + 1) % n]!;
    const length = Math.hypot(next.x - cur.x, next.y - cur.y);
    // Signed turn from the incoming edge to the outgoing edge; interior angle is
    // π minus that turn, flipped for clockwise winding so reflex corners read >180°.
    const inX = cur.x - prev.x;
    const inY = cur.y - prev.y;
    const outX = next.x - cur.x;
    const outY = next.y - cur.y;
    const turn = Math.atan2(inX * outY - inY * outX, inX * outX + inY * outY);
    const interior = Math.PI - orient * turn;
    walls.push({ length, interiorAngleDeg: (interior * 180) / Math.PI });
  }
  return walls;
}

// ───────────────────────────── editing ops ─────────────────────────────
// Pure transforms the polygon editor calls; the outline stays a closed ring.

/** Move corner `i` to a new position. */
export function moveCorner(room: RoomShape, i: number, to: Point): RoomShape {
  if (i < 0 || i >= room.outline.length) return room;
  return { outline: room.outline.map((p, j) => (j === i ? { x: to.x, y: to.y } : p)) };
}

/** Insert a corner on edge `edgeIndex` (between corner i and i+1); defaults to its midpoint. */
export function insertCorner(room: RoomShape, edgeIndex: number, at?: Point): RoomShape {
  const o = room.outline;
  const n = o.length;
  if (edgeIndex < 0 || edgeIndex >= n) return room;
  const a = o[edgeIndex]!;
  const b = o[(edgeIndex + 1) % n]!;
  const p = at ?? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const next = o.slice(0, edgeIndex + 1);
  next.push({ x: p.x, y: p.y });
  next.push(...o.slice(edgeIndex + 1));
  return { outline: next };
}

/** Remove corner `i`, keeping at least a triangle (returns the room unchanged otherwise). */
export function removeCorner(room: RoomShape, i: number): RoomShape {
  if (room.outline.length <= 3 || i < 0 || i >= room.outline.length) return room;
  return { outline: room.outline.filter((_, j) => j !== i) };
}

/**
 * Set wall `i`'s length by sliding its end corner along the wall direction and
 * rigidly translating every later corner — so all other walls keep their length
 * and angle and the closing wall absorbs the change. No-op for the closing wall.
 */
export function setWallLength(room: RoomShape, i: number, length: Mm): RoomShape {
  const o = room.outline;
  const n = o.length;
  if (i < 0 || i >= n - 1 || length <= 0) return room; // closing wall (i=n-1) is derived
  const a = o[i]!;
  const b = o[i + 1]!;
  const cur = Math.hypot(b.x - a.x, b.y - a.y);
  if (cur < 1e-6) return room;
  const k = length / cur;
  const dx = a.x + (b.x - a.x) * k - b.x;
  const dy = a.y + (b.y - a.y) * k - b.y;
  return { outline: o.map((p, j) => (j > i ? { x: p.x + dx, y: p.y + dy } : { ...p })) };
}

/** True when any two non-adjacent edges of the outline cross (an invalid room). */
export function selfIntersects(room: RoomShape): boolean {
  const o = room.outline;
  const n = o.length;
  if (n < 4) return false;
  const cross = (p: Point, q: Point, r: Point) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const properCross = (a: Point, b: Point, c: Point, d: Point) => {
    const d1 = cross(c, d, a);
    const d2 = cross(c, d, b);
    const d3 = cross(a, b, c);
    const d4 = cross(a, b, d);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
  };
  for (let i = 0; i < n; i++) {
    const a = o[i]!;
    const b = o[(i + 1) % n]!;
    for (let j = i + 1; j < n; j++) {
      // Skip adjacent edges (shared vertex), including the first/last wrap pair.
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      const c = o[j]!;
      const d = o[(j + 1) % n]!;
      if (properCross(a, b, c, d)) return true;
    }
  }
  return false;
}

/**
 * Coerce a possibly-legacy persisted room into the current `RoomShape`:
 * passes a modern `{ outline }` through, converts the old four-measurement
 * object, and falls back to `fallback` for anything unrecognised.
 */
export function toRoomShape(raw: unknown, fallback: RoomShape): RoomShape {
  if (raw && typeof raw === "object") {
    const o = (raw as Partial<RoomShape>).outline;
    if (Array.isArray(o) && o.length >= 3) return { outline: o };
    if ("widthNear" in raw) return rectRoom(raw as RectMeasurements);
  }
  return fallback;
}
