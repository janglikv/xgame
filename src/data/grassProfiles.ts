import type { GrassSize } from './maps/types';

/** 草地视觉档案（草不需要碰撞体） */
export type GrassSizeProfile = {
  /** 相对 drawGrassLocal 的显示缩放 */
  scale: number;
  tint: number;
};

/** 中草视觉 scale */
export const GRASS_MEDIUM_VISUAL_SCALE = 0.85;

export const GRASS_SIZE_PROFILE: Record<GrassSize, GrassSizeProfile> = {
  small: {
    scale: 0.5,
    tint: 0x8ecf68,
  },
  medium: {
    scale: GRASS_MEDIUM_VISUAL_SCALE,
    tint: 0x66bb48,
  },
  large: {
    scale: 1.35,
    tint: 0x4f9e34,
  },
};

export function grassBodyShapeScale(size: GrassSize): number {
  return GRASS_SIZE_PROFILE[size].scale / GRASS_MEDIUM_VISUAL_SCALE;
}

/** 各体型生长到下一阶段的时间（秒），null 表示已是最终期 */
export const GRASS_GROWTH_TIME_SEC: Record<GrassSize, number | null> = {
  small: 8,
  medium: 14,
  large: null,
};

/** 各体型向四周播种的间隔（秒），null 表示不扩散 */
export const GRASS_SPREAD_TIME_SEC: Record<GrassSize, number | null> = {
  small: 14,
  medium: 10,
  large: 6,
};

/** 一次扩散尝试的新草数量（按体型） */
export const GRASS_SPREAD_ATTEMPTS: Record<GrassSize, number> = {
  small: 1,
  medium: 2,
  large: 3,
};

/** 新草相对母株的距离（世界像素）：播种距离大幅拉远 (80~220px) */
export const GRASS_SPREAD_RADIUS_MIN = 80;
export const GRASS_SPREAD_RADIUS_MAX = 220;

/** 草丛之间最小间距（世界像素）：拉大至 48px，严格控制密度避免过密挤作一团 */
export const GRASS_MIN_SPACING = 48;

/** 树木对草的遮荫/养分竞争死区基础半径（按树体型：小树 48 / 中树 72 / 大树 110） */
export const TREE_GRASS_COMPETITION_RADIUS: Record<string, number> = {
  sapling: 48,
  medium: 72,
  large: 110,
};

/** 各体型基础自然寿命（秒） */
export const GRASS_LIFESPAN_BASE_SEC: Record<GrassSize, number> = {
  small: 75,
  medium: 120,
  large: 180,
};

/** 过密判定检测半径（世界像素） */
export const GRASS_OVERCROWD_CHECK_RADIUS = 90;

/** 半径内邻居草超过此数量时，判定为过密并加速枯萎 */
export const GRASS_OVERCROWD_MAX_NEIGHBORS = 5;

/**
 * 判定「绿地」时相对海岸的内缩（世界像素）。
 * 金沙滩约在岸线内侧 ~96px，小于此距离的位置为沙滩/海岸。
 */
export const GRASS_GREEN_LAND_MARGIN = 96;

/** 场上草丛数量上限，防止无限膨胀拖垮性能 */
export const GRASS_MAX_COUNT = 1200;

/** 获取草的下一阶段体型 */
export function nextGrassSize(size: GrassSize): GrassSize | null {
  if (size === 'small') return 'medium';
  if (size === 'medium') return 'large';
  return null;
}

/** 被啃后体型降一级；已是小草则保持 small（不消失） */
export function prevGrassSize(size: GrassSize): GrassSize | null {
  if (size === 'large') return 'medium';
  if (size === 'medium') return 'small';
  return null;
}
