import { describe, expect, test } from "vite-plus/test";
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

describe("polyLayout — stagger is honoured on a stepped custom shape", () => {
  // Field-reported regression: boards 2200 mm long run along X; a step in the far
  // wall makes the upper rows (run 2780) shorter than the lower rows (run 3200).
  // The old fixed start schedule let a rebalanced tail (734 | 1233 | 1233) drop a
  // seam at 1967 — only 233 mm from the next row's seam at 2200 — while still
  // reporting a healthy 733 mm stagger. minStagger is 500 mm here.
  const STEP_ROOM: RoomShape = {
    outline: [
      { x: 0, y: 0 },
      { x: 3220, y: 0 },
      { x: 3220, y: 2080 },
      { x: 2800, y: 2080 },
      { x: 2800, y: 2680 },
      { x: 0, y: 2680 },
    ],
  };
  const inputs = (() => {
    const i = structuredClone(DEFAULT_INPUTS);
    i.room = STEP_ROOM;
    i.board = { length: 2200, width: 190, thickness: 8 };
    i.gap = { near: 10, far: 10, left: 10, right: 10 };
    i.tunables = { ...i.tunables, minStagger: 500 };
    return i;
  })();
  const plan = buildPolygonPlan(inputs, "X")!;

  // Independently reconstruct each row's interior butt joints from the laid
  // pieces (each row spans X contiguously here, so a non-extreme piece boundary
  // is a real seam), then measure the closest joint between adjacent rows.
  function minAdjacentSeamGap(): number {
    const byRow = new Map<number, { min: number; max: number; bounds: Set<number> }>();
    for (const p of plan.pieces) {
      const xs = p.poly.map((q) => q.x);
      const lo = Math.min(...xs);
      const hi = Math.max(...xs);
      const r = byRow.get(p.rowIndex) ?? {
        min: Infinity,
        max: -Infinity,
        bounds: new Set<number>(),
      };
      r.min = Math.min(r.min, lo);
      r.max = Math.max(r.max, hi);
      r.bounds.add(Math.round(lo));
      r.bounds.add(Math.round(hi));
      byRow.set(p.rowIndex, r);
    }
    const seams = [...byRow.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, r]) =>
        [...r.bounds].filter((b) => b - r.min > 1 && r.max - b > 1).sort((a, b) => a - b),
      );
    let mn = Number.POSITIVE_INFINITY;
    for (let k = 0; k + 1 < seams.length; k++)
      for (const a of seams[k]!) for (const b of seams[k + 1]!) mn = Math.min(mn, Math.abs(a - b));
    return mn;
  }

  test("every adjacent-row butt joint clears the 500 mm minimum", () => {
    expect(minAdjacentSeamGap()).toBeGreaterThanOrEqual(500 - 1);
  });

  test("the plan reports the true stagger, stays valid, and raises no stagger warning", () => {
    expect(plan.stagger.minObservedStagger).toBeGreaterThanOrEqual(500 - 0.5);
    expect(plan.valid).toBe(true);
    expect(plan.diagnostics.some((d) => d.code === "stagger.belowMin")).toBe(false);
  });
});
