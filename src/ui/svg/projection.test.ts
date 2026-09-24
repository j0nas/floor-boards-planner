import { describe, expect, test } from "vite-plus/test";
import { centroidPx, fitProjection, polyToPoints } from "./projection.ts";
import type { Point } from "../../domain/index.ts";

const square: Point[] = [
  { x: 0, y: 0 },
  { x: 4000, y: 0 },
  { x: 4000, y: 3000 },
  { x: 0, y: 3000 },
];

describe("fitProjection", () => {
  test("preserves aspect ratio (single scale for both axes)", () => {
    const proj = fitProjection(square, 1000, 0);
    // 4000 mm wide is the limiting dimension → scale = 1000/4000
    expect(proj.scale).toBeCloseTo(1000 / 4000, 9);
    expect(proj.width).toBeCloseTo(1000, 6);
    expect(proj.height).toBeCloseTo(750, 6); // 3000 * scale
  });

  test("flips Y so the near wall (y=0) is at the bottom", () => {
    const proj = fitProjection(square, 1000, 0);
    const near = proj.toPx({ x: 0, y: 0 });
    const far = proj.toPx({ x: 0, y: 3000 });
    expect(near.y).toBeGreaterThan(far.y);
  });

  test("padding insets the drawing", () => {
    const proj = fitProjection(square, 1000, 50);
    expect(proj.toPx({ x: 0, y: 3000 }).y).toBeCloseTo(50, 6); // top-left after flip
    expect(proj.toPx({ x: 0, y: 3000 }).x).toBeCloseTo(50, 6);
  });

  test("turned half a turn: the far wall at the bottom, left and right swapped", () => {
    const proj = fitProjection(square, 1000, 50, true);
    const nearLeft = proj.toPx({ x: 0, y: 0 });
    expect(nearLeft.x).toBeCloseTo(proj.width - 50, 6); // near-left corner now top-right
    expect(nearLeft.y).toBeCloseTo(50, 6);
    const back = proj.toMm(proj.toPx({ x: 1234, y: 567 }));
    expect(back.x).toBeCloseTo(1234, 6);
    expect(back.y).toBeCloseTo(567, 6);
  });

  test("px converts mm lengths consistently with scale", () => {
    const proj = fitProjection(square, 1000, 0);
    expect(proj.px(4000)).toBeCloseTo(1000, 6);
  });
});

describe("poly helpers", () => {
  test("polyToPoints emits one coordinate pair per vertex", () => {
    const proj = fitProjection(square, 1000, 0);
    expect(polyToPoints(square, proj).split(" ")).toHaveLength(4);
  });

  test("centroid of a centred square is its middle", () => {
    const proj = fitProjection(square, 1000, 0);
    const c = centroidPx(square, proj);
    expect(c.x).toBeCloseTo(500, 6);
    expect(c.y).toBeCloseTo(375, 6);
  });
});
