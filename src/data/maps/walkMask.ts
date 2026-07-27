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
/**
 * 点/圆是否在海水区域（禁止进入任何海水，仅允许在岛上：草地+金沙滩活动）。
 * margin > 0：把实体圆半径算入碰撞抵挡。
 */
export function isOcean(
  x: number,
  y: number,
  def: LevelMapDef,
  margin = 0,
): boolean {
  const grid = getMapGrid(def);
  const m = grid.seaMarginCells * grid.cellSize;
  const half = def.mapSize / 2;

  const lx = -half + m;
  const ly = -half + m;
  const lw = def.mapSize - m * 2;
  const lh = def.mapSize - m * 2;

  // 金色沙滩最外边缘 offset 为 24，严格限制玩家在岛上沙滩以内，禁止下水
  const maxAllowedOffset = 24;
  return checkPointDeepOcean(x, y, lx, ly, lw, lh, maxAllowedOffset, margin);
}

/**
 * 钳制坐标到岛上可走区域（草地+金沙滩），防止踩入海水
 */
export function clampToWalkableWorld(x: number, y: number, def: LevelMapDef, margin = 0): { x: number; y: number } {
  const grid = getMapGrid(def);
  const m = grid.seaMarginCells * grid.cellSize;
  const half = def.mapSize / 2;

  const lx = -half + m;
  const ly = -half + m;
  const lw = def.mapSize - m * 2;
  const lh = def.mapSize - m * 2;

  const maxAllowedOffset = 24;
  return clampPointToDeepOcean(x, y, lx, ly, lw, lh, maxAllowedOffset, margin);
}

function checkPointDeepOcean(
  px: number,
  py: number,
  lx: number,
  ly: number,
  lw: number,
  lh: number,
  maxOffset: number,
  margin: number,
): boolean {
  const rCorner = Math.min(lw, lh) * 0.12;
  const u = getBoundaryAngleU(px, py, lx, ly, lw, lh);
  const { pos, normal } = sampleRectBoundaryNormal(lx, ly, lw, lh, rCorner, u);

  // 匹配 OceanLayer 的自然波纹起伏公式
  const s1 = Math.sin(u * Math.PI * 6 + 42) * 16;
  const s2 = Math.cos(u * Math.PI * 14 + 42 * 1.7) * 7;
  const s3 = Math.sin(u * Math.PI * 26 + 42 * 2.9) * 3.5;

  const allowedDist = maxOffset - Math.abs(margin) + (s1 + s2 + s3);
  const distAlongNormal = (px - pos.x) * normal.x + (py - pos.y) * normal.y;

  return distAlongNormal > allowedDist;
}

function clampPointToDeepOcean(
  px: number,
  py: number,
  lx: number,
  ly: number,
  lw: number,
  lh: number,
  maxOffset: number,
  margin: number,
): { x: number; y: number } {
  const rCorner = Math.min(lw, lh) * 0.12;
  const u = getBoundaryAngleU(px, py, lx, ly, lw, lh);
  const { pos, normal } = sampleRectBoundaryNormal(lx, ly, lw, lh, rCorner, u);

  const s1 = Math.sin(u * Math.PI * 6 + 42) * 16;
  const s2 = Math.cos(u * Math.PI * 14 + 42 * 1.7) * 7;
  const s3 = Math.sin(u * Math.PI * 26 + 42 * 2.9) * 3.5;

  const allowedDist = maxOffset - Math.abs(margin) + (s1 + s2 + s3);
  const distAlongNormal = (px - pos.x) * normal.x + (py - pos.y) * normal.y;

  if (distAlongNormal > allowedDist) {
    const pushBack = distAlongNormal - allowedDist;
    return {
      x: px - normal.x * pushBack,
      y: py - normal.y * pushBack,
    };
  }

  return { x: px, y: py };
}

function getBoundaryAngleU(
  px: number,
  py: number,
  lx: number,
  ly: number,
  lw: number,
  lh: number,
): number {
  const cx = lx + lw / 2;
  const cy = ly + lh / 2;
  const angle = Math.atan2(py - cy, px - cx); // -PI..PI
  // 映射至 0..1 的周长比例
  let u = (angle + Math.PI) / (Math.PI * 2);
  return (u + 0.25) % 1;
}

function sampleRectBoundaryNormal(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  u: number,
): { pos: { x: number; y: number }; normal: { x: number; y: number } } {
  const straightW = Math.max(1, w - 2 * r);
  const straightH = Math.max(1, h - 2 * r);
  const cornerArc = 0.5 * Math.PI * r;
  const totalPerimeter = 2 * straightW + 2 * straightH + 4 * cornerArc;

  let d = ((u % 1 + 1) % 1) * totalPerimeter;

  if (d <= straightW) {
    const t = d / straightW;
    return { pos: { x: x + r + t * straightW, y }, normal: { x: 0, y: -1 } };
  }
  d -= straightW;

  if (d <= cornerArc) {
    const angle = (d / cornerArc) * (Math.PI / 2) - Math.PI / 2;
    const nx = Math.cos(angle);
    const ny = Math.sin(angle);
    return { pos: { x: x + w - r + nx * r, y: y + r + ny * r }, normal: { x: nx, y: ny } };
  }
  d -= cornerArc;

  if (d <= straightH) {
    const t = d / straightH;
    return { pos: { x: x + w, y: y + r + t * straightH }, normal: { x: 1, y: 0 } };
  }
  d -= straightH;

  if (d <= cornerArc) {
    const angle = (d / cornerArc) * (Math.PI / 2);
    const nx = Math.cos(angle);
    const ny = Math.sin(angle);
    return { pos: { x: x + w - r + nx * r, y: y + h - r + ny * r }, normal: { x: nx, y: ny } };
  }
  d -= cornerArc;

  if (d <= straightW) {
    const t = d / straightW;
    return { pos: { x: x + w - r - t * straightW, y: y + h }, normal: { x: 0, y: 1 } };
  }
  d -= straightW;

  if (d <= cornerArc) {
    const angle = (d / cornerArc) * (Math.PI / 2) + Math.PI / 2;
    const nx = Math.cos(angle);
    const ny = Math.sin(angle);
    return { pos: { x: x + r + nx * r, y: y + h - r + ny * r }, normal: { x: nx, y: ny } };
  }
  d -= cornerArc;

  if (d <= straightH) {
    const t = d / straightH;
    return { pos: { x, y: y + h - r - t * straightH }, normal: { x: -1, y: 0 } };
  }
  d -= straightH;

  const angle = (Math.min(d, cornerArc) / cornerArc) * (Math.PI / 2) + Math.PI;
  const nx = Math.cos(angle);
  const ny = Math.sin(angle);
  return { pos: { x: x + r + nx * r, y: y + r + ny * r }, normal: { x: nx, y: ny } };
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
