import { describe, expect, test } from "vite-plus/test";
import { DEFAULT_INPUTS } from "./defaults.ts";
import { buildPlanForAxis, computePlans } from "./plan.ts";
import { asRect, rectRoom } from "./room.ts";
import type { Inputs, Plan } from "./types.ts";
import { checkPlan } from "./verify.ts";

function clone(i: Inputs): Inputs {
  return structuredClone(i);
}

/** Assert the hard domain invariants on a plan. */
function assertInvariants(plan: Plan, inputs: Inputs) {
  const t = inputs.tunables;
  // The independent physical check: tiling, sizes, cuttable cut list, stagger.
  expect(checkPlan(inputs, plan)).toEqual([]);
  // No installed piece below the minimum (an angled end judged on its short edge).
  for (const p of plan.pieces) {
    const shortest = Math.min(p.faceLength, p.faceLengthShort ?? p.faceLength);
    expect(shortest, `piece ${p.id}`).toBeGreaterThanOrEqual(t.minPiece - 0.5);
  }
  // First/last rows meet the minimum row width, at their narrow end too.
  for (const r of plan.rows.filter((r) => r.isEndRow)) {
    expect(r.rowWidthNarrow).toBeGreaterThanOrEqual(t.minRowWidth - 0.5);
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
    // 100 mm over the 3000 mm wall → 99.3 mm across the 2980 mm between the gaps.
    expect(planY.taper!.outOfSquareMm).toBeCloseTo((100 * 2980) / 3000, 1);
    expect(planY.taper!.taperWideMm - planY.taper!.taperNarrowMm).toBeCloseTo(
      planY.taper!.outOfSquareMm,
      6,
    );
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

describe("computePlans — forced orientation that doesn't fit", () => {
  test("falls back to the feasible orientation instead of pointing at a null plan", () => {
    const inputs = clone(DEFAULT_INPUTS);
    // 300 mm wide room: running boards along the width leaves a 280 mm run,
    // below the 300 mm min piece → that orientation is infeasible.
    inputs.room = rectRoom({ widthNear: 300, widthFar: 300, lengthLeft: 3000, lengthRight: 3000 });
    inputs.orientation = { mode: "forced", runAxis: "X" };
    const r = computePlans(inputs);
    expect(r.plans.X).toBeNull();
    expect(r.chosenAxis).toBe("Y");
    expect(r.plans[r.chosenAxis]).not.toBeNull(); // chosen axis always has a plan
    expect(r.comparison.some((d) => d.code === "orientation.forcedInfeasible")).toBe(true);
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

// ───────────────────── regressions from the pre-cut correctness review ─────────────────────

/** Gap between each row's boards and the (possibly slanted) run-end wall, per row. */
function rowEndGaps(plan: Plan, wallX: (y: number) => number): number[] {
  const gaps: number[] = [];
  for (const row of plan.rows) {
    const pieces = plan.pieces.filter((p) => p.rowIndex === row.index);
    for (const y of [
      Math.min(...pieces.flatMap((p) => p.poly.map((q) => q.y))),
      Math.max(...pieces.flatMap((p) => p.poly.map((q) => q.y))),
    ]) {
      // Rightmost board edge at this y (the row's last piece).
      const xs = pieces.flatMap((p) =>
        p.poly.filter((q) => Math.abs(q.y - y) < 0.01).map((q) => q.x),
      );
      gaps.push(wallX(y) - Math.max(...xs));
    }
  }
  return gaps;
}

describe("regression — a slanted wall at the row ends is followed row by row", () => {
  // Right wall 40 mm out of square over 3 m; boards run along it (X).
  const inputs = clone(DEFAULT_INPUTS);
  inputs.room = rectRoom({ widthNear: 4000, widthFar: 4040, lengthLeft: 3000, lengthRight: 3000 });
  const plan = buildPlanForAxis(inputs, "X");
  const cos = 3000 / Math.hypot(40, 3000);
  const wallX = (y: number) => 4000 + (40 * y) / 3000;

  test("every row keeps the 10 mm gap (was −10 mm into the wall / 30 mm, averaged)", () => {
    for (const g of rowEndGaps(plan, wallX)) expect(g * cos).toBeCloseTo(10, 1);
  });

  test("row lengths differ and the plan says so", () => {
    const lengths = plan.rows.map((r) => r.runLength);
    expect(Math.max(...lengths) - Math.min(...lengths)).toBeGreaterThan(30);
    expect(plan.diagnostics.some((d) => d.code === "run.angled")).toBe(true);
    assertInvariants(plan, inputs);
  });

  test("even within the square tolerance, the measured slant is honoured", () => {
    const within = clone(DEFAULT_INPUTS);
    within.room = rectRoom({
      widthNear: 4000,
      widthFar: 4014,
      lengthLeft: 3000,
      lengthRight: 3000,
    });
    const p = buildPlanForAxis(within, "X");
    const c = 3000 / Math.hypot(14, 3000);
    for (const g of rowEndGaps(p, (y) => 4000 + (14 * y) / 3000)) expect(g * c).toBeCloseTo(10, 1);
  });
});

describe("regression — taper pieces carry their own widths", () => {
  for (const [near, far] of [
    [4000, 3960],
    [3960, 4000],
  ] as const) {
    test(`right wall ${near} → ${far}: each taper piece's widths are its real ends`, () => {
      const inputs = clone(DEFAULT_INPUTS);
      inputs.room = rectRoom({
        widthNear: near,
        widthFar: far,
        lengthLeft: 3000,
        lengthRight: 3000,
      });
      const plan = buildPlanForAxis(inputs, "Y");
      const last = plan.rows[plan.rows.length - 1]!;
      expect(last.isTaper).toBe(true);
      for (const p of plan.pieces.filter((q) => q.rowIndex === last.index)) {
        const ys = p.poly.map((q) => q.y);
        const widthAt = (y: number) => {
          const xs = p.poly.filter((q) => Math.abs(q.y - y) < 0.01).map((q) => q.x);
          return Math.max(...xs) - Math.min(...xs);
        };
        const start = widthAt(Math.min(...ys));
        const end = widthAt(Math.max(...ys));
        expect(p.faceWidth).toBeCloseTo(Math.max(start, end), 1);
        expect(p.faceWidthNarrow).toBeCloseTo(Math.min(start, end), 1);
        expect(p.narrowAtEnd).toBe(end < start);
        const cut = plan.cutList.find((c) => c.pieceId === p.id)!;
        expect(cut.width).toBeCloseTo(p.faceWidth, 6);
        expect(cut.widthNarrow).toBeCloseTo(p.faceWidthNarrow!, 6);
      }
      assertInvariants(plan, inputs);
    });
  }
});

describe("regression — offcuts respect the click-joint ends", () => {
  test("default room: a start piece never comes from another start piece's offcut", () => {
    const r = computePlans(DEFAULT_INPUTS);
    const plan = r.plans[r.chosenAxis]!;
    const role = new Map(plan.cutList.map((c) => [c.pieceId, c.role]));
    for (const e of plan.reuseMap) {
      const from = role.get(e.fromPieceId);
      const to = role.get(e.usedByPieceId);
      if (from === "start") expect(to).not.toBe("start");
      if (from === "end") expect(to).not.toBe("end");
    }
    assertInvariants(plan, DEFAULT_INPUTS);
  });
});

describe("regression — every border option is a complete, consistent plan", () => {
  test("choosing the other border option re-plans the cut list and material with it", () => {
    const inputs = clone(DEFAULT_INPUTS);
    const base = buildPlanForAxis(inputs, "Y");
    expect(base.layoutOptions.length).toBe(2);
    const otherIdx = 1 - base.chosenOptionIndex;
    const other = buildPlanForAxis(inputs, "Y", otherIdx);
    expect(other.chosenOptionIndex).toBe(otherIdx);
    expect(other.rows.map((r) => Math.round(r.rowWidth))).not.toEqual(
      base.rows.map((r) => Math.round(r.rowWidth)),
    );
    // The cut list belongs to the pieces actually drawn.
    expect(new Set(other.cutList.map((c) => c.pieceId))).toEqual(
      new Set(other.pieces.map((p) => p.id)),
    );
    assertInvariants(other, inputs);
  });
});

describe("regression — a taper the last row can't absorb is clipped across rows", () => {
  test("190 mm slant on 244 mm boards falls back to the clip engine on the exact floor", () => {
    const inputs = clone(DEFAULT_INPUTS);
    inputs.room = {
      outline: [
        { x: 0, y: 0 },
        { x: 4773, y: 0 },
        { x: 4750, y: 2472 },
        { x: 0, y: 2281 },
      ],
    };
    inputs.board = { length: 2050, width: 244, thickness: 8 };
    const plan = computePlans(inputs).plans.X!;
    expect(plan.rows.length).toBe(0); // clip engine
    expect(plan.diagnostics.some((d) => d.code === "poly.uniformGap")).toBe(false);
    expect(checkPlan(inputs, plan)).toEqual([]);
  });

  test("a balanced row never overshoots a board width when the leftover is a hair over one", () => {
    const inputs = clone(DEFAULT_INPUTS);
    inputs.room = rectRoom({
      widthNear: 2407,
      widthFar: 2407,
      lengthLeft: 5089,
      lengthRight: 4988,
    });
    inputs.board = { length: 1380, width: 211, thickness: 8 };
    inputs.gap = { near: 12, far: 12, left: 12, right: 12 };
    const plan = buildPlanForAxis(inputs, "X");
    for (const option of plan.layoutOptions.keys()) {
      const p = buildPlanForAxis(inputs, "X", option);
      for (const piece of p.pieces) expect(piece.faceWidth).toBeLessThanOrEqual(211 + 0.5);
      expect(checkPlan(inputs, p)).toEqual([]);
    }
  });
});

describe("real room — the pantry laid in 2026-09 (Pergo Trondheim 2050 × 211)", () => {
  // Measured on site (mm): door wall A–B 2887, B–C 1677, back wall C–D 2880,
  // D–A 1675, both diagonals 3325. Entered with the door wall as "near", seen
  // from the doorway (so B is near-left); boards along the long walls; saw kerf 3;
  // the owner's choice of a 5 mm gap; the 704 mm door (opening into the hallway)
  // floored 81 mm through the wall to the threshold, 10 mm under each jamb.
  const inputs = clone(DEFAULT_INPUTS);
  inputs.room = rectRoom({ widthNear: 2887, widthFar: 2880, lengthLeft: 1677, lengthRight: 1675 });
  inputs.board = { length: 2050, width: 211, thickness: 9.5 };
  inputs.gap = { near: 5, far: 5, left: 5, right: 5 };
  inputs.orientation = { mode: "forced", runAxis: "X" };
  inputs.openings = [{ wall: 0, offset: 1145.5, width: 704, depth: 81, tuck: 10 }];
  inputs.tunables = { ...inputs.tunables, kerf: 3 };
  const result = computePlans(inputs);
  const plan = result.plans[result.chosenAxis]!;

  test("is valid and passes the independent self-check", () => {
    expect(result.chosenAxis).toBe("X");
    expect(plan.valid).toBe(true);
    assertInvariants(plan, inputs);
  });

  test("seven full rows from the door wall, one 190 → 188 mm rip at the back wall", () => {
    expect(plan.rows.map((r) => Math.round(r.rowWidth))).toEqual([
      211, 211, 211, 211, 211, 211, 211, 190,
    ]);
    expect(Math.round(plan.rows[7]!.rowWidthNarrow)).toBe(188);
  });

  test("the cut list that was handed to the installer", () => {
    expect(plan.rows.map((r) => r.pieceLengths.map((l) => Math.round(l)))).toEqual([
      [1778, 1099],
      [1095, 1781],
      [412, 2050, 414],
      [1778, 1096],
      [1095, 1778],
      [412, 2050, 411],
      [1778, 1093],
      [1095, 1776],
    ]);
    expect(plan.material.boardsConsumed).toBe(14);
    expect(plan.material.recommendedPurchasePacks).toBe(3);
    // Four boards give an end piece and a start piece from opposite ends, and
    // row 8's start board gives the doorway strip from its offcut.
    const byBoard = new Map<string, string[]>();
    for (const c of plan.cutList)
      byBoard.set(c.source, [...(byBoard.get(c.source) ?? []), `r${c.rowIndex + 1}-${c.role}`]);
    const shared = [...byBoard.values()].filter((v) => v.length > 1).map((v) => v.join("+"));
    expect(shared).toEqual([
      "r1-end+r3-start",
      "r2-start+r3-end",
      "r4-end+r6-start",
      "r5-start+r6-end",
      "r8-start+r0-free",
    ]);
    const strip = plan.cutList.find((c) => c.opening === 0)!;
    expect(Math.round(strip.length)).toBe(724);
    expect(Math.round(strip.width)).toBe(86);
  });
});
