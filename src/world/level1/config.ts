/** 第一关可玩地图边长（米）：X 仍 20，+Z 另扩 10 给 Boss */
export const LEVEL1_MAP_SIZE = 20;
/** 半边长（X 仍 ∈ [−half, +half]） */
export const LEVEL1_MAP_HALF = LEVEL1_MAP_SIZE / 2;
/** +Z 方向额外空间（Boss 区） */
export const LEVEL1_BOSS_EXTEND_Z = 10;

export const LEVEL1_X_MIN = -LEVEL1_MAP_HALF;
export const LEVEL1_X_MAX = LEVEL1_MAP_HALF;
export const LEVEL1_Z_MIN = -LEVEL1_MAP_HALF;
export const LEVEL1_Z_MAX = LEVEL1_MAP_HALF + LEVEL1_BOSS_EXTEND_Z;
/** 可视地板相对围墙四边外延格数（1 格 = 1 米） */
export const LEVEL1_FLOOR_EXTEND = 10;
/**
 * 回程传送阵位置（须在可玩区内）。
 * 距 +X 边约 3m，与枢纽「边侧放置」风格一致。
 */
export const LEVEL1_PAD_X = 0;
export const LEVEL1_PAD_Z = -7;

/**
 * 进关/回关落地点：3×3 方围内、阵北侧开口（阵外、不贴墙）。
 */
export const LEVEL1_LANDING_OFFSET_X = 0;
export const LEVEL1_LANDING_OFFSET_Z = 1.6;
export const LEVEL1_LANDING_X = LEVEL1_PAD_X + LEVEL1_LANDING_OFFSET_X;
export const LEVEL1_LANDING_Z = LEVEL1_PAD_Z + LEVEL1_LANDING_OFFSET_Z;

/** 传送阵方围中心线（与 Floor.SPAWN_COVER_PATH 一致，围绕 x=0, z=-7） */
const COVER_X0 = -1.5;
const COVER_X1 = 1.5;
const COVER_Z0 = -8.5;
const COVER_Z1 = -5.5;
const COVER_HALF_T = 0.4;

/** 将坐标钳到第一关可站立区域（留半米边距） */
export function clampLevel1Position(
  x: number,
  z: number,
  margin = 0.5,
): { x: number; z: number } {
  return {
    x: Math.max(LEVEL1_X_MIN + margin, Math.min(LEVEL1_X_MAX - margin, x)),
    z: Math.max(LEVEL1_Z_MIN + margin, Math.min(LEVEL1_Z_MAX - margin, z)),
  };
}

/** 确保出生点在地图有效范围内 */
export function clampLevel1Spawn(
  x: number,
  z: number,
): { x: number; z: number } {
  return clampLevel1Position(x, z);
}

/** @deprecated 使用 LEVEL1_*；保留别名以免外部漏改 */
export const BLANK_MAP_SIZE = LEVEL1_MAP_SIZE;
export const BLANK_MAP_HALF = LEVEL1_MAP_HALF;
export const BLANK_FLOOR_EXTEND = LEVEL1_FLOOR_EXTEND;
export const BLANK_PAD_X = LEVEL1_PAD_X;
export const BLANK_PAD_Z = LEVEL1_PAD_Z;
export const clampBlankMapPosition = clampLevel1Position;
