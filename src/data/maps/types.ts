/**
 * 可走格子矩形（格子坐标）。
 * c/r 从地图左上角 (0,0) 起；一格边长 = cellSize。
 */
export type CellRect = {
  c: number;
  r: number;
  w: number;
  h: number;
};

/** 当前支持的敌人种类（编辑器放置 / 关卡刷怪） */
export type EnemyKind = 'spider' | 'flame-flower' | 'wooden-dummy';

/** 敌人出生点（世界坐标，须在陆地上） */
export type EnemySpawn = {
  kind: EnemyKind;
  x: number;
  y: number;
};

/**
 * 树上种类：
 * - pine：静态装饰 + solid（不可砍）
 * - harvest：可砍实体（运行时 HarvestableTree）
 */
export type TreeKind = 'pine' | 'harvest';

/** 编辑器摆放的一棵树（格子坐标） */
export type MapTree = {
  c: number;
  r: number;
  /** 缺省 harvest */
  kind?: TreeKind;
};

/**
 * 关卡地图（海岛模型）：
 * - mapSize 方框内是绿地岛屿（可走），方框外全是海（不可走）
 * - seaMarginCells 可选：再从方框内侧缩一圈海（默认 0 = 整框都是陆）
 * - 阻挡来自海 + 显式 trees
 * - 不再使用 walk 涂抹挖洞
 */
export type LevelMapDef = {
  id: string;
  /** 陆地岛屿边长（世界像素）；岛外全是海 */
  mapSize: number;
  /** 基本单元 = 一棵树占位宽度 */
  cellSize: number;
  /**
   * 可选：岛屿内侧再挖一圈海（格数）。默认 0。
   * 陆地 = mapSize 方框去掉四周各 seaMarginCells 格。
   */
  seaMarginCells: number;
  /** 玩家出生点（世界坐标，须在陆地上） */
  spawn: { x: number; y: number };
  /** 摆放的树 */
  trees: MapTree[];
  /**
   * 敌人出生列表。
   * - 省略：兼容旧逻辑时用默认；新关卡写 `[]`
   * - `[]`：明确无敌人
   * - 有项：按列表刷怪
   */
  enemies?: EnemySpawn[];
};
