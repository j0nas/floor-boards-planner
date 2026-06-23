import { describe, expect, test } from "vitest";
import { DEFAULT_BOARD, DEFAULT_INPUTS, recommendedMinGap } from "./defaults.ts";
import { asRect, rectRoom } from "./room.ts";
import { resolveBoardsPerPack, validateInputs } from "./validate.ts";
import type { Inputs, RectMeasurements } from "./types.ts";

function clone(): Inputs {
  return structuredClone(DEFAULT_INPUTS);
}

/** Rebuild the (quad) room with a measurement patch. */
function setRect(i: Inputs, patch: Partial<RectMeasurements>): void {
  i.room = rectRoom({ ...asRect(i.room)!, ...patch });
}

describe("resolveBoardsPerPack", () => {
  test("prefers explicit boards/pack", () => {
    expect(resolveBoardsPerPack({ boardsPerPack: 6 }, DEFAULT_BOARD)).toBe(6);
  });
  test("derives from area/pack when count missing", () => {
    const area = DEFAULT_BOARD.length * DEFAULT_BOARD.width * 6;
    expect(resolveBoardsPerPack({ areaPerPack: area }, DEFAULT_BOARD)).toBe(6);
  });
  test("falls back to 1", () => {
    expect(resolveBoardsPerPack({}, DEFAULT_BOARD)).toBe(1);
  });
});

describe("validateInputs", () => {
  test("clean default has no errors", () => {
    expect(validateInputs(DEFAULT_INPUTS).some((d) => d.severity === "error")).toBe(false);
  });
  test("min piece exceeding board length errors", () => {
    const i = clone();
    i.tunables.minPiece = 5000;
    expect(validateInputs(i).some((d) => d.code === "minPiece.gtBoard")).toBe(true);
  });
  test("tiny gap warns", () => {
    const i = clone();
    i.gap = { near: 2, far: 2, left: 2, right: 2 };
    expect(validateInputs(i).some((d) => d.code === "gap.tooSmall")).toBe(true);
  });
  test("negative on-hand errors", () => {
    const i = clone();
    i.boardsOnHand = -3;
    expect(validateInputs(i).some((d) => d.code === "onHand.negative")).toBe(true);
  });
});

describe("expansion gap guidance (matches ~1 mm/metre industry rule)", () => {
  test("recommendedMinGap is ~1 mm per metre, floored at the 5 mm manufacturer minimum", () => {
    expect(recommendedMinGap(4000)).toBe(5); // normal room → 5 mm (Pergo baseline), not 8
    expect(recommendedMinGap(3000)).toBe(5); // small room → 5 mm floor
    expect(recommendedMinGap(7000)).toBe(7); // 7 m span → 7 mm
    expect(recommendedMinGap(10000)).toBe(10); // 10 m → 10 mm
  });

  test("a uniform too-small gap produces a single warning, not one per wall", () => {
    const i = clone();
    i.gap = { near: 3, far: 3, left: 3, right: 3 };
    const gapWarnings = validateInputs(i).filter((d) => d.code === "gap.tooSmall");
    expect(gapWarnings).toHaveLength(1);
    expect(gapWarnings[0]?.message).not.toMatch(/near|far|left|right/);
  });

  test("differing per-wall gaps name only the affected walls", () => {
    const i = clone();
    i.gap = { near: 10, far: 10, left: 3, right: 3 };
    const gapWarnings = validateInputs(i).filter((d) => d.code === "gap.tooSmall");
    expect(gapWarnings).toHaveLength(1);
    expect(gapWarnings[0]?.message).toMatch(/left, right/);
  });

  test("a 10 mm gap in a normal 7 m room does NOT warn (the old 1.5 mm/m bug)", () => {
    const i = clone();
    setRect(i, { widthNear: 7000, widthFar: 7000 });
    i.gap = { near: 10, far: 10, left: 10, right: 10 };
    const codes = validateInputs(i).map((d) => d.code);
    expect(codes).not.toContain("gap.tooSmall");
  });

  test("the gap and span warnings cite sources", () => {
    const i = clone();
    i.gap = { near: 3, far: 3, left: 3, right: 3 };
    setRect(i, { lengthLeft: 14000, lengthRight: 14000 });
    const ds = validateInputs(i);
    for (const code of ["gap.tooSmall", "span.expansionJoint"]) {
      const diag = ds.find((d) => d.code === code);
      expect(diag?.sources?.length).toBeGreaterThan(0);
      expect(diag?.sources?.every((s) => s.url.startsWith("https://") && s.label)).toBe(true);
    }
  });

  test("very large floors recommend an intermediate expansion joint", () => {
    const i = clone();
    setRect(i, { lengthLeft: 14000, lengthRight: 14000 });
    const codes = validateInputs(i).map((d) => d.code);
    expect(codes).toContain("span.expansionJoint");
    // ...and the perimeter gap facing that 14 m span is now flagged as too small.
    expect(codes).toContain("gap.tooSmall");
  });
});
