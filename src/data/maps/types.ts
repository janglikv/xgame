/**
 * 可走格子矩形（格子坐标）。
 * c/r 从地图左上角 (0,0) 起；一格边长 = cellSize（一棵树宽）。
 */
export type CellRect = {
  c: number;
  r: number;
  w: number;
  h: number;
};

/** 当前支持的敌人种类（编辑器放置 / 关卡刷怪） */
export type EnemyKind = 'spider';

/** 敌人出生点（世界坐标，建议放在可走格内） */
export type EnemySpawn = {
  kind: EnemyKind;
  x: number;
  y: number;
};

/**
 * 关卡地图：默认整图密林；walk 格子并集 = 可行动空间。
 * 编辑器按树宽格子涂抹，导出后进代码。
 */
export type LevelMapDef = {
  id: string;
  /** 整图边长（世界像素） */
  mapSize: number;
  /** 基本单元 = 一棵树占位宽度（与种树间距一致） */
  cellSize: number;
  /** 玩家出生点（世界坐标，须在可走格内） */
  spawn: { x: number; y: number };
  /** 可走区域（格子矩形并集） */
  walk: CellRect[];
  /**
   * 敌人出生列表。
   * - 省略：兼容旧关卡，运行时用出生点旁默认蜘蛛
   * - `[]`：明确无敌人
   * - 有项：按列表刷怪
   */
  enemies?: EnemySpawn[];
};
