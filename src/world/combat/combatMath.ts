import type { CircleBody } from '../collision/CircleBody';
import type { CombatUnit } from './CombatUnit';

/** 两碰撞体圆心的地面距离 */
export function distXZ(a: CircleBody, b: CircleBody): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  return Math.hypot(dx, dz);
}

export type PickEnemyTargetOptions = {
  /**
   * true：数值越大越优先（小兵打塔）；
   * false / 默认：数值越小越优先（塔清兵）。
   */
  preferHigherPriority?: boolean;
};

/**
 * 在 range 内选取敌方目标：先比 combatPriority，再比距离（近优先）。
 */
export function pickEnemyTarget(
  self: CombatUnit,
  units: readonly CombatUnit[],
  range: number,
  options?: PickEnemyTargetOptions,
): CombatUnit | null {
  const preferHigher = options?.preferHigherPriority === true;
  let best: CombatUnit | null = null;
  let bestPriority = preferHigher ? -Infinity : Infinity;
  let bestDist = Infinity;

  for (const unit of units) {
    if (unit === self || !unit.isAlive || unit.team === self.team) continue;
    const d = distXZ(self.collider, unit.collider);
    if (d > range) continue;

    const betterPriority = preferHigher
      ? unit.combatPriority > bestPriority
      : unit.combatPriority < bestPriority;
    const samePriorityCloser =
      unit.combatPriority === bestPriority && d < bestDist;

    if (betterPriority || samePriorityCloser) {
      best = unit;
      bestPriority = unit.combatPriority;
      bestDist = d;
    }
  }

  return best;
}

/**
 * 在 range 内选取最近的敌方目标（纯距离，忽略 combatPriority）。
 * 用于英雄目标死亡后的自动换目标。
 */
export function pickNearestEnemy(
  self: CombatUnit,
  units: readonly CombatUnit[],
  range: number,
): CombatUnit | null {
  let best: CombatUnit | null = null;
  let bestDist = Infinity;

  for (const unit of units) {
    if (unit === self || !unit.isAlive || unit.team === self.team) continue;
    const d = distXZ(self.collider, unit.collider);
    if (d > range || d >= bestDist) continue;
    best = unit;
    bestDist = d;
  }

  return best;
}

/**
 * 在世界点 (x,z) 附近选取最近的敌方单位（相对该点，而非相对 self）。
 * @param maxDist 指针吸附最大距离；超出则视为未点到
 */
export function pickNearestEnemyNearPoint(
  self: CombatUnit,
  units: readonly CombatUnit[],
  x: number,
  z: number,
  maxDist: number,
): CombatUnit | null {
  if (!Number.isFinite(x) || !Number.isFinite(z) || !(maxDist > 0)) {
    return null;
  }
  let best: CombatUnit | null = null;
  let bestDist = Infinity;

  for (const unit of units) {
    if (unit === self || !unit.isAlive || unit.team === self.team) continue;
    const d = Math.hypot(unit.collider.x - x, unit.collider.z - z);
    if (d > maxDist || d >= bestDist) continue;
    best = unit;
    bestDist = d;
  }

  return best;
}

/**
 * Q 穿透弹：在 primary 身后锥形区域内选最近的敌方。
 * 「身后」= 相对射击方向（from → primary）的远端一侧。
 * @param fromX/fromZ 射击起点（施法者）
 * @param halfAngleRad 半锥角（弧度）
 */
export function pickPierceTargetBehind(
  fromX: number,
  fromZ: number,
  primary: CombatUnit,
  units: readonly CombatUnit[],
  range: number,
  halfAngleRad: number,
): CombatUnit | null {
  if (!primary.isAlive && !Number.isFinite(primary.collider.x)) return null;

  let fx = primary.collider.x - fromX;
  let fz = primary.collider.z - fromZ;
  let flen = Math.hypot(fx, fz);
  if (flen < 1e-6) {
    // 与目标重叠时默认朝 +X
    fx = 1;
    fz = 0;
    flen = 1;
  } else {
    fx /= flen;
    fz /= flen;
  }

  const cosMin = Math.cos(Math.max(0, halfAngleRad));
  let best: CombatUnit | null = null;
  let bestDist = Infinity;

  for (const unit of units) {
    // 只穿透到与 primary 同阵营的其它单位（敌方链）
    if (
      unit === primary ||
      !unit.isAlive ||
      unit.team !== primary.team
    ) {
      continue;
    }
    const ex = unit.collider.x - primary.collider.x;
    const ez = unit.collider.z - primary.collider.z;
    const dist = Math.hypot(ex, ez);
    if (dist > range || dist < 1e-5 || dist >= bestDist) continue;

    const inv = 1 / dist;
    const align = (ex * fx + ez * fz) * inv;
    // 必须在射击方向前方，且在锥角内
    if (align < cosMin) continue;

    best = unit;
    bestDist = dist;
  }

  return best;
}

export function isValidTarget(
  self: CombatUnit,
  target: CombatUnit | null,
): target is CombatUnit {
  return (
    !!target &&
    target.isAlive &&
    target.team !== self.team
  );
}
