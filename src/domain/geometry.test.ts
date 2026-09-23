import { describe, expect, test } from "vite-plus/test";
import { DEFAULT_GAP } from "./defaults.ts";
import { computeGeometry, crossWidthAt, runLengthAt, toRoom } from "./geometry.ts";
import { asRect, rectRoom } from "./room.ts";
import type { RectMeasurements } from "./types.ts";

const square: RectMeasurements = {
  widthNear: 4000,
  widthFar: 4000,
  lengthLeft: 3000,
  lengthRight: 3000,
};

describe("geometry — square room", () => {
  test("run = Y: runLength is length, cross is width, constant", () => {
    const g = computeGeometry(square, DEFAULT_GAP, "Y", 3)!;
    expect(g.runLength).toBe(3000 - 20); // length - near - far
    expect(g.runLengthEnd).toBe(3000 - 20);
    expect(g.crossWidthStart).toBe(4000 - 20); // width - left - right
    expect(g.crossWidthEnd).toBe(4000 - 20);
    expect(g.crossVaries).toBe(false);
    expect(g.runVaries).toBe(false);
  });

  test("run = X: runLength is width, cross is length", () => {
    const g = computeGeometry(square, DEFAULT_GAP, "X", 3)!;
    expect(g.runLength).toBe(4000 - 20);
    expect(g.crossWidthStart).toBe(3000 - 20);
    expect(g.crossVaries).toBe(false);
  });

  test("crossWidthAt and runLengthAt are constant for a square room", () => {
    const g = computeGeometry(square, DEFAULT_GAP, "Y", 3)!;
    expect(crossWidthAt(g, 0)).toBe(crossWidthAt(g, g.runLength));
    expect(runLengthAt(g, 0)).toBe(runLengthAt(g, g.crossWidthStart));
  });

  test("the usable floor is the room inset by each wall's own gap", () => {
    const g = computeGeometry(square, { near: 5, far: 15, left: 8, right: 12 }, "X", 3)!;
    expect(g.inner).toEqual([
      { x: 8, y: 5 },
      { x: 3988, y: 5 },
      { x: 3988, y: 2985 },
      { x: 8, y: 2985 },
    ]);
    expect(g.runLength).toBe(4000 - 8 - 12);
    expect(g.crossWidthStart).toBe(3000 - 5 - 15);
  });
});

describe("geometry — out of square", () => {
  const slanted: RectMeasurements = {
    widthNear: 4000,
    widthFar: 3900, // right wall slanted
    lengthLeft: 3000,
    lengthRight: 3000,
  };

  test("run = Y: the slanted wall is at the cross end → the last row tapers", () => {
    const g = computeGeometry(slanted, DEFAULT_GAP, "Y", 3)!;
    expect(g.crossVaries).toBe(true);
    expect(g.runVaries).toBe(false);
    // The gap is held perpendicular to the slanted wall: 10 / cos θ horizontally.
    const cos = 3000 / Math.hypot(100, 3000);
    const at = (y: number) => 4000 - (100 * y) / 3000 - 10 / cos - 10;
    expect(g.crossWidthStart).toBeCloseTo(at(10), 6);
    expect(g.crossWidthEnd).toBeCloseTo(at(2990), 6);
    expect(crossWidthAt(g, g.runLength / 2)).toBeCloseTo(at(1500), 6);
  });

  test("run = X: the slanted wall is at the row ends → every row has its own length", () => {
    const g = computeGeometry(slanted, DEFAULT_GAP, "X", 3)!;
    expect(g.crossVaries).toBe(false); // length axis is parallel
    expect(g.runVaries).toBe(true);
    const cos = 3000 / Math.hypot(100, 3000);
    const at = (y: number) => 4000 - (100 * y) / 3000 - 10 / cos - 10;
    // Row length at cross position v (from the near wall's inset line at y = 10).
    expect(runLengthAt(g, 0)).toBeCloseTo(at(10), 6);
    expect(runLengthAt(g, 1490)).toBeCloseTo(at(1500), 6);
    expect(runLengthAt(g, g.crossWidthEnd)).toBeCloseTo(at(2990), 6);
  });

  test("a concave quad has no rows-and-one-taper geometry", () => {
    const concave = { widthNear: 4000, widthFar: 1000, lengthLeft: 3000, lengthRight: 500 };
    expect(computeGeometry(concave, DEFAULT_GAP, "X", 3)).toBeNull();
  });
});

describe("geometry — coordinate mapping", () => {
  test("toRoom run=Y maps run→Y, cross→X with gap origin", () => {
    const g = computeGeometry(square, DEFAULT_GAP, "Y", 3)!;
    expect(toRoom(g, 0, 0)).toEqual({ x: 10, y: 10 });
    expect(toRoom(g, 100, 50)).toEqual({ x: 60, y: 110 });
  });

  test("toRoom run=X maps run→X, cross→Y", () => {
    const g = computeGeometry(square, DEFAULT_GAP, "X", 3)!;
    expect(toRoom(g, 100, 50)).toEqual({ x: 110, y: 60 });
  });

  test("rectRoom places a slanted far-right corner and asRect recovers it", () => {
    const m = { widthNear: 4000, widthFar: 3900, lengthLeft: 3000, lengthRight: 3000 };
    const room = rectRoom(m);
    expect(room.outline[0]).toEqual({ x: 0, y: 0 });
    expect(room.outline[2]).toEqual({ x: 3900, y: 3000 }); // farRight shifted in x
    expect(asRect(room)).toEqual(m);
  });
});
