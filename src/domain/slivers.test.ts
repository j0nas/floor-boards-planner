import { describe, expect, test } from "vite-plus/test";
import { isUndersized, markUndersized, undersizedDiagnostic } from "./slivers.ts";
import type { Piece } from "./types.ts";

function piece(faceLength: number, faceWidth: number, id = "p"): Piece {
  return {
    id,
    rowIndex: 0,
    indexInRow: 0,
    poly: [],
    faceLength,
    faceWidth,
    kind: "cut-length",
    isRipped: false,
  };
}

describe("slivers", () => {
  test("flags a piece shorter than the min piece length", () => {
    expect(isUndersized(piece(250, 211), 300, 50)).toBe(true);
  });

  test("flags a piece narrower than the min row width", () => {
    expect(isUndersized(piece(1500, 40), 300, 50)).toBe(true);
  });

  test("a healthy cut piece is not a sliver", () => {
    expect(isUndersized(piece(1500, 211), 300, 50)).toBe(false);
  });

  test("a balanced border row at ≥ min row width is not a sliver", () => {
    // Balanced end rows live in (bw/2, bw) — well above minRowWidth.
    expect(isUndersized(piece(2050, 130), 300, 50)).toBe(false);
  });

  test("markUndersized tags every piece and the diagnostic counts them", () => {
    const pieces = [piece(2050, 211, "a"), piece(200, 211, "b"), piece(1500, 30, "c")];
    markUndersized(pieces, 300, 50);
    expect(pieces.map((p) => p.undersized)).toEqual([false, true, true]);

    const diag = undersizedDiagnostic(pieces, 300, 50);
    expect(diag?.code).toBe("piece.sliver");
    expect(diag?.severity).toBe("warn");
    expect(diag?.message).toContain("2 cut pieces");
  });

  test("no slivers → no diagnostic", () => {
    const pieces = [piece(2050, 211, "a"), piece(1500, 211, "b")];
    markUndersized(pieces, 300, 50);
    expect(undersizedDiagnostic(pieces, 300, 50)).toBeNull();
  });

  test("flags a thin diagonal fragment whose bbox looks full but real area is a sliver", () => {
    // Right triangle: bbox 400×60 (both ≥ the minimums) but area = 12 000 mm²,
    // below the 300×50 = 15 000 mm² minimum installable rectangle.
    const wedge: Pick<Piece, "faceLength" | "faceWidth" | "poly"> = {
      faceLength: 400,
      faceWidth: 60,
      poly: [
        { x: 0, y: 0 },
        { x: 400, y: 0 },
        { x: 0, y: 60 },
      ],
    };
    expect(isUndersized(wedge, 300, 50)).toBe(true);
  });

  test("a full rectangle with the same bbox is not a sliver", () => {
    const rect: Pick<Piece, "faceLength" | "faceWidth" | "poly"> = {
      faceLength: 400,
      faceWidth: 60,
      poly: [
        { x: 0, y: 0 },
        { x: 400, y: 0 },
        { x: 400, y: 60 },
        { x: 0, y: 60 },
      ],
    };
    expect(isUndersized(rect, 300, 50)).toBe(false);
  });
});
