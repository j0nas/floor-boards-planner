import { describe, expect, test } from "vite-plus/test";
import { type DemandPiece, assignCuts } from "./cutting.ts";
import type { PieceRole } from "./types.ts";

const BL = 2050;

/** One demand piece per [length, role], each in its own row (laying order = index). */
function demand(pieces: [number, PieceRole][]): DemandPiece[] {
  return pieces.map(([length, role], i) => ({
    pieceId: `p${i}`,
    rowIndex: i,
    indexInRow: role === "end" ? 1 : 0,
    length,
    width: 200,
    kind: length >= BL ? "full" : "cut-length",
    role,
  }));
}

/** Pieces grouped by the board they are cut from. */
function boards(res: ReturnType<typeof assignCuts>): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const c of res.cutList) m.set(c.source, [...(m.get(c.source) ?? []), c.pieceId]);
  return m;
}

describe("assignCuts", () => {
  test("an end piece and a start piece share one board (a row's end offcut starts another row)", () => {
    const res = assignCuts(
      demand([
        [1367, "end"],
        [683, "start"],
      ]),
      BL,
      0,
    );
    expect(res.boardsConsumed).toBe(1);
    expect(res.reuseMap.length).toBe(1);
    expect(res.reuseMap[0]?.usedByPieceId).toBe("p1");
  });

  test("two start pieces never share a board — it has only one end that joins the next board", () => {
    const res = assignCuts(
      demand([
        [1307, "start"],
        [624, "start"],
      ]),
      BL,
      0,
    );
    expect(res.boardsConsumed).toBe(2);
    expect(res.reuseMap.length).toBe(0);
  });

  test("two end pieces never share a board either", () => {
    const res = assignCuts(
      demand([
        [900, "end"],
        [900, "end"],
      ]),
      BL,
      0,
    );
    expect(res.boardsConsumed).toBe(2);
  });

  test("a board gives at most one start and one end piece", () => {
    const res = assignCuts(
      demand([
        [600, "end"],
        [600, "start"],
        [600, "start"],
      ]),
      BL,
      0,
    );
    expect(res.boardsConsumed).toBe(2);
    for (const ids of boards(res).values()) {
      const roles = ids.map((id) => res.cutList.find((c) => c.pieceId === id)!.role);
      expect(roles.filter((r) => r === "start").length).toBeLessThanOrEqual(1);
      expect(roles.filter((r) => r === "end").length).toBeLessThanOrEqual(1);
    }
  });

  test("reuse beats the naive one-board-per-piece count", () => {
    // four 2/3-board end pieces + four 1/3-board start pieces → 4 boards, not 8
    const res = assignCuts(
      demand([
        [1367, "end"],
        [1367, "end"],
        [1367, "end"],
        [1367, "end"],
        [683, "start"],
        [683, "start"],
        [683, "start"],
        [683, "start"],
      ]),
      BL,
      0,
    );
    expect(res.boardsConsumed).toBe(4);
  });

  test("pairs are a maximum matching, not first-come", () => {
    // Pairing the 500 end with the 600 start would strand 1400 + 1500 (too long
    // together); the optimum pairs 500+1500 and 1400+600.
    const res = assignCuts(
      demand([
        [500, "end"],
        [1400, "end"],
        [1500, "start"],
        [600, "start"],
      ]),
      BL,
      0,
    );
    expect(res.boardsConsumed).toBe(2);
  });

  test("full-length pieces each take a fresh board with no offcut", () => {
    const res = assignCuts(
      demand([
        [BL, "full"],
        [BL, "full"],
        [BL, "full"],
      ]),
      BL,
      0,
    );
    expect(res.boardsConsumed).toBe(3);
    expect(res.fullBoards).toBe(3);
    expect(res.reuseMap.length).toBe(0);
  });

  test("pieces too long to pair each take their own board", () => {
    const res = assignCuts(
      demand([
        [1900, "end"],
        [1900, "start"],
      ]),
      BL,
      0,
    );
    expect(res.boardsConsumed).toBe(2);
    expect(res.reuseMap.length).toBe(0);
  });

  test("kerf is removed from every cut", () => {
    // 1000 + 1000 + 5 kerf fits a 2050 board; with 60 mm kerf it doesn't.
    const pair = demand([
      [1000, "end"],
      [1000, "start"],
    ]);
    expect(assignCuts(pair, BL, 5).boardsConsumed).toBe(1);
    expect(assignCuts(pair, BL, 5).reuseMap[0]?.lengthUsed).toBe(1000);
    expect(assignCuts(pair, BL, 60).boardsConsumed).toBe(2);
  });

  test("free pieces (a whole row in one piece) fill leftover board length", () => {
    const res = assignCuts(
      demand([
        [1200, "free"],
        [800, "free"],
        [500, "free"],
      ]),
      BL,
      0,
    );
    expect(res.boardsConsumed).toBe(2); // 1200+800 on one, 500 on another
  });

  test("boards are numbered in laying order", () => {
    const res = assignCuts(
      demand([
        [BL, "full"],
        [700, "start"],
        [BL, "full"],
        [1300, "end"],
      ]),
      BL,
      0,
    );
    expect(res.cutList.map((c) => c.source)).toEqual(["B1", "B2", "B3", "B2"]);
  });

  test("deterministic across runs", () => {
    const d = demand([
      [1367, "end"],
      [683, "start"],
      [900, "end"],
      [1100, "start"],
      [700, "free"],
    ]);
    const a = assignCuts(d, BL, 0);
    const b = assignCuts(d, BL, 0);
    expect(a.boardsConsumed).toBe(b.boardsConsumed);
    expect(a.cutList.map((c) => c.source)).toEqual(b.cutList.map((c) => c.source));
  });
});
