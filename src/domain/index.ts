export * from "./types.ts";
export { computePlans, buildPlanForAxis } from "./plan.ts";
export {
  DEFAULT_INPUTS,
  DEFAULT_RECT,
  DEFAULT_BOARD,
  DEFAULT_PACK,
  DEFAULT_GAP,
  DEFAULT_TUNABLES,
  uniformGap,
  recommendedMinGap,
  GAP_RANGE,
} from "./defaults.ts";
export { resolveBoardsPerPack } from "./validate.ts";
export { computeGeometry, crossWidthAt, runLengthAt, toRoom } from "./geometry.ts";
export {
  rectRoom,
  asRect,
  roomOutline,
  isQuadRoom,
  roomArea,
  longAxis,
  roomWalls,
  toRoomShape,
  moveCorner,
  insertCorner,
  removeCorner,
  setWallLength,
  selfIntersects,
  type Wall,
} from "./room.ts";
export { insetRoom, clipRings, offsetRings, ringsArea, type Ring } from "./poly.ts";
export { checkPlan, usableFloor } from "./verify.ts";
export { mm2ToM2, m2ToMm2 } from "./units.ts";
