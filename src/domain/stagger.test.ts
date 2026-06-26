import { describe, expect, test } from "vite-plus/test";
import { planRowPieces, planStagger, seamsOf } from "./stagger.ts";
import { makeRng } from "./units.ts";

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

describe("planStagger — randomised pattern", () => {
  const L = 4980;
  const ROWS = 14;
  const base = planStagger(L, BL, ROWS, MIN_PIECE, MIN_STAGGER, IDEAL); // randomness 0
  const rnd = planStagger(L, BL, ROWS, MIN_PIECE, MIN_STAGGER, IDEAL, 1, 7);

  test("randomness 0 leaves the regular schedule byte-for-byte unchanged", () => {
    const explicitZero = planStagger(L, BL, ROWS, MIN_PIECE, MIN_STAGGER, IDEAL, 0, 7);
    expect(explicitZero.startOffsets).toEqual(base.startOffsets);
  });

  test("a randomised layout still clears every minimum", () => {
    expect(Math.min(...allPieces(L, rnd.startOffsets))).toBeGreaterThanOrEqual(MIN_PIECE - 0.5);
    expect(minAdjacentStagger(L, rnd.startOffsets)).toBeGreaterThanOrEqual(MIN_STAGGER - 0.5);
    expect(rnd.info.minObservedStagger).toBeGreaterThanOrEqual(MIN_STAGGER - 0.5);
  });

  test("randomisation actually changes the pattern", () => {
    const changed = rnd.startOffsets.some((s, i) => Math.abs(s - (base.startOffsets[i] ?? 0)) > 1);
    expect(changed).toBe(true);
  });

  test("deterministic by seed; different seeds give different patterns", () => {
    const a = planStagger(L, BL, ROWS, MIN_PIECE, MIN_STAGGER, IDEAL, 1, 7);
    const b = planStagger(L, BL, ROWS, MIN_PIECE, MIN_STAGGER, IDEAL, 1, 7);
    const c = planStagger(L, BL, ROWS, MIN_PIECE, MIN_STAGGER, IDEAL, 1, 99);
    expect(a.startOffsets).toEqual(b.startOffsets);
    expect(c.startOffsets).not.toEqual(a.startOffsets);
  });

  test("full randomness never emits a sub-min piece, even near a board multiple", () => {
    for (let L2 = 2200; L2 <= 9000; L2 += 53) {
      const p = planStagger(L2, BL, 10, MIN_PIECE, MIN_STAGGER, IDEAL, 1, 5);
      expect(Math.min(...allPieces(L2, p.startOffsets)), `L=${L2}`).toBeGreaterThanOrEqual(
        MIN_PIECE - 0.5,
      );
    }
  });

  test("randomness still clears the stagger floor on an exact board multiple", () => {
    const p = planStagger(6 * BL, BL, 12, MIN_PIECE, MIN_STAGGER, IDEAL, 1, 3);
    expect(minAdjacentStagger(6 * BL, p.startOffsets)).toBeGreaterThanOrEqual(MIN_STAGGER - 0.5);
  });
});

describe("makeRng (seeded PRNG)", () => {
  test("is deterministic for a seed and yields [0,1)", () => {
    const a = Array.from({ length: 8 }, makeRng(123));
    const b = Array.from({ length: 8 }, makeRng(123));
    expect(a).toEqual(b);
    for (const x of a) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
  test("different seeds diverge", () => {
    const a = makeRng(1)();
    const b = makeRng(2)();
    expect(a).not.toBe(b);
  });
});
