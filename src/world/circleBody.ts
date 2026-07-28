/**
 * 脚底圆形实体碰撞（俯视地面平面）。
 * 圆心 = 世界坐标脚底；半径为地面占位，不含立绘上半身。
 */

import type { Vec2 } from '../utils/math';

export type { Vec2 };

export type CircleObstacle = { x: number; y: number; r: number };

/** 贴边皮肤：略大于 0，避免下一帧立刻再穿入 */
const SLIDE_SKIN = 0.08;
/** 滑动次数：多圆拐角时连续沿切线滑 */
const SLIDE_MAX = 4;

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

/** 动圆是否与任一障碍重叠（含 skin） */
export function circleHitsAny(
  x: number,
  y: number,
  radius: number,
  obstacles: ReadonlyArray<CircleObstacle>,
  skin = 0,
): boolean {
  const r = Math.max(0, radius) + Math.max(0, skin);
  for (const o of obstacles) {
    const dx = x - o.x;
    const dy = y - o.y;
    const lim = r + Math.max(0, o.r);
    if (dx * dx + dy * dy < lim * lim) return true;
  }
  return false;
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
  obstacles: ReadonlyArray<CircleObstacle>,
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

type SegmentHit = {
  /** 线段参数 [0,1] */
  t: number;
  /** 接触时圆心（已含 skin 外推） */
  x: number;
  y: number;
  /** 障碍 → 动圆心的单位法线 */
  nx: number;
  ny: number;
};

/**
 * 动圆中心沿 from→to 扫掠，求与静态圆障碍的最早接触。
 * 起点已重叠时返回 t=0 并给出脱困法线。
 */
function firstCircleHitAlongSegment(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  radius: number,
  obstacles: ReadonlyArray<CircleObstacle>,
  skin: number,
): SegmentHit | null {
  const rMove = Math.max(0, radius) + Math.max(0, skin);
  const dx = toX - fromX;
  const dy = toY - fromY;
  const a = dx * dx + dy * dy;

  let best: SegmentHit | null = null;

  for (const o of obstacles) {
    const R = rMove + Math.max(0, o.r);
    if (R <= 0) continue;

    const fx = fromX - o.x;
    const fy = fromY - o.y;
    const c = fx * fx + fy * fy - R * R;

    // 起点已在圆内 / 贴边：t=0
    if (c < 0) {
      const distSq = fx * fx + fy * fy;
      let nx: number;
      let ny: number;
      if (distSq < 1e-10) {
        nx = 1;
        ny = 0;
      } else {
        const inv = 1 / Math.sqrt(distSq);
        nx = fx * inv;
        ny = fy * inv;
      }
      if (!best || 0 < best.t) {
        best = {
          t: 0,
          x: o.x + nx * R,
          y: o.y + ny * R,
          nx,
          ny,
        };
      }
      continue;
    }

    if (a < 1e-12) continue;

    const b = 2 * (fx * dx + fy * dy);
    // 远离且未进入：b>=0 且 c>=0 时最近距离在起点之后方向上增大
    const disc = b * b - 4 * a * c;
    if (disc < 0) continue;

    const sqrtDisc = Math.sqrt(disc);
    // 较早根（进入）
    const tEnter = (-b - sqrtDisc) / (2 * a);
    if (tEnter < 0 || tEnter > 1) continue;

    if (best && tEnter >= best.t) continue;

    const hx = fromX + dx * tEnter;
    const hy = fromY + dy * tEnter;
    const nx0 = hx - o.x;
    const ny0 = hy - o.y;
    const nLen = Math.hypot(nx0, ny0);
    let nx: number;
    let ny: number;
    if (nLen < 1e-8) {
      nx = 1;
      ny = 0;
    } else {
      nx = nx0 / nLen;
      ny = ny0 / nLen;
    }
    best = {
      t: tEnter,
      x: o.x + nx * R,
      y: o.y + ny * R,
      nx,
      ny,
    };
  }

  return best;
}

/**
 * 圆形角色从 from 移向 to：遇静态圆障碍时沿切线滑动（可绕开）。
 * 比轴分离更适合圆-圆，斜向贴树不会整段卡死。
 */
export function slideCircle(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  radius: number,
  obstacles: ReadonlyArray<CircleObstacle>,
  maxSlides = SLIDE_MAX,
): Vec2 {
  if (obstacles.length === 0) return { x: toX, y: toY };

  const r = Math.max(0, radius);
  const skin = SLIDE_SKIN;

  // 起点卡进障碍：先径向脱出，避免整段滑动失效
  let px = fromX;
  let py = fromY;
  if (circleHitsAny(px, py, r, obstacles, skin)) {
    const freed = pushCircleOutMany(px, py, r + skin, obstacles, 4);
    px = freed.x;
    py = freed.y;
  }

  // 从当前（可能已脱困）点指向原目标
  let mx = toX - px;
  let my = toY - py;

  const slides = Math.max(1, maxSlides);
  for (let i = 0; i < slides; i++) {
    const mLen = Math.hypot(mx, my);
    if (mLen < 1e-5) break;

    const tx = px + mx;
    const ty = py + my;

    if (!circleHitsAny(tx, ty, r, obstacles, skin)) {
      px = tx;
      py = ty;
      break;
    }

    const hit = firstCircleHitAlongSegment(
      px,
      py,
      tx,
      ty,
      r,
      obstacles,
      skin,
    );

    if (!hit) {
      // 终点穿入但扫掠未命中（数值边界）：终点推出
      const pushed = pushCircleOutMany(tx, ty, r + skin, obstacles, 4);
      px = pushed.x;
      py = pushed.y;
      break;
    }

    // 移到接触面
    px = hit.x;
    py = hit.y;

    // 剩余位移去掉法向分量 → 切向滑行
    const remain = 1 - hit.t;
    let rx = mx * remain;
    let ry = my * remain;
    const vn = rx * hit.nx + ry * hit.ny;
    if (vn < 0) {
      rx -= hit.nx * vn;
      ry -= hit.ny * vn;
    }
    mx = rx;
    my = ry;

    // 几乎只剩法向（正对障碍）→ 停下，避免微抖
    if (rx * rx + ry * ry < 1e-6) break;
  }

  // 最终再推一次，清多圆拐角残留重叠
  return pushCircleOutMany(px, py, r + skin, obstacles, 3);
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
