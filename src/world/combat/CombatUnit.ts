import type * as THREE from 'three';
import type { CircleBody } from '../collision/CircleBody';

export type TeamId = 'blue' | 'red';

/**
 * 可参与索敌 / 受伤的战斗单位。
 * combatPriority：建筑类（防御塔）数值更大；小兵索敌时优先打高值目标。
 */
export interface CombatUnit {
  readonly team: TeamId;
  readonly collider: CircleBody;
  /**
   * 目标优先级标签。
   * 小兵索敌：数值越大越优先（先塔后兵）；
   * 防御塔索敌：数值越小越优先（先兵后塔）。
   */
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
