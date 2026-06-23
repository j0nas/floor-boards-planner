import { describe, expect, test } from "vite-plus/test";
import { computeTaper } from "./taper.ts";
import type { Geometry } from "./types.ts";

function geom(crossStart: number, crossEnd: number, runLength = 4000): Geometry {
  return {
    runAxis: "Y",
    crossAxis: "X",
    runLength,
    crossWidthStart: crossStart,
    crossWidthEnd: crossEnd,
    crossVaries: true,
    innerOrigin: { x: 10, y: 10 },
  };
}

describe("computeTaper", () => {
  test("absorbs the full width difference into the last row", () => {
    const t = computeTaper(geom(3980, 3880), 196, 50, 8, 10);
    expect(t.outOfSquareMm).toBeCloseTo(100, 6);
    expect(t.taperWideMm).toBe(196);
    expect(t.taperNarrowMm).toBeCloseTo(96, 6);
    expect(t.ok).toBe(true);
  });

  test("flags a taper that narrows below the minimum row width", () => {
    const t = computeTaper(geom(3980, 3700), 120, 50, 8, 10); // 280 mm out of square
    expect(t.taperNarrowMm).toBeLessThan(50);
    expect(t.ok).toBe(false);
  });

  test("flags when the gap on the slanted wall is below the minimum", () => {
    const t = computeTaper(geom(3980, 3880), 196, 50, 8, 5); // gap 5 < minGap 8
    expect(t.ok).toBe(false);
  });

  test("reports an approximate out-of-square angle", () => {
    const t = computeTaper(geom(3980, 3880, 4000), 196, 50, 8, 10);
    expect(t.approxAngleDeg).toBeCloseTo((Math.atan2(100, 4000) * 180) / Math.PI, 4);
  });
});
