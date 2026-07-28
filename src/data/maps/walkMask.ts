import type { LevelMapDef, MapTree, TreeKind } from './types';

/** 树干 solid 半径（世界像素，相对脚底） */
export const TREE_SOLID_R = 14;

/** 两棵树过近时 normalize 去重的距离² */
const TREE_DEDUP_DIST2 = 8 * 8;

export type MapGrid = {
  mapSize: number;
  seaMargin: number;
};

export function mapHalf(def: LevelMapDef): number {
  return def.mapSize / 2;
}

/** 海缘像素（兼容旧草稿 seaMarginCells * cellSize） */
export function seaMarginPx(def: LevelMapDef): number {
  if (typeof def.seaMargin === 'number' && Number.isFinite(def.seaMargin)) {
    return Math.max(0, def.seaMargin);
  }
  const legacy = def as LevelMapDef & {
    seaMarginCells?: number;
    cellSize?: number;
  };
  if (
    typeof legacy.seaMarginCells === 'number' &&
    typeof legacy.cellSize === 'number'
  ) {
    return (
      Math.max(0, Math.floor(legacy.seaMarginCells)) *
      Math.max(1, legacy.cellSize)
    );
  }
  return 0;
}

export function getMapGrid(def: LevelMapDef): MapGrid {
  return {
    mapSize: def.mapSize,
    seaMargin: seaMarginPx(def),
  };
}

/**
 * 陆地轴对齐范围（与 WorldMap 绿地矩形一致，世界像素）。
 */
export function landBounds(def: LevelMapDef): { min: number; max: number } {
  const half = def.mapSize / 2;
  const sea = seaMarginPx(def);
  return { min: -half + sea, max: half - sea };
}

export function landRectOf(def: LevelMapDef): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const sea = seaMarginPx(def);
  const half = def.mapSize / 2;
  return {
    x: -half + sea,
    y: -half + sea,
    w: def.mapSize - sea * 2,
    h: def.mapSize - sea * 2,
  };
}

/**
 * 与 OceanLayer.generateOrganicContour 同相位/频率，但碰撞波幅更小：
 * 全量视觉扰动会在岸线凹处形成「口袋」，轴分离时极易卡脚。
 * 金色沙滩外缘 offset = 24；碰撞用较低波幅沿岸滑行更顺。
 */
const COAST_SEED = 42;
const COAST_CORNER_RATIO = 0.12;
/** 金色沙滩最外缘相对陆地圆角矩形的外扩（px） */
const WALK_COAST_OFFSET = 24;
/**
 * 碰撞扰动相对视觉扰动的比例。
 * 1 = 完全贴视觉岸线（凹处易卡）；0 = 纯圆角矩形。
 */
const WALK_WAVE_SCALE = 0.4;
/** 钳制迭代：有机扰动下 u 会随位置微调，多推一次更稳 */
const COAST_CLAMP_ITERS = 4;
/** 海岸判定容差，避免贴边浮点误差导致每帧「在海里」抖动 */
const COAST_EPS = 0.25;

/** 视觉同款扰动（OceanLayer 用全量；走路碰撞再缩放） */
function organicShoreDistort(u: number, seed = COAST_SEED): number {
  const s1 = Math.sin(u * Math.PI * 6 + seed) * 16;
  const s2 = Math.cos(u * Math.PI * 14 + seed * 1.7) * 7;
  const s3 = Math.sin(u * Math.PI * 26 + seed * 2.9) * 3.5;
  return s1 + s2 + s3;
}

/** 走路/钳制用：减弱波幅，减少凹处卡脚 */
function walkShoreDistort(u: number): number {
  return organicShoreDistort(u) * WALK_WAVE_SCALE;
}

/**
 * 圆心允许的最大外向距离（相对圆角矩形边界）。
 * 再扣 body 半径；并对过深凹谷做下限，避免 margin 把可走带掐成锯齿口袋。
 */
function walkAllowedDist(u: number, margin: number): number {
  const m = Math.abs(margin);
  const raw = WALK_COAST_OFFSET - m + walkShoreDistort(u);
  // 至少允许贴在「基线 - 0.35*半径」附近滑，避免波谷把通道掐死
  return Math.max(raw, -m * 0.35);
}

/**
 * 点/圆是否在海水区域（禁止进入任何海水，仅允许在岛上：草地+金沙滩）。
 * margin > 0：把实体 solid 半径算入（圆心距岸边 < margin 即算海）。
 */
export function isOcean(
  x: number,
  y: number,
  def: LevelMapDef,
  margin = 0,
): boolean {
  const land = landRectOf(def);
  if (land.w <= 0 || land.h <= 0) return true;
  return coastSignedOvershoot(x, y, land, margin) > COAST_EPS;
}

/**
 * 钳制坐标到岛上可走区域（草地+金沙滩），防止踩入海水。
 * 沿岸法线推回，可沿海岸滑行（配合 resolve 里「海不做轴分离」）。
 */
export function clampToWalkableWorld(
  x: number,
  y: number,
  def: LevelMapDef,
  margin = 0,
): { x: number; y: number } {
  const land = landRectOf(def);
  if (land.w <= 0 || land.h <= 0) return { x: 0, y: 0 };

  const rCorner = Math.min(land.w, land.h) * COAST_CORNER_RATIO;
  let px = x;
  let py = y;
  for (let i = 0; i < COAST_CLAMP_ITERS; i++) {
    const hit = projectToRoundedRectBoundary(
      px,
      py,
      land.x,
      land.y,
      land.w,
      land.h,
      rCorner,
    );
    const allowed = walkAllowedDist(hit.u, margin);
    const overshoot = hit.signedDist - allowed;
    if (overshoot <= COAST_EPS) break;
    px -= hit.normal.x * overshoot;
    py -= hit.normal.y * overshoot;
  }
  return { x: px, y: py };
}

function coastSignedOvershoot(
  px: number,
  py: number,
  land: { x: number; y: number; w: number; h: number },
  margin: number,
): number {
  const hit = projectToRoundedRectBoundary(
    px,
    py,
    land.x,
    land.y,
    land.w,
    land.h,
    Math.min(land.w, land.h) * COAST_CORNER_RATIO,
  );
  return hit.signedDist - walkAllowedDist(hit.u, margin);
}

type BoundaryHit = {
  pos: { x: number; y: number };
  normal: { x: number; y: number };
  u: number;
  signedDist: number;
};

/**
 * 投影到圆角矩形边界最近点，并给出外向法线与周长参数 u。
 * 绝不能用极角当 u——那会把右侧点映射到左侧边界，导致永远判不成海。
 */
function projectToRoundedRectBoundary(
  px: number,
  py: number,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): BoundaryHit {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) * 0.5));
  const straightW = Math.max(0, w - 2 * rr);
  const straightH = Math.max(0, h - 2 * rr);
  const cornerArc = rr > 1e-8 ? 0.5 * Math.PI * rr : 0;
  const totalPerimeter = Math.max(
    1e-6,
    2 * straightW + 2 * straightH + 4 * cornerArc,
  );

  let bestD2 = Infinity;
  let bestPosX = x + w * 0.5;
  let bestPosY = y;
  let bestNx = 0;
  let bestNy = -1;
  let bestPeri = 0;

  const consider = (
    qx: number,
    qy: number,
    nx: number,
    ny: number,
    periAlong: number,
  ): void => {
    const dx = px - qx;
    const dy = py - qy;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      bestPosX = qx;
      bestPosY = qy;
      bestNx = nx;
      bestNy = ny;
      bestPeri = periAlong;
    }
  };

  let peri = 0;

  if (straightW > 0) {
    const qx = Math.min(Math.max(px, x + rr), x + w - rr);
    consider(qx, y, 0, -1, peri + (qx - (x + rr)));
    peri += straightW;
  }

  if (cornerArc > 0) {
    const cx = x + w - rr;
    const cy = y + rr;
    const ang = clampAngle(Math.atan2(py - cy, px - cx), -Math.PI / 2, 0);
    const nx = Math.cos(ang);
    const ny = Math.sin(ang);
    const t = (ang + Math.PI / 2) / (Math.PI / 2);
    consider(cx + nx * rr, cy + ny * rr, nx, ny, peri + t * cornerArc);
    peri += cornerArc;
  }

  if (straightH > 0) {
    const qy = Math.min(Math.max(py, y + rr), y + h - rr);
    consider(x + w, qy, 1, 0, peri + (qy - (y + rr)));
    peri += straightH;
  }

  if (cornerArc > 0) {
    const cx = x + w - rr;
    const cy = y + h - rr;
    const ang = clampAngle(Math.atan2(py - cy, px - cx), 0, Math.PI / 2);
    const nx = Math.cos(ang);
    const ny = Math.sin(ang);
    const t = ang / (Math.PI / 2);
    consider(cx + nx * rr, cy + ny * rr, nx, ny, peri + t * cornerArc);
    peri += cornerArc;
  }

  if (straightW > 0) {
    const qx = Math.min(Math.max(px, x + rr), x + w - rr);
    consider(qx, y + h, 0, 1, peri + (x + w - rr - qx));
    peri += straightW;
  }

  if (cornerArc > 0) {
    const cx = x + rr;
    const cy = y + h - rr;
    const ang = clampAngle(Math.atan2(py - cy, px - cx), Math.PI / 2, Math.PI);
    const nx = Math.cos(ang);
    const ny = Math.sin(ang);
    const t = (ang - Math.PI / 2) / (Math.PI / 2);
    consider(cx + nx * rr, cy + ny * rr, nx, ny, peri + t * cornerArc);
    peri += cornerArc;
  }

  if (straightH > 0) {
    const qy = Math.min(Math.max(py, y + rr), y + h - rr);
    consider(x, qy, -1, 0, peri + (y + h - rr - qy));
    peri += straightH;
  }

  if (cornerArc > 0) {
    const cx = x + rr;
    const cy = y + rr;
    let raw = Math.atan2(py - cy, px - cx);
    if (raw > 0) raw -= Math.PI * 2;
    const ang = clampAngle(raw, -Math.PI, -Math.PI / 2);
    const nx = Math.cos(ang);
    const ny = Math.sin(ang);
    const t = (ang + Math.PI) / (Math.PI / 2);
    consider(cx + nx * rr, cy + ny * rr, nx, ny, peri + t * cornerArc);
  }

  const signedDist =
    (px - bestPosX) * bestNx + (py - bestPosY) * bestNy;

  return {
    pos: { x: bestPosX, y: bestPosY },
    normal: { x: bestNx, y: bestNy },
    u: ((bestPeri / totalPerimeter) % 1 + 1) % 1,
    signedDist,
  };
}

function clampAngle(a: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, a));
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

let treeIdSeq = 0;

/** 生成稳定树 id */
export function allocTreeId(prefix = 't'): string {
  treeIdSeq += 1;
  return `${prefix}_${Date.now().toString(36)}_${treeIdSeq}`;
}

export function treeIdOf(t: MapTree): string {
  if (t.id && t.id.length > 0) return t.id;
  return `tree_${Math.round(t.x)}_${Math.round(t.y)}_${treeKindOf(t)}`;
}

/**
 * 规范化树列表：世界坐标、陆地过滤、近距去重、补 id。
 * 只保留可砍树（harvest）；松树 pine 已废弃，加载时丢弃。
 * 兼容旧草稿 `{ c, r }`（需 mapSize + cellSize）。
 */
export function normalizeTrees(def: LevelMapDef): MapTree[] {
  const out: MapTree[] = [];
  const seenIds = new Set<string>();

  for (const raw of def.trees) {
    const t = coerceTree(raw, def);
    if (!t) continue;
    // 不再使用静态松树
    if (treeKindOf(t) === 'pine') continue;
    if (!isOnLand(t.x, t.y, def, 0)) continue;
    const id = treeIdOf(t);
    if (seenIds.has(id)) continue;

    // 近距去重（任意点放置时避免完全重叠）
    let tooClose = false;
    for (const o of out) {
      const dx = o.x - t.x;
      const dy = o.y - t.y;
      if (dx * dx + dy * dy < TREE_DEDUP_DIST2) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;

    seenIds.add(id);
    out.push({
      x: t.x,
      y: t.y,
      kind: 'harvest',
      id,
    });
  }
  return out;
}

/** 兼容旧格子树 / 新世界坐标树 */
function coerceTree(raw: MapTree | Record<string, unknown>, def: LevelMapDef): MapTree | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  if (typeof o.x === 'number' && typeof o.y === 'number') {
    return {
      x: o.x,
      y: o.y,
      kind: o.kind === 'pine' || o.kind === 'harvest' ? o.kind : undefined,
      id: typeof o.id === 'string' ? o.id : undefined,
    };
  }

  // 旧格式 { c, r }
  if (typeof o.c === 'number' && typeof o.r === 'number') {
    const legacy = def as LevelMapDef & { cellSize?: number };
    const cell = Math.max(1, legacy.cellSize ?? 36);
    const half = def.mapSize / 2;
    const x = -half + Math.floor(o.c) * cell + cell / 2;
    const y = -half + Math.floor(o.r) * cell + cell / 2;
    return {
      x,
      y,
      kind: o.kind === 'pine' || o.kind === 'harvest' ? o.kind : undefined,
      id: typeof o.id === 'string' ? o.id : undefined,
    };
  }

  return null;
}

export type TreeObstacle = {
  x: number;
  y: number;
  r: number;
  /** 树 id，便于砍伐 / 上帝模式删除 */
  id: string;
};

/** 由地图树生成 solid 圆列表 */
export function buildTreeObstacles(def: LevelMapDef): TreeObstacle[] {
  const out: TreeObstacle[] = [];
  for (const t of normalizeTrees(def)) {
    out.push({
      x: t.x,
      y: t.y,
      r: TREE_SOLID_R,
      id: treeIdOf(t),
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

export function removeRuntimeTreeObstacleById(id: string): void {
  runtimeTreeObstacles = runtimeTreeObstacles.filter((o) => o.id !== id);
}

/** @deprecated 使用 removeRuntimeTreeObstacleById */
export function removeRuntimeTreeObstacleAtCell(
  _def: LevelMapDef,
  _c: number,
  _r: number,
): void {
  /* no-op：格子模型已移除 */
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

/** 运行时追加一棵树 solid（上帝模式放置） */
export function addRuntimeTreeObstacle(obs: TreeObstacle): void {
  runtimeTreeObstacles = runtimeTreeObstacles.filter((o) => o.id !== obs.id);
  runtimeTreeObstacles.push({ ...obs });
}

export function isSpawnValid(def: LevelMapDef): boolean {
  return isOnLand(def.spawn.x, def.spawn.y, def, 8);
}

export function cloneLevelDef(def: LevelMapDef): LevelMapDef {
  return {
    id: def.id,
    mapSize: def.mapSize,
    seaMargin: seaMarginPx(def),
    spawn: { x: def.spawn.x, y: def.spawn.y },
    trees: normalizeTrees(def).map((t) => ({
      x: t.x,
      y: t.y,
      kind: t.kind,
      id: t.id,
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
    seaMargin?: number;
  } = {},
): LevelMapDef {
  const mapSize = options.mapSize ?? 2880;
  const seaMargin = options.seaMargin ?? 0;
  return {
    id,
    mapSize,
    seaMargin,
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
