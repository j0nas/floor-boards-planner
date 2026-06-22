import { describe, expect, test } from "vitest";
import { type DemandPiece, assignCuts } from "./cutting.ts";

const BL = 2050;

function demand(lengths: number[]): DemandPiece[] {
  return lengths.map((length, i) => ({
    pieceId: `p${i}`,
    rowIndex: i,
    indexInRow: 0,
    length,
    width: 200,
    kind: length >= BL ? "full" : "cut-length",
  }));
}

describe("assignCuts", () => {
  test("complementary pieces share one board (2/3 + 1/3)", () => {
    const res = assignCuts(demand([1367, 683]), BL, 0, 300);
    expect(res.boardsConsumed).toBe(1);
    expect(res.reuseMap.length).toBe(1);
    expect(res.reuseMap[0]?.usedByPieceId).toBe("p1");
  });

  test("reuse beats the naive one-board-per-piece count", () => {
    // four 2/3-board pieces + four 1/3-board pieces → 4 boards, not 8
    const res = assignCuts(
      demand([1367, 1367, 1367, 1367, 683, 683, 683, 683]),
      BL,
      0,
      300,
    );
    expect(res.boardsConsumed).toBe(4);
  });

  test("full-length pieces each take a fresh board with no offcut", () => {
    const res = assignCuts(demand([BL, BL, BL]), BL, 0, 300);
    expect(res.boardsConsumed).toBe(3);
    expect(res.fullBoards).toBe(3);
    expect(res.reuseMap.length).toBe(0);
  });

  test("sub-minimum remainders become waste, not reusable offcuts", () => {
    // 1900 mm piece leaves 150 mm (< 300) → discarded; next 1900 needs a new board
    const res = assignCuts(demand([1900, 1900]), BL, 0, 300);
    expect(res.boardsConsumed).toBe(2);
    expect(res.reuseMap.length).toBe(0);
  });

  test("kerf is removed from every cut", () => {
    // 1000 + 1000 with 5 mm kerf: first board leaves 2050-1000-5 = 1045 ≥ 1000 → reused
    const res = assignCuts(demand([1000, 1000]), BL, 5, 300);
    expect(res.boardsConsumed).toBe(1);
    expect(res.reuseMap[0]?.lengthUsed).toBe(1000);
  });

  test("deterministic across runs", () => {
    const a = assignCuts(demand([1367, 683, 900, 1100, 700]), BL, 0, 300);
    const b = assignCuts(demand([1367, 683, 900, 1100, 700]), BL, 0, 300);
    expect(a.boardsConsumed).toBe(b.boardsConsumed);
    expect(a.cutList.map((c) => c.source)).toEqual(b.cutList.map((c) => c.source));
  });
});
