/**
 * 脚底圆形实体碰撞（俯视地面平面）。
 * 圆心 = 世界坐标脚底；半径为地面占位，不含立绘上半身。
 */

import type { Vec2 } from '../utils/math';

export type { Vec2 };

/** 两圆是否重叠（含贴边：中心距 < rA+rB） */
export function circlesOverlap(
  ax: number,
  ay: number,
  ar: number,
  bx: number,
  by: number,
  br: number,
): boolean {
  const dx = ax - bx;
  const dy = ay - by;
  const minDist = Math.max(0, ar) + Math.max(0, br);
  return dx * dx + dy * dy < minDist * minDist;
}

/**
 * 将圆 A 从静止圆 B 中推出（B 不动）。
 * 无重叠时原样返回；圆心重合时沿 +X 推开。
 */
export function pushCircleOut(
  ax: number,
  ay: number,
  ar: number,
  bx: number,
  by: number,
  br: number,
): Vec2 {
  const minDist = Math.max(0, ar) + Math.max(0, br);
  if (minDist <= 0) return { x: ax, y: ay };

  const dx = ax - bx;
  const dy = ay - by;
  const distSq = dx * dx + dy * dy;

  if (distSq >= minDist * minDist) {
    return { x: ax, y: ay };
  }

  if (distSq < 1e-10) {
    return { x: bx + minDist, y: by };
  }

  const dist = Math.sqrt(distSq);
  const scale = minDist / dist;
  return {
    x: bx + dx * scale,
    y: by + dy * scale,
  };
}

/**
 * 依次把动圆从多个静止障碍圆中推出。
 * 多障碍时做少量迭代，减轻「推出 A 又叠进 B」的残留重叠。
 */
export function pushCircleOutMany(
  x: number,
  y: number,
  radius: number,
  obstacles: ReadonlyArray<{ x: number; y: number; r: number }>,
  iterations = 2,
): Vec2 {
  let cx = x;
  let cy = y;
  if (obstacles.length === 0 || radius < 0) return { x: cx, y: cy };

  const iters = Math.max(1, iterations);
  for (let i = 0; i < iters; i++) {
    let moved = false;
    for (const o of obstacles) {
      const next = pushCircleOut(cx, cy, radius, o.x, o.y, o.r);
      if (next.x !== cx || next.y !== cy) {
        cx = next.x;
        cy = next.y;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return { x: cx, y: cy };
}

/**
 * 两圆分离。weightA ∈ [0,1] 为 A 承担的位移比例：
 * - 0：只推 B（A 挤走 B）
 * - 1：只推 A（B 为墙）
 * - 0.5：对半挤开
 */
export function separateCircles(
  ax: number,
  ay: number,
  ar: number,
  bx: number,
  by: number,
  br: number,
  weightA = 0.5,
): { ax: number; ay: number; bx: number; by: number } {
  const minDist = Math.max(0, ar) + Math.max(0, br);
  if (minDist <= 0) {
    return { ax, ay, bx, by };
  }

  let dx = ax - bx;
  let dy = ay - by;
  let distSq = dx * dx + dy * dy;

  if (distSq >= minDist * minDist) {
    return { ax, ay, bx, by };
  }

  const wA = Math.min(1, Math.max(0, weightA));
  const wB = 1 - wA;

  if (distSq < 1e-10) {
    // 同心：沿 +X 分开
    return {
      ax: ax + minDist * wA,
      ay,
      bx: bx - minDist * wB,
      by,
    };
  }

  const dist = Math.sqrt(distSq);
  const overlap = minDist - dist;
  const nx = dx / dist;
  const ny = dy / dist;
  return {
    ax: ax + nx * overlap * wA,
    ay: ay + ny * overlap * wA,
    bx: bx - nx * overlap * wB,
    by: by - ny * overlap * wB,
  };
}
