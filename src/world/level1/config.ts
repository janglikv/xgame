/** 第一关可玩地图边长（米）：20×20 */
export const LEVEL1_MAP_SIZE = 20;
/** 半边长（X/Z ∈ [−half, +half]） */
export const LEVEL1_MAP_HALF = LEVEL1_MAP_SIZE / 2;
/** 可视地板相对围墙四边外延格数（1 格 = 1 米） */
export const LEVEL1_FLOOR_EXTEND = 10;
/**
 * 回程传送阵位置（须在 20×20 地图内）。
 * 距 +X 边约 3m，与枢纽「边侧放置」风格一致。
 */
export const LEVEL1_PAD_X = 7;
export const LEVEL1_PAD_Z = 0;

/**
 * 进关/回关落地点：3×3 方围内、阵西侧（阵外、不贴墙）。
 * 开口在 x=8，旧的 +X 1.2 / −Z 1.6 都会卡进墙体。
 */
export const LEVEL1_LANDING_OFFSET_X = -0.85;
export const LEVEL1_LANDING_OFFSET_Z = 0;
export const LEVEL1_LANDING_X = LEVEL1_PAD_X + LEVEL1_LANDING_OFFSET_X;
export const LEVEL1_LANDING_Z = LEVEL1_PAD_Z + LEVEL1_LANDING_OFFSET_Z;

/** 传送阵方围中心线（与 Floor.SPAWN_COVER_PATH 一致） */
const COVER_X0 = 5;
const COVER_X1 = 8;
const COVER_Z0 = -1.5;
const COVER_Z1 = 1.5;
const COVER_HALF_T = 0.4;

/** 将坐标钳到第一关可站立区域（留半米边距） */
export function clampLevel1Position(
  x: number,
  z: number,
  margin = 0.5,
): { x: number; z: number } {
  const lim = LEVEL1_MAP_HALF - margin;
  return {
    x: Math.max(-lim, Math.min(lim, x)),
    z: Math.max(-lim, Math.min(lim, z)),
  };
}

/** 出生点再避开方围墙体，防止卡墙被物理顶飞穿墙 */
export function clampLevel1Spawn(
  x: number,
  z: number,
): { x: number; z: number } {
  const c = clampLevel1Position(x, z);
  const inNorth =
    c.x >= COVER_X0 - COVER_HALF_T &&
    c.x <= COVER_X1 + COVER_HALF_T &&
    c.z >= COVER_Z1 - COVER_HALF_T &&
    c.z <= COVER_Z1 + COVER_HALF_T;
  const inSouth =
    c.x >= COVER_X0 - COVER_HALF_T &&
    c.x <= COVER_X1 + COVER_HALF_T &&
    c.z >= COVER_Z0 - COVER_HALF_T &&
    c.z <= COVER_Z0 + COVER_HALF_T;
  const inWest =
    c.x >= COVER_X0 - COVER_HALF_T &&
    c.x <= COVER_X0 + COVER_HALF_T &&
    c.z >= COVER_Z0 - COVER_HALF_T &&
    c.z <= COVER_Z1 + COVER_HALF_T;
  if (inNorth || inSouth || inWest) {
    return { x: LEVEL1_LANDING_X, z: LEVEL1_LANDING_Z };
  }
  return c;
}

/** @deprecated 使用 LEVEL1_*；保留别名以免外部漏改 */
export const BLANK_MAP_SIZE = LEVEL1_MAP_SIZE;
export const BLANK_MAP_HALF = LEVEL1_MAP_HALF;
export const BLANK_FLOOR_EXTEND = LEVEL1_FLOOR_EXTEND;
export const BLANK_PAD_X = LEVEL1_PAD_X;
export const BLANK_PAD_Z = LEVEL1_PAD_Z;
export const clampBlankMapPosition = clampLevel1Position;
