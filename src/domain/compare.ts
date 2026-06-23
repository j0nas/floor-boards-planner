import type { Axis, Diagnostic, Plan, PlanScore } from "./types.ts";

const STAGGER_TOL = 20; // mm — ignore tiny stagger differences
const BALANCE_TOL = 0.05;
const WASTE_TOL = 0.5; // percentage points

/**
 * Lexicographic comparison of two plans (returns > 0 when `a` is better):
 *   1. validity (hard gate)
 *   2. healthier stagger
 *   3. better border balance
 *   4. lower waste
 */
export function comparePlans(a: PlanScore, b: PlanScore): number {
  if (a.valid !== b.valid) return a.valid ? 1 : -1;

  const ds = a.staggerScore - b.staggerScore;
  if (Math.abs(ds) > STAGGER_TOL) return ds;

  const db = a.balanceScore - b.balanceScore;
  if (Math.abs(db) > BALANCE_TOL) return db;

  const dw = b.wastePct - a.wastePct; // lower waste is better
  if (Math.abs(dw) > WASTE_TOL) return dw;

  return 0;
}

/** Choose the better orientation and produce a human-readable verdict. */
export function chooseAxis(
  planX: Plan | null,
  planY: Plan | null,
  forced: Axis | null,
  long: Axis,
): { axis: Axis; comparison: Diagnostic[] } {
  const comparison: Diagnostic[] = [];
  // "length" = the longer room side, "width" = the shorter, so the verdict reads
  // the same way as the orientation labels in the UI.
  const word = (a: Axis) => (a === long ? "length" : "width");
  const phrase = (a: Axis) =>
    `along the ${word(a)} (the ${a === long ? "longer" : "shorter"} walls)`;

  if (forced) {
    const other = forced === "X" ? planY : planX;
    const chosen = forced === "X" ? planX : planY;
    comparison.push({
      severity: "info",
      code: "orientation.forced",
      message: `Orientation forced: boards run ${phrase(forced)}.`,
    });
    if (chosen && other) {
      comparison.push(orientationVerdict(planX, planY, word));
    }
    return { axis: forced, comparison };
  }

  if (planX && !planY) return { axis: "X", comparison };
  if (planY && !planX) return { axis: "Y", comparison };
  if (!planX && !planY) return { axis: "Y", comparison }; // nothing valid; arbitrary

  const cmp = comparePlans(planX!.score, planY!.score);
  const axis: Axis = cmp >= 0 ? "X" : "Y";
  comparison.push(orientationVerdict(planX, planY, word));
  comparison.push({
    severity: "info",
    code: "orientation.auto",
    message: `Recommended: run boards ${phrase(axis)}.`,
  });
  return { axis, comparison };
}

function pct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function orientationVerdict(
  planX: Plan | null,
  planY: Plan | null,
  word: (a: Axis) => string,
): Diagnostic {
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const fx = planX
    ? `${cap(word("X"))}: stagger ${Math.round(planX.stagger.minObservedStagger === Infinity ? planX.stagger.achievedStagger : planX.stagger.minObservedStagger)} mm, waste ${pct(planX.material.consumedWastePct)}`
    : `${cap(word("X"))}: not feasible`;
  const fy = planY
    ? `${cap(word("Y"))}: stagger ${Math.round(planY.stagger.minObservedStagger === Infinity ? planY.stagger.achievedStagger : planY.stagger.minObservedStagger)} mm, waste ${pct(planY.material.consumedWastePct)}`
    : `${cap(word("Y"))}: not feasible`;
  return {
    severity: "info",
    code: "orientation.compare",
    message: `Comparison — ${fx}; ${fy}.`,
  };
}
