export type {
  LevelMapDef,
  EnemyKind,
  EnemySpawn,
  MapTree,
  TreeSize,
  TreeKind,
  MapGrass,
  GrassSize,
} from './types';
export { ENEMY_KINDS } from './types';
export {
  treeSolidR,
  treeSizeOf,
  treeKindOf,
  allocGrassId,
  grassIdOf,
  grassSizeOf,
  normalizeGrasses,
  mapHalf,
  seaMarginPx,
  landBounds,
  landRectOf,
  isOcean,
  clampToWalkableWorld,
  isOnLand,
  isOnGreenLand,
  allocTreeId,
  treeIdOf,
  normalizeTrees,
  buildTreeObstacles,
  setRuntimeTreeObstacles,
  getRuntimeTreeObstacles,
  getTreeObstaclesNear,
  removeRuntimeTreeObstacleById,
  clearRuntimeTreeObstacles,
  syncRuntimeTreesFromDef,
  addRuntimeTreeObstacle,
  updateMapTreeSize,
  hitsTreeObstacle,
  isSpawnValid,
  cloneLevelDef,
  emptyIslandDef,
  type TreeObstacle,
} from './walkMask';
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
  resetMapDraftsInMemory,
} from './mapDrafts';
