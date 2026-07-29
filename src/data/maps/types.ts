/**
 * 当前支持的敌人种类（上帝模式放置 / 关卡刷怪 / 碰撞模板）。
 * 新增动物：先往本数组追加 id，再补 factory / 贴图 / BODY_PROFILES / bodyEditCatalog。
 */
export const ENEMY_KINDS = [
  'spider',
  'flame-flower',
  'wooden-dummy',
  'chicken',
  'pig',
  'cow',
  'horse',
  'horse_king',
  'wolf',
  'bear',
] as const;

export type EnemyKind = (typeof ENEMY_KINDS)[number];

/** 敌人出生点（世界坐标，须在陆地上） */
export type EnemySpawn = {
  kind: EnemyKind;
  x: number;
  y: number;
};

/** 可砍树体型：小树苗 / 中树 / 大树 */
export type TreeSize = 'sapling' | 'medium' | 'large';

/** 树木种类：松树 / 苹果树 */
export type TreeKind = 'pine' | 'apple';

/** 草地体型：小草 / 中草 / 大草 */
export type GrassSize = 'small' | 'medium' | 'large';

/**
 * 摆放的一颗可砍树（世界坐标，脚底）。
 * id 用于砍伐 / 上帝模式删除 solid。
 */
export type MapTree = {
  x: number;
  y: number;
  /** 体型；缺省 medium */
  size?: TreeSize;
  /** 树种类；缺省 pine */
  kind?: TreeKind;
  /** 稳定 id；缺省由 normalize 生成 */
  id?: string;
};

/**
 * 摆放的一丛草地（世界坐标，脚底，无碰撞体）。
 */
export type MapGrass = {
  x: number;
  y: number;
  /** 体型；缺省 medium */
  size?: GrassSize;
  /** 稳定 id */
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
  /** 摆放的无碰撞草地 */
  grasses?: MapGrass[];
  /** 敌人出生列表（可为空数组） */
  enemies: EnemySpawn[];
};
