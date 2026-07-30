import * as THREE from 'three';
import type { CombatUnit, TeamId } from '../world/combat/CombatUnit';
import { HitSpark } from './HitSpark';
import { HomingBolt, type HomingBoltSpawn } from './HomingBolt';

/**
 * 管理追踪弹与命中火花。
 */
export class ProjectileManager {
  private readonly parent: THREE.Object3D;
  private readonly bolts: HomingBolt[] = [];
  private readonly sparks: HitSpark[] = [];

  constructor(parent: THREE.Object3D) {
    this.parent = parent;
  }

  /** 从前摇结束处发射一发锁定弹 */
  fire(spawn: HomingBoltSpawn): void {
    if (!spawn.target.isAlive) return;
    const bolt = new HomingBolt(spawn);
    this.bolts.push(bolt);
    this.parent.add(bolt);
  }

  fireAt(
    origin: THREE.Vector3,
    target: CombatUnit,
    damage: number,
    team: TeamId,
    scale = 1,
  ): void {
    this.fire({ origin, target, damage, team, scale });
  }

  update(delta: number): void {
    for (let i = this.bolts.length - 1; i >= 0; i -= 1) {
      const bolt = this.bolts[i];
      const still = bolt.update(delta);
      if (still) continue;

      if (bolt.didHit) {
        this.spawnSpark(bolt.position, bolt.team);
      }

      this.parent.remove(bolt);
      bolt.dispose();
      this.bolts.splice(i, 1);
    }

    for (let i = this.sparks.length - 1; i >= 0; i -= 1) {
      const spark = this.sparks[i];
      if (spark.update(delta)) continue;
      this.parent.remove(spark);
      spark.dispose();
      this.sparks.splice(i, 1);
    }
  }

  dispose(): void {
    for (const bolt of this.bolts) {
      this.parent.remove(bolt);
      bolt.dispose();
    }
    this.bolts.length = 0;
    for (const spark of this.sparks) {
      this.parent.remove(spark);
      spark.dispose();
    }
    this.sparks.length = 0;
  }

  private spawnSpark(position: THREE.Vector3, team: TeamId): void {
    const spark = new HitSpark(position.clone(), team);
    this.sparks.push(spark);
    this.parent.add(spark);
  }
}
