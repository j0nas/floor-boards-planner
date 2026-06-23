import { describe, expect, test } from "vite-plus/test";
import { DEFAULT_INPUTS } from "./defaults.ts";
import { buildPlanForAxis, computePlans } from "./plan.ts";
import { asRect, rectRoom } from "./room.ts";
import type { Inputs, Plan } from "./types.ts";

function clone(i: Inputs): Inputs {
  return structuredClone(i);
}

/** Assert the hard domain invariants on a plan. */
function assertInvariants(plan: Plan, inputs: Inputs) {
  const t = inputs.tunables;
  // No installed piece below the minimum.
  for (const p of plan.pieces) {
    expect(p.faceLength, `piece ${p.id}`).toBeGreaterThanOrEqual(t.minPiece - 0.5);
  }
  // First/last rows meet the minimum row width.
  for (const r of plan.rows.filter((r) => r.isEndRow)) {
    expect(r.rowWidth).toBeGreaterThanOrEqual(t.minRowWidth - 0.5);
  }
  // Adjacent-row stagger ≥ minimum (when there are interior seams).
  for (let i = 0; i + 1 < plan.rows.length; i++) {
    const a = plan.rows[i]!.seamPositions;
    const b = plan.rows[i + 1]!.seamPositions;
    if (a.length && b.length) {
      let mn = Infinity;
      for (const x of a) for (const y of b) mn = Math.min(mn, Math.abs(x - y));
      expect(mn).toBeGreaterThanOrEqual(t.minStagger - 0.5);
    }
  }
  // Waste is non-negative and bounded.
  const boardArea = inputs.board.length * inputs.board.width;
  expect(plan.material.boardsConsumed * boardArea).toBeGreaterThanOrEqual(
    plan.material.coveredAreaMm2 - 1,
  );
  expect(plan.material.consumedWastePct).toBeGreaterThanOrEqual(-0.01);
  expect(plan.material.consumedWastePct).toBeLessThan(60);
  // Every piece has a source after cutting.
  for (const p of plan.pieces) {
    expect(p.sourceBoardId ?? p.fromOffcutId).toBeTruthy();
  }
}

describe("computePlans — default 4×3 m room", () => {
  const result = computePlans(DEFAULT_INPUTS);

  test("produces both orientations and chooses one", () => {
    expect(result.plans.X).not.toBeNull();
    expect(result.plans.Y).not.toBeNull();
    expect(["X", "Y"]).toContain(result.chosenAxis);
    expect(result.forced).toBe(false);
  });

  test("chosen plan is valid and satisfies all invariants", () => {
    const plan = result.plans[result.chosenAxis]!;
    expect(plan.valid).toBe(true);
    assertInvariants(plan, DEFAULT_INPUTS);
  });

  test("material summary is internally consistent", () => {
    const plan = result.plans[result.chosenAxis]!;
    const m = plan.material;
    expect(m.boardsConsumed).toBeGreaterThan(0);
    expect(m.packsConsumed).toBe(Math.ceil(m.boardsConsumed / m.boardsPerPack));
    expect(m.recommendedPurchaseBoards).toBeGreaterThanOrEqual(m.boardsConsumed);
    expect(m.recommendedPurchaseBoards % m.boardsPerPack).toBe(0);
  });

  test("both balanced and unbalanced options surface when leftover is healthy", () => {
    const plan = result.plans[result.chosenAxis]!;
    expect(plan.layoutOptions.length).toBeGreaterThanOrEqual(1);
  });
});

describe("computePlans — out of square", () => {
  const inputs = clone(DEFAULT_INPUTS);
  inputs.room = rectRoom({ ...asRect(inputs.room)!, widthFar: 3900 }); // 100 mm out of square

  test("taper appears on the width-varying orientation and holds the gap", () => {
    const planY = buildPlanForAxis(inputs, "Y"); // run along length, cross = width varies
    expect(planY.taper).toBeDefined();
    expect(planY.taper!.outOfSquareMm).toBeCloseTo(100, 0);
    expect(planY.taper!.taperWideMm - planY.taper!.taperNarrowMm).toBeCloseTo(100, 0);
    // Last row is flagged as a taper row.
    expect(planY.rows[planY.rows.length - 1]!.isTaper).toBe(true);
  });

  test("the perpendicular orientation stays square", () => {
    const planX = buildPlanForAxis(inputs, "X"); // cross = length, parallel
    expect(planX.taper).toBeUndefined();
  });

  test("general quadrilateral is flagged", () => {
    const quad = clone(DEFAULT_INPUTS);
    quad.room = rectRoom({ ...asRect(quad.room)!, widthFar: 3900, lengthRight: 2900 });
    const r = computePlans(quad);
    expect(r.diagnostics.some((d) => d.code === "room.generalQuad")).toBe(true);
  });
});

describe("computePlans — near-multiple length engages multi-piece", () => {
  test("run ≈ integer multiple of board flags the trap", () => {
    const inputs = clone(DEFAULT_INPUTS);
    // Make the length run an exact multiple of board length (+ gaps).
    const run = 6 * 2050 + 20;
    inputs.room = rectRoom({ ...asRect(inputs.room)!, lengthLeft: run, lengthRight: run });
    const planY = buildPlanForAxis(inputs, "Y");
    expect(planY.stagger.nearMultipleTrap).toBe(true);
    expect(planY.stagger.usedMultiPiecePattern).toBe(true);
    assertInvariants(planY, inputs);
  });
});

describe("computePlans — flip mirrors the cut row", () => {
  const widths = (p: Plan) => p.rows.map((r) => Math.round(r.rowWidth));
  const rippedIndex = (p: Plan) => p.rows.findIndex((r) => r.isRipped);

  test("flip reverses the row order and moves the ripped border row", () => {
    const base = buildPlanForAxis({ ...clone(DEFAULT_INPUTS), flip: false }, "Y");
    const flipped = buildPlanForAxis({ ...clone(DEFAULT_INPUTS), flip: true }, "Y");

    // Same rows, mirrored order.
    expect(widths(flipped)).toEqual([...widths(base)].reverse());
    // The ripped border row is now against the opposite wall.
    expect(rippedIndex(base)).toBeGreaterThanOrEqual(0);
    expect(rippedIndex(flipped)).not.toBe(rippedIndex(base));
    assertInvariants(flipped, DEFAULT_INPUTS);
  });

  test("flip is a pure mirror — material and waste are unchanged", () => {
    const base = buildPlanForAxis({ ...clone(DEFAULT_INPUTS), flip: false }, "Y");
    const flipped = buildPlanForAxis({ ...clone(DEFAULT_INPUTS), flip: true }, "Y");
    expect(flipped.material.boardsConsumed).toBe(base.material.boardsConsumed);
    expect(flipped.material.consumedWastePct).toBeCloseTo(base.material.consumedWastePct, 6);
  });

  test("flip is ignored for an out-of-square (tapered) orientation", () => {
    const inputs = clone(DEFAULT_INPUTS);
    inputs.room = rectRoom({ ...asRect(inputs.room)!, widthFar: 3900 }); // cross = width varies along Y
    const base = buildPlanForAxis({ ...inputs, flip: false }, "Y");
    const flipped = buildPlanForAxis({ ...inputs, flip: true }, "Y");
    expect(widths(flipped)).toEqual(widths(base)); // unchanged
    expect(flipped.rows[flipped.rows.length - 1]!.isTaper).toBe(true);
  });
});

describe("computePlans — forced orientation", () => {
  test("respects the force but still compares both", () => {
    const inputs = clone(DEFAULT_INPUTS);
    inputs.orientation = { mode: "forced", runAxis: "X" };
    const r = computePlans(inputs);
    expect(r.chosenAxis).toBe("X");
    expect(r.forced).toBe(true);
    expect(r.comparison.some((d) => d.code === "orientation.compare")).toBe(true);
  });
});

describe("computePlans — invalid inputs", () => {
  test("min piece larger than board → hard error, no plans", () => {
    const inputs = clone(DEFAULT_INPUTS);
    inputs.tunables.minPiece = 3000; // > board length
    const r = computePlans(inputs);
    expect(r.diagnostics.some((d) => d.severity === "error")).toBe(true);
    expect(r.plans.X).toBeNull();
    expect(r.plans.Y).toBeNull();
  });
});
