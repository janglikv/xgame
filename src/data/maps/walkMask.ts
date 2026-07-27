import type { LevelMapDef, MapTree, TreeKind } from './types';

/** 树干 solid 半径（世界像素，相对格子中心） */
export const TREE_SOLID_R = 14;

export type MapGrid = {
  cols: number;
  rows: number;
  cellSize: number;
  mapSize: number;
  seaMarginCells: number;
};

export function mapHalf(def: LevelMapDef): number {
  return def.mapSize / 2;
}

export function gridDims(mapSize: number, cellSize: number): {
  cols: number;
  rows: number;
} {
  const n = Math.floor(mapSize / cellSize);
  return { cols: n, rows: n };
}

export function cellKey(c: number, r: number, cols: number): number {
  return r * cols + c;
}

/** 世界坐标 → 格子（可越界，调用方 clamp） */
export function worldToCell(
  x: number,
  y: number,
  mapSize: number,
  cellSize: number,
): { c: number; r: number } {
  const half = mapSize / 2;
  return {
    c: Math.floor((x + half) / cellSize),
    r: Math.floor((y + half) / cellSize),
  };
}

/** 格子左上角世界坐标 */
export function cellOrigin(
  c: number,
  r: number,
  mapSize: number,
  cellSize: number,
): { x: number; y: number } {
  const half = mapSize / 2;
  return {
    x: -half + c * cellSize,
    y: -half + r * cellSize,
  };
}

/** 格子中心世界坐标 */
export function cellCenter(
  c: number,
  r: number,
  mapSize: number,
  cellSize: number,
): { x: number; y: number } {
  const o = cellOrigin(c, r, mapSize, cellSize);
  return { x: o.x + cellSize / 2, y: o.y + cellSize / 2 };
}

export function getMapGrid(def: LevelMapDef): MapGrid {
  const { cols, rows } = gridDims(def.mapSize, def.cellSize);
  return {
    cols,
    rows,
    cellSize: def.cellSize,
    mapSize: def.mapSize,
    seaMarginCells: Math.max(0, Math.floor(def.seaMarginCells)),
  };
}

/**
 * 陆地轴对齐范围（与 WorldMap 绿地矩形一致，世界像素）。
 * 闭开区间语义：点在 [min, max] 内算陆；圆用 margin 内缩。
 */
export function landBounds(def: LevelMapDef): { min: number; max: number } {
  const half = def.mapSize / 2;
  const sea =
    Math.max(0, Math.floor(def.seaMarginCells)) * Math.max(1, def.cellSize);
  return { min: -half + sea, max: half - sea };
}

/** 格子是否在陆地区（非海、非越界）——编辑器摆放用 */
export function isLandCell(
  c: number,
  r: number,
  def: LevelMapDef,
): boolean {
  const { cols, rows, seaMarginCells: m } = getMapGrid(def);
  if (c < m || r < m || c >= cols - m || r >= rows - m) return false;
  return true;
}

/**
 * 点/圆是否在海里（含越界）。
 * 用连续陆地矩形判定，避免格子台阶在下边界造成「顶墙感」和抖动。
 * margin > 0：把 solid 圆内缩进陆地（圆心距边 < margin 即算海）。
 */
export function isOcean(
  x: number,
  y: number,
  def: LevelMapDef,
  margin = 0,
): boolean {
  const { min, max } = landBounds(def);
  if (max <= min) return true;
  const pad = Math.max(0, margin);
  return (
    x - pad < min ||
    x + pad > max ||
    y - pad < min ||
    y + pad > max
  );
}

/** 陆地可走（不考虑树） */
export function isOnLand(
  x: number,
  y: number,
  def: LevelMapDef,
  bodyR = 0,
): boolean {
  return !isOcean(x, y, def, bodyR);
}

/**
 * 兼容旧名：可站立点 = 陆地（树 solid 另算）。
 * body 半径用 margin 语义：>0 时按身体采样。
 */
export function isWalkable(
  x: number,
  y: number,
  def: LevelMapDef,
  margin = 0,
): boolean {
  return isOnLand(x, y, def, Math.abs(margin));
}

export function treeKindOf(t: MapTree): TreeKind {
  return t.kind ?? 'harvest';
}

/** 规范化树列表（去重格、钳制陆地） */
export function normalizeTrees(
  def: Pick<LevelMapDef, 'mapSize' | 'cellSize' | 'seaMarginCells' | 'trees'>,
): MapTree[] {
  const { cols, rows } = gridDims(def.mapSize, def.cellSize);
  const seen = new Set<number>();
  const out: MapTree[] = [];
  for (const t of def.trees) {
    const c = Math.floor(t.c);
    const r = Math.floor(t.r);
    if (!isLandCell(c, r, def as LevelMapDef)) continue;
    if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
    const k = cellKey(c, r, cols);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ c, r, kind: treeKindOf(t) });
  }
  return out;
}

export type TreeObstacle = {
  x: number;
  y: number;
  r: number;
  /** 格子 key，便于砍伐后移除 */
  key: number;
};

/** 由地图树生成 solid 圆列表 */
export function buildTreeObstacles(def: LevelMapDef): TreeObstacle[] {
  const { cols } = gridDims(def.mapSize, def.cellSize);
  const out: TreeObstacle[] = [];
  for (const t of normalizeTrees(def)) {
    const p = cellCenter(t.c, t.r, def.mapSize, def.cellSize);
    out.push({
      x: p.x,
      y: p.y,
      r: TREE_SOLID_R,
      key: cellKey(t.c, t.r, cols),
    });
  }
  return out;
}

// —— 运行时树 solid（砍伐后可动态移除）——

let runtimeTreeObstacles: TreeObstacle[] = [];
let runtimeDefId: string | null = null;

export function setRuntimeTreeObstacles(
  def: LevelMapDef,
  obstacles: TreeObstacle[],
): void {
  runtimeDefId = def.id;
  runtimeTreeObstacles = obstacles.slice();
}

export function getRuntimeTreeObstacles(): readonly TreeObstacle[] {
  return runtimeTreeObstacles;
}

export function removeRuntimeTreeObstacleAtCell(
  def: LevelMapDef,
  c: number,
  r: number,
): void {
  const { cols } = gridDims(def.mapSize, def.cellSize);
  const key = cellKey(c, r, cols);
  runtimeTreeObstacles = runtimeTreeObstacles.filter((o) => o.key !== key);
}

export function clearRuntimeTreeObstacles(): void {
  runtimeTreeObstacles = [];
  runtimeDefId = null;
}

export function syncRuntimeTreesFromDef(def: LevelMapDef): void {
  setRuntimeTreeObstacles(def, buildTreeObstacles(def));
}

/** 圆心是否碰到运行时树干 */
export function hitsTreeObstacle(
  x: number,
  y: number,
  radius: number,
): boolean {
  const r = Math.max(0, radius);
  for (const o of runtimeTreeObstacles) {
    const dx = x - o.x;
    const dy = y - o.y;
    const lim = r + o.r;
    if (dx * dx + dy * dy < lim * lim) return true;
  }
  return false;
}

export function isSpawnValid(def: LevelMapDef): boolean {
  return isOnLand(def.spawn.x, def.spawn.y, def, 8);
}

export function cloneLevelDef(def: LevelMapDef): LevelMapDef {
  return {
    id: def.id,
    mapSize: def.mapSize,
    cellSize: def.cellSize,
    seaMarginCells: def.seaMarginCells,
    spawn: { x: def.spawn.x, y: def.spawn.y },
    trees: def.trees.map((t) => ({
      c: t.c,
      r: t.r,
      kind: t.kind,
    })),
    enemies:
      def.enemies === undefined
        ? undefined
        : def.enemies.map((e) => ({ ...e })),
  };
}

/** 空白海岛关卡模板 */
export function emptyIslandDef(
  id: string,
  options: {
    mapSize?: number;
    cellSize?: number;
    seaMarginCells?: number;
  } = {},
): LevelMapDef {
  const mapSize = options.mapSize ?? 2880;
  const cellSize = options.cellSize ?? 36;
  // 默认 0：整块 mapSize 是绿地岛，岛外全是海（不再「只围一圈」）
  const seaMarginCells = options.seaMarginCells ?? 0;
  return {
    id,
    mapSize,
    cellSize,
    seaMarginCells,
    spawn: { x: 0, y: 0 },
    trees: [],
    enemies: [],
  };
}

/** @deprecated 兼容旧 import 名 */
export function invalidateWalkCache(): void {
  /* no-op：海岛模型不再缓存 walk 掩码 */
}

void runtimeDefId;
