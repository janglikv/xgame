/** 第二关暂为空图：20×20 */
export const LEVEL2_MAP_SIZE = 20;
export const LEVEL2_MAP_HALF = LEVEL2_MAP_SIZE / 2;
export const LEVEL2_FLOOR_EXTEND = 10;

export const LEVEL2_X_MIN = -LEVEL2_MAP_HALF;
export const LEVEL2_X_MAX = LEVEL2_MAP_HALF;
export const LEVEL2_Z_MIN = -LEVEL2_MAP_HALF;
export const LEVEL2_Z_MAX = LEVEL2_MAP_HALF;

export const LEVEL2_PAD_X = 0;
export const LEVEL2_PAD_Z = -7;
export const LEVEL2_LANDING_X = LEVEL2_PAD_X;
export const LEVEL2_LANDING_Z = LEVEL2_PAD_Z + 1.6;

export function clampLevel2Position(
  x: number,
  z: number,
  margin = 0.5,
): { x: number; z: number } {
  return {
    x: Math.max(LEVEL2_X_MIN + margin, Math.min(LEVEL2_X_MAX - margin, x)),
    z: Math.max(LEVEL2_Z_MIN + margin, Math.min(LEVEL2_Z_MAX - margin, z)),
  };
}
