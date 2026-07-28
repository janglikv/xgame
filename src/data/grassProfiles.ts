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
  small: 15,
  medium: 25,
  large: null,
};

/** 各体型向四周播种的间隔（秒），null 表示不扩散 */
export const GRASS_SPREAD_TIME_SEC: Record<GrassSize, number | null> = {
  small: 28,
  medium: 20,
  large: 12,
};

/** 一次扩散尝试的新草数量（按体型） */
export const GRASS_SPREAD_ATTEMPTS: Record<GrassSize, number> = {
  small: 1,
  medium: 2,
  large: 3,
};

/** 新草相对母株的距离（世界像素） */
export const GRASS_SPREAD_RADIUS_MIN = 30;
export const GRASS_SPREAD_RADIUS_MAX = 72;

/** 草丛之间最小间距（世界像素），避免叠成一团 */
export const GRASS_MIN_SPACING = 26;

/**
 * 判定「绿地」时相对海岸的内缩（世界像素）。
 * 金沙滩约在岸线内侧 ~96px，用此 margin 把新草限制在绿地上。
 */
export const GRASS_GREEN_LAND_MARGIN = 100;

/** 场上草丛数量上限，防止无限膨胀拖垮性能 */
export const GRASS_MAX_COUNT = 500;

/** 获取草的下一阶段体型 */
export function nextGrassSize(size: GrassSize): GrassSize | null {
  if (size === 'small') return 'medium';
  if (size === 'medium') return 'large';
  return null;
}
