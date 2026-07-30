import type { CircleBody } from './CircleBody';

/**
 * 二维圆-圆位置校正（地面 XZ）。
 * 静态体不动，动态体被推开；双方皆动态时各退一半。
 */
export function resolveCircleCollisions(
  bodies: readonly CircleBody[],
  iterations = 4,
): void {
  const n = bodies.length;
  if (n < 2) return;

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

        if (a.isStatic) {
          b.setXZ(b.x + dx * overlap, b.z + dz * overlap);
        } else if (b.isStatic) {
          a.setXZ(a.x - dx * overlap, a.z - dz * overlap);
        } else {
          const half = overlap * 0.5;
          a.setXZ(a.x - dx * half, a.z - dz * half);
          b.setXZ(b.x + dx * half, b.z + dz * half);
        }
      }
    }
  }
}
