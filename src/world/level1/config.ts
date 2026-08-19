/** 第一关可玩地图边长（米）：外接正方形 20×20，切左右两角成六边形 */
export const LEVEL1_MAP_SIZE = 20;
/** 半边长（X/Z 均 ∈ [−half, +half]） */
export const LEVEL1_MAP_HALF = LEVEL1_MAP_SIZE / 2;
/** 沿边切除米数：切去屏幕左右两角，外墙变为六边形 */
export const LEVEL1_HEXAGON_CUT = LEVEL1_MAP_HALF;
/** +Z 方向额外空间（已移除 Boss 区） */
export const LEVEL1_BOSS_EXTEND_Z = 0;

export const LEVEL1_X_MIN = -LEVEL1_MAP_HALF;
export const LEVEL1_X_MAX = LEVEL1_MAP_HALF;
export const LEVEL1_Z_MIN = -LEVEL1_MAP_HALF;
export const LEVEL1_Z_MAX = LEVEL1_MAP_HALF;
/** 可视地板相对围墙四边外延格数（1 格 = 1 米） */
export const LEVEL1_FLOOR_EXTEND = 10;
/**
 * 回程传送阵位置（须在可玩区内）。
 * 位于屏幕正下方原血包位置 (-7.8, -7.8)。
 */
export const LEVEL1_PAD_X = -7.8;
export const LEVEL1_PAD_Z = -7.8;
/** 清理小怪后出现的通往第二关传送阵 */
export const LEVEL1_BOSS_EXIT_PAD_X = 0;
export const LEVEL1_BOSS_EXIT_PAD_Z = 7;

/**
 * 进关/回关落地点：3×3 方围内、阵北侧开口（阵外、不贴墙）。
 */
export const LEVEL1_LANDING_OFFSET_X = 0;
export const LEVEL1_LANDING_OFFSET_Z = 1.6;
export const LEVEL1_LANDING_X = LEVEL1_PAD_X + LEVEL1_LANDING_OFFSET_X;
export const LEVEL1_LANDING_Z = LEVEL1_PAD_Z + LEVEL1_LANDING_OFFSET_Z;

/** 将坐标钳到第一关可站立区域（六边形内，留半米边距） */
export function clampLevel1Position(
  x: number,
  z: number,
  margin = 0.5,
): { x: number; z: number } {
  let cx = Math.max(LEVEL1_X_MIN + margin, Math.min(LEVEL1_X_MAX - margin, x));
  let cz = Math.max(LEVEL1_Z_MIN + margin, Math.min(LEVEL1_Z_MAX - margin, z));
  const diagMargin = margin * Math.SQRT2;
  const minDiag =
    LEVEL1_X_MIN - LEVEL1_Z_MAX + LEVEL1_HEXAGON_CUT + diagMargin;
  const maxDiag =
    LEVEL1_X_MAX - LEVEL1_Z_MIN - LEVEL1_HEXAGON_CUT - diagMargin;
  const d = cx - cz;
  if (d < minDiag) {
    const corr = (minDiag - d) / 2;
    cx += corr;
    cz -= corr;
  } else if (d > maxDiag) {
    const corr = (d - maxDiag) / 2;
    cx -= corr;
    cz += corr;
  }
  return { x: cx, z: cz };
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
