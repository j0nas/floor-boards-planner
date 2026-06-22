/**
 * Sliver detection — the single rule both layout engines use to flag pieces
 * that are too small to install comfortably.
 *
 * A "sliver" is a piece below a recommended minimum: shorter than the minimum
 * piece length, or narrower than the minimum row width. The quad engine's
 * balancing and stagger usually prevent these; clipping an arbitrary polygon
 * around a concave corner can still produce them, so they are highlighted in
 * the plan rather than hidden.
 */
import type { Diagnostic, Piece } from "./types.ts";
import { EPS, type Mm } from "./units.ts";

/** True when a piece is shorter than `minPiece` or narrower than `minRowWidth`. */
export function isUndersized(
  p: Pick<Piece, "faceLength" | "faceWidth">,
  minPiece: Mm,
  minRowWidth: Mm,
): boolean {
  return p.faceLength < minPiece - EPS || p.faceWidth < minRowWidth - EPS;
}

/** Tag every piece with its `undersized` flag (mutates in place). */
export function markUndersized(pieces: Piece[], minPiece: Mm, minRowWidth: Mm): void {
  for (const p of pieces) p.undersized = isUndersized(p, minPiece, minRowWidth);
}

/** A diagnostic summarising the highlighted slivers, or null when there are none. */
export function undersizedDiagnostic(
  pieces: readonly Piece[],
  minPiece: Mm,
  minRowWidth: Mm,
): Diagnostic | null {
  const n = pieces.filter((p) => p.undersized).length;
  if (!n) return null;
  return {
    severity: "warn",
    code: "piece.sliver",
    message: `${n} cut piece${n > 1 ? "s" : ""} fall${n > 1 ? "" : "s"} below the recommended minimum (length ${minPiece} mm or row width ${minRowWidth} mm) — highlighted in red. Glue a sliver to its neighbour, or nudge the layout/gap to absorb it.`,
  };
}
