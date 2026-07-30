import type { CircleBody } from './CircleBody';

/**
 * 将动态圆体限制在地板可走区域内，圆心考虑半径后不越界。
 * 静态体（防御塔等）不动。
 *
 * 默认仅夹紧 Z（兵线两侧），避免单位被追击/碰撞推出地板。
 * X 方向两端留给出生点与 isOffField 回收，不强制夹紧。
 */
export function clampBodiesToFloor(
  bodies: readonly CircleBody[],
  options: {
    halfZ: number;
    /** 若提供则同时夹紧 X；默认不夹 */
    halfX?: number;
  },
): void {
  const { halfZ, halfX } = options;

  for (const body of bodies) {
    if (body.isStatic) continue;

    let x = body.x;
    let z = body.z;
    let changed = false;

    const zMin = -halfZ + body.radius;
    const zMax = halfZ - body.radius;
    if (z < zMin) {
      z = zMin;
      changed = true;
    } else if (z > zMax) {
      z = zMax;
      changed = true;
    }

    if (halfX != null) {
      const xMin = -halfX + body.radius;
      const xMax = halfX - body.radius;
      if (x < xMin) {
        x = xMin;
        changed = true;
      } else if (x > xMax) {
        x = xMax;
        changed = true;
      }
    }

    if (changed) body.setXZ(x, z);
  }
}
