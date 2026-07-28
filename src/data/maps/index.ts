export type {
  LevelMapDef,
  EnemyKind,
  EnemySpawn,
  MapTree,
  TreeKind,
  TreeSize,
} from './types';
export {
  TREE_SOLID_R,
  treeSolidR,
  treeSizeOf,
  mapHalf,
  seaMarginPx,
  getMapGrid,
  landBounds,
  landRectOf,
  isOcean,
  clampToWalkableWorld,
  isOnLand,
  isWalkable,
  treeKindOf,
  allocTreeId,
  treeIdOf,
  normalizeTrees,
  buildTreeObstacles,
  setRuntimeTreeObstacles,
  getRuntimeTreeObstacles,
  removeRuntimeTreeObstacleById,
  removeRuntimeTreeObstacleAtCell,
  clearRuntimeTreeObstacles,
  syncRuntimeTreesFromDef,
  addRuntimeTreeObstacle,
  hitsTreeObstacle,
  isSpawnValid,
  cloneLevelDef,
  emptyIslandDef,
  invalidateWalkCache,
  type MapGrid,
  type TreeObstacle,
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
  getPlayableCatalog,
  coerceLevelDef,
} from './mapDrafts';
