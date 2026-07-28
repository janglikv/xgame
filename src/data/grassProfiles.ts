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

/** 获取草的下一阶段体型 */
export function nextGrassSize(size: GrassSize): GrassSize | null {
  if (size === 'small') return 'medium';
  if (size === 'medium') return 'large';
  return null;
}
