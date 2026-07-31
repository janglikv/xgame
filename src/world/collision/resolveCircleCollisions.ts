import type { CircleBody } from './CircleBody';

/**
 * 二维圆-圆位置校正（地面 XZ）。
 *
 * 策略：
 * - 静态建筑 / 本帧未移动的单位视为锚定，不被挤走
 * - 移动体撞锚定体：只推开移动体
 * - 双方都在移动：各退一半
 * - 双方都锚定但仍重叠（出生重叠等）：各退一半以免卡死
 */
export function resolveCircleCollisions(
  bodies: readonly CircleBody[],
  iterations = 4,
): void {
  const n = bodies.length;
  if (n < 2) return;

  for (const body of bodies) {
    body.beginMotionFrame();
  }

  for (let iter = 0; iter < iterations; iter += 1) {
    for (let i = 0; i < n; i += 1) {
      const a = bodies[i];
      for (let j = i + 1; j < n; j += 1) {
        const b = bodies[j];
        if (a.isStatic && b.isStatic) continue;

        let dx = b.x - a.x;
        let dz = b.z - a.z;
        let distSq = dx * dx + dz * dz;
        const minDist = a.radius + b.radius;
        if (distSq >= minDist * minDist) continue;

        let dist = Math.sqrt(distSq);
        if (dist < 1e-8) {
          // 完全重合时沿 X 推开，避免 NaN
          dx = 1;
          dz = 0;
          dist = 1;
        } else {
          dx /= dist;
          dz /= dist;
        }

        const overlap = minDist - dist;
        const aAnchored = a.isAnchored;
        const bAnchored = b.isAnchored;

        if (aAnchored && !bAnchored) {
          // A 静止/建筑：只把移动的 B 推出
          b.setXZ(b.x + dx * overlap, b.z + dz * overlap);
        } else if (bAnchored && !aAnchored) {
          // B 静止/建筑：只把移动的 A 推出
          a.setXZ(a.x - dx * overlap, a.z - dz * overlap);
        } else {
          // 双方都在动，或双方都锚定但重叠：各退一半
          const half = overlap * 0.5;
          if (!a.isStatic) {
            a.setXZ(a.x - dx * half, a.z - dz * half);
          }
          if (!b.isStatic) {
            b.setXZ(b.x + dx * half, b.z + dz * half);
          }
        }
      }
    }
  }

  for (const body of bodies) {
    body.endMotionFrame();
  }
}
