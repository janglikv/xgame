/** 当前支持的敌人种类（上帝模式放置 / 关卡刷怪） */
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

/**
 * 摆放的一棵树（世界坐标，脚底）。
 * 不再绑定网格；id 用于砍伐 / 上帝模式删除 solid。
 */
export type MapTree = {
  x: number;
  y: number;
  /** 缺省 harvest */
  kind?: TreeKind;
  /** 稳定 id；缺省由 normalize 生成 */
  id?: string;
};

/**
 * 关卡地图（海岛模型）：
 * - mapSize 方框内是绿地岛屿（可走），方框外全是海（不可走）
 * - seaMargin 可选：再从方框内侧缩一圈海（像素，默认 0）
 * - 阻挡来自海 + 显式 trees
 * - 摆放均为世界坐标，无网格
 */
export type LevelMapDef = {
  id: string;
  /** 陆地岛屿边长（世界像素）；岛外全是海 */
  mapSize: number;
  /**
   * 可选：岛屿内侧再挖一圈海（像素）。默认 0。
   * 陆地 = mapSize 方框去掉四周各 seaMargin。
   */
  seaMargin?: number;
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
