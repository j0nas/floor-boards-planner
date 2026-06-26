import type { StaggerInfo } from "./types.ts";
import { EPS, type Mm, approxEq, makeRng } from "./units.ts";

/**
 * Piece lengths for one row of run length `L`, starting with a piece of length
 * `startLen`, then full boards, then an end piece. If the row is shorter than a
 * board it is a single piece.
 */
export function planRowPieces(L: Mm, bl: Mm, startLen: Mm): Mm[] {
  if (L <= bl + EPS) return [L];
  if (startLen >= L - EPS) return [L]; // degenerate start ≥ run → single piece
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
export function pairStagger(a: readonly Mm[], b: readonly Mm[]): Mm {
  if (a.length === 0 || b.length === 0) return Number.POSITIVE_INFINITY;
  let mn = Number.POSITIVE_INFINITY;
  for (const x of a) for (const y of b) mn = Math.min(mn, Math.abs(x - y));
  return mn;
}

/** A scored row-start candidate: its clearance to the previous one/two rows. */
export interface StaggerCandidate {
  /** Clearance (mm) to the immediately previous row (∞ if none / no seams). */
  gapPrev: number;
  /** Clearance (mm) to the row two back (∞ if none). */
  gapPrev2: number;
}

/**
 * Choose a row-start candidate index, honouring `randomness` (0..1).
 *
 * Validity comes first and is never traded for variety: every candidate this can
 * return ties the best achievable *saturated* clearance key
 * `[min(gapPrev,minStagger), min(gapPrev2,minStagger)]`, so a randomised pick is
 * exactly as valid as the deterministic one. `randomness` only widens the choice
 * among that feasible set along the tertiary "how centred" spread:
 *   - 0   → the single best-centred candidate (legacy deterministic behaviour);
 *   - 1   → uniform over every feasible candidate that still clears minStagger;
 *   - mid → a pool whose floor rises toward the centred pick as randomness falls.
 *
 * `rand` is one PRNG draw in [0,1). `spreadFallback` is the spread credited to a
 * candidate with infinite clearance (e.g. the first row, which has no neighbour).
 */
export function pickStaggerIndex(
  cands: readonly StaggerCandidate[],
  minStagger: Mm,
  spreadFallback: Mm,
  randomness: number,
  rand: number,
): number {
  const sat = (g: number): number => Math.min(g, minStagger);
  const spread = (c: StaggerCandidate): number => {
    const tm = Math.min(c.gapPrev, c.gapPrev2);
    return Number.isFinite(tm) ? tm : spreadFallback;
  };

  // Best achievable saturated [primary, secondary] clearance key.
  let bestP = Number.NEGATIVE_INFINITY;
  let bestS = Number.NEGATIVE_INFINITY;
  for (const c of cands) {
    const p = sat(c.gapPrev);
    const s = sat(c.gapPrev2);
    if (p > bestP + EPS || (approxEq(p, bestP) && s > bestS + EPS)) {
      bestP = p;
      bestS = s;
    }
  }

  // Feasible set: candidates tying that key (original order kept → deterministic).
  const feasible: number[] = [];
  for (let i = 0; i < cands.length; i++) {
    if (approxEq(sat(cands[i]!.gapPrev), bestP) && approxEq(sat(cands[i]!.gapPrev2), bestS))
      feasible.push(i);
  }

  // Deterministic centre: the earliest candidate with the greatest spread.
  let centre = feasible[0] ?? 0;
  for (const i of feasible) if (spread(cands[i]!) > spread(cands[centre]!) + EPS) centre = i;
  if (randomness <= 0 || feasible.length <= 1) return centre;

  // Widen the pool as randomness rises, but never below the minStagger floor: the
  // cutoff slides from the centred spread (randomness→0) down to minStagger (→1).
  const maxSpread = spread(cands[centre]!);
  const floor = Math.min(minStagger, maxSpread);
  const cutoff = floor + (1 - randomness) * (maxSpread - floor);
  const pool = feasible.filter((i) => spread(cands[i]!) >= cutoff - EPS);
  if (!pool.length) return centre;
  return pool[Math.min(pool.length - 1, Math.floor(rand * pool.length))]!;
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
 * Per-row randomised offsets: a seeded greedy that, for each row, picks a start
 * piece whose seams clear the previous one/two rows by ≥ minStagger, choosing
 * among the still-valid candidates by `randomness` (0 = most centred). Mirrors
 * the polygon engine's per-row search so both layouts randomise the same way.
 */
function randomizedRowOffsets(
  L: Mm,
  bl: Mm,
  rowCount: number,
  minPiece: Mm,
  minStagger: Mm,
  randomness: number,
  seed: number,
): Mm[] {
  const rng = makeRng(seed);
  const steps = 64;
  const offsets: Mm[] = [];
  let prev: Mm[] = [];
  let prev2: Mm[] = [];
  for (let row = 0; row < rowCount; row++) {
    const starts: Mm[] = [bl];
    for (let i = 0; i <= steps; i++) starts.push(minPiece + ((bl - minPiece) * i) / steps);
    const scored = starts
      .map((s) => {
        const pieces = planRowPieces(L, bl, s);
        const seams = seamsOf(pieces, L);
        return {
          startOffset: s,
          seams,
          minPiece: Math.min(...pieces),
          gapPrev: pairStagger(seams, prev),
          gapPrev2: pairStagger(seams, prev2),
        };
      })
      // Only starts that keep every piece installable (no run-direction sliver).
      .filter((c) => c.minPiece >= minPiece - EPS);
    if (!scored.length) {
      // Degenerate: no legal cut start → a full-board start (validity gated later).
      offsets.push(bl);
      prev2 = prev;
      prev = seamsOf(planRowPieces(L, bl, bl), L);
      continue;
    }
    const idx = pickStaggerIndex(scored, minStagger, bl, randomness, rng());
    offsets.push(scored[idx]!.startOffset);
    prev2 = prev;
    prev = scored[idx]!.seams;
  }
  return offsets;
}

/**
 * Plan the staggered seam pattern for `rowCount` rows of run length `L`.
 *
 * Uses a P-phase offset schedule (target ≈ 1/3 board) and searches a global
 * phase shift so that no start/end piece drops below `minPiece`. Escalates the
 * phase count when a near-multiple run length traps the simple pattern.
 *
 * With `randomness > 0` the regular schedule is replaced by a seeded per-row
 * search that still clears `minStagger` everywhere, for a less repetitive look.
 */
export function planStagger(
  L: Mm,
  bl: Mm,
  rowCount: number,
  minPiece: Mm,
  minStagger: Mm,
  idealStagger: Mm,
  randomness = 0,
  seed = 1,
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

  const scheduled: Mm[] = [];
  for (let i = 0; i < rowCount; i++) {
    scheduled.push(wrapStart(bl - (i % pick.P) * pick.step - pick.shift, bl));
  }
  // randomness > 0 swaps the regular schedule for a seeded per-row search that
  // still clears minStagger; 0 keeps the schedule byte-for-byte (legacy output).
  const startOffsets =
    randomness > 0
      ? randomizedRowOffsets(L, bl, rowCount, minPiece, minStagger, randomness, seed)
      : scheduled;

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
      phases: randomness > 0 ? new Set(startOffsets.map((s) => Math.round(s))).size : pick.P,
      naturalStagger,
      nearMultipleTrap: trap,
      // The multi-piece (P-phase) rescue is the schedule path only; the randomised
      // greedy clears the trap differently, so don't claim the P-phase pattern.
      usedMultiPiecePattern: trap && randomness <= 0,
    },
  };
}
