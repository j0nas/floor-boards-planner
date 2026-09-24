/**
 * Least-waste stagger: choose each row's start piece so offcuts chain — the
 * offcut left by one row's end piece starts a later row, and the offcut left by
 * a start piece ends one — using as few boards as possible, while every piece
 * stays ≥ minPiece and adjacent rows' joints stay ≥ minStagger apart.
 *
 * A board has two factory ends: the one that joins the previous board in a row
 * and the one that joins the next. A start piece keeps the second (it is the
 * board's far part), an end piece the first (its near part), so the offcut of
 * an end piece can only start a row and the offcut of a start piece can only
 * end one — the rule `assignCuts` enforces.
 *
 * Beam search over the rows in laying order, tracking the open offcuts. Each
 * row tries the starts that use an open offcut exactly, the starts that let its
 * end piece use one exactly, a whole board, a coarse spread of other lengths
 * and the even schedule's own start. The surviving layouts are scored with the
 * real cutting pass; at equal board counts the wider stagger wins, and the
 * even schedule wins outright when it is as good.
 */
import { assignCuts, type DemandPiece } from "./cutting.ts";
import {
  type RowRun,
  type StaggerPlan,
  pairStagger,
  rowMinPiece,
  seamsOf,
  tileRun,
} from "./stagger.ts";
import type { PieceRole } from "./types.ts";
import { EPS, type Mm, approxEq } from "./units.ts";

const BEAM = 32;
const GRID = 12;

interface State {
  boards: number;
  /** Offcuts that still have the factory end a start piece needs. */
  startable: Mm[];
  /** Offcuts that still have the factory end an end piece needs. */
  endable: Mm[];
  starts: Mm[];
  prev: Mm[];
  prev2: Mm[];
  minGap: number;
  minGap2: number;
}

/** A row's pieces as cut: the first reaches back into a doorway by `lead`, the last on by `trail`. */
function cutLengths(run: RowRun, bl: Mm, start: Mm): { lengths: Mm[]; roles: PieceRole[] } {
  const lengths = tileRun(run, bl, start).slice();
  const n = lengths.length;
  lengths[0] = lengths[0]! + (run.lead ?? 0);
  lengths[n - 1] = lengths[n - 1]! + (run.trail ?? 0);
  const roles = lengths.map((len, j): PieceRole => {
    if (approxEq(len, bl)) return "full";
    if (n === 1) return "free";
    return j === 0 ? "start" : j === n - 1 ? "end" : "full";
  });
  return { lengths, roles };
}

/** Take `len` from the best-fitting offcut in `pool` (removing it); false if none fits. */
function takeFrom(pool: Mm[], len: Mm): boolean {
  let best = -1;
  for (let i = 0; i < pool.length; i++)
    if (pool[i]! >= len - EPS && (best < 0 || pool[i]! < pool[best]!)) best = i;
  if (best < 0) return false;
  pool.splice(best, 1);
  return true;
}

/** Lay one row onto a state: which offcuts it uses, which boards it opens. */
function layRow(
  s: State,
  run: RowRun,
  start: Mm,
  seams: Mm[],
  gap: number,
  gap2: number,
  bl: Mm,
  kerf: Mm,
  minPiece: Mm,
): State {
  const next: State = {
    boards: s.boards,
    startable: s.startable.slice(),
    endable: s.endable.slice(),
    starts: [...s.starts, start],
    prev: seams,
    prev2: s.prev,
    minGap: Math.min(s.minGap, gap),
    minGap2: Math.min(s.minGap2, gap2),
  };
  const keep = (pool: Mm[], len: Mm) => {
    if (len >= minPiece - EPS) pool.push(len);
  };
  const { lengths, roles } = cutLengths(run, bl, start);
  lengths.forEach((len, j) => {
    const role = roles[j]!;
    if (role === "full") next.boards++;
    else if (role === "start") {
      if (!takeFrom(next.startable, len)) {
        next.boards++;
        keep(next.endable, bl - len - kerf);
      }
    } else if (role === "end") {
      if (!takeFrom(next.endable, len)) {
        next.boards++;
        keep(next.startable, bl - len - kerf);
      }
    } else if (!takeFrom(next.startable, len) && !takeFrom(next.endable, len)) {
      next.boards++;
      keep(next.startable, bl - len - kerf);
    }
  });
  return next;
}

/** Boards the real cutting pass needs for a set of row starts. */
function boardsFor(runs: readonly RowRun[], starts: readonly Mm[], bl: Mm, kerf: Mm): number {
  const demand: DemandPiece[] = [];
  runs.forEach((run, i) => {
    const { lengths, roles } = cutLengths(run, bl, starts[i]!);
    lengths.forEach((length, j) =>
      demand.push({
        pieceId: `r${i}-p${j}`,
        rowIndex: i,
        indexInRow: j,
        length,
        width: 0,
        kind: "cut-length",
        role: roles[j]!,
      }),
    );
  });
  return assignCuts(demand, bl, kerf).boardsConsumed;
}

/** Stagger to the previous row and the one before it, for a set of starts. */
function staggerOf(runs: readonly RowRun[], starts: readonly Mm[], bl: Mm) {
  const seams = runs.map((run, i) => seamsOf(tileRun(run, bl, starts[i]!), run.length));
  let gap = Number.POSITIVE_INFINITY;
  let gap2 = Number.POSITIVE_INFINITY;
  for (let i = 1; i < seams.length; i++) {
    gap = Math.min(gap, pairStagger(seams[i]!, seams[i - 1]!));
    if (i > 1) gap2 = Math.min(gap2, pairStagger(seams[i]!, seams[i - 2]!));
  }
  return { gap, gap2 };
}

/** Beam search over the rows; the surviving layouts' row starts. */
function search(
  runs: readonly RowRun[],
  bl: Mm,
  minPiece: Mm,
  minStagger: Mm,
  kerf: Mm,
  even: readonly Mm[],
  noLadder: boolean,
): Mm[][] {
  let beam: State[] = [
    {
      boards: 0,
      startable: [],
      endable: [],
      starts: [],
      prev: [],
      prev2: [],
      minGap: Number.POSITIVE_INFINITY,
      minGap2: Number.POSITIVE_INFINITY,
    },
  ];
  runs.forEach((run, i) => {
    const L = run.length;
    const next: State[] = [];
    for (const s of beam) {
      const cands = new Set<number>([bl, even[i]!]);
      for (const o of s.startable) cands.add(o - (run.lead ?? 0));
      for (const e of s.endable)
        for (let k = 0; k * bl < L; k++) cands.add(L - k * bl - (e - (run.trail ?? 0)));
      for (let g = 0; g <= GRID; g++) cands.add(minPiece + ((bl - minPiece) * g) / GRID);
      let laid = 0;
      for (const raw of cands) {
        const start = Math.round(raw * 1000) / 1000;
        if (!(start > EPS && start <= bl + EPS)) continue;
        if (rowMinPiece(run, bl, start) < minPiece - EPS) continue;
        const seams = seamsOf(tileRun(run, bl, start), L);
        const gap = pairStagger(seams, s.prev);
        if (gap < minStagger - EPS) continue;
        const gap2 = pairStagger(seams, s.prev2);
        if (noLadder && gap2 < minStagger - EPS) continue;
        next.push(layRow(s, run, start, seams, gap, gap2, bl, kerf, minPiece));
        laid++;
      }
      // No legal start from here: carry the even schedule's (validity is gated later).
      if (!laid) {
        const start = even[i]!;
        const seams = seamsOf(tileRun(run, bl, start), L);
        const gap = pairStagger(seams, s.prev);
        next.push(
          layRow(s, run, start, seams, gap, pairStagger(seams, s.prev2), bl, kerf, minPiece),
        );
      }
    }
    // Fewest boards, then the most offcut still usable, then the widest stagger.
    const spare = (s: State) =>
      s.startable.reduce((a, b) => a + b, 0) + s.endable.reduce((a, b) => a + b, 0);
    next.sort(
      (a, b) =>
        a.boards - b.boards ||
        spare(b) - spare(a) ||
        Math.min(b.minGap, bl) - Math.min(a.minGap, bl) ||
        Math.min(b.minGap2, bl) - Math.min(a.minGap2, bl),
    );
    const seen = new Set<string>();
    beam = [];
    for (const s of next) {
      const pool = [...s.startable, -1, ...s.endable].map(Math.round).join(",");
      const key = `${s.boards}|${s.prev.map(Math.round).join(",")}|${pool}`;
      if (seen.has(key)) continue;
      seen.add(key);
      beam.push(s);
      if (beam.length >= BEAM) break;
    }
  });
  return beam.map((s) => s.starts);
}

/**
 * Row starts using the fewest boards — never more than `even` (the regular
 * schedule) needs, and `even` itself when it needs as few. Among layouts with
 * the same board count, one whose joints never line up two rows apart (the
 * ladder look) wins, then the widest stagger. Rows that can't meet the
 * minimums from any start keep the even schedule's start.
 */
export function leastWasteStarts(
  runs: readonly RowRun[],
  bl: Mm,
  minPiece: Mm,
  minStagger: Mm,
  kerf: Mm,
  even: readonly Mm[],
): Mm[] {
  const score = (starts: readonly Mm[]) => {
    const { gap, gap2 } = staggerOf(runs, starts, bl);
    return {
      starts,
      boards: boardsFor(runs, starts, bl, kerf),
      valid: gap >= minStagger - EPS,
      ladderFree: gap2 >= minStagger - EPS,
      gap: Math.min(gap, bl),
      gap2: Math.min(gap2, bl),
    };
  };
  type Score = ReturnType<typeof score>;
  // Negative when a is the better layout.
  const compare = (a: Score, b: Score) =>
    Number(b.valid) - Number(a.valid) ||
    a.boards - b.boards ||
    Number(b.ladderFree) - Number(a.ladderFree) ||
    b.gap - a.gap ||
    b.gap2 - a.gap2;

  const evenScore = score(even);
  let best = evenScore;
  for (const noLadder of [true, false])
    for (const starts of search(runs, bl, minPiece, minStagger, kerf, even, noLadder)) {
      const c = score(starts);
      // The regular schedule keeps any tie on board count.
      if (compare(c, best) < 0 && !(best === evenScore && c.boards === best.boards && c.valid))
        best = c;
    }
  return [...best.starts];
}

/** A stagger plan re-based on other row starts: its stats measured on their seams. */
export function withStarts(
  plan: StaggerPlan,
  runs: readonly RowRun[],
  bl: Mm,
  starts: readonly Mm[],
): StaggerPlan {
  if (starts.every((s, i) => approxEq(s, plan.startOffsets[i]!))) return plan;
  const { gap } = staggerOf(runs, starts, bl);
  return {
    startOffsets: [...starts],
    info: {
      ...plan.info,
      achievedStagger: gap,
      minObservedStagger: gap,
      phases: new Set(starts.map((s) => Math.round(s))).size,
      // The trap notes describe the regular schedule, which this replaces.
      nearMultipleTrap: false,
      usedMultiPiecePattern: false,
    },
  };
}
