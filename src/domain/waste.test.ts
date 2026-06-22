import { describe, expect, test } from "vitest";
import { DEFAULT_BOARD } from "./defaults.ts";
import { computeMaterial } from "./waste.ts";
import type { CutResult } from "./cutting.ts";

const cut: CutResult = {
  boardsConsumed: 30,
  fullBoards: 20,
  cutPieces: 24,
  cutList: [],
  reuseMap: [],
};
const boardArea = DEFAULT_BOARD.length * DEFAULT_BOARD.width;

describe("computeMaterial", () => {
  test("packs round up and recommendation adds safety, rounded to packs", () => {
    const m = computeMaterial({
      cut,
      board: DEFAULT_BOARD,
      boardsPerPack: 6,
      boardsOnHand: 0,
      coveredAreaMm2: boardArea * 27, // ~10% waste
      safetyMarginPct: 0.1,
    });
    expect(m.packsConsumed).toBe(5); // ceil(30/6)
    expect(m.safetyBoards).toBe(3); // ceil(30*0.1)
    expect(m.recommendedPurchasePacks).toBe(6); // ceil((30+3)/6)
    expect(m.recommendedPurchaseBoards).toBe(36);
    expect(m.consumedWastePct).toBeCloseTo((3 / 30) * 100, 4);
  });

  test("boards on hand reduce the purchase and clamp at zero", () => {
    const m = computeMaterial({
      cut,
      board: DEFAULT_BOARD,
      boardsPerPack: 6,
      boardsOnHand: 100, // more than needed
      coveredAreaMm2: boardArea * 27,
      safetyMarginPct: 0.1,
    });
    expect(m.recommendedPurchaseBoards).toBe(0);
    expect(m.recommendedPurchasePacks).toBe(0);
  });

  test("dye-lot note is present", () => {
    const m = computeMaterial({
      cut,
      board: DEFAULT_BOARD,
      boardsPerPack: 6,
      boardsOnHand: 0,
      coveredAreaMm2: boardArea * 27,
      safetyMarginPct: 0.1,
    });
    expect(m.dyeLotNote).toMatch(/dye-lot/i);
  });
});
