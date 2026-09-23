/**
 * An independent physical check of a finished plan — the safety net between
 * the layout engines and a saw.
 *
 * It trusts none of the engines' bookkeeping. It rebuilds the usable floor its
 * own way (the room outline clipped by each wall's inset half-plane), reads the
 * joints and roles straight off the piece polygons, and replays the cut list
 * board by board. A correct plan returns no problems.
 */
import { differenceRings, insetRoom, clipRings, type Ring, ringsArea, unionRings } from "./poly.ts";
import { asRect } from "./room.ts";
import type { CutItem, Inputs, Piece, Plan, Point } from "./types.ts";
import type { Mm } from "./units.ts";

// mm — dimension agreement. A piece within 0.5 mm of a board length is laid as
// a whole board (the expansion gap takes the difference), plus Clipper's grid.
const LEN_TOL: Mm = 0.51;
const AREA_REL_TOL = 1e-5; // relative — area bookkeeping (Clipper works on a 0.001 mm grid)

function isConvex(ring: readonly Point[]): boolean {
  let sign = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const c = ring[(i + 2) % ring.length]!;
    const z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(z) < 1e-9) continue;
    if (sign === 0) sign = Math.sign(z);
    else if (Math.sign(z) !== sign) return false;
  }
  return sign !== 0;
}

/**
 * The floor boards must cover: a convex four-wall room inset by each wall's own
 * gap (any other outline by the largest gap, as the polygon engine does), plus
 * each door opening's clear width from its threshold back to the floor. With
 * `underFrames`, also the strips beside each opening that slide under the
 * undercut frame — floor boards may cover, but need not.
 */
export function usableFloor(inputs: Inputs, underFrames = false): Ring[] {
  const outline = inputs.room.outline;
  const g = inputs.gap;
  const perWall = asRect(inputs.room) !== null && isConvex(outline);
  const room = perWall
    ? perWallFloor(inputs)
    : insetRoom(outline, Math.max(g.near, g.far, g.left, g.right));
  const orient = Math.sign(ringsArea([outline])) || 1;
  const doors: Ring[] = [];
  for (const o of inputs.openings ?? []) {
    const a = outline[o.wall];
    const b = outline[(o.wall + 1) % outline.length];
    if (!a || !b) continue;
    const gap = perWall
      ? [g.near, g.right, g.far, g.left][o.wall]!
      : Math.max(g.near, g.far, g.left, g.right);
    // Along the wall from its start corner; across it from the threshold (outside
    // the wall face) into the room to just past the floor's edge.
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const along = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const into = { x: -along.y * orient, y: along.x * orient };
    const corner = (s: number, t: number) => ({
      x: a.x + along.x * s + into.x * t,
      y: a.y + along.y * s + into.y * t,
    });
    const frame = underFrames ? o.tuck : 0;
    const s0 = o.offset - frame;
    const s1 = o.offset + o.width + frame;
    const door: Ring = [
      corner(s0, -o.depth),
      corner(s0, gap + 1),
      corner(s1, gap + 1),
      corner(s1, -o.depth),
    ];
    doors.push(ringsArea([door]) < 0 ? [...door].reverse() : door);
  }
  if (!doors.length) return room;
  return unionRings([...room.map((r) => (ringsArea([r]) < 0 ? [...r].reverse() : r)), ...doors]);
}

/** A convex four-wall room: the outline clipped by each wall's inset half-plane. */
function perWallFloor(inputs: Inputs): Ring[] {
  const outline = inputs.room.outline;
  const g = inputs.gap;
  // Canonical quad edges: near, right, far, left.
  const gaps = [g.near, g.right, g.far, g.left];
  const orient = Math.sign(ringsArea([outline])) || 1;
  const T = 1e6;
  let region: Ring[] = [outline];
  for (let i = 0; i < 4; i++) {
    const a = outline[i]!;
    const b = outline[(i + 1) % 4]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const dx = (b.x - a.x) / len;
    const dy = (b.y - a.y) / len;
    const nx = -dy * orient; // toward the interior
    const ny = dx * orient;
    const gi = gaps[i]!;
    const p = { x: a.x + nx * gi - dx * T, y: a.y + ny * gi - dy * T };
    const q = { x: b.x + nx * gi + dx * T, y: b.y + ny * gi + dy * T };
    const half: Ring = [
      p,
      q,
      { x: q.x + nx * T, y: q.y + ny * T },
      { x: p.x + nx * T, y: p.y + ny * T },
    ];
    region = clipRings(region, [half]);
  }
  return region;
}

const perimeter = (ring: Ring) =>
  ring.reduce((s, p, i) => {
    const q = ring[(i + 1) % ring.length]!;
    return s + Math.hypot(q.x - p.x, q.y - p.y);
  }, 0);

const area = (rings: readonly Ring[]) => rings.reduce((s, r) => s + Math.abs(ringsArea([r])), 0);

/** A piece in local run (u) / cross (v) terms. */
interface Local {
  piece: Piece;
  uMin: Mm;
  uMax: Mm;
  vMin: Mm;
  vMax: Mm;
}

function toLocal(p: Piece, runIsX: boolean): Local {
  const us = p.poly.map((q) => (runIsX ? q.x : q.y));
  const vs = p.poly.map((q) => (runIsX ? q.y : q.x));
  return {
    piece: p,
    uMin: Math.min(...us),
    uMax: Math.max(...us),
    vMin: Math.min(...vs),
    vMax: Math.max(...vs),
  };
}

/** Run positions where two pieces of the same row butt together. */
function rowJoints(row: readonly Local[]): { joints: Mm[]; low: Set<Local>; high: Set<Local> } {
  const joints: Mm[] = [];
  const low = new Set<Local>(); // pieces with a neighbour at their low-run end
  const high = new Set<Local>(); // … at their high-run end
  for (const a of row)
    for (const b of row) {
      if (a === b || Math.abs(a.uMax - b.uMin) > LEN_TOL) continue;
      // Any real contact counts, however narrow (a flagged sliver still joins).
      if (Math.min(a.vMax, b.vMax) - Math.max(a.vMin, b.vMin) <= 0.01) continue;
      high.add(a);
      low.add(b);
      joints.push(a.uMax);
    }
  return { joints, low, high };
}

/**
 * Check a plan against its inputs. Returns human-readable problems; an empty
 * list means the plan is physically consistent.
 */
export function checkPlan(inputs: Inputs, plan: Plan): string[] {
  const problems: string[] = [];
  const bl = inputs.board.length;
  const bw = inputs.board.width;
  const t = inputs.tunables;
  const runIsX = plan.runAxis === "X";
  const fail = (msg: string) => {
    if (problems.length < 50) problems.push(msg);
  };

  // ── 1. The pieces tile the usable floor exactly: inside it, no overlaps, no holes.
  // (Under a door frame, beside the opening, is floor they may cover but needn't.)
  const floor = usableFloor(inputs);
  const allowed = inputs.openings?.length ? usableFloor(inputs, true) : floor;
  const floorArea = area(floor);
  const tol = Math.max(10, floorArea * AREA_REL_TOL);
  let pieceSum = 0;
  for (const p of plan.pieces) {
    const a = area([p.poly]);
    if (a <= 0) fail(`${p.id}: empty piece`);
    pieceSum += a;
    // Clipper rounds to a 0.001 mm grid, so allow a film that thin along the edges.
    const outside = area(differenceRings([p.poly], allowed));
    if (outside > 1 + 0.003 * perimeter(p.poly))
      fail(`${p.id}: ${outside.toFixed(1)} mm² lies in the expansion gap or outside the room`);
  }
  const laid = unionRings(plan.pieces.map((p) => p.poly));
  const covered = area(laid);
  if (Math.abs(pieceSum - covered) > tol)
    fail(`pieces overlap by ${(pieceSum - covered).toFixed(0)} mm²`);
  const bare = area(differenceRings(floor, laid));
  if (bare > tol)
    fail(`${bare.toFixed(0)} mm² of the ${floorArea.toFixed(0)} mm² floor is left bare`);
  if (Math.abs(plan.material.coveredAreaMm2 - covered) > tol)
    fail(
      `material covered area ${plan.material.coveredAreaMm2.toFixed(0)} ≠ laid ${covered.toFixed(0)} mm²`,
    );

  // ── 2. Every piece comes from one board, and its stated size is its drawn size.
  const locals = plan.pieces.map((p) => toLocal(p, runIsX));
  for (const l of locals) {
    const p = l.piece;
    const runExt = l.uMax - l.uMin;
    const crossExt = l.vMax - l.vMin;
    if (runExt > bl + LEN_TOL) fail(`${p.id}: ${runExt.toFixed(1)} mm long — longer than a board`);
    if (crossExt > bw + LEN_TOL)
      fail(`${p.id}: ${crossExt.toFixed(1)} mm wide — wider than a board`);
    if (Math.abs(p.faceLength - runExt) > LEN_TOL)
      fail(`${p.id}: stated length ${p.faceLength.toFixed(1)} ≠ drawn ${runExt.toFixed(1)} mm`);
    if (Math.abs(p.faceWidth - crossExt) > LEN_TOL)
      fail(`${p.id}: stated width ${p.faceWidth.toFixed(1)} ≠ drawn ${crossExt.toFixed(1)} mm`);
    if (
      p.faceLengthShort !== undefined &&
      !(p.faceLengthShort >= 0 && p.faceLengthShort < p.faceLength)
    )
      fail(`${p.id}: short edge ${p.faceLengthShort} out of range`);
    if (
      p.faceWidthNarrow !== undefined &&
      !(p.faceWidthNarrow >= 0 && p.faceWidthNarrow < p.faceWidth)
    )
      fail(`${p.id}: narrow end ${p.faceWidthNarrow} out of range`);
  }

  // ── 3. Roles, read off the geometry: which ends butt against another board.
  const byRow = new Map<number, Local[]>();
  for (const l of locals) byRow.set(l.piece.rowIndex, [...(byRow.get(l.piece.rowIndex) ?? []), l]);
  const rowSeams = new Map<number, Mm[]>();
  for (const [k, row] of byRow) {
    const { joints, low, high } = rowJoints(row);
    rowSeams.set(k, joints);
    for (const l of row) {
      const p = l.piece;
      // A board spanning its full length keeps both factory ends (a slanted wall
      // may still rip a corner off it), so it may sit anywhere in a row.
      const whole = p.faceLength >= bl - LEN_TOL;
      const expected = low.has(l)
        ? high.has(l)
          ? "middle"
          : "end"
        : high.has(l)
          ? "start"
          : "free";
      if (expected === "middle" && !whole)
        fail(
          `${p.id}: a ${p.faceLength.toFixed(0)} mm piece mid-row — its cut end can't click into the next board`,
        );
      else if (!whole && expected !== "middle" && p.role !== expected)
        fail(`${p.id}: labelled ${p.role} but sits as the ${expected} piece of row ${k + 1}`);
    }
  }

  // ── 4. The cut list is one entry per piece, matching it, and every board is cuttable.
  const cutById = new Map(plan.cutList.map((c) => [c.pieceId, c]));
  if (plan.cutList.length !== plan.pieces.length || cutById.size !== plan.pieces.length)
    fail(`cut list has ${plan.cutList.length} entries for ${plan.pieces.length} pieces`);
  for (const p of plan.pieces) {
    const c = cutById.get(p.id);
    if (!c) {
      fail(`${p.id}: missing from the cut list`);
      continue;
    }
    if (Math.abs(c.length - p.faceLength) > LEN_TOL || Math.abs(c.width - p.faceWidth) > LEN_TOL)
      fail(
        `${p.id}: cut list says ${c.length.toFixed(0)}×${c.width.toFixed(0)}, piece is ${p.faceLength.toFixed(0)}×${p.faceWidth.toFixed(0)}`,
      );
    if (c.role !== p.role && !(c.role === "full" && p.faceLength >= bl - LEN_TOL))
      fail(`${p.id}: cut list role ${c.role} ≠ piece role ${p.role}`);
  }
  const boards = new Map<string, CutItem[]>();
  for (const c of plan.cutList) boards.set(c.source, [...(boards.get(c.source) ?? []), c]);
  for (const [id, items] of boards) {
    const need = items.reduce((s, c) => s + c.length, 0) + t.kerf * (items.length - 1);
    if (need > bl + LEN_TOL) fail(`${id}: ${need.toFixed(0)} mm of pieces from a ${bl} mm board`);
    if (items.length > 1 && items.some((c) => c.role === "full"))
      fail(`${id}: a whole-board piece shares its board`);
    if (items.filter((c) => c.role === "start").length > 1)
      fail(`${id}: two start pieces — a board has only one end that joins the next board`);
    if (items.filter((c) => c.role === "end").length > 1)
      fail(`${id}: two end pieces — a board has only one end that joins the previous board`);
  }
  if (boards.size !== plan.material.boardsConsumed)
    fail(`material says ${plan.material.boardsConsumed} boards, cut list uses ${boards.size}`);
  const m = plan.material;
  if (m.recommendedPurchaseBoards + inputs.boardsOnHand < m.boardsConsumed)
    fail(
      `recommended purchase (${m.recommendedPurchaseBoards} + ${inputs.boardsOnHand} on hand) is short of ${m.boardsConsumed} boards`,
    );

  // ── 5. Minimums: a sliver is flagged; a plan marked valid has none and keeps the stagger.
  for (const l of locals) {
    const p = l.piece;
    const short = Math.min(p.faceLength, p.faceLengthShort ?? p.faceLength);
    const narrow = Math.min(p.faceWidth, p.faceWidthNarrow ?? p.faceWidth);
    // A notched (L-shaped) piece's narrow end is a tab into a doorway, not a sliver.
    const tabbed = !isConvex(p.poly);
    const below =
      short < t.minPiece - LEN_TOL || (tabbed ? p.faceWidth : narrow) < t.minRowWidth - LEN_TOL;
    if (below && !p.undersized)
      fail(
        `${p.id}: ${short.toFixed(0)}×${narrow.toFixed(0)} mm is below the minimum but not flagged`,
      );
    if (below && plan.valid && plan.rows.length)
      fail(
        `${p.id}: ${short.toFixed(0)}×${narrow.toFixed(0)} mm is below the minimum in a plan marked valid`,
      );
  }
  const rowKeys = [...byRow.keys()].sort((a, b) => a - b);
  let minStagger = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 1 < rowKeys.length; i++) {
    if (rowKeys[i + 1] !== rowKeys[i]! + 1) continue; // an empty row between: not touching
    const a = rowSeams.get(rowKeys[i]!)!;
    const b = rowSeams.get(rowKeys[i + 1]!)!;
    for (const x of a) for (const y of b) minStagger = Math.min(minStagger, Math.abs(x - y));
  }
  if (plan.valid && minStagger < t.minStagger - LEN_TOL)
    fail(
      `joints in adjacent rows are only ${minStagger.toFixed(0)} mm apart (min ${t.minStagger}) in a plan marked valid`,
    );
  const reported = plan.stagger.minObservedStagger;
  if (
    Number.isFinite(minStagger) !== Number.isFinite(reported) ||
    (Number.isFinite(minStagger) && Math.abs(minStagger - reported) > LEN_TOL)
  )
    fail(`reported stagger ${reported} ≠ measured ${minStagger}`);

  return problems;
}
