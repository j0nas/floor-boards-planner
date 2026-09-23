import { EPS, type Mm, approxEq, clamp, gte, lt, lte } from "./units.ts";

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
  /** Valid means every row meets the minimum row width (at its narrow end too). */
  valid: boolean;
}

function fullRow(bw: Mm): RowWidth {
  return { width: bw, isEndRow: false, isRipped: false };
}

/**
 * Border balancing across the run. `W` is the usable cross width at its widest;
 * `taper` is how much narrower the floor gets at the other end (0 for a square
 * room). Rows stack from the straight wall, so the whole taper lands in the last
 * row: it is `width` wide at the wide end and `width - taper` at the narrow end.
 *
 * Rule: rather than leave a thin sliver last row, split the leftover across the
 * first and last rows so both are about equal — `(leftover + boardWidth) / 2`
 * for a square room; with a taper the first row matches the last row's average,
 * nudged so the last row is never wider than a board or narrower than the
 * minimum at either end.
 */
export function balanceRows(W: Mm, bw: Mm, minRowWidth: Mm, taper: Mm = 0): LayoutOptionDraft[] {
  const tapers = taper > EPS;
  const tapering = (w: Mm) => (tapers ? ` (tapering to ${Math.round(w - taper)} mm)` : "");

  // Room no wider than one board: a single row spans the whole floor.
  if (lte(W, bw)) {
    return [
      {
        kind: "unbalanced",
        recommended: true,
        reason: "Room is narrower than one board width — a single row spans the floor.",
        rowWidths: [{ width: W, isEndRow: true, isRipped: lt(W, bw) || tapers }],
        valid: gte(W - taper, minRowWidth),
      },
    ];
  }

  // Unbalanced: full rows from the straight wall; the last row takes the
  // remainder r ∈ (0, bw] at the wide end.
  const m = Math.ceil((W - EPS) / bw); // total rows (≥ 2 here)
  const r = W - (m - 1) * bw;

  // Exact fit: every row is a full board, no border decision.
  if (approxEq(r, bw) && !tapers) {
    return [
      {
        kind: "unbalanced",
        recommended: true,
        reason: "Width is an exact multiple of the board — every row is a full board.",
        rowWidths: Array.from({ length: m }, (_, k) => ({
          width: bw,
          isEndRow: k === 0 || k === m - 1,
          isRipped: false,
        })),
        // Even a full-board row is invalid if the minimum row width is set above
        // the board width (caught within EPS by validateInputs, but be consistent).
        valid: gte(bw, minRowWidth),
      },
    ];
  }

  const unbalanced: LayoutOptionDraft = {
    kind: "unbalanced",
    recommended: false,
    reason: `Full first row, ${Math.round(r)} mm last row${tapering(r)}.`,
    rowWidths: [
      ...Array.from({ length: m - 1 }, (_, k) => ({ ...fullRow(bw), isEndRow: k === 0 })),
      { width: r, isEndRow: true, isRipped: lt(r, bw) || tapers },
    ],
    valid: gte(r - taper, minRowWidth),
  };

  // Balanced: first row a, (m-2) full rows, last row c = r + bw - a (wide end).
  // Feasible a keeps a ∈ [minRow, bw], c ≤ bw and c - taper ≥ minRow.
  const lo = Math.max(minRowWidth, r);
  const hi = Math.min(bw, r + bw - taper - minRowWidth);
  const ideal = (r + bw - taper / 2) / 2; // first row = last row's average width
  // Always clamp: when the band is empty (infeasible, or within EPS of it) the
  // nearest edge keeps the last row within a board rather than overshooting.
  const a = clamp(ideal, lo, Math.max(lo, hi));
  const c = r + bw - a;
  const balancedRows: RowWidth[] = [{ width: a, isEndRow: true, isRipped: lt(a, bw) }];
  for (let k = 0; k < m - 2; k++) balancedRows.push(fullRow(bw));
  balancedRows.push({ width: c, isEndRow: true, isRipped: lt(c, bw) || tapers });
  const balanced: LayoutOptionDraft = {
    kind: "balanced",
    recommended: false,
    reason: tapers
      ? `Balanced borders: ${Math.round(a)} mm first row, ${Math.round(c)} mm last row${tapering(c)}.`
      : `Two equal ${Math.round(a)} mm end rows for symmetric borders.`,
    rowWidths: balancedRows,
    valid: lo <= hi + EPS,
  };

  // Decide recommendation & which options to surface, judged at the narrow end.
  if (!unbalanced.valid) {
    balanced.recommended = true;
    balanced.reason = `Plain leftover (${Math.round(r - taper)} mm at its narrowest) is below the minimum row width — balanced into ${Math.round(a)} mm and ${Math.round(c)} mm end rows${tapering(c)}.`;
    return [balanced]; // unbalanced is illegal
  }
  // A balanced layout whose first row is a full board is the unbalanced one.
  if (!balanced.valid || !lt(a, bw)) {
    unbalanced.recommended = true;
    return [unbalanced];
  }
  if (lt(r - taper, bw / 2)) {
    balanced.recommended = true;
    return [balanced, unbalanced]; // both valid, balanced preferred
  }
  // Healthy leftover (≥ half a board): both fine, default to the simpler one.
  unbalanced.recommended = true;
  return [unbalanced, balanced];
}
