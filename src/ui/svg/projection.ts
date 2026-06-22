import type { Point } from "../../domain/index.ts";

export interface Projection {
  /** mm → px scale factor. */
  scale: number;
  /** Map a room-mm point to SVG px. */
  toPx: (p: Point) => Point;
  /** Map an SVG-px point back to room mm (inverse of `toPx`). */
  toMm: (p: Point) => Point;
  /** SVG canvas size in px. */
  width: number;
  height: number;
  viewBox: string;
  /** Convert an mm length to px (for stroke widths, label sizing). */
  px: (mm: number) => number;
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function boundsOf(points: readonly Point[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Fit a set of room-mm points into a px canvas, preserving aspect ratio and
 * centering. Room Y is flipped so the near wall (y=0) sits at the bottom — the
 * view reads like standing in the doorway looking into the room.
 */
export function fitProjection(
  points: readonly Point[],
  maxPx = 1000,
  padding = 36,
): Projection {
  const b = boundsOf(points.length ? points : [{ x: 0, y: 0 }, { x: 1000, y: 1000 }]);
  const wMm = Math.max(1, b.maxX - b.minX);
  const hMm = Math.max(1, b.maxY - b.minY);

  const inner = maxPx - 2 * padding;
  const scale = inner / Math.max(wMm, hMm);

  const width = wMm * scale + 2 * padding;
  const height = hMm * scale + 2 * padding;

  const toPx = (p: Point): Point => ({
    x: padding + (p.x - b.minX) * scale,
    // flip Y: room top (maxY) maps to small py
    y: padding + (b.maxY - p.y) * scale,
  });

  const toMm = (p: Point): Point => ({
    x: (p.x - padding) / scale + b.minX,
    y: b.maxY - (p.y - padding) / scale,
  });

  return {
    scale,
    toPx,
    toMm,
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    px: (mm: number) => mm * scale,
  };
}

/** "x1,y1 x2,y2 …" string for an SVG <polygon>. */
export function polyToPoints(poly: readonly Point[], proj: Projection): string {
  return poly
    .map((p) => {
      const q = proj.toPx(p);
      return `${q.x.toFixed(2)},${q.y.toFixed(2)}`;
    })
    .join(" ");
}

/** Centroid of a polygon in px (for labels). */
export function centroidPx(poly: readonly Point[], proj: Projection): Point {
  let x = 0;
  let y = 0;
  for (const p of poly) {
    const q = proj.toPx(p);
    x += q.x;
    y += q.y;
  }
  const n = Math.max(1, poly.length);
  return { x: x / n, y: y / n };
}
