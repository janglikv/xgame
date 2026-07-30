import type * as THREE from 'three';
import type { CircleBody } from '../collision/CircleBody';

export type TeamId = 'blue' | 'red';

/**
 * 可参与索敌 / 受伤的战斗单位。
 * combatPriority 越小越优先被小兵选为目标（小兵 < 防御塔）。
 */
export interface CombatUnit {
  readonly team: TeamId;
  readonly collider: CircleBody;
  /** 索敌优先级，数值越小越优先 */
  readonly combatPriority: number;
  readonly maxHp: number;
  readonly isAlive: boolean;
  hp: number;
  takeDamage(amount: number): void;
  /**
   * 弹道瞄准 / 命中落点（身体中心等），写入 out 并返回。
   */
  getHitPoint(out: THREE.Vector3): THREE.Vector3;
}
