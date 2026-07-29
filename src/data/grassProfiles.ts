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
  small: 90,
  medium: 150,
  large: null,
};

/** 各体型向四周播种的间隔（秒），null 表示不扩散 */
export const GRASS_SPREAD_TIME_SEC: Record<GrassSize, number | null> = {
  small: 90,
  medium: 70,
  large: 55,
};

/** 一次扩散尝试的新草数量（按体型，控数量） */
export const GRASS_SPREAD_ATTEMPTS: Record<GrassSize, number> = {
  small: 1,
  medium: 1,
  large: 2,
};

/** 新草相对母株的距离（世界像素） */
export const GRASS_SPREAD_RADIUS_MIN = 90;
export const GRASS_SPREAD_RADIUS_MAX = 240;

/** 草丛之间最小间距（世界像素）；越小密度越高 */
export const GRASS_MIN_SPACING = 36;

/** 树木对草的遮荫/养分竞争死区基础半径（按树体型：小树 56 / 中树 90 / 大树 135） */
export const TREE_GRASS_COMPETITION_RADIUS: Record<string, number> = {
  sapling: 56,
  medium: 90,
  large: 135,
};

/**
 * 判定「绿地」时相对海岸的内缩（世界像素）。
 * 金沙滩约在岸线内侧 ~96px，小于此距离的位置为沙滩/海岸。
 */
export const GRASS_GREEN_LAND_MARGIN = 96;

/** 场上草丛数量上限（Sprite + 屏外剔除后可适当放宽） */
export const GRASS_MAX_COUNT = 3200;

/** 屏外草不更新摇摆的边距（世界像素，相对镜头可视区） */
export const GRASS_VIEW_CULL_MARGIN = 120;

/** 空间网格边长（世界像素）；约等于最小间距量级 */
export const GRASS_GRID_CELL = 64;

/**
 * 全景 LOD：currentZoom <= minZoom * 该倍率 → 草不合入角色深度排序。
 * 略大于 1，避免卡在最小缩放边缘来回切换。
 */
export const GRASS_FAR_LOD_ZOOM_MUL = 1.4;

/** 生长/扩散逻辑分几片轮转更新（视觉仍可每帧） */
export const GRASS_LOGIC_SLICES = 8;

/** 地图草稿合并写入间隔（秒） */
export const GRASS_PERSIST_DEBOUNCE_SEC = 0.75;

/** 牛马重锁定最近大草的间隔（秒） */
export const GRASS_ANIMAL_RETARGET_SEC = 0.28;

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
