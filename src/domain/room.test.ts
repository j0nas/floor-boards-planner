import { describe, expect, test } from "vite-plus/test";
import {
  asRect,
  insertCorner,
  isQuadRoom,
  moveCorner,
  rectRoom,
  removeCorner,
  roomArea,
  roomWalls,
  selfIntersects,
  setWallLength,
  toRoomShape,
} from "./room.ts";
import type { RoomShape } from "./types.ts";

const SQUARE = { widthNear: 4000, widthFar: 4000, lengthLeft: 3000, lengthRight: 3000 };
const SLANTED = { widthNear: 4000, widthFar: 3900, lengthLeft: 3000, lengthRight: 3000 };

// An L-shaped room: reflex (concave) corner at index 3.
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

describe("room — quad ⇄ measurements", () => {
  test("rectRoom ⇄ asRect round-trips a square and a slanted quad", () => {
    expect(asRect(rectRoom(SQUARE))).toEqual(SQUARE);
    expect(asRect(rectRoom(SLANTED))).toEqual(SLANTED);
    expect(isQuadRoom(rectRoom(SLANTED))).toBe(true);
  });

  test("asRect returns null for a multi-wall outline", () => {
    expect(asRect(L_ROOM)).toBeNull();
    expect(isQuadRoom(L_ROOM)).toBe(false);
  });

  test("asRect returns null for a quad that isn't in canonical orientation", () => {
    const shifted: RoomShape = {
      outline: [
        { x: 100, y: 100 },
        { x: 4100, y: 100 },
        { x: 4100, y: 3100 },
        { x: 100, y: 3100 },
      ],
    };
    expect(asRect(shifted)).toBeNull();
  });

  test("roomArea is the enclosed area", () => {
    expect(Math.abs(roomArea(rectRoom(SQUARE)))).toBeCloseTo(4000 * 3000, 0);
    expect(Math.abs(roomArea(L_ROOM))).toBeCloseTo(9_000_000, 0);
  });
});

describe("room — perimeter walk", () => {
  test("a rectangle is four 90° walls of the right lengths", () => {
    const walls = roomWalls(rectRoom(SQUARE));
    expect(walls).toHaveLength(4);
    expect(walls.map((w) => Math.round(w.length))).toEqual([4000, 3000, 4000, 3000]);
    for (const w of walls) expect(w.interiorAngleDeg).toBeCloseTo(90, 3);
  });

  test("the L-room's concave corner reads as a 270° interior angle", () => {
    const walls = roomWalls(L_ROOM);
    expect(walls).toHaveLength(6);
    expect(walls[3]!.interiorAngleDeg).toBeCloseTo(270, 3); // reflex corner
    const convex = walls.filter((_, i) => i !== 3);
    for (const w of convex) expect(w.interiorAngleDeg).toBeCloseTo(90, 3);
  });
});

describe("room — editing ops", () => {
  test("insertCorner adds a midpoint vertex and grows a rectangle into an L when dragged", () => {
    // Insert on the top edge (corner 2→3 of a CCW rect), then move it inward.
    const rect = rectRoom(SQUARE);
    const five = insertCorner(rect, 2);
    expect(five.outline).toHaveLength(5);
    expect(asRect(five)).toBeNull(); // no longer a quad
    expect(roomWalls(five)).toHaveLength(5);
  });

  test("moveCorner repositions exactly one vertex", () => {
    const moved = moveCorner(rectRoom(SQUARE), 2, { x: 1234, y: 5678 });
    expect(moved.outline[2]).toEqual({ x: 1234, y: 5678 });
    expect(moved.outline[0]).toEqual({ x: 0, y: 0 });
  });

  test("removeCorner drops a vertex but never below a triangle", () => {
    const five = insertCorner(rectRoom(SQUARE), 0);
    expect(removeCorner(five, 1).outline).toHaveLength(4);
    const tri: RoomShape = {
      outline: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 0, y: 100 },
      ],
    };
    expect(removeCorner(tri, 0)).toBe(tri); // refuses to go below 3
  });

  test("setWallLength resizes one wall, preserving the other walls' lengths", () => {
    const rect = rectRoom(SQUARE); // walls: bottom 4000, right 3000, top 4000, left 3000
    const widened = setWallLength(rect, 0, 5000); // bottom wall → 5000
    const walls = widened.outline;
    expect(Math.hypot(walls[1]!.x - walls[0]!.x, walls[1]!.y - walls[0]!.y)).toBeCloseTo(5000, 6);
    // The right wall (corner 1→2) keeps its length and direction.
    expect(Math.hypot(walls[2]!.x - walls[1]!.x, walls[2]!.y - walls[1]!.y)).toBeCloseTo(3000, 6);
    expect(roomWalls(widened)[1]!.interiorAngleDeg).toBeCloseTo(90, 3);
  });

  test("setWallLength is a no-op on the closing wall", () => {
    const rect = rectRoom(SQUARE);
    expect(setWallLength(rect, 3, 9999)).toEqual(rect);
  });

  test("selfIntersects flags a bow-tie and clears a simple polygon", () => {
    expect(selfIntersects(rectRoom(SQUARE))).toBe(false);
    expect(selfIntersects(L_ROOM)).toBe(false);
    const bowtie: RoomShape = {
      outline: [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
        { x: 100, y: 0 },
        { x: 0, y: 100 },
      ],
    };
    expect(selfIntersects(bowtie)).toBe(true);
  });
});

describe("room — back-compat", () => {
  const fallback = rectRoom(SQUARE);

  test("migrates a legacy four-measurement room", () => {
    const migrated = toRoomShape(SLANTED, fallback);
    expect(asRect(migrated)).toEqual(SLANTED);
  });

  test("passes a modern outline through", () => {
    expect(toRoomShape(L_ROOM, fallback)).toEqual(L_ROOM);
  });

  test("falls back for unrecognised input", () => {
    expect(toRoomShape(null, fallback)).toBe(fallback);
    expect(toRoomShape({ nonsense: 1 }, fallback)).toBe(fallback);
  });
});
