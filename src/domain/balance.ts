import { type Mm, approxEq, gte, lt } from "./units.ts";

/** A single row's cross dimension and flags, before stagger/piece assignment. */
export interface RowWidth {
  width: Mm; // cross width at the (wide) balancing end
  isEndRow: boolean;
  isRipped: boolean; // narrower than a full board → wall edge ripped
}

export interface LayoutOptionDraft {
  kind: "balanced" | "unbalanced";
  recommended: boolean;
  reason: string;
  rowWidths: RowWidth[];
  /** Valid means every row meets the minimum row width. */
  valid: boolean;
}

function fullRow(bw: Mm): RowWidth {
  return { width: bw, isEndRow: false, isRipped: false };
}

/**
 * Border balancing across the run. `W` is the usable cross width (for a taper
 * room, pass the wide end). Returns the candidate layout options.
 *
 * Rule: rather than leave a thin sliver last row, split the leftover across the
 * first and last rows so both equal (leftover + boardWidth) / 2.
 */
export function balanceRows(W: Mm, bw: Mm, minRowWidth: Mm): LayoutOptionDraft[] {
  // Room narrower than a single board: one (ripped) row spanning the whole width.
  if (lt(W, bw)) {
    return [
      {
        kind: "unbalanced",
        recommended: true,
        reason: "Room is narrower than one board width — a single row spans the floor.",
        rowWidths: [{ width: W, isEndRow: true, isRipped: !approxEq(W, bw) }],
        valid: gte(W, minRowWidth),
      },
    ];
  }

  const n = Math.floor((W + 1e-6) / bw); // full rows that fit
  const leftover = W - n * bw; // [0, bw)

  // Exact fit: all full rows, no border decision.
  if (approxEq(leftover, 0)) {
    const rows: RowWidth[] = [];
    for (let k = 0; k < n; k++) {
      rows.push({ width: bw, isEndRow: k === 0 || k === n - 1, isRipped: false });
    }
    return [
      {
        kind: "unbalanced",
        recommended: true,
        reason: "Width is an exact multiple of the board — every row is a full board.",
        rowWidths: rows,
        valid: true,
      },
    ];
  }

  const endRow = (leftover + bw) / 2; // always in (bw/2, bw)

  // Unbalanced: n full rows + a final row of `leftover`.
  const unbalanced: LayoutOptionDraft = {
    kind: "unbalanced",
    recommended: false,
    reason: `Full first row, ${Math.round(leftover)} mm last row.`,
    rowWidths: [
      ...Array.from({ length: n }, () => fullRow(bw)).map((r, k) =>
        k === 0 ? { ...r, isEndRow: true } : r,
      ),
      { width: leftover, isEndRow: true, isRipped: true },
    ],
    valid: gte(leftover, minRowWidth),
  };

  // Balanced: two equal end rows of `endRow`, (n-1) full rows between.
  const balancedRows: RowWidth[] = [{ width: endRow, isEndRow: true, isRipped: true }];
  for (let k = 0; k < n - 1; k++) balancedRows.push(fullRow(bw));
  balancedRows.push({ width: endRow, isEndRow: true, isRipped: true });
  const balanced: LayoutOptionDraft = {
    kind: "balanced",
    recommended: false,
    reason: `Two equal ${Math.round(endRow)} mm end rows for symmetric borders.`,
    rowWidths: balancedRows,
    valid: gte(endRow, minRowWidth),
  };

  // Decide recommendation & which options to surface.
  const sliver = lt(leftover, minRowWidth);
  const narrow = !sliver && lt(leftover, bw / 2);

  if (sliver) {
    balanced.recommended = true;
    balanced.reason = `Plain leftover (${Math.round(leftover)} mm) is below the minimum row width — balanced into two ${Math.round(endRow)} mm end rows.`;
    return [balanced]; // unbalanced is illegal
  }
  if (narrow) {
    balanced.recommended = true;
    return [balanced, unbalanced]; // both valid, balanced preferred
  }
  // Healthy leftover (≥ half a board): both fine, default to the simpler one.
  unbalanced.recommended = true;
  return [unbalanced, balanced];
}
