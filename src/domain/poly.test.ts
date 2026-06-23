import { describe, expect, test } from "vite-plus/test";
import { type Ring, clipRings, insetRoom, ringsArea } from "./poly.ts";

const abs = Math.abs;

// An L-shaped room (mm), CCW. Left column x∈[0,2000] is full height (y 0..3000);
// right column x∈[2000,4000] only reaches y=1500. Reflex corner at (2000,1500).
// Area = 2000·3000 (left) + 2000·1500 (right) = 9,000,000 mm² (9 m²).
const L_ROOM: Ring = [
  { x: 0, y: 0 },
  { x: 4000, y: 0 },
  { x: 4000, y: 1500 },
  { x: 2000, y: 1500 },
  { x: 2000, y: 3000 },
  { x: 0, y: 3000 },
];

/** Full-width horizontal plank strip spanning a given y-band (overshoots the room). */
function strip(y0: number, y1: number): Ring {
  return [
    { x: -100, y: y0 },
    { x: 4200, y: y0 },
    { x: 4200, y: y1 },
    { x: -100, y: y1 },
  ];
}

describe("poly — Clipper2-backed room geometry", () => {
  test("the L-room area is exact", () => {
    expect(abs(ringsArea([L_ROOM]))).toBeCloseTo(9_000_000, 0);
  });

  test("insetting by the expansion gap shrinks the room but keeps its 6 corners", () => {
    const inset = insetRoom(L_ROOM, 10);
    expect(inset).toHaveLength(1);
    expect(inset[0]).toHaveLength(6); // right angles preserved by miter joins
    const a = abs(ringsArea(inset));
    expect(a).toBeLessThan(9_000_000);
    expect(a).toBeGreaterThan(8_800_000); // ≈ 9e6 − perimeter(14000)·10mm
  });

  test("clipping a plank well inside the base trims it to the inset width", () => {
    const inset = insetRoom(L_ROOM, 10); // side walls now at x∈[10,3990]
    const clipped = clipRings([strip(100, 300)], inset);
    expect(clipped).toHaveLength(1);
    // width 3990−10 = 3980, height 200 → 796,000 mm²
    expect(abs(ringsArea(clipped))).toBeCloseTo(796_000, 0);
  });

  test("a plank crossing the inner corner clips to a stepped, non-rectangular piece", () => {
    const inset = insetRoom(L_ROOM, 10); // notch ceiling drops to y=1490, leg wall to x=1990
    const clipped = clipRings([strip(1400, 1600)], inset);
    expect(clipped).toHaveLength(1);
    // y 1400..1490 (h90) full width 3980 = 358,200; y 1490..1600 (h110) width 1980 = 217,800
    expect(abs(ringsArea(clipped))).toBeCloseTo(576_000, 0);
    expect(clipped[0]!.length).toBeGreaterThan(4); // a step, not a rectangle
  });
});
