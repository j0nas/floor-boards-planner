import { describe, expect, test } from "vite-plus/test";
import { DEFAULT_INPUTS } from "./defaults.ts";
import { buildPlanForAxis, computePlans } from "./plan.ts";
import { rectRoom } from "./room.ts";
import type { Inputs, Opening, Plan } from "./types.ts";
import { validateInputs } from "./validate.ts";
import { checkPlan } from "./verify.ts";

const door = (wall: number, offset: number, width = 800, depth = 100, tuck = 10): Opening => ({
  wall,
  offset,
  width,
  depth,
  tuck,
});

function withDoors(doors: Opening[], base: Inputs = DEFAULT_INPUTS): Inputs {
  return { ...structuredClone(base), openings: doors };
}

const doorPieces = (p: Plan) => p.pieces.filter((q) => q.opening !== undefined);

describe("openings — a doorway beyond the first row", () => {
  // The pantry laid in 2026-09 entered door wall first: its 704 mm door in the
  // near wall, 81 mm of floor through the wall to the threshold, 10 mm under
  // each jamb. The first row is a full board, so the strip clicks straight on.
  const pantry = structuredClone(DEFAULT_INPUTS);
  pantry.room = rectRoom({ widthNear: 2887, widthFar: 2880, lengthLeft: 1677, lengthRight: 1675 });
  pantry.board = { length: 2050, width: 211, thickness: 9.5 };
  pantry.orientation = { mode: "forced", runAxis: "X" };
  pantry.tunables = { ...pantry.tunables, kerf: 3 };
  const before = buildPlanForAxis(pantry, "X");
  const inputs = withDoors([door(0, 1145.5, 704, 81, 10)], pantry);
  const plan = buildPlanForAxis(inputs, "X");

  test("adds one strip across the doorway, leaving the room's rows as they were", () => {
    expect(plan.rows.map((r) => r.pieceLengths)).toEqual(before.rows.map((r) => r.pieceLengths));
    const strips = doorPieces(plan);
    expect(strips).toHaveLength(1);
    const strip = strips[0]!;
    expect(strip.rowIndex).toBe(-1);
    expect(strip.role).toBe("free");
    expect(strip.faceLength).toBeCloseTo(704 + 2 * 10, 1);
    expect(strip.faceWidth).toBeCloseTo(81 + 10, 1); // through the wall + the room's gap
  });

  test("cuts the strip from an offcut: no extra board, board numbers unchanged", () => {
    expect(plan.material.boardsConsumed).toBe(before.material.boardsConsumed);
    const strip = plan.cutList.find((c) => c.opening === 0)!;
    expect(strip.reused).toBe(true);
    const before13 = before.cutList.filter((c) => c.source === strip.source).map((c) => c.pieceId);
    expect(before13.length).toBeGreaterThan(0); // the same board, same number as before
    expect(plan.valid).toBe(true);
    expect(checkPlan(inputs, plan)).toEqual([]);
  });
});

describe("openings — a doorway at the row ends", () => {
  // 4 × 3 m, boards along X: the right wall (1) is the run-end wall.
  const inputs = withDoors([door(1, 1000)]);
  const plan = buildPlanForAxis(inputs, "X");

  test("the rows passing it run on into the doorway; one straddling a jamb is notched", () => {
    const into = doorPieces(plan);
    expect(into.length).toBeGreaterThanOrEqual(4);
    for (const p of into) expect(p.indexInRow).toBe(plan.rows[p.rowIndex]!.pieceLengths.length - 1);
    expect(into.some((p) => p.notched)).toBe(true);
    for (const p of into) expect(p.faceLength).toBeLessThanOrEqual(2050 + 0.5);
    expect(checkPlan(inputs, plan)).toEqual([]);
  });

  test("a row that would only reach under the door frame gets no tab", () => {
    // Put the jamb 4 mm above a row boundary: the row below then meets only the
    // 10 mm under-frame zone (by 6 mm), never the clear opening.
    const boundary = 10 + buildPlanForAxis(DEFAULT_INPUTS, "X").rows[6]!.crossStart;
    const i = withDoors([door(1, boundary + 4, 800, 100, 10)]);
    const p = buildPlanForAxis(i, "X");
    const below = p.rows.findIndex(
      (r) => Math.abs(10 + r.crossStart + r.rowWidth - boundary) < 0.01,
    );
    expect(below).toBe(5);
    expect(doorPieces(p).some((q) => q.rowIndex === below)).toBe(false);
    expect(doorPieces(p).some((q) => q.rowIndex === below + 1)).toBe(true);
    expect(checkPlan(i, p)).toEqual([]);
  });

  test("works at the run-start wall too (the first piece reaches back into it)", () => {
    const i = withDoors([door(3, 1000)]);
    const p = buildPlanForAxis(i, "X");
    const into = doorPieces(p);
    expect(into.length).toBeGreaterThan(0);
    for (const q of into) expect(q.indexInRow).toBe(0);
    expect(checkPlan(i, p)).toEqual([]);
  });

  test("a row passing two doors on the same wall reaches into both", () => {
    const i = withDoors([door(1, 1000, 700, 80, 5), door(1, 1750, 600, 80, 5)]);
    const p = buildPlanForAxis(i, "X");
    expect(new Set(doorPieces(p).map((q) => q.opening))).toEqual(new Set([0, 1]));
    expect(checkPlan(i, p)).toEqual([]);
  });
});

describe("openings — a ripped row keeps full width across its doorway", () => {
  // The pantry as laid: full rows from the back wall, the door row ripped to fit
  // along the door wall — but left whole between the jambs, so its factory edge
  // is there for the doorway strip to click onto.
  const inputs = withDoors([door(2, 1145.5, 704, 81, 10)]);
  inputs.room = rectRoom({ widthNear: 2880, widthFar: 2887, lengthLeft: 1675, lengthRight: 1677 });
  inputs.board = { length: 2050, width: 211, thickness: 9.5 };
  inputs.gap = { near: 5, far: 5, left: 5, right: 5 };
  inputs.tunables = { ...inputs.tunables, kerf: 3 };
  const plan = buildPlanForAxis(inputs, "X");
  const doorRow = plan.rows.length - 1;

  test("the door row is 211 wide across the clear opening, and ripped elsewhere", () => {
    expect(plan.rows[doorRow]!.isRipped).toBe(true);
    const tabbed = plan.pieces.filter((p) => p.doorTab);
    expect(tabbed.map((p) => p.rowIndex)).toEqual([doorRow, doorRow]);
    for (const p of tabbed) {
      expect(p.faceWidth).toBeCloseTo(211, 1);
      expect(p.doorTab!.ripStart).toBeLessThan(191);
      expect(p.opening).toBe(0);
    }
    // Together they span the clear opening, jamb to jamb.
    const along = tabbed.flatMap((p) => p.doorTab!.spans).reduce((s, x) => s + x.to - x.from, 0);
    expect(along).toBeCloseTo(704, 0);
    expect(plan.diagnostics.some((d) => d.code === "opening.rippedEdge")).toBe(false);
  });

  test("the doorway strip starts where the full-width stretch ends", () => {
    const strip = doorPieces(plan).filter((p) => p.rowIndex === plan.rows.length);
    expect(strip).toHaveLength(1);
    // 81 through the wall + the 5 mm gap − the 21–23 mm the door row already covers.
    expect(strip[0]!.faceWidth).toBeCloseTo(64.2, 0);
    expect(strip[0]!.faceLength).toBeCloseTo(724, 0);
    expect(plan.valid).toBe(true);
    expect(checkPlan(inputs, plan)).toEqual([]);
  });

  test("the door row is numbered with the room's rows; only the strip is fitted last", () => {
    const board = (id: string) =>
      Number(plan.cutList.find((c) => c.pieceId === id)!.source.slice(1));
    const tabBoards = plan.pieces.filter((p) => p.doorTab).map((p) => board(p.id));
    expect(Math.max(...tabBoards)).toBe(plan.material.boardsConsumed);
    const strip = doorPieces(plan).find((p) => !p.doorTab)!;
    expect(plan.cutList.find((c) => c.pieceId === strip.id)!.reused).toBe(true);
  });
});

describe("openings — warnings, custom shapes and validation", () => {
  test("warns when keeping a ripped row whole across a doorway would leave too thin a strip", () => {
    // The default room balances ~119 mm rips against both long walls: 92 mm of
    // full width would leave an 18 mm strip in a 100 mm doorway.
    const i = withDoors([door(0, 1500)]);
    const p = buildPlanForAxis(i, "X");
    expect(p.diagnostics.some((d) => d.code === "opening.rippedEdge")).toBe(true);
    expect(checkPlan(i, p)).toEqual([]);
  });

  test("a door in a custom L-shaped room is floored and self-checked", () => {
    const i = withDoors([door(2, 600), door(3, 400, 700, 120)]);
    i.room = {
      outline: [
        { x: 0, y: 0 },
        { x: 4000, y: 0 },
        { x: 4000, y: 1500 },
        { x: 2000, y: 1500 },
        { x: 2000, y: 3000 },
        { x: 0, y: 3000 },
      ],
    };
    for (const axis of ["X", "Y"] as const) {
      const p = computePlans(i).plans[axis]!;
      expect(doorPieces(p).length).toBeGreaterThan(0);
      expect(checkPlan(i, p), axis).toEqual([]);
    }
  });

  test("rejects doors that aren't on a wall, overrun it, sit in a corner gap or overlap", () => {
    const codes = (doors: Opening[]) => validateInputs(withDoors(doors)).map((d) => d.code);
    expect(codes([door(7, 100)])).toContain("opening.wall");
    expect(codes([door(0, 3500)])).toContain("opening.outside");
    expect(codes([door(0, 3, 700, 80, 0)])).toContain("opening.corner");
    expect(codes([door(0, 1000), door(0, 1500)])).toContain("opening.overlap");
    expect(codes([door(0, 1000, 0)])).toContain("opening.size");
    expect(codes([door(0, 1000)])).toEqual(codes([]));
  });
});
