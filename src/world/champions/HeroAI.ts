import type { ProjectileManager } from '../../effects/ProjectileManager';
import {
  distXZ,
  isValidTarget,
  pickNearestEnemy,
} from '../combat/combatMath';
import type { CombatUnit } from '../combat/CombatUnit';
import { MissFortune } from './MissFortune';

/**
 * 红方厄运小姐 AI：推线 + 普攻 + QWER 循环。
 * 通过 MissFortune 公开 API 下指令，不侵入英雄内部状态机。
 */
export class HeroAI {
  /** 进入战斗的索敌距离 */
  private static readonly AGGRO_RANGE = 4.0;
  /** 无近处敌人时，远距追击/探路距离 */
  private static readonly SEEK_RANGE = 7.5;
  /** 技能决策节流（秒） */
  private static readonly SKILL_THINK = 0.18;
  /** R：锥内至少多少目标才放（含英雄则放宽到 1） */
  private static readonly R_MIN_UNITS = 2;

  private skillThinkCd = 0;

  constructor(
    private readonly hero: MissFortune,
    private readonly projectiles: ProjectileManager,
    private readonly getEnemies: () => readonly CombatUnit[],
    /** 推线目标 X（敌方水晶附近） */
    private readonly laneTargetX: number,
  ) {}

  /**
   * 每帧决策：索敌战斗或沿中路推进；CD 好时放技能。
   */
  update(delta: number): void {
    if (!(delta > 0)) return;
    if (!this.hero.isAlive) return;
    // R 引导 / Q·E 排队走位中：由英雄自身状态机推进，AI 不抢控制
    if (this.hero.isRChanneling) return;
    if (this.hero.queuedSkill) return;

    const enemies = this.getEnemies();
    let target =
      pickNearestEnemy(this.hero, enemies, HeroAI.AGGRO_RANGE) ??
      pickNearestEnemy(this.hero, enemies, HeroAI.SEEK_RANGE);

    // 已锁定目标仍有效则优先保持（避免近处新小兵频繁切目标）
    const current = this.hero.currentAttackTarget;
    if (
      isValidTarget(this.hero, current) &&
      distXZ(this.hero.collider, current.collider) <= HeroAI.SEEK_RANGE
    ) {
      // 仅当新目标明显更近时才切
      if (
        !target ||
        target === current ||
        distXZ(this.hero.collider, target.collider) + 0.35 >=
          distXZ(this.hero.collider, current.collider)
      ) {
        target = current;
      }
    }

    if (target) {
      if (this.hero.currentAttackTarget !== target) {
        this.hero.setAttackTarget(target);
      } else {
        // 同目标：补一次 set，保证追击/停步与距离同步（同目标不打断前摇）
        this.hero.setAttackTarget(target);
      }
      this.trySkills(delta, target, enemies);
      return;
    }

    // 无目标：沿兵线推往敌方水晶
    this.hero.moveTo(this.laneTargetX, 0);
  }

  private trySkills(
    delta: number,
    target: CombatUnit,
    enemies: readonly CombatUnit[],
  ): void {
    this.skillThinkCd -= delta;
    if (this.skillThinkCd > 0) return;
    this.skillThinkCd = HeroAI.SKILL_THINK;

    if (!isValidTarget(this.hero, target)) return;
    if (this.hero.isRChanneling) return;

    const d = distXZ(this.hero.collider, target.collider);
    const tx = target.collider.x;
    const tz = target.collider.z;
    const getEnemies = () => this.getEnemies();

    // W：交战时开热诚
    if (this.hero.canCastW() && d <= MissFortune.ATTACK_RANGE * 2.2) {
      this.hero.castW();
    }

    // R：扇形内目标够多，或正对敌方英雄
    if (this.hero.canCastR() && d <= MissFortune.R_RANGE * 0.95) {
      const dirX = tx - this.hero.position.x;
      const dirZ = tz - this.hero.position.z;
      const inCone = this.countInCone(
        this.hero.position.x,
        this.hero.position.z,
        dirX,
        dirZ,
        MissFortune.R_RANGE,
        (MissFortune.R_HALF_ANGLE_DEG * Math.PI) / 180,
        enemies,
      );
      const targetIsHero = target instanceof MissFortune;
      if (targetIsHero || inCone >= HeroAI.R_MIN_UNITS) {
        this.hero.castR(this.projectiles, getEnemies, { x: tx, z: tz });
        return;
      }
    }

    // E：朝目标脚下枪林弹雨（可超距排队走位）
    if (
      this.hero.canCastE() &&
      d <= MissFortune.E_CAST_RANGE + MissFortune.E_RADIUS
    ) {
      const result = this.hero.castE(tx, tz, this.projectiles, getEnemies);
      if (result) return;
    }

    // Q：指针落在目标位置选敌（成功含超距排队）
    if (this.hero.canCastQ() && d <= MissFortune.Q_SEEK_RANGE) {
      this.hero.castQ(this.projectiles, getEnemies, { x: tx, z: tz });
    }
  }

  /** 统计原点朝 dir 扇形锥内的敌方数量 */
  private countInCone(
    ox: number,
    oz: number,
    dirX: number,
    dirZ: number,
    range: number,
    halfAngle: number,
    enemies: readonly CombatUnit[],
  ): number {
    let len = Math.hypot(dirX, dirZ);
    if (len < 1e-6) {
      dirX = 1;
      dirZ = 0;
      len = 1;
    } else {
      dirX /= len;
      dirZ /= len;
    }
    const cosMin = Math.cos(halfAngle);
    let n = 0;
    for (const u of enemies) {
      if (!u.isAlive || u.team === this.hero.team) continue;
      const ux = u.collider.x - ox;
      const uz = u.collider.z - oz;
      const dist = Math.hypot(ux, uz);
      if (dist > range + u.collider.radius * 0.4) continue;
      if (dist > 1e-5) {
        const align = (ux * dirX + uz * dirZ) / dist;
        if (align < cosMin) continue;
      }
      n += 1;
    }
    return n;
  }
}
