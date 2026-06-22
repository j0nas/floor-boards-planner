import type { StaggerInfo } from "./types.ts";
import { EPS, type Mm } from "./units.ts";

/**
 * Piece lengths for one row of run length `L`, starting with a piece of length
 * `startLen`, then full boards, then an end piece. If the row is shorter than a
 * board it is a single piece.
 */
export function planRowPieces(L: Mm, bl: Mm, startLen: Mm): Mm[] {
  if (L <= bl + EPS) return [L];
  const pieces: Mm[] = [startLen];
  let rem = L - startLen;
  while (rem > bl + EPS) {
    pieces.push(bl);
    rem -= bl;
  }
  pieces.push(rem);
  return pieces;
}

/** Interior seam positions (cumulative sums, excluding the two wall ends). */
export function seamsOf(pieceLengths: readonly Mm[], L: Mm): Mm[] {
  const seams: Mm[] = [];
  let acc = 0;
  for (let i = 0; i < pieceLengths.length - 1; i++) {
    acc += pieceLengths[i]!;
    if (acc > EPS && acc < L - EPS) seams.push(acc);
  }
  return seams;
}

/** Min distance between any two interior seams of adjacent rows. */
function pairStagger(a: readonly Mm[], b: readonly Mm[]): Mm {
  if (a.length === 0 || b.length === 0) return Number.POSITIVE_INFINITY;
  let mn = Number.POSITIVE_INFINITY;
  for (const x of a) for (const y of b) mn = Math.min(mn, Math.abs(x - y));
  return mn;
}

export interface StaggerPlan {
  startOffsets: Mm[]; // per-row start-piece length
  info: StaggerInfo;
}

/** Wrap a start length into (0, bl]. */
function wrapStart(s: Mm, bl: Mm): Mm {
  let v = ((s % bl) + bl) % bl;
  if (v <= EPS) v += bl; // 0 → full board
  return v;
}

/**
 * Plan the staggered seam pattern for `rowCount` rows of run length `L`.
 *
 * Uses a P-phase offset schedule (target ≈ 1/3 board) and searches a global
 * phase shift so that no start/end piece drops below `minPiece`. Escalates the
 * phase count when a near-multiple run length traps the simple pattern.
 */
export function planStagger(
  L: Mm,
  bl: Mm,
  rowCount: number,
  minPiece: Mm,
  minStagger: Mm,
  idealStagger: Mm,
): StaggerPlan {
  // Short room: each row is a single piece, no stagger to plan.
  if (L <= bl + EPS) {
    return {
      startOffsets: Array.from({ length: rowCount }, () => L),
      info: {
        achievedStagger: Number.POSITIVE_INFINITY,
        minObservedStagger: Number.POSITIVE_INFINITY,
        phases: 1,
        naturalStagger: Number.POSITIVE_INFINITY,
        nearMultipleTrap: false,
        usedMultiPiecePattern: false,
      },
    };
  }

  // Natural stagger a simple 2-piece reuse pattern would yield.
  const r = ((L % bl) + bl) % bl;
  const naturalStagger = Math.min(r, bl - r);
  const trap = naturalStagger < minStagger - EPS;

  // Candidate phase counts: step = bl/P must be ≥ minStagger. Prefer the step
  // closest to the ideal, and ≥ 3 phases (avoids the every-other-row ladder).
  const maxP = Math.max(2, Math.floor(bl / Math.max(minStagger, 1)));
  const candidates: number[] = [];
  for (let P = 2; P <= maxP; P++) candidates.push(P);
  candidates.sort((a, b) => {
    const sa = Math.abs(bl / a - idealStagger) + (a < 3 ? 1e6 : 0);
    const sb = Math.abs(bl / b - idealStagger) + (b < 3 ? 1e6 : 0);
    return sa - sb;
  });

  const evalPhases = Math.min(rowCount, 12); // distinct phase rows are enough

  function bestShiftFor(P: number): { shift: Mm; minPiece: Mm } {
    const step = bl / P;
    const samples = Math.min(400, Math.max(40, Math.round(step)));
    let bestShift = 0;
    let bestMin = -1;
    for (let s = 0; s <= samples; s++) {
      const delta = (step * s) / samples;
      let mn = Number.POSITIVE_INFINITY;
      for (let i = 0; i < Math.max(evalPhases, P); i++) {
        const start = wrapStart(bl - (i % P) * step - delta, bl);
        for (const p of planRowPieces(L, bl, start)) mn = Math.min(mn, p);
      }
      if (mn > bestMin + EPS) {
        bestMin = mn;
        bestShift = delta;
      }
    }
    return { shift: bestShift, minPiece: bestMin };
  }

  // Pick the first candidate whose best shift keeps every piece ≥ minPiece.
  let chosen: { P: number; step: Mm; shift: Mm } | null = null;
  let fallback: { P: number; step: Mm; shift: Mm; minPiece: Mm } | null = null;
  for (const P of candidates) {
    const { shift, minPiece: mn } = bestShiftFor(P);
    if (!fallback || mn > fallback.minPiece) {
      fallback = { P, step: bl / P, shift, minPiece: mn };
    }
    if (mn >= minPiece - EPS) {
      chosen = { P, step: bl / P, shift };
      break;
    }
  }
  const pick = chosen ?? {
    P: fallback!.P,
    step: fallback!.step,
    shift: fallback!.shift,
  };

  const startOffsets: Mm[] = [];
  for (let i = 0; i < rowCount; i++) {
    startOffsets.push(wrapStart(bl - (i % pick.P) * pick.step - pick.shift, bl));
  }

  // Validate stagger on actual seam positions.
  const seamSets = startOffsets.map((s) => seamsOf(planRowPieces(L, bl, s), L));
  let minObserved = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 1 < seamSets.length; i++) {
    minObserved = Math.min(minObserved, pairStagger(seamSets[i]!, seamSets[i + 1]!));
  }

  return {
    startOffsets,
    info: {
      achievedStagger: pick.step,
      minObservedStagger: minObserved,
      phases: pick.P,
      naturalStagger,
      nearMultipleTrap: trap,
      usedMultiPiecePattern: trap,
    },
  };
}
