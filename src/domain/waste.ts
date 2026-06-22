import type { Board, MaterialSummary } from "./types.ts";
import type { CutResult } from "./cutting.ts";
import { type Mm2, clamp } from "./units.ts";

export interface MaterialInputs {
  cut: CutResult;
  board: Board;
  boardsPerPack: number;
  boardsOnHand: number;
  coveredAreaMm2: Mm2;
  safetyMarginPct: number;
}

/**
 * Boards, packs, waste percentages and a safe purchase recommendation.
 *
 * Waste is computed honestly against board *area* (board count × board area),
 * which captures kerf and rip losses — never against summed piece areas.
 */
export function computeMaterial(m: MaterialInputs): MaterialSummary {
  const boardArea = m.board.length * m.board.width;
  const boardsConsumed = m.cut.boardsConsumed;

  const consumedArea = boardsConsumed * boardArea;
  const consumedWastePct =
    consumedArea > 0 ? ((consumedArea - m.coveredAreaMm2) / consumedArea) * 100 : 0;

  const boardsPerPack = Math.max(1, Math.round(m.boardsPerPack));
  const packsConsumed = Math.ceil(boardsConsumed / boardsPerPack);

  const safetyBoards = Math.ceil(boardsConsumed * m.safetyMarginPct);
  const target = boardsConsumed + safetyBoards;
  const afterOnHand = clamp(target - m.boardsOnHand, 0, Number.MAX_SAFE_INTEGER);
  const recommendedPurchasePacks = Math.ceil(afterOnHand / boardsPerPack);
  const recommendedPurchaseBoards = recommendedPurchasePacks * boardsPerPack;

  const totalAvailable = recommendedPurchaseBoards + m.boardsOnHand;
  const availableArea = totalAvailable * boardArea;
  const purchaseWastePct =
    availableArea > 0 ? ((availableArea - m.coveredAreaMm2) / availableArea) * 100 : 0;

  return {
    boardsConsumed,
    fullBoards: m.cut.fullBoards,
    cutPieces: m.cut.cutPieces,
    consumedWastePct,
    purchaseWastePct,
    coveredAreaMm2: m.coveredAreaMm2,
    boardsPerPack,
    packsConsumed,
    safetyBoards,
    recommendedPurchaseBoards,
    recommendedPurchasePacks,
    dyeLotNote:
      "Order all packs together in a single dye-lot/batch — mixing batches risks visible shade variation. Keep the spare boards for future repairs.",
  };
}
