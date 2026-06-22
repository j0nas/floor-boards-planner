import type { Geometry, TaperInfo } from "./types.ts";
import { type Mm, gte, lte } from "./units.ts";

/**
 * Out-of-square taper for the last row that follows a non-parallel wall.
 *
 * The whole width difference along the run is absorbed by the taper row, whose
 * inner edge is straight (against the last full row) and whose outer edge
 * follows the slanted wall at a constant expansion gap. We balance using the
 * wide end, so the wide end is always ≤ a board width; the risk is the narrow
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
  const approxAngleDeg = (Math.atan2(outOfSquareMm, geom.runLength) * 180) / Math.PI;

  const taperWideMm = lastRowWidthWide;
  const taperNarrowMm = taperWideMm - outOfSquareMm;

  // The gap is preserved by cutting the row to the wall, so the tight gap equals
  // the configured gap on that wall; it must still meet the minimum.
  const tightGapMm = slantWallGap;
  const ok =
    gte(taperNarrowMm, minRowWidth) && gte(tightGapMm, minGap) && lte(taperNarrowMm, taperWideMm);

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
