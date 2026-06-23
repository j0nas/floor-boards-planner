import { describe, expect, test } from "vite-plus/test";
import { balanceRows } from "./balance.ts";
import { sum } from "./units.ts";

function widths(rows: { width: number }[]): number[] {
  return rows.map((r) => r.width);
}

describe("balanceRows", () => {
  test("healthy leftover surfaces both options, unbalanced recommended", () => {
    // W = 1080, bw = 200 → n=5, leftover=80 (< bw/2). narrow case.
    const narrow = balanceRows(1080, 200, 50);
    expect(narrow.map((o) => o.kind)).toEqual(["balanced", "unbalanced"]);
    expect(narrow[0]?.recommended).toBe(true); // balanced preferred when narrow

    // W = 1130, bw = 200 → n=5, leftover=130 (> bw/2=100). healthy.
    const healthy = balanceRows(1130, 200, 50);
    expect(healthy.map((o) => o.kind)).toEqual(["unbalanced", "balanced"]);
    expect(healthy[0]?.recommended).toBe(true);
    expect(healthy.length).toBe(2);
  });

  test("sliver forces balancing (unbalanced illegal)", () => {
    // W = 1030, bw = 200, min = 50 → leftover=30 < min.
    const opts = balanceRows(1030, 200, 50);
    expect(opts.length).toBe(1);
    expect(opts[0]?.kind).toBe("balanced");
    expect(opts[0]?.recommended).toBe(true);
  });

  test("balanced end rows are equal and always > half a board", () => {
    const opts = balanceRows(1030, 200, 50);
    const rows = opts[0]!.rowWidths;
    const first = rows[0]!.width;
    const last = rows[rows.length - 1]!.width;
    expect(first).toBeCloseTo(last, 9);
    expect(first).toBeGreaterThan(100); // > bw/2
  });

  test("row widths always sum to W", () => {
    for (const [W, bw] of [
      [1080, 200],
      [1130, 200],
      [1030, 200],
      [3980, 211],
    ] as const) {
      for (const opt of balanceRows(W, bw, 50)) {
        expect(sum(widths(opt.rowWidths))).toBeCloseTo(W, 6);
      }
    }
  });

  test("exact multiple → all full rows, single option", () => {
    const opts = balanceRows(1000, 200, 50);
    expect(opts.length).toBe(1);
    expect(opts[0]?.rowWidths.length).toBe(5);
    expect(opts[0]?.rowWidths.every((r) => r.width === 200)).toBe(true);
  });

  test("room narrower than one board → single ripped row", () => {
    const opts = balanceRows(150, 200, 50);
    expect(opts.length).toBe(1);
    expect(opts[0]?.rowWidths.length).toBe(1);
    expect(opts[0]?.rowWidths[0]?.isRipped).toBe(true);
    expect(opts[0]?.valid).toBe(true);

    const tooNarrow = balanceRows(40, 200, 50);
    expect(tooNarrow[0]?.valid).toBe(false); // below min row width
  });

  test("balanced count equals unbalanced count (n+1 rows)", () => {
    const opts = balanceRows(1080, 200, 50);
    const counts = opts.map((o) => o.rowWidths.length);
    expect(new Set(counts).size).toBe(1); // both have same row count
  });
});
