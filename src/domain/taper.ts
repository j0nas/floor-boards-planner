import type { Geometry, TaperInfo } from "./types.ts";
import { type Mm, gte } from "./units.ts";

/**
 * Out-of-square taper for the last row, which follows a non-parallel wall.
 *
 * The whole width difference along the run is absorbed by the taper row, whose
 * inner edge is straight (against the last full row) and whose outer edge
 * follows the slanted wall at that wall's own expansion gap (the usable floor is
 * inset perpendicular to each wall, so the gap is held along the whole wall).
 * `lastRowWidthWide` is the row's width at its wide end; the risk is the narrow
 * end becoming thinner than the minimum row width.
 */
export function computeTaper(
  geom: Geometry,
  lastRowWidthWide: Mm,
  minRowWidth: Mm,
  minGap: Mm,
  slantWallGap: Mm,
): TaperInfo {
  const outOfSquareMm = Math.abs(geom.crossWidthStart - geom.crossWidthEnd);
  const approxAngleDeg = (Math.atan2(outOfSquareMm, geom.runLengthEnd) * 180) / Math.PI;

  const taperWideMm = lastRowWidthWide;
  const taperNarrowMm = taperWideMm - outOfSquareMm;

  // The gap is preserved by cutting the row to the wall, so the tight gap equals
  // the configured gap on that wall; it must still meet the minimum.
  const tightGapMm = slantWallGap;
  const ok = gte(taperNarrowMm, minRowWidth) && gte(tightGapMm, minGap);

  return {
    axis: geom.crossAxis,
    outOfSquareMm,
    approxAngleDeg,
    taperWideMm,
    taperNarrowMm,
    tightGapMm,
    ok,
  };
}
