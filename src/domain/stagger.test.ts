import { describe, expect, test } from "vitest";
import { planRowPieces, planStagger, seamsOf } from "./stagger.ts";

const BL = 2050;
const MIN_PIECE = 300;
const MIN_STAGGER = 300;
const IDEAL = Math.round(BL / 3);

function allPieces(L: number, offsets: number[]): number[] {
  return offsets.flatMap((s) => planRowPieces(L, BL, s));
}

function minAdjacentStagger(L: number, offsets: number[]): number {
  const seams = offsets.map((s) => seamsOf(planRowPieces(L, BL, s), L));
  let mn = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 1 < seams.length; i++) {
    for (const a of seams[i]!) for (const b of seams[i + 1]!) mn = Math.min(mn, Math.abs(a - b));
  }
  return mn;
}

describe("planRowPieces", () => {
  test("decomposes run into start + full boards + end summing to L", () => {
    const pieces = planRowPieces(5000, BL, 700);
    expect(pieces[0]).toBe(700);
    expect(pieces.reduce((a, b) => a + b, 0)).toBeCloseTo(5000, 6);
    expect(pieces.slice(1, -1).every((p) => p === BL)).toBe(true);
  });

  test("short row is a single piece", () => {
    expect(planRowPieces(1800, BL, 999)).toEqual([1800]);
  });
});

describe("planStagger — normal room", () => {
  const L = 4980; // ~5 m run
  const plan = planStagger(L, BL, 14, MIN_PIECE, MIN_STAGGER, IDEAL);

  test("uses ≥ 3 phases with stagger near 1/3 board", () => {
    expect(plan.info.phases).toBeGreaterThanOrEqual(3);
    expect(plan.info.achievedStagger).toBeGreaterThanOrEqual(MIN_STAGGER);
    expect(plan.info.achievedStagger).toBeLessThanOrEqual(BL / 2 + 1);
  });

  test("no installed piece below the minimum", () => {
    const mn = Math.min(...allPieces(L, plan.startOffsets));
    expect(mn).toBeGreaterThanOrEqual(MIN_PIECE - 0.5);
  });

  test("adjacent rows are staggered at least the minimum", () => {
    expect(minAdjacentStagger(L, plan.startOffsets)).toBeGreaterThanOrEqual(MIN_STAGGER - 0.5);
    expect(plan.info.minObservedStagger).toBeGreaterThanOrEqual(MIN_STAGGER - 0.5);
  });

  test("not flagged as a near-multiple trap", () => {
    expect(plan.info.nearMultipleTrap).toBe(false);
  });
});

describe("planStagger — near-multiple trap", () => {
  test("exact multiple is detected and rescued by the multi-piece pattern", () => {
    const L = 6 * BL; // 12300 — seams would align with a 2-piece pattern
    const plan = planStagger(L, BL, 14, MIN_PIECE, MIN_STAGGER, IDEAL);
    expect(plan.info.naturalStagger).toBeLessThan(MIN_STAGGER);
    expect(plan.info.nearMultipleTrap).toBe(true);
    expect(plan.info.usedMultiPiecePattern).toBe(true);
    // Despite the trap, the produced layout still staggers and has no sub-min piece.
    expect(minAdjacentStagger(L, plan.startOffsets)).toBeGreaterThanOrEqual(MIN_STAGGER - 0.5);
    expect(Math.min(...allPieces(L, plan.startOffsets))).toBeGreaterThanOrEqual(MIN_PIECE - 0.5);
  });

  test("a near (not exact) multiple is also trapped", () => {
    const L = 6 * BL + 150;
    const plan = planStagger(L, BL, 12, MIN_PIECE, MIN_STAGGER, IDEAL);
    expect(plan.info.nearMultipleTrap).toBe(true);
    expect(Math.min(...allPieces(L, plan.startOffsets))).toBeGreaterThanOrEqual(MIN_PIECE - 0.5);
  });

  test("a run far from a multiple is not trapped", () => {
    const L = 6 * BL + 1000;
    const plan = planStagger(L, BL, 12, MIN_PIECE, MIN_STAGGER, IDEAL);
    expect(plan.info.nearMultipleTrap).toBe(false);
  });
});

describe("planStagger — robustness over many run lengths", () => {
  test("never emits a sub-min piece for plausible rooms", () => {
    for (let L = 2200; L <= 9000; L += 37) {
      const plan = planStagger(L, BL, 10, MIN_PIECE, MIN_STAGGER, IDEAL);
      const mn = Math.min(...allPieces(L, plan.startOffsets));
      expect(mn, `L=${L}`).toBeGreaterThanOrEqual(MIN_PIECE - 0.5);
    }
  });
});
