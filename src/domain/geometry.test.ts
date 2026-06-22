import { describe, expect, test } from "vitest";
import { DEFAULT_GAP } from "./defaults.ts";
import { computeGeometry, crossWidthAt, toRoom } from "./geometry.ts";
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
    const g = computeGeometry(square, DEFAULT_GAP, "Y", 3);
    expect(g.runLength).toBe(3000 - 20); // length - near - far
    expect(g.crossWidthStart).toBe(4000 - 20); // width - left - right
    expect(g.crossWidthEnd).toBe(4000 - 20);
    expect(g.crossVaries).toBe(false);
  });

  test("run = X: runLength is width, cross is length", () => {
    const g = computeGeometry(square, DEFAULT_GAP, "X", 3);
    expect(g.runLength).toBe(4000 - 20);
    expect(g.crossWidthStart).toBe(3000 - 20);
    expect(g.crossVaries).toBe(false);
  });

  test("crossWidthAt is constant for a square room", () => {
    const g = computeGeometry(square, DEFAULT_GAP, "Y", 3);
    expect(crossWidthAt(g, 0)).toBe(crossWidthAt(g, 1));
  });
});

describe("geometry — out of square", () => {
  const slanted: RectMeasurements = {
    widthNear: 4000,
    widthFar: 3900, // right wall slanted
    lengthLeft: 3000,
    lengthRight: 3000,
  };

  test("run = Y detects varying cross width and interpolates", () => {
    const g = computeGeometry(slanted, DEFAULT_GAP, "Y", 3);
    expect(g.crossVaries).toBe(true);
    expect(g.crossWidthStart).toBe(4000 - 20);
    expect(g.crossWidthEnd).toBe(3900 - 20);
    expect(crossWidthAt(g, 0.5)).toBeCloseTo((3980 + 3880) / 2, 6);
  });

  test("run = X stays square when only width varies", () => {
    const g = computeGeometry(slanted, DEFAULT_GAP, "X", 3);
    expect(g.crossVaries).toBe(false); // length axis is parallel
  });
});

describe("geometry — coordinate mapping", () => {
  test("toRoom run=Y maps run→Y, cross→X with gap origin", () => {
    const g = computeGeometry(square, DEFAULT_GAP, "Y", 3);
    expect(toRoom(g, 0, 0)).toEqual({ x: 10, y: 10 });
    expect(toRoom(g, 100, 50)).toEqual({ x: 60, y: 110 });
  });

  test("toRoom run=X maps run→X, cross→Y", () => {
    const g = computeGeometry(square, DEFAULT_GAP, "X", 3);
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
