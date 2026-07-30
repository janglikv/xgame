import type { Object3D } from 'three';
import type { ProjectileManager } from '../effects/ProjectileManager';
import type { CombatUnit, TeamId } from './combat/CombatUnit';
import { Minion, type MinionKind } from './Minion';

export type MinionTeam = TeamId;

/**
 * AI 发兵：双方从己方基地水晶前诞生，逐个出兵。
 * 每波 6 人（前 3 近战 + 后 3 远程），波次循环。
 */
export class MinionWaveSpawner {
  /** 蓝方水晶 X（与 NexusCrystal 一致） */
  static readonly BLUE_NEXUS_X = -18;
  /** 红方水晶 X */
  static readonly RED_NEXUS_X = 18;
  /**
   * 相对水晶沿兵线朝中路偏移（米），避免与水晶静态碰撞体重叠。
   * 蓝方向 +X，红方向 -X。
   */
  static readonly SPAWN_FORWARD = 1.15;
  /** 蓝方出生点 X：水晶前方 */
  static readonly BLUE_SPAWN_X =
    MinionWaveSpawner.BLUE_NEXUS_X + MinionWaveSpawner.SPAWN_FORWARD;
  /** 红方出生点 X：水晶前方 */
  static readonly RED_SPAWN_X =
    MinionWaveSpawner.RED_NEXUS_X - MinionWaveSpawner.SPAWN_FORWARD;
  /** 每波小兵数量（每方） */
  static readonly WAVE_SIZE = 6;
  /** 每波末尾远程兵数量 */
  static readonly RANGED_COUNT = 3;
  /** 同队相邻小兵出现间隔（秒） */
  static readonly SPAWN_INTERVAL = 0.75;
  /** 一波全部出完后，到下一波开始的间隔（秒） */
  static readonly WAVE_GAP = 12;
  /** 首波开局延迟（秒） */
  static readonly FIRST_WAVE_DELAY = 1.2;
  /** 出生点 Z（略偏侧，从水晶旁走出） */
  static readonly SPAWN_Z = -0.5;

  private readonly parent: Object3D;
  private readonly minions: Minion[] = [];

  /** 本波各方还要出几个 */
  private blueRemaining = 0;
  private redRemaining = 0;
  /** 距下一次可出兵的倒计时（各方独立） */
  private blueSpawnCd = 0;
  private redSpawnCd = 0;
  /** 波间等待；首波用 FIRST_WAVE_DELAY */
  private waveCd = MinionWaveSpawner.FIRST_WAVE_DELAY;
  /** 是否正在出兵中（本波尚未出完） */
  private waveActive = false;

  constructor(parent: Object3D) {
    this.parent = parent;
  }

  get activeMinions(): readonly Minion[] {
    return this.minions;
  }

  /**
   * @param structures 场景中的建筑单位（防御塔等），与场上小兵一并供 AI 索敌
   * @param projectiles 弹道管理器：前摇结束发射锁定弹
   */
  update(
    delta: number,
    structures: readonly CombatUnit[],
    projectiles: ProjectileManager,
  ): void {
    this.prune();
    this.tickSpawn(delta);

    // 出兵后再收集，保证本帧新兵也能被索敌/互打
    const combatUnits: CombatUnit[] = [
      ...structures.filter((u) => u.isAlive),
      ...this.minions.filter((m) => m.isAlive),
    ];

    for (const minion of this.minions) {
      minion.update(delta, combatUnits, projectiles);
    }

    // 本帧战斗可能打死小兵（弹道命中在 projectiles.update 中结算）
    this.prune();
  }

  /** 移除死亡或出界小兵（弹道命中后由场景再调一次） */
  pruneDead(): void {
    this.prune();
  }

  dispose(): void {
    for (const minion of this.minions) {
      this.parent.remove(minion);
      minion.dispose();
    }
    this.minions.length = 0;
  }

  private tickSpawn(delta: number): void {
    if (!this.waveActive) {
      this.waveCd -= delta;
      if (this.waveCd <= 0) {
        this.beginWave();
      }
      return;
    }

    // 双方并行、各自一个一个出
    this.blueSpawnCd -= delta;
    this.redSpawnCd -= delta;

    if (this.blueRemaining > 0 && this.blueSpawnCd <= 0) {
      this.spawnOne('blue');
      this.blueRemaining -= 1;
      this.blueSpawnCd = MinionWaveSpawner.SPAWN_INTERVAL;
    }

    if (this.redRemaining > 0 && this.redSpawnCd <= 0) {
      this.spawnOne('red');
      this.redRemaining -= 1;
      this.redSpawnCd = MinionWaveSpawner.SPAWN_INTERVAL;
    }

    if (this.blueRemaining <= 0 && this.redRemaining <= 0) {
      this.waveActive = false;
      this.waveCd = MinionWaveSpawner.WAVE_GAP;
    }
  }

  private beginWave(): void {
    this.waveActive = true;
    this.blueRemaining = MinionWaveSpawner.WAVE_SIZE;
    this.redRemaining = MinionWaveSpawner.WAVE_SIZE;
    // 立刻各出第一个
    this.blueSpawnCd = 0;
    this.redSpawnCd = 0;
  }

  private spawnOne(team: MinionTeam): void {
    const x =
      team === 'blue'
        ? MinionWaveSpawner.BLUE_SPAWN_X
        : MinionWaveSpawner.RED_SPAWN_X;
    // remaining 含本只：6/5/4 近战，3/2/1 远程
    const remaining =
      team === 'blue' ? this.blueRemaining : this.redRemaining;
    const kind: MinionKind =
      remaining <= MinionWaveSpawner.RANGED_COUNT ? 'ranged' : 'melee';
    const minion = new Minion(x, MinionWaveSpawner.SPAWN_Z, team, kind);
    this.minions.push(minion);
    this.parent.add(minion);
  }

  private prune(): void {
    for (let i = this.minions.length - 1; i >= 0; i -= 1) {
      const minion = this.minions[i];
      if (minion.isAlive && !minion.isOffField) continue;
      this.parent.remove(minion);
      minion.dispose();
      this.minions.splice(i, 1);
    }
  }
}
