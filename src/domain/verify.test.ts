import { describe, expect, test } from "vite-plus/test";
import { DEFAULT_INPUTS } from "./defaults.ts";
import { buildPlanForAxis, computePlans } from "./plan.ts";
import { rectRoom } from "./room.ts";
import type { Inputs, Plan } from "./types.ts";
import { makeRng } from "./units.ts";
import { checkPlan } from "./verify.ts";

function defaultPlan(): { inputs: Inputs; plan: Plan } {
  const inputs = structuredClone(DEFAULT_INPUTS);
  return { inputs, plan: buildPlanForAxis(inputs, "X") };
}

describe("checkPlan catches a broken plan", () => {
  test("a sound plan passes", () => {
    const { inputs, plan } = defaultPlan();
    expect(checkPlan(inputs, plan)).toEqual([]);
  });

  test("a piece pushed into the expansion gap", () => {
    const { inputs, plan } = defaultPlan();
    const p = plan.pieces[0]!;
    p.poly = p.poly.map((q) => ({ x: q.x - 5, y: q.y }));
    expect(checkPlan(inputs, plan).join("\n")).toMatch(/expansion gap/);
  });

  test("a missing piece leaves the floor uncovered", () => {
    const { inputs, plan } = defaultPlan();
    plan.pieces.pop();
    expect(checkPlan(inputs, plan).join("\n")).toMatch(/left bare/);
  });

  test("a stated length that isn't the drawn one", () => {
    const { inputs, plan } = defaultPlan();
    plan.pieces[1]!.faceLength += 3;
    expect(checkPlan(inputs, plan).join("\n")).toMatch(/stated length/);
  });

  test("two start pieces cut from one board", () => {
    const { inputs, plan } = defaultPlan();
    const starts = plan.cutList.filter((c) => c.role === "start");
    starts[1]!.source = starts[0]!.source;
    expect(checkPlan(inputs, plan).join("\n")).toMatch(/two start pieces/);
  });

  test("more pieces than a board holds", () => {
    const { inputs, plan } = defaultPlan();
    const fulls = plan.cutList.filter((c) => c.role === "full");
    fulls[1]!.source = fulls[0]!.source;
    expect(checkPlan(inputs, plan).join("\n")).toMatch(/from a 2050 mm board/);
  });

  test("a board count that doesn't match the cut list", () => {
    const { inputs, plan } = defaultPlan();
    plan.material.boardsConsumed -= 1;
    expect(checkPlan(inputs, plan).join("\n")).toMatch(/boards/);
  });

  test("a valid plan whose joints are too close", () => {
    const { inputs, plan } = defaultPlan();
    const stricter = { ...inputs, tunables: { ...inputs.tunables, minStagger: 1500 } };
    expect(checkPlan(stricter, plan).join("\n")).toMatch(/apart/);
  });
});

describe("checkPlan over randomised rooms (both engines, every border option)", () => {
  // Deterministic sweep: square, out-of-square, per-wall gaps, L/notched shapes,
  // doors, several board sizes, kerf, flip and pattern randomness.
  const rand = makeRng(20260923);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const cases: Inputs[] = [];
  for (let i = 0; i < 90; i++) {
    const W = 1500 + Math.round(rand() * 6000);
    const L = 1500 + Math.round(rand() * 6000);
    const slant = () =>
      pick([0, 0, Math.round((rand() - 0.5) * 30), Math.round((rand() - 0.5) * 300)]);
    const inputs = structuredClone(DEFAULT_INPUTS);
    const shape = rand();
    if (shape < 0.75)
      inputs.room = rectRoom({
        widthNear: W,
        widthFar: W + slant(),
        lengthLeft: L,
        lengthRight: L + slant(),
      });
    else {
      const cx = Math.round(W * (0.3 + 0.4 * rand()));
      const cy = Math.round(L * (0.3 + 0.4 * rand()));
      inputs.room = {
        outline: [
          { x: 0, y: 0 },
          { x: W, y: 0 },
          { x: W, y: cy },
          { x: cx, y: cy },
          { x: cx, y: L },
          { x: 0, y: L },
        ],
      };
    }
    const bl = pick([1200, 1380, 1845, 2050, 2200]);
    inputs.board = { length: bl, width: pick([140, 190, 211, 244]), thickness: 8 };
    const g = pick([5, 8, 10, 12]);
    inputs.gap =
      rand() < 0.7
        ? { near: g, far: g, left: g, right: g }
        : {
            near: pick([5, 10, 15]),
            far: pick([5, 10, 15]),
            left: pick([5, 10, 15]),
            right: pick([5, 10, 15]),
          };
    inputs.flip = rand() < 0.3;
    // Up to two doors, anywhere along any wall (overlapping or corner-gap doors
    // are rejected by validation, leaving no plan to check).
    inputs.openings = [];
    for (let d = Math.floor(rand() * 3); d > 0; d--) {
      const o = inputs.room.outline;
      const wall = Math.floor(rand() * o.length);
      const a = o[wall]!;
      const b = o[(wall + 1) % o.length]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const width = 500 + Math.round(rand() * 600);
      const tuck = pick([0, 5, 10]);
      if (len < width + 2 * tuck + 20) continue;
      const offset = tuck + Math.round(rand() * (len - width - 2 * tuck));
      inputs.openings.push({ wall, offset, width, depth: pick([0, 40, 80, 120, 250]), tuck });
    }
    inputs.tunables = {
      ...inputs.tunables,
      kerf: pick([0, 0, 3]),
      idealStagger: Math.round(bl / 3),
      staggerRandomness: pick([0, 0, 0.5, 1]),
      staggerSeed: 1 + Math.floor(rand() * 50),
    };
    cases.push(inputs);
  }

  test("every plan is physically consistent", () => {
    let checked = 0;
    for (const [i, inputs] of cases.entries()) {
      const result = computePlans(inputs);
      for (const axis of ["X", "Y"] as const) {
        const plan = result.plans[axis];
        if (!plan) continue;
        const variants = [plan];
        if (plan.rows.length)
          for (const k of plan.layoutOptions.keys())
            if (k !== plan.chosenOptionIndex) variants.push(buildPlanForAxis(inputs, axis, k));
        for (const v of variants) {
          checked++;
          expect(
            checkPlan(inputs, v),
            `case ${i} axis ${axis} option ${v.chosenOptionIndex}`,
          ).toEqual([]);
        }
      }
    }
    expect(checked).toBeGreaterThan(150);
  });
});
