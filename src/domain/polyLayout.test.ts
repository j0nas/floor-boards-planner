import { describe, expect, test } from "vitest";
import { DEFAULT_INPUTS } from "./defaults.ts";
import { insetRoom, ringsArea } from "./poly.ts";
import { buildPolygonPlan } from "./polyLayout.ts";
import { roomOutline } from "./room.ts";
import { isUndersized } from "./slivers.ts";
import type { Inputs, RoomShape } from "./types.ts";

// L-shaped room (mm), area 9,000,000 mm².
const L_ROOM: RoomShape = {
  outline: [
    { x: 0, y: 0 },
    { x: 4000, y: 0 },
    { x: 4000, y: 1500 },
    { x: 2000, y: 1500 },
    { x: 2000, y: 3000 },
    { x: 0, y: 3000 },
  ],
};

function withRoom(room: RoomShape, gap = 10): Inputs {
  const i = structuredClone(DEFAULT_INPUTS);
  i.room = room;
  i.gap = { near: gap, far: gap, left: gap, right: gap };
  return i;
}

describe("polyLayout — clip-to-outline", () => {
  const plan = buildPolygonPlan(withRoom(L_ROOM), "Y")!;
  const region = insetRoom(roomOutline(L_ROOM), 10);
  const regionArea = region.reduce((s, r) => s + Math.abs(ringsArea([r])), 0);
  const boardArea = DEFAULT_INPUTS.board.length * DEFAULT_INPUTS.board.width;
  const pieceArea = (poly: { x: number; y: number }[]) => Math.abs(ringsArea([poly]));

  test("produces a plan with clipped pieces", () => {
    expect(plan).not.toBeNull();
    expect(plan.pieces.length).toBeGreaterThan(0);
    expect(plan.material.boardsConsumed).toBeGreaterThan(0);
  });

  test("the clipped pieces tile the usable (inset) region", () => {
    const sum = plan.pieces.reduce((s, p) => s + pieceArea([...p.poly]), 0);
    expect(sum).toBeGreaterThan(regionArea * 0.999);
    expect(sum).toBeLessThan(regionArea * 1.001);
    expect(plan.material.coveredAreaMm2).toBeGreaterThan(regionArea * 0.999);
  });

  test("no clipped piece exceeds a full board", () => {
    for (const p of plan.pieces) {
      expect(pieceArea([...p.poly])).toBeLessThanOrEqual(boardArea + 5);
    }
  });

  test("boards consumed cover the area", () => {
    expect(plan.material.boardsConsumed).toBeGreaterThanOrEqual(Math.ceil(regionArea / boardArea));
  });

  test("balancing avoids full-width slivers (every full-length row board is ≥ half a board wide)", () => {
    const bl = DEFAULT_INPUTS.board.length;
    const bw = DEFAULT_INPUTS.board.width;
    for (const p of plan.pieces) {
      if (p.faceLength >= bl * 0.8) expect(p.faceWidth).toBeGreaterThanOrEqual(bw / 2 - 1);
    }
  });

  test("clipped pieces are full or cut-length, never the red rip kind", () => {
    for (const p of plan.pieces) expect(["full", "cut-length"]).toContain(p.kind);
  });

  test("offcut reuse keeps the board count well under one-board-per-piece", () => {
    expect(plan.material.boardsConsumed).toBeLessThan(plan.pieces.length);
  });

  test("both run directions are layable and carry a heuristic note", () => {
    expect(buildPolygonPlan(withRoom(L_ROOM), "X")).not.toBeNull();
    expect(plan.diagnostics.some((d) => d.code === "poly.heuristic")).toBe(true);
  });

  test("an oversized gap leaves no usable region", () => {
    expect(buildPolygonPlan(withRoom(L_ROOM, 3000), "Y")).toBeNull();
  });

  test("every piece carries an undersized flag consistent with the rule", () => {
    const minPiece = DEFAULT_INPUTS.tunables.minPiece;
    const minRow = DEFAULT_INPUTS.tunables.minRowWidth;
    for (const p of plan.pieces) {
      expect(typeof p.undersized).toBe("boolean");
      expect(p.undersized).toBe(isUndersized(p, minPiece, minRow));
    }
  });

  test("run-direction rebalancing leaves no sliver on a clean rectilinear L", () => {
    expect(plan.pieces.some((p) => p.undersized)).toBe(false);
    expect(plan.diagnostics.some((d) => d.code === "piece.sliver")).toBe(false);
  });

  test("flip mirrors the row order for a custom shape and stays waste-neutral", () => {
    const a = buildPolygonPlan(withRoom(L_ROOM), "Y")!;
    const b = buildPolygonPlan({ ...withRoom(L_ROOM), flip: true }, "Y")!;
    // Each row's full strip width = its row width; flip reverses the row order.
    const rowWidthSeq = (plan: typeof a) => {
      const byRow = new Map<number, number>();
      for (const p of plan.pieces)
        byRow.set(p.rowIndex, Math.max(byRow.get(p.rowIndex) ?? 0, p.faceWidth));
      return [...byRow.entries()].sort((x, y) => x[0] - y[0]).map((e) => Math.round(e[1]));
    };
    expect(rowWidthSeq(b)).toEqual([...rowWidthSeq(a)].reverse());
    // Pure mirror → identical material.
    expect(b.material.boardsConsumed).toBe(a.material.boardsConsumed);
    expect(b.pieces.length).toBe(a.pieces.length);
  });

  test("genuine slivers are flagged and summarised in a diagnostic", () => {
    // An unrealistically high min piece length forces short pieces to be slivers.
    const strict = withRoom(L_ROOM);
    strict.tunables = { ...strict.tunables, minPiece: 1600 };
    const p = buildPolygonPlan(strict, "Y")!;
    expect(p.pieces.some((piece) => piece.undersized)).toBe(true);
    expect(p.diagnostics.some((d) => d.code === "piece.sliver")).toBe(true);
  });
});
