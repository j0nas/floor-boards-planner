import type {
  Axis,
  ExpansionGap,
  Geometry,
  Point,
  RectMeasurements,
} from "./types.ts";
import { type Mm, lerp } from "./units.ts";

/** The other axis. */
export function otherAxis(a: Axis): Axis {
  return a === "X" ? "Y" : "X";
}

/**
 * Resolve per-orientation geometry. `runAxis` is the axis the board *length*
 * runs along; rows stack along the perpendicular cross axis.
 *
 * Run length is taken along the run axis using the average of its two parallel
 * wall measurements (constant across rows). Cross width is allowed to vary
 * linearly along the run — that variation is the out-of-square taper.
 */
export function computeGeometry(
  room: RectMeasurements,
  gap: ExpansionGap,
  runAxis: Axis,
  squareTol: Mm,
): Geometry {
  if (runAxis === "Y") {
    // Boards run along Y (length). Cross = X (width).
    const runLength = (room.lengthLeft + room.lengthRight) / 2 - gap.near - gap.far;
    const crossWidthStart = room.widthNear - gap.left - gap.right;
    const crossWidthEnd = room.widthFar - gap.left - gap.right;
    return {
      runAxis,
      crossAxis: "X",
      runLength,
      crossWidthStart,
      crossWidthEnd,
      crossVaries: Math.abs(room.widthNear - room.widthFar) > squareTol,
      innerOrigin: { x: gap.left, y: gap.near },
    };
  }
  // Boards run along X (width). Cross = Y (length).
  const runLength = (room.widthNear + room.widthFar) / 2 - gap.left - gap.right;
  const crossWidthStart = room.lengthLeft - gap.near - gap.far;
  const crossWidthEnd = room.lengthRight - gap.near - gap.far;
  return {
    runAxis,
    crossAxis: "Y",
    runLength,
    crossWidthStart,
    crossWidthEnd,
    crossVaries: Math.abs(room.lengthLeft - room.lengthRight) > squareTol,
    innerOrigin: { x: gap.left, y: gap.near },
  };
}

/** Usable cross width at a fraction `t` (0..1) along the run. */
export function crossWidthAt(geom: Geometry, t: number): Mm {
  return lerp(geom.crossWidthStart, geom.crossWidthEnd, t);
}

/**
 * Map a local (runPos, crossPos) coordinate — both measured from the inner
 * usable corner — to room mm coordinates for the given orientation.
 */
export function toRoom(
  geom: Geometry,
  runPos: Mm,
  crossPos: Mm,
): Point {
  const { innerOrigin } = geom;
  if (geom.runAxis === "Y") {
    // run = Y, cross = X
    return { x: innerOrigin.x + crossPos, y: innerOrigin.y + runPos };
  }
  // run = X, cross = Y
  return { x: innerOrigin.x + runPos, y: innerOrigin.y + crossPos };
}
