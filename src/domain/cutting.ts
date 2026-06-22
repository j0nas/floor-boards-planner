import type { CutItem, PieceKind, ReuseEntry } from "./types.ts";
import { EPS, type Mm } from "./units.ts";

/** A piece that must be obtained, before a source board/offcut is assigned. */
export interface DemandPiece {
  pieceId: string;
  rowIndex: number;
  indexInRow: number;
  length: Mm; // run-length to cut
  width: Mm; // cross width (for area/labelling)
  kind: PieceKind;
}

interface Offcut {
  id: string;
  length: Mm;
  fromBoardId: string;
  fromPieceId: string;
}

export interface CutResult {
  boardsConsumed: number;
  fullBoards: number;
  cutPieces: number;
  cutList: CutItem[];
  reuseMap: ReuseEntry[];
}

/**
 * 1-D cutting-stock with best-fit offcut reuse and kerf.
 *
 * Length accounting only: each piece needs `length` of a `bl`-long board.
 * Pieces are cut longest-first; a cut piece prefers the *smallest* offcut that
 * still fits (best-fit — which naturally pairs complementary lengths, e.g. a
 * 2/3 and a 1/3 board from one stick), otherwise a fresh board is opened and
 * its remainder enters the offcut pool. Width (rip) waste is accounted by area
 * in the material summary, not here.
 */
export function assignCuts(
  demand: readonly DemandPiece[],
  bl: Mm,
  kerf: Mm,
  minReusable: Mm,
): CutResult {
  const cutList: CutItem[] = [];
  const reuseMap: ReuseEntry[] = [];
  const offcuts: Offcut[] = [];
  let boards = 0;
  let fullBoards = 0;
  let cutPieces = 0;
  let offcutSeq = 0;

  const byId = new Map<string, CutItem>();
  for (const d of demand) {
    const item: CutItem = {
      pieceId: d.pieceId,
      rowIndex: d.rowIndex,
      indexInRow: d.indexInRow,
      length: d.length,
      width: d.width,
      kind: d.kind,
      source: "",
      reused: false,
    };
    byId.set(d.pieceId, item);
    cutList.push(item);
  }

  // Full boards first — each consumes a whole board, no offcut.
  const fulls = demand.filter((d) => d.length >= bl - EPS);
  for (const d of fulls) {
    boards++;
    fullBoards++;
    const item = byId.get(d.pieceId)!;
    item.source = `B${boards}`;
    item.reused = false;
  }

  // Cut pieces longest-first so big pieces seed offcuts that small pieces reuse.
  const cuts = demand
    .filter((d) => d.length < bl - EPS)
    .slice()
    .sort((a, b) => b.length - a.length || a.pieceId.localeCompare(b.pieceId));

  for (const d of cuts) {
    cutPieces++;
    const item = byId.get(d.pieceId)!;

    // best-fit: smallest offcut that still fits this length
    let bestIdx = -1;
    for (let i = 0; i < offcuts.length; i++) {
      if (offcuts[i]!.length >= d.length - EPS) {
        if (bestIdx === -1 || offcuts[i]!.length < offcuts[bestIdx]!.length) bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      const oc = offcuts[bestIdx]!;
      offcuts.splice(bestIdx, 1);
      const remainder = oc.length - d.length - kerf;
      item.source = oc.id;
      item.reused = true;
      reuseMap.push({
        offcutId: oc.id,
        fromBoardId: oc.fromBoardId,
        fromPieceId: oc.fromPieceId,
        usedByPieceId: d.pieceId,
        lengthUsed: d.length,
        remainder: Math.max(0, remainder),
      });
      if (remainder >= minReusable - EPS) {
        offcuts.push({
          id: `O${++offcutSeq}`,
          length: remainder,
          fromBoardId: oc.fromBoardId,
          fromPieceId: d.pieceId,
        });
      }
    } else {
      boards++;
      const boardId = `B${boards}`;
      item.source = boardId;
      item.reused = false;
      const remainder = bl - d.length - kerf;
      if (remainder >= minReusable - EPS) {
        offcuts.push({
          id: `O${++offcutSeq}`,
          length: remainder,
          fromBoardId: boardId,
          fromPieceId: d.pieceId,
        });
      }
    }
  }

  return { boardsConsumed: boards, fullBoards, cutPieces, cutList, reuseMap };
}
