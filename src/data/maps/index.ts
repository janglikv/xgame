export type { LevelMapDef, CellRect, EnemyKind, EnemySpawn } from './types';
export {
  TREE_CLEAR_MARGIN,
  mapHalf,
  gridDims,
  cellKey,
  worldToCell,
  cellOrigin,
  cellCenter,
  cellRectToWorld,
  buildWalkGrid,
  getWalkGrid,
  invalidateWalkCache,
  isWalkable,
  shouldPlantTree,
  mergeCellsToRects,
  rasterizeWorldRect,
  cellsFromWalk,
  countWalkCells,
  isSpawnValid,
  cloneLevelDef,
  defFromCells,
} from './walkMask';
export { buildGridLevelDef, GRID_LAYOUT_META } from './gridTemplate';
export { formatLevelDefTs, copyLevelDefTs } from './exportLevel';
export { LEVEL_1 } from './level-1';
export { LEVEL_2 } from './level-2';
export {
  LEVEL_CATALOG,
  getLevelById,
  getLevelIndex,
  levelDisplayName,
  type LevelId,
} from './catalog';
export { getActiveMapDef, setActiveMapDef } from './activeMap';
export {
  loadMapDraftsFromStorage,
  saveMapDraft,
  getMapDraft,
  hasMapDraft,
  clearMapDraft,
  getPlayableLevelById,
  getDefaultEditLevel,
  getPlayableCatalog,
} from './mapDrafts';
