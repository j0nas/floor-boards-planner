import { describe, expect, test } from "vite-plus/test";
import { DEFAULT_INPUTS } from "./defaults.ts";
import { buildPlanForAxis } from "./plan.ts";
import { rectRoom } from "./room.ts";
import { pairStagger } from "./stagger.ts";
import type { Inputs, Plan } from "./types.ts";
import { makeRng } from "./units.ts";
import { checkPlan } from "./verify.ts";

const even = (i: Inputs): Inputs => ({ ...i, tunables: { ...i.tunables, pattern: "even" } });

/** Closest joints two rows apart (∞ when there are none). */
function ladderGap(plan: Plan): number {
  let gap = Number.POSITIVE_INFINITY;
  for (let i = 2; i < plan.rows.length; i++)
    gap = Math.min(gap, pairStagger(plan.rows[i]!.seamPositions, plan.rows[i - 2]!.seamPositions));
  return gap;
}

describe("least waste (the default pattern)", () => {
  // A pantry-sized room: eight rows of ~2.87 m from 2.05 m boards.
  const pantry = structuredClone(DEFAULT_INPUTS);
  pantry.room = rectRoom({ widthNear: 2887, widthFar: 2880, lengthLeft: 1677, lengthRight: 1675 });
  pantry.gap = { near: 5, far: 5, left: 5, right: 5 };
  pantry.tunables = { ...pantry.tunables, kerf: 3 };

  test("chains offcuts to the fewest boards the rows' length allows", () => {
    const lw = buildPlanForAxis(pantry, "X");
    const ev = buildPlanForAxis(even(pantry), "X");
    const length = lw.rows.reduce((s, r) => s + r.runLength, 0);
    expect(lw.material.boardsConsumed).toBe(Math.ceil(length / pantry.board.length)); // 12
    expect(ev.material.boardsConsumed).toBe(14);
    expect(lw.valid).toBe(true);
    expect(lw.stagger.minObservedStagger).toBeGreaterThanOrEqual(pantry.tunables.minStagger);
    expect(checkPlan(pantry, lw)).toEqual([]);
  });

  test("doesn't line joints up two rows apart when that costs no board", () => {
    expect(ladderGap(buildPlanForAxis(pantry, "X"))).toBeGreaterThanOrEqual(
      pantry.tunables.minStagger,
    );
  });

  test("keeps the even pattern when it already uses the fewest boards", () => {
    // The default room's 15 rows of 3.98 m need 30 boards however they're cut.
    const lw = buildPlanForAxis(DEFAULT_INPUTS, "X");
    const ev = buildPlanForAxis(even(DEFAULT_INPUTS), "X");
    expect(lw.material.boardsConsumed).toBe(30);
    expect(lw.rows.map((r) => r.startOffset)).toEqual(ev.rows.map((r) => r.startOffset));
  });

  test("never needs more boards than the even pattern, over randomised rooms", () => {
    const rand = makeRng(20260924);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
    let fewer = 0;
    for (let i = 0; i < 60; i++) {
      const W = 1500 + Math.round(rand() * 5000);
      const L = 1500 + Math.round(rand() * 5000);
      const inputs = structuredClone(DEFAULT_INPUTS);
      inputs.room = rectRoom({
        widthNear: W,
        widthFar: W + Math.round((rand() - 0.5) * 30),
        lengthLeft: L,
        lengthRight: L + Math.round((rand() - 0.5) * 30),
      });
      const bl = pick([1200, 1380, 1845, 2050, 2200]);
      inputs.board = { length: bl, width: pick([140, 190, 211, 244]), thickness: 8 };
      inputs.tunables = {
        ...inputs.tunables,
        kerf: pick([0, 3]),
        idealStagger: Math.round(bl / 3),
      };
      for (const axis of ["X", "Y"] as const) {
        const lw = buildPlanForAxis(inputs, axis);
        const ev = buildPlanForAxis(even(inputs), axis);
        expect(lw.material.boardsConsumed, `room ${i} ${axis}`).toBeLessThanOrEqual(
          ev.material.boardsConsumed,
        );
        if (ev.valid) expect(lw.valid, `room ${i} ${axis}`).toBe(true);
        expect(checkPlan(inputs, lw), `room ${i} ${axis}`).toEqual([]);
        if (lw.material.boardsConsumed < ev.material.boardsConsumed) fewer++;
      }
    }
    expect(fewer).toBeGreaterThan(20); // it usually finds a saving
  });

  test("the even pattern is still there when you'd rather have it", () => {
    const ev = buildPlanForAxis(even(DEFAULT_INPUTS), "X");
    const starts = new Set(ev.rows.map((r) => Math.round(r.startOffset)));
    expect(starts.size).toBe(ev.stagger.phases); // a repeating schedule
  });
});
