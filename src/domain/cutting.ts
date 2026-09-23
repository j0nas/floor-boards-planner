import type { CutItem, Piece, PieceKind, PieceRole, ReuseEntry } from "./types.ts";
import { EPS, type Mm } from "./units.ts";

/** A piece that must be obtained, before a source board/offcut is assigned. */
export interface DemandPiece {
  pieceId: string;
  rowIndex: number;
  indexInRow: number;
  length: Mm; // run-length to cut (the longer edge of an angled end)
  lengthShort?: Mm;
  width: Mm; // cross width (for area/labelling)
  widthNarrow?: Mm;
  narrowAtEnd?: boolean;
  kind: PieceKind;
  role: PieceRole;
  /** Door opening the piece reaches into — fitted after the room's rows. */
  opening?: number;
  notched?: boolean;
}

/** The cut demand for a set of pieces: each needs its length from a board. */
export function demandFromPieces(pieces: readonly Piece[]): DemandPiece[] {
  return pieces.map((p) => ({
    pieceId: p.id,
    rowIndex: p.rowIndex,
    indexInRow: p.indexInRow,
    length: p.faceLength,
    lengthShort: p.faceLengthShort,
    width: p.faceWidth,
    widthNarrow: p.faceWidthNarrow,
    narrowAtEnd: p.narrowAtEnd,
    kind: p.kind,
    role: p.role,
    opening: p.opening,
    notched: p.notched,
  }));
}

export interface CutResult {
  boardsConsumed: number;
  fullBoards: number;
  cutPieces: number;
  cutList: CutItem[];
  reuseMap: ReuseEntry[];
}

/** A board with the demand pieces cut from it (in no particular order yet). */
interface Stock {
  pieces: DemandPiece[];
  /** Free length left in the middle of the board, between its end cuts. */
  spare: Mm;
}

/** Laying order: the room row by row, then doorway pieces (fitted last). */
function layOrder(a: DemandPiece, b: DemandPiece): number {
  const door = (d: DemandPiece) => (d.opening === undefined ? 0 : 1);
  return door(a) - door(b) || a.rowIndex - b.rowIndex || a.indexInRow - b.indexInRow;
}

/**
 * 1-D cutting-stock that respects click-joint ends, with kerf.
 *
 * Length accounting only (the cut-to-length-first convention: every length
 * offcut is still full width, so width never limits reuse). A cut START piece
 * must keep the board end that joins the next board and a cut END piece the end
 * that joins the previous one, so one board yields at most one start and one end
 * piece: the classic "the offcut from a row's end starts another row". Pairs are
 * chosen by a greedy maximum matching (the longest end piece takes the shortest
 * start piece that still fits beside it), which minimises boards for the start
 * and end pieces. FREE pieces (a whole row in one piece, both ends at walls) can
 * come from any part of a board, so they fill leftover middles best-fit first.
 * Width (rip) waste is accounted by area in the material summary, not here.
 */
export function assignCuts(demand: readonly DemandPiece[], bl: Mm, kerf: Mm): CutResult {
  const stocks: Stock[] = [];
  const open = (pieces: DemandPiece[], used: Mm): void => {
    stocks.push({ pieces, spare: bl - used });
  };

  const isFull = (d: DemandPiece) => d.role === "full" || d.length >= bl - EPS;
  const fulls = demand.filter(isFull);
  const starts = demand.filter((d) => !isFull(d) && d.role === "start");
  const ends = demand.filter((d) => !isFull(d) && d.role === "end");
  const frees = demand.filter((d) => !isFull(d) && d.role === "free");

  // Full boards — each consumes a whole board, no offcut.
  for (const d of fulls) open([d], bl);

  // Pair end pieces with start pieces: largest end first, with the smallest start
  // that fits beside it on one board (an exchange argument shows this greedy
  // finds a maximum matching). Ties resolve in laying order for determinism.
  const desc = (a: DemandPiece, b: DemandPiece) => b.length - a.length || layOrder(a, b);
  const endsDesc = [...ends].sort(desc);
  const startsAsc = [...starts].sort((a, b) => a.length - b.length || layOrder(a, b));
  let lo = 0; // index of the smallest unpaired start
  const unpaired: DemandPiece[] = [];
  for (const e of endsDesc) {
    const s = startsAsc[lo];
    if (s && e.length + kerf + s.length <= bl + EPS) {
      lo++;
      open([e, s], e.length + s.length + 2 * kerf);
    } else unpaired.push(e);
  }
  unpaired.push(...startsAsc.slice(lo));
  for (const d of unpaired.sort(desc)) open([d], d.length + kerf);

  // Free pieces: best-fit into the spare length of already-opened boards (the
  // smallest spare that fits), else a new board.
  for (const f of [...frees].sort(desc)) {
    let best: Stock | null = null;
    for (const st of stocks) {
      if (st.pieces.some(isFull)) continue;
      if (st.spare >= f.length - EPS && (!best || st.spare < best.spare)) best = st;
    }
    if (best) {
      best.pieces.push(f);
      best.spare -= f.length + kerf;
    } else open([f], f.length + kerf);
  }

  // Number boards in laying order (B1 is the first board you open while laying),
  // and list each board's pieces in the order they are laid.
  for (const st of stocks) st.pieces.sort(layOrder);
  stocks.sort((a, b) => layOrder(a.pieces[0]!, b.pieces[0]!));

  const byId = new Map<string, CutItem>();
  const reuseMap: ReuseEntry[] = [];
  stocks.forEach((st, i) => {
    const boardId = `B${i + 1}`;
    let left = bl;
    st.pieces.forEach((d, j) => {
      left -= d.length + (j < st.pieces.length - 1 || left - d.length > EPS ? kerf : 0);
      byId.set(d.pieceId, {
        pieceId: d.pieceId,
        rowIndex: d.rowIndex,
        indexInRow: d.indexInRow,
        length: d.length,
        lengthShort: d.lengthShort,
        width: d.width,
        widthNarrow: d.widthNarrow,
        narrowAtEnd: d.narrowAtEnd,
        kind: d.kind,
        role: isFull(d) ? "full" : d.role,
        source: boardId,
        reused: j > 0,
        ...(d.opening === undefined ? {} : { opening: d.opening }),
        ...(d.notched ? { notched: true } : {}),
      });
      if (j > 0)
        reuseMap.push({
          fromBoardId: boardId,
          fromPieceId: st.pieces[0]!.pieceId,
          usedByPieceId: d.pieceId,
          lengthUsed: d.length,
          remainder: Math.max(0, left),
        });
    });
  });

  const cutList = demand.map((d) => byId.get(d.pieceId)!);
  const fullBoards = cutList.filter((c) => c.role === "full").length;
  return {
    boardsConsumed: stocks.length,
    fullBoards,
    cutPieces: cutList.length - fullBoards,
    cutList,
    reuseMap,
  };
}
