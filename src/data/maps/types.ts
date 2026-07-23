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
};
