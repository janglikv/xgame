/** 当前支持的敌人种类（上帝模式放置 / 关卡刷怪） */
export type EnemyKind = 'spider' | 'flame-flower' | 'wooden-dummy';

/** 敌人出生点（世界坐标，须在陆地上） */
export type EnemySpawn = {
  kind: EnemyKind;
  x: number;
  y: number;
};

/** 可砍树体型：小树苗 / 中树 / 大树 */
export type TreeSize = 'sapling' | 'medium' | 'large';

/**
 * 摆放的一棵可砍树（世界坐标，脚底）。
 * id 用于砍伐 / 上帝模式删除 solid。
 */
export type MapTree = {
  x: number;
  y: number;
  /** 体型；缺省 medium */
  size?: TreeSize;
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
  /** 摆放的可砍树 */
  trees: MapTree[];
  /** 敌人出生列表（可为空数组） */
  enemies: EnemySpawn[];
};
