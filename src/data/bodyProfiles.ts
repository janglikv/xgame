/**
 * 碰撞体 / 受击体配置（权威默认值）。
 * 编辑器导出应整段替换本文件中的 BODY_PROFILES。
 *
 * 坐标：相对脚底 worldX/Y 的世界像素偏移（oy 向上为负）。
 * solid / hurt 均为形状数组，可多圆 + 多矩形组合。
 *
 * BodyProfileId = 角色 + 敌人 kind + 环境模板。
 * 敌人与 kind 同名；新增 ENEMY_KINDS 后本文件会因 Record 缺 key 报错，需补默认条目。
 */

import { CHARACTER_IDS, type CharacterId } from '../entities/types';
import { ENEMY_KINDS, type EnemyKind } from './maps/types';

/** 环境碰撞模板（非 EnemyKind） */
export const ENV_BODY_PROFILE_IDS = ['tree', 'apple-tree', 'grass'] as const;
export type EnvBodyProfileId = (typeof ENV_BODY_PROFILE_IDS)[number];

/**
 * 与实体种类 / 环境模板一一对应的模板 id（编的是类型，不是场上实例）。
 * 角色 CharacterId · 敌人 EnemyKind · 环境 EnvBodyProfileId。
 */
export type BodyProfileId = CharacterId | EnemyKind | EnvBodyProfileId;

/** 圆形：圆心 = 脚底 + (ox, oy) */
export type CircleShape = {
  type: 'circle';
  ox: number;
  oy: number;
  r: number;
};

/** 轴对齐矩形：中心 = 脚底 + (ox, oy) */
export type RectShape = {
  type: 'rect';
  ox: number;
  oy: number;
  w: number;
  h: number;
};

export type BodyShape = CircleShape | RectShape;

export type BodyProfile = {
  id: BodyProfileId;
  /** 中文显示名 */
  label: string;
  /** 碰撞体（挡树 / 互挤）；可多样 */
  solid: BodyShape[];
  /** 受击体（武器命中）；可多样，命中任一即可 */
  hurt: BodyShape[];
};

/** 仓库内默认配置（碰撞编辑器导出） */
export const BODY_PROFILES: Record<BodyProfileId, BodyProfile> = {
  'bomb-girl': {
    id: 'bomb-girl',
    label: '炸炸',
    solid: [{ type: 'circle', ox: 0.21, oy: -9.42, r: 18 }],
    hurt: [
      { type: 'circle', ox: 0.5, oy: -35.99, r: 20.15 },
      { type: 'circle', ox: -0.52, oy: -14.09, r: 18.71 },
    ],
  },
  'ice-ranger': {
    id: 'ice-ranger',
    label: '冰冰',
    solid: [{ type: 'circle', ox: 0.2, oy: -12.78, r: 19.4 }],
    hurt: [
      { type: 'circle', ox: -2.44, oy: -32.09, r: 22 },
      { type: 'circle', ox: 0, oy: -11.42, r: 20 },
    ],
  },
  spider: {
    id: 'spider',
    label: '蜘蛛',
    solid: [{ type: 'circle', ox: -3.11, oy: -18.7, r: 23.06 }],
    hurt: [{ type: 'circle', ox: -1.67, oy: -22.58, r: 29.76 }],
  },
  'flame-flower': {
    id: 'flame-flower',
    label: '火焰花',
    solid: [{ type: 'circle', ox: -6.25, oy: -17.95, r: 20 }],
    hurt: [
      { type: 'circle', ox: -7.56, oy: -17.33, r: 24 },
      { type: 'circle', ox: -11.59, oy: -50.19, r: 23.77 },
    ],
  },
  'wooden-dummy': {
    id: 'wooden-dummy',
    label: '木桩',
    solid: [{ type: 'circle', ox: 0.47, oy: -11.86, r: 11.21 }],
    hurt: [
      { type: 'rect', ox: 0, oy: -40.45, w: 21.31, h: 73.35 },
      { type: 'rect', ox: 0.8, oy: -44.47, w: 50.49, h: 8.51 },
    ],
  },
  chicken: {
    id: 'chicken',
    label: '鸡',
    solid: [{ type: 'circle', ox: 0, oy: -8, r: 10 }],
    hurt: [{ type: 'circle', ox: 0, oy: -12, r: 14 }],
  },
  pig: {
    id: 'pig',
    label: '猪',
    solid: [{ type: 'circle', ox: -2.44, oy: -32.15, r: 21.2 }],
    hurt: [{ type: 'circle', ox: 1.06, oy: -45.93, r: 28 }],
  },
  cow: {
    id: 'cow',
    label: '牛',
    solid: [{ type: 'circle', ox: -1.26, oy: -22.76, r: 22.75 }],
    hurt: [
      { type: 'circle', ox: -2.99, oy: -39.54, r: 32 },
      { type: 'circle', ox: 22.63, oy: -69.55, r: 23.16 },
    ],
  },
  horse: {
    id: 'horse',
    label: '马',
    solid: [{ type: 'circle', ox: -6.71, oy: -20.23, r: 24.31 }],
    hurt: [
      { type: 'circle', ox: -5.88, oy: -38.62, r: 34.6 },
      { type: 'circle', ox: 26.41, oy: -88.89, r: 25.39 },
    ],
  },
  wolf: {
    id: 'wolf',
    label: '狼',
    solid: [{ type: 'circle', ox: 2, oy: -9.25, r: 13.22 }],
    hurt: [{ type: 'circle', ox: 4.32, oy: -21.01, r: 21.14 }],
  },
  bear: {
    id: 'bear',
    label: '熊',
    solid: [{ type: 'circle', ox: 0, oy: -20, r: 34 }],
    hurt: [{ type: 'circle', ox: 0, oy: -28, r: 42 }],
  },
  tree: {
    id: 'tree',
    label: '树',
    solid: [{ type: 'circle', ox: -0.16, oy: -8.54, r: 11.05 }],
    hurt: [{ type: 'circle', ox: 0, oy: -18, r: 22 }],
  },
  'apple-tree': {
    id: 'apple-tree',
    label: '苹果树',
    solid: [{ type: 'circle', ox: -0.31, oy: -10.92, r: 11.05 }],
    hurt: [{ type: 'circle', ox: 0, oy: -18, r: 22 }],
  },
  grass: {
    id: 'grass',
    label: '草地',
    solid: [],
    hurt: [],
  },
};

/** 运行时覆盖（编辑器本局，不写盘） */
const overrides = new Map<BodyProfileId, BodyProfile>();

/**
 * 有序列表：角色 → 敌人（= ENEMY_KINDS）→ 环境。
 * 新增 ENEMY_KINDS / CHARACTER_IDS 会自动进入导出与遍历。
 */
export const BODY_PROFILE_IDS: readonly BodyProfileId[] = [
  ...CHARACTER_IDS,
  ...ENEMY_KINDS,
  ...ENV_BODY_PROFILE_IDS,
];

/** 松树碰撞模板 id */
export const TREE_BODY_PROFILE_ID: BodyProfileId = 'tree';

/** 苹果树碰撞模板 id */
export const APPLE_TREE_BODY_PROFILE_ID: BodyProfileId = 'apple-tree';

/** 按比例缩放形状（树体型用） */
export function scaleBodyShape(s: BodyShape, scale: number): BodyShape {
  if (scale === 1) return cloneShape(s);
  if (s.type === 'circle') {
    return {
      type: 'circle',
      ox: s.ox * scale,
      oy: s.oy * scale,
      r: Math.max(1, s.r * scale),
    };
  }
  return {
    type: 'rect',
    ox: s.ox * scale,
    oy: s.oy * scale,
    w: Math.max(1, s.w * scale),
    h: Math.max(1, s.h * scale),
  };
}

export function cloneShape(s: BodyShape): BodyShape {
  return s.type === 'circle' ? { ...s } : { ...s };
}

function cloneProfile(p: BodyProfile): BodyProfile {
  return {
    id: p.id,
    label: p.label,
    solid: p.solid.map(cloneShape),
    hurt: p.hurt.map(cloneShape),
  };
}

/** 生效配置：默认 ⊕ 本局 override */
export function getBodyProfile(id: BodyProfileId): BodyProfile {
  const base = BODY_PROFILES[id];
  const over = overrides.get(id);
  if (!over) return cloneProfile(base);
  return cloneProfile(over);
}

export function hasBodyProfileOverride(id: BodyProfileId): boolean {
  return overrides.has(id);
}

export function hasAnyBodyProfileOverride(): boolean {
  return overrides.size > 0;
}

export function setBodyProfileOverride(profile: BodyProfile): void {
  overrides.set(profile.id, cloneProfile(profile));
}

export function clearBodyProfileOverride(id: BodyProfileId): void {
  overrides.delete(id);
}

export function clearAllBodyProfileOverrides(): void {
  overrides.clear();
}

export function getAllEffectiveBodyProfiles(): Record<
  BodyProfileId,
  BodyProfile
> {
  const out = {} as Record<BodyProfileId, BodyProfile>;
  for (const id of BODY_PROFILE_IDS) {
    out[id] = getBodyProfile(id);
  }
  return out;
}

/** 形状 → 用于物理的圆近似 */
export function shapeAsCircle(s: BodyShape): CircleShape {
  if (s.type === 'circle') return { ...s };
  return {
    type: 'circle',
    ox: s.ox,
    oy: s.oy,
    r: Math.max(4, Math.hypot(s.w * 0.5, s.h * 0.5)),
  };
}

/**
 * 主 solid 圆（移动 / 树挡用）：优先第一个圆，否则第一形状的外接圆。
 */
export function primarySolidCircle(id: BodyProfileId): CircleShape {
  const solids = getBodyProfile(id).solid;
  if (solids.length === 0) {
    return { type: 'circle', ox: 0, oy: 0, r: 16 };
  }
  const firstCircle = solids.find((s) => s.type === 'circle');
  if (firstCircle && firstCircle.type === 'circle') return { ...firstCircle };
  return shapeAsCircle(solids[0]!);
}

/** solid 半径快捷（主圆） */
export function profileSolidR(id: BodyProfileId): number {
  return primarySolidCircle(id).r;
}

/** 主 solid 偏移 */
export function profileSolidOffset(id: BodyProfileId): {
  ox: number;
  oy: number;
} {
  const c = primarySolidCircle(id);
  return { ox: c.ox, oy: c.oy };
}

/**
 * 全部 solid 圆（世界脚底下），用于互推障碍。
 * 矩形用外接圆近似。
 */
export function solidCirclesAtFeet(
  feetX: number,
  feetY: number,
  id: BodyProfileId,
): Array<{ x: number; y: number; r: number }> {
  const solids = getBodyProfile(id).solid;
  if (solids.length === 0) {
    return [{ x: feetX, y: feetY, r: 16 }];
  }
  return solids.map((s) => {
    const c = shapeAsCircle(s);
    return {
      x: feetX + c.ox,
      y: feetY + c.oy,
      r: Math.max(1, c.r),
    };
  });
}

/**
 * 受击近似半径（扑咬粗判等）：取所有 hurt 外接半径最大值。
 */
export function profileHurtR(id: BodyProfileId): number {
  const hurts = getBodyProfile(id).hurt;
  if (hurts.length === 0) return 0;
  let max = 0;
  for (const h of hurts) {
    const r = h.type === 'circle' ? h.r : Math.hypot(h.w * 0.5, h.h * 0.5);
    if (r > max) max = r;
  }
  return max;
}

/** 第一 hurt 中心偏移 */
export function profileHurtOffset(id: BodyProfileId): {
  ox: number;
  oy: number;
} {
  const h = getBodyProfile(id).hurt[0];
  if (!h) return { ox: 0, oy: 0 };
  return { ox: h.ox, oy: h.oy };
}

export function hurtCenterFromFeet(
  feetX: number,
  feetY: number,
  id: BodyProfileId,
): { x: number; y: number } {
  const o = profileHurtOffset(id);
  return { x: feetX + o.ox, y: feetY + o.oy };
}

function circleHitsShape(
  ax: number,
  ay: number,
  ar: number,
  feetX: number,
  feetY: number,
  s: BodyShape,
): boolean {
  const cx = feetX + s.ox;
  const cy = feetY + s.oy;
  if (s.type === 'circle') {
    const rr = ar + Math.max(0, s.r);
    const dx = ax - cx;
    const dy = ay - cy;
    return dx * dx + dy * dy <= rr * rr;
  }
  const hw = s.w * 0.5;
  const hh = s.h * 0.5;
  const closestX = Math.max(cx - hw, Math.min(ax, cx + hw));
  const closestY = Math.max(cy - hh, Math.min(ay, cy + hh));
  const dx = ax - closestX;
  const dy = ay - closestY;
  const r = Math.max(0, ar);
  return dx * dx + dy * dy <= r * r;
}

function distancePastShape(
  ax: number,
  ay: number,
  feetX: number,
  feetY: number,
  s: BodyShape,
): number {
  const cx = feetX + s.ox;
  const cy = feetY + s.oy;
  if (s.type === 'circle') {
    return Math.max(0, Math.hypot(ax - cx, ay - cy) - Math.max(0, s.r));
  }
  const hw = s.w * 0.5;
  const hh = s.h * 0.5;
  const inside =
    ax >= cx - hw && ax <= cx + hw && ay >= cy - hh && ay <= cy + hh;
  if (inside) return 0;
  const closestX = Math.max(cx - hw, Math.min(ax, cx + hw));
  const closestY = Math.max(cy - hh, Math.min(ay, cy + hh));
  return Math.hypot(ax - closestX, ay - closestY);
}

/**
 * 圆攻击体是否命中目标任意 hurt 形状。
 * @param shapeScale 形状整体缩放（树体型：相对中树）
 */
export function circleHitsHurt(
  ax: number,
  ay: number,
  ar: number,
  feetX: number,
  feetY: number,
  id: BodyProfileId,
  shapeScale = 1,
): boolean {
  const hurts = getBodyProfile(id).hurt;
  if (hurts.length === 0) {
    const r = Math.max(0, ar);
    const dx = ax - feetX;
    const dy = ay - feetY;
    return dx * dx + dy * dy <= r * r;
  }
  for (const h of hurts) {
    const shape = scaleBodyShape(h, shapeScale);
    if (circleHitsShape(ax, ay, ar, feetX, feetY, shape)) return true;
  }
  return false;
}

/**
 * 爆炸：到 hurt 表面的最短内距（多形状取最小）。
 * @param shapeScale 形状整体缩放（树体型：相对中树）
 */
export function distancePastHurt(
  ax: number,
  ay: number,
  feetX: number,
  feetY: number,
  id: BodyProfileId,
  shapeScale = 1,
): number {
  const hurts = getBodyProfile(id).hurt;
  if (hurts.length === 0) {
    return Math.hypot(ax - feetX, ay - feetY);
  }
  let best = Infinity;
  for (const h of hurts) {
    const shape = scaleBodyShape(h, shapeScale);
    const d = distancePastShape(ax, ay, feetX, feetY, shape);
    if (d < best) best = d;
  }
  return best;
}
