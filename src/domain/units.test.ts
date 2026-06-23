import { describe, expect, test } from "vite-plus/test";
import { approxEq, clamp, gte, lerp, lte, m2ToMm2, mm2ToM2, roundTo, sum } from "./units.ts";

describe("units", () => {
  test("approxEq within tolerance", () => {
    expect(approxEq(100, 100.3)).toBe(true);
    expect(approxEq(100, 101)).toBe(false);
  });

  test("gte / lte with slack", () => {
    expect(gte(50, 50.2)).toBe(true); // within EPS
    expect(gte(50, 51)).toBe(false);
    expect(lte(50, 49.8)).toBe(true);
  });

  test("clamp", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });

  test("lerp endpoints and midpoint", () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(0, 10, 0.5)).toBe(5);
  });

  test("sum", () => {
    expect(sum([1, 2, 3])).toBe(6);
    expect(sum([])).toBe(0);
  });

  test("roundTo", () => {
    expect(roundTo(123.4)).toBe(123);
    expect(roundTo(127, 5)).toBe(125);
  });

  test("area conversions round-trip", () => {
    expect(mm2ToM2(m2ToMm2(2.6))).toBeCloseTo(2.6, 9);
  });
});
