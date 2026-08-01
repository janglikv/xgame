import * as THREE from 'three';
import { getGameAudio } from '../audio/GameAudio';
import type { CombatUnit, TeamId } from '../world/combat/CombatUnit';
import { BulletRain, type BulletRainSpawn } from './BulletRain';
import { HitSpark } from './HitSpark';
import { HomingBolt, type HomingBoltSpawn } from './HomingBolt';

/**
 * 管理追踪弹、区域落弹（枪林弹雨）与命中火花。
 */
export class ProjectileManager {
  private readonly parent: THREE.Object3D;
  private readonly bolts: HomingBolt[] = [];
  private readonly rains: BulletRain[] = [];
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
    extras?: Pick<
      HomingBoltSpawn,
      'color' | 'emissive' | 'speed' | 'hitSfx'
    >,
  ): void {
    this.fire({ origin, target, damage, team, scale, ...extras });
  }

  /** 枪林弹雨：地面圆内持续落弹 + 周期伤害 */
  spawnBulletRain(spawn: BulletRainSpawn): void {
    const rain = new BulletRain(spawn);
    this.rains.push(rain);
    this.parent.add(rain);
  }

  update(delta: number): void {
    for (let i = this.bolts.length - 1; i >= 0; i -= 1) {
      const bolt = this.bolts[i];
      const still = bolt.update(delta);
      if (still) continue;

      if (bolt.didHit) {
        this.spawnSpark(bolt.position, bolt.team);
        this.playHitSfx(bolt);
      }

      this.parent.remove(bolt);
      bolt.dispose();
      this.bolts.splice(i, 1);
    }

    for (let i = this.rains.length - 1; i >= 0; i -= 1) {
      const rain = this.rains[i];
      if (rain.update(delta)) continue;
      this.parent.remove(rain);
      rain.dispose();
      this.rains.splice(i, 1);
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
    for (const rain of this.rains) {
      this.parent.remove(rain);
      rain.dispose();
    }
    this.rains.length = 0;
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

  /** 追踪弹命中音：按发射方 hitSfx，缺省按队伍给中性小兵感 */
  private playHitSfx(bolt: HomingBolt): void {
    const kind = bolt.hitSfx ?? 'minion';
    getGameAudio().playProjectileHit({
      kind,
      pitch: 0.96 + Math.random() * 0.1,
      gain: kind === 'tower' ? 1 : kind === 'hero' ? 0.9 : 0.75,
    });
  }
}
