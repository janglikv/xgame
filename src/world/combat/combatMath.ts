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
