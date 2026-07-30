import type { CircleBody } from '../collision/CircleBody';
import type { CombatUnit } from './CombatUnit';

/** 两碰撞体圆心的地面距离 */
export function distXZ(a: CircleBody, b: CircleBody): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  return Math.hypot(dx, dz);
}

/**
 * 在 range 内选取敌方目标：先比 combatPriority（小优先），再比距离（近优先）。
 */
export function pickEnemyTarget(
  self: CombatUnit,
  units: readonly CombatUnit[],
  range: number,
): CombatUnit | null {
  let best: CombatUnit | null = null;
  let bestPriority = Infinity;
  let bestDist = Infinity;

  for (const unit of units) {
    if (unit === self || !unit.isAlive || unit.team === self.team) continue;
    const d = distXZ(self.collider, unit.collider);
    if (d > range) continue;
    if (
      unit.combatPriority < bestPriority ||
      (unit.combatPriority === bestPriority && d < bestDist)
    ) {
      best = unit;
      bestPriority = unit.combatPriority;
      bestDist = d;
    }
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
