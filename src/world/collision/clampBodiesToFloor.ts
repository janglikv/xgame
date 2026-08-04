import { DirtFloor } from '../DirtFloor';
import type { CircleBody } from './CircleBody';

type Pt = { x: number; z: number };

/** 与地板 / 围墙共用的外轮廓（懒加载缓存） */
let outlineCache: readonly Pt[] | null = null;

function getOutline(): readonly Pt[] {
  if (!outlineCache) {
    outlineCache = DirtFloor.getWalkableOutline().map((p) => ({
      x: p.x,
      z: p.z,
    }));
  }
  return outlineCache;
}

/**
 * 将动态圆体限制在地板可走区域内，圆心考虑半径后不越界。
 * 静态体（防御塔等）不动。
 *
 * 使用与围墙内侧完全相同的外轮廓：要求圆心到边界的内侧距离 ≥ radius，
 * 避免「走廊 / 八边形分段内缩」在接合处产生空气墙。
 */
export function clampBodiesToFloor(bodies: readonly CircleBody[]): void {
  for (const body of bodies) {
    if (body.isStatic) continue;
    const p = clampPointToWalkable(body.x, body.z, body.radius);
    if (p.x !== body.x || p.z !== body.z) {
      body.setXZ(p.x, p.z);
    }
  }
}

/**
 * 把点夹到「可走区向内至少 radius」内。
 * 用于点地移动目标、以及每帧物理夹紧。
 */
export function clampPointToWalkable(
  x: number,
  z: number,
  radius: number,
): { x: number; z: number } {
  const r = Math.max(0, radius);
  const outline = getOutline();
  const n = outline.length;
  if (n < 3) return { x, z };

  const inside = pointInPolygon(x, z, outline);
  const nearest = nearestOnPolygon(x, z, outline);

  // 到边界的有符号距离：内侧为正，外侧为负
  const signed = inside ? nearest.dist : -nearest.dist;

  // 已在安全区内
  if (signed >= r - 1e-9) {
    return { x, z };
  }

  // 需要推到距该边内侧恰好 r 处
  // 轮廓俯视顺时针：边前进方向的左侧 = 外侧，右侧 = 内侧
  const a = outline[nearest.i]!;
  const b = outline[(nearest.i + 1) % n]!;
  let edx = b.x - a.x;
  let edz = b.z - a.z;
  const elen = Math.hypot(edx, edz);
  if (elen < 1e-10) {
    // 退化边：沿指向多边形质心方向兜底
    return { x: nearest.x, z: nearest.z };
  }
  edx /= elen;
  edz /= elen;
  // 外侧法线（顺时针左侧）
  const outX = -edz;
  const outZ = edx;
  // 内侧 = -外侧
  const inX = -outX;
  const inZ = -outZ;

  return {
    x: nearest.x + inX * r,
    z: nearest.z + inZ * r,
  };
}

/** 射线法：点是否在多边形内（含边界） */
function pointInPolygon(x: number, z: number, poly: readonly Pt[]): boolean {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i]!.x;
    const zi = poly[i]!.z;
    const xj = poly[j]!.x;
    const zj = poly[j]!.z;
    const denom = zj - zi;
    const intersect =
      zi > z !== zj > z &&
      x <
        ((xj - xi) * (z - zi)) / (Math.abs(denom) > 1e-12 ? denom : 1e-12) +
          xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * 点到多边形边界的最近点（遍历各边）。
 * @returns dist 非负欧氏距离；i 为边起点索引
 */
function nearestOnPolygon(
  x: number,
  z: number,
  poly: readonly Pt[],
): { x: number; z: number; dist: number; i: number } {
  const n = poly.length;
  let bestX = poly[0]!.x;
  let bestZ = poly[0]!.z;
  let bestD = Infinity;
  let bestI = 0;

  for (let i = 0; i < n; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % n]!;
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const apx = x - a.x;
    const apz = z - a.z;
    const abLenSq = abx * abx + abz * abz;
    let t = abLenSq > 1e-12 ? (apx * abx + apz * abz) / abLenSq : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const px = a.x + abx * t;
    const pz = a.z + abz * t;
    const dx = x - px;
    const dz = z - pz;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      bestX = px;
      bestZ = pz;
      bestI = i;
    }
  }

  return { x: bestX, z: bestZ, dist: Math.sqrt(bestD), i: bestI };
}
