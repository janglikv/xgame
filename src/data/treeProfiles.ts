import {
  TREE_BODY_PROFILE_ID,
  profileHurtR,
  profileSolidR,
} from './bodyProfiles';
import type { TreeSize } from './maps/types';

/**
 * 可砍树视觉 / 玩法档案。
 * 碰撞模板只有一份 `tree`（中树为 1×）；小/大树乘 bodyShapeScale。
 */
export type TreeSizeProfile = {
  /** 相对 drawPineLocal 的显示缩放 */
  scale: number;
  maxHp: number;
  woodDrop: number;
  /** 近战可砍距离（脚底→脚底） */
  interactR: number;
  hpBarY: number;
  hpBarW: number;
  tint: number;
};

/** 中树视觉 scale = 碰撞模板 1× 基准 */
export const TREE_MEDIUM_VISUAL_SCALE = 0.72;

function scaled(base: number, scale: number): number {
  return Math.max(1, Math.round((base * scale) / TREE_MEDIUM_VISUAL_SCALE));
}

function visualProfile(
  scale: number,
  extras: { maxHp: number; woodDrop: number; tint: number },
): TreeSizeProfile {
  return {
    scale,
    maxHp: extras.maxHp,
    woodDrop: extras.woodDrop,
    interactR: scaled(56, scale),
    hpBarY: -Math.round(108 * (scale / TREE_MEDIUM_VISUAL_SCALE)),
    hpBarW: scaled(36, scale),
    tint: extras.tint,
  };
}

export const TREE_SIZE_PROFILE: Record<TreeSize, TreeSizeProfile> = {
  sapling: visualProfile(0.38, {
    maxHp: 18,
    woodDrop: 1,
    tint: 0x8aaa62,
  }),
  medium: visualProfile(TREE_MEDIUM_VISUAL_SCALE, {
    maxHp: 36,
    woodDrop: 2,
    tint: 0x6a8a5a,
  }),
  large: visualProfile(1.55, {
    maxHp: 90,
    woodDrop: 5,
    tint: 0x547848,
  }),
};

/** 体型相对中树的碰撞形状缩放 */
export function treeBodyShapeScale(size: TreeSize): number {
  return TREE_SIZE_PROFILE[size].scale / TREE_MEDIUM_VISUAL_SCALE;
}

/** solid 半径：模板主圆 × 体型缩放 */
export function treeSolidR(size: TreeSize): number {
  return Math.max(
    1,
    Math.round(profileSolidR(TREE_BODY_PROFILE_ID) * treeBodyShapeScale(size)),
  );
}

/** hurt 近似半径：模板 × 体型缩放 */
export function treeHurtR(size: TreeSize): number {
  return Math.max(
    1,
    Math.round(profileHurtR(TREE_BODY_PROFILE_ID) * treeBodyShapeScale(size)),
  );
}

/** 各体型生长到下一阶段的时间（秒），null 表示已是最终期 */
export const TREE_GROWTH_TIME_SEC: Record<TreeSize, number | null> = {
  sapling: 80,
  medium: 140,
  large: null,
};

/** 各体型向四周播种树苗的间隔（秒），null 表示不扩散 */
export const TREE_SPREAD_TIME_SEC: Record<TreeSize, number | null> = {
  sapling: null,
  medium: 48,
  large: 32,
};

/** 一次扩散尝试的新树苗数量 */
export const TREE_SPREAD_ATTEMPTS: Record<TreeSize, number> = {
  sapling: 0,
  medium: 1,
  large: 2,
};

/** 新树苗相对母树的聚集落点（偏近，便于成片密林） */
export const TREE_SPREAD_RADIUS_MIN = 40;
export const TREE_SPREAD_RADIUS_MAX = 78;

/** 树木之间最小保护间距（世界像素），紧凑成林 */
export const TREE_MIN_SPACING = 38;

/** 场上树木数量上限 */
export const TREE_MAX_COUNT = 140;

/** 森林抱团庇护半径（世界像素） */
export const TREE_CLUSTER_RADIUS = 120;

/** 森林抱团加速倍率（有同伴时生长/播种更快，利于成林） */
export const TREE_CLUSTER_SPEEDUP = 1.55;

/** 空间网格边长（世界像素）；与最小间距同量级 */
export const TREE_GRID_CELL = 64;

/**
 * 生长/扩散/抱团逻辑分几片轮转（视觉仍可每帧）。
 * 树比草少，4 片足够摊平 O(邻居) 与 timer。
 */
export const TREE_LOGIC_SLICES = 4;

/** 屏外树不更新摇摆/插值的边距（世界像素） */
export const TREE_VIEW_CULL_MARGIN = 160;

/**
 * 树冠向上延伸的剔除垫量（世界像素）：脚底在镜头下方时冠层仍可能可见。
 * large * bake 约 150px 量级，略放宽。
 */
export const TREE_CANOPY_CULL_PAD = 180;

/** 树地图草稿合并写入间隔（秒） */
export const TREE_PERSIST_DEBOUNCE_SEC = 0.75;

/** 获取树的下一阶段体型 */
export function nextTreeSize(size: TreeSize): TreeSize | null {
  if (size === 'sapling') return 'medium';
  if (size === 'medium') return 'large';
  return null;
}

/** 获取树的上一阶段体型 */
export function prevTreeSize(size: TreeSize): TreeSize | null {
  if (size === 'large') return 'medium';
  if (size === 'medium') return 'sapling';
  return null;
}

