import { applyRecoilHop } from '../knockArc';
import {
  WorldCreature,
  type CreatureEcologyContext,
  type EcologyTree,
  type SpiderAttackHit,
} from '../WorldCreature';
import type { BodyProfileId } from '../../data/bodyProfiles';
import { WOLF_PREY_KINDS } from '../creatureKinds';
import {
  ANIMAL_SCALE,
  ANIMAL_WALK_BOB,
  animalOptions,
  clearOfTreeSolids,
  type FarmAnimalOptions,
} from './animalCommon';

/** 狼：有限视野觅食；吃完后视野内就近找松树休息 */
export const WOLF_ECO = {
  /** 饥饿基础增长速率（秒，约 167s 从 0→1） */
  hungerPerSec: 0.006,
  /** 开始主动搜捕 / 捡尸 */
  seekPreyAt: 0.15,
  /** 触发饥饿「暴走状态」门槛 */
  berserkHungerAt: 0.55,
  /** 基础搜寻视野 / 饥饿嗅觉扩展视野 */
  visionRange: 500,
  hungryVisionRange: 720,
  chaseMemory: 550,
  hungryChaseMemory: 800,
  eatRange: 58,
  /** 常规逼近移速（高于猎物 185 逃跑） */
  huntSpeed: 290,
  /** 扑咬冷却中贴身跟进速度（须 > 猎物逃速 185，否则一刀后必丢） */
  cooldownHuntSpeed: 230,
  /** 蓄力时缓慢贴身，避免完全站桩被拉开 */
  windupSpeed: 95,
  /** 猛冲「扑咬」触发距离 */
  chargeRange: 165,
  /** 猛冲「扑咬」极速 / 暴走极速 */
  dashSpeed: 560,
  berserkDashSpeed: 680,
  /** 「扑咬」前摇蓄力时间（秒） */
  windupDuration: 0.18,
  berserkWindupDuration: 0.1,
  /** 「扑咬」猛冲持续时间（秒） */
  dashDuration: 0.35,
  forageSpeed: 140,
  /** 饿时搜捕半径（略大，减少空地空转） */
  forageRadius: 280,
  hungryForageRadius: 400,
  walkSpeed: 90,
  /** 出生略饿，给约 2 分钟窗口找到第一顿 */
  startHunger: 0.28,
  /** 常规「扑咬」攻击力 */
  pounceDamage: 15,
  /** 饥饿暴走「扑咬」攻击力 */
  berserkPounceDamage: 30,
  /** 对玩家反击时的攻击力 */
  counterAttackDamage: 60,
  /** 常规「扑咬」攻击冷却 */
  attackInterval: 1.2,
  /** 暴走「扑咬」攻击冷却 */
  berserkAttackInterval: 0.65,
  /** 吃完一具倒地尸体恢复饱腹度 */
  mealFeed: 0.85,
  /** 进食时长（秒） */
  eatDuration: 2.5,
  /** 单次追击超时（秒）；暴走略长 */
  huntTimeout: 7.0,
  berserkHuntTimeout: 9.0,
  restArrive: 28,
  restOffsetY: 40,
  /** 重索敌冷却 */
  retargetCd: 0.45,
  maxHp: 120,
} as const;

/** @deprecated 使用 WOLF_PREY_KINDS；保留 label 集合仅兼容旧调试 */
export const WOLF_PREY_LABELS = new Set(['Chicken', 'Pig', 'Cow', 'Horse']);

/**
 * 狼：视野内觅食猎杀；可捡食倒地猎物尸体；成功后就近找松树休息。
 * 无「全图透视」。
 */
export class Wolf extends WorldCreature {
  private hunger: number = WOLF_ECO.startHunger;
  private prey: WorldCreature | null = null;
  private restTree: EcologyTree | null = null;
  private retargetCd = 0;
  /** 刚吃完，优先在视野内找树歇 */
  private wantRest = false;
  /** 猛冲扑杀状态机：approach(逼近) -> windup(蓄力) -> dash(猛冲) */
  private chargeState: 'approach' | 'windup' | 'dash' = 'approach';
  private chargeTimer = 0;
  /** 单次捕猎累计时长（禁止死追，超过上限自动放弃） */
  private huntTime = 0;
  /** 扑空/脱靶次数 */
  private dashMisses = 0;
  /** 进食倒地尸体状态机 */
  private eatingCorpse: WorldCreature | null = null;
  private eatingCorpseTimer = 0;

  constructor(worldX: number, worldY: number, options: FarmAnimalOptions = {}) {
    const baseOpts = animalOptions(
      { ...options, maxHp: options.maxHp ?? WOLF_ECO.maxHp },
      ANIMAL_SCALE.wolf,
      'wolf',
      {
        textureUrl: '/assets/wolf/wolf.png',
        label: 'Wolf',
        spriteLabel: 'WolfSprite',
      },
      ANIMAL_WALK_BOB.medium,
    );

    super(worldX, worldY, {
      ...baseOpts,
      canAttack: true,
      aggroOnDetect: false,
    });
  }

  get hunger01(): number {
    return this.hunger;
  }

  /** 极度饥饿触发暴走：伤害/频率提升 */
  get isBerserk(): boolean {
    return this.hunger >= WOLF_ECO.berserkHungerAt;
  }

  /** 获取当前视野半径（饥饿时凭借嗅觉扩大） */
  private getVisionRange(baseRange?: number): number {
    if (baseRange) return baseRange;
    return this.hunger >= 0.4
      ? WOLF_ECO.hungryVisionRange
      : WOLF_ECO.visionRange;
  }

  /** 获取当前追击记忆半径 */
  private getChaseMemory(): number {
    return this.hunger >= 0.4
      ? WOLF_ECO.hungryChaseMemory
      : WOLF_ECO.chaseMemory;
  }

  /** 点是否在给定半径内（默认视野） */
  private inVision(tx: number, ty: number, range?: number): boolean {
    const r = range ?? this.getVisionRange();
    const dx = tx - this.worldX;
    const dy = ty - this.worldY;
    return dx * dx + dy * dy <= r * r;
  }

  /** 是否为可食用猎物尸体（鸡猪牛马） */
  private isEdibleCorpse(c: WorldCreature): boolean {
    return (
      c !== this &&
      !c.destroyed &&
      c.isCorpse &&
      WOLF_PREY_KINDS.has(c.kind)
    );
  }

  protected override updateAI(
    dt: number,
    playerX: number,
    playerY: number,
    playerBodyProfileId: BodyProfileId | null = null,
  ): { moved: boolean; attackHit: SpiderAttackHit | null } {
    // 暴走视觉反馈
    if (this.sprite && !this.isCorpse) {
      this.sprite.tint = this.isBerserk ? 0xff4444 : 0xffffff;
    }

    // 关键：父类 updateAI 被完全覆盖，必须在此递减攻击冷却
    if (this.attackCd > 0) {
      this.attackCd = Math.max(0, this.attackCd - dt);
    }

    if (this.locked) {
      this.prey = null;
      return super.updateAI(dt, playerX, playerY, playerBodyProfileId);
    }

    if (this.retargetCd > 0) {
      this.retargetCd = Math.max(0, this.retargetCd - dt);
    }

    const eco = this.ecology;
    if (!eco) {
      return { moved: false, attackHit: null };
    }

    // 狼多食物少：适度加速饥饿（最高 1.8 倍）
    let wolfCount = 0;
    let preyCount = 0;
    for (const c of eco.creatures) {
      if (!c.isAlive || c.destroyed) continue;
      if (c.kind === 'wolf') wolfCount += 1;
      else if (WOLF_PREY_KINDS.has(c.kind)) preyCount += 1;
    }

    let hungerMult = 1.0;
    if (wolfCount > 0 && preyCount < wolfCount * 2) {
      const deficit = wolfCount * 2 - preyCount;
      hungerMult = Math.min(1.8, 1.0 + deficit * 0.3);
    }

    this.hunger += WOLF_ECO.hungerPerSec * hungerMult * dt;

    // 饿死 → 倒地尸体
    if (this.hunger >= 1.0) {
      this.prey = null;
      this.restTree = null;
      this.eatingCorpse = null;
      this.applyDamage(this.maximumHp + 1);
      if (!this.isAlive && !this.isCorpse) {
        this.turnIntoCorpse(6.0);
      }
      return { moved: false, attackHit: null };
    }

    // 0) 继续进食已锁定尸体
    if (this.eatingCorpse) {
      const eatResult = this.tickEatingCorpse(dt, eco);
      if (eatResult) return eatResult;
    }

    // 0.5) 视野内有可食尸体：优先捡食（自己/同伴/玩家击杀的都算）
    // 饥饿或刚想休息时都愿意捡，避免浪费肉
    if (this.hunger >= WOLF_ECO.seekPreyAt * 0.5 || this.wantRest) {
      this.refreshScavengeCorpse(eco);
      if (this.eatingCorpse) {
        this.wantRest = false;
        this.prey = null;
        this.chargeState = 'approach';
        const eatResult = this.tickEatingCorpse(dt, eco);
        if (eatResult) return eatResult;
      }
    }

    // 1) 视野内有活猎物 → 猎捕
    this.refreshPrey(eco);
    if (this.prey) {
      this.wantRest = false;
      return this.huntPrey(dt, eco);
    }

    // 2) 饿了：扩大范围巡游搜捕
    if (this.hunger >= WOLF_ECO.seekPreyAt) {
      this.wantRest = false;
      return this.forageRoam(dt);
    }

    // 3) 饱腹：找松树休息
    this.refreshRestTree(eco);
    if (this.restTree) {
      return this.goRestNearPine(dt, this.restTree);
    }

    // 4) 没树：慢悠悠游荡
    return this.forageRoam(dt, /* lookingForRest */ true);
  }

  /**
   * 走向尸体并进食；尸体消失则清空目标。
   * 返回 null 表示尸体无效，调用方继续后续 AI。
   */
  private tickEatingCorpse(
    dt: number,
    eco: CreatureEcologyContext,
  ): { moved: boolean; attackHit: SpiderAttackHit | null } | null {
    const corpse = this.eatingCorpse;
    if (!corpse || !this.isEdibleCorpse(corpse) || !eco.creatures.includes(corpse)) {
      this.eatingCorpse = null;
      return null;
    }

    const dist = Math.hypot(
      corpse.worldX - this.worldX,
      corpse.worldY - this.worldY,
    );
    this.faceToward(corpse.worldX, corpse.worldY);

    if (dist > WOLF_ECO.eatRange * 0.6) {
      // 饿了跑快点去抢尸，避免同伴先吃完
      const speed =
        this.hunger >= WOLF_ECO.berserkHungerAt
          ? WOLF_ECO.huntSpeed
          : WOLF_ECO.forageSpeed;
      const moved = this.moveTowardAvoidingTrees(
        corpse.worldX,
        corpse.worldY,
        speed,
        dt,
        WOLF_ECO.eatRange * 0.4,
        22,
      );
      return { moved, attackHit: null };
    }

    this.eatingCorpseTimer -= dt;
    this.aiState = 'patrol';

    if (this.eatingCorpseTimer <= 0) {
      this.hunger = Math.max(0, this.hunger - WOLF_ECO.mealFeed);
      eco.removeCreature(corpse);
      this.eatingCorpse = null;
      this.wantRest = true;
      this.restTree = null;
      this.retargetCd = WOLF_ECO.retargetCd;
    }
    return { moved: false, attackHit: null };
  }

  /** 视野内就近锁定可食尸体并开始进食计时 */
  private refreshScavengeCorpse(eco: CreatureEcologyContext): void {
    if (this.eatingCorpse && this.isEdibleCorpse(this.eatingCorpse)) {
      if (eco.creatures.includes(this.eatingCorpse)) return;
      this.eatingCorpse = null;
    }

    let best: WorldCreature | null = null;
    let bestD = this.getVisionRange();

    for (const c of eco.creatures) {
      if (!this.isEdibleCorpse(c)) continue;
      if (!this.inVision(c.worldX, c.worldY)) continue;
      const d = Math.hypot(c.worldX - this.worldX, c.worldY - this.worldY);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }

    if (best) {
      this.eatingCorpse = best;
      this.eatingCorpseTimer = WOLF_ECO.eatDuration;
    }
  }

  /** 视野内觅食 / 找歇脚点游荡 */
  private forageRoam(
    dt: number,
    lookingForRest = false,
  ): { moved: boolean; attackHit: SpiderAttackHit | null } {
    const hungry = this.hunger >= 0.4;
    const radius = lookingForRest
      ? WOLF_ECO.forageRadius * 0.85
      : hungry
        ? WOLF_ECO.hungryForageRadius
        : WOLF_ECO.forageRadius;
    const speed = lookingForRest
      ? WOLF_ECO.walkSpeed
      : hungry
        ? WOLF_ECO.forageSpeed * 1.15
        : WOLF_ECO.forageSpeed;

    return {
      moved: this.updateSearchRoam(dt, {
        radius,
        speed,
        pauseMin: lookingForRest ? 0.12 : 0.06,
        pauseMax: lookingForRest ? 0.55 : hungry ? 0.18 : 0.3,
        preferFar: hungry ? 0.78 : 0.62,
        leisurely: lookingForRest,
      }),
      attackHit: null,
    };
  }

  /**
   * 刷新猎物：
   * - 新锁定：饥饿嗅觉扩展视野
   * - 小体型（鸡/猪）优先，易咬死
   */
  private refreshPrey(eco: CreatureEcologyContext): void {
    const memoryRange = this.getChaseMemory();
    if (this.prey) {
      if (
        this.prey.isAlive &&
        !this.prey.destroyed &&
        !this.prey.isCorpse &&
        eco.creatures.includes(this.prey) &&
        this.inVision(this.prey.worldX, this.prey.worldY, memoryRange)
      ) {
        return;
      }
      this.prey = null;
      this.retargetCd = WOLF_ECO.retargetCd;
      this.chargeState = 'approach';
      this.huntTime = 0;
      this.dashMisses = 0;
    }
    if (this.retargetCd > 0) return;

    let best: WorldCreature | null = null;
    let bestScore = Infinity;
    const currentVision = this.getVisionRange();

    for (const c of eco.creatures) {
      if (c === this || !c.isAlive || c.destroyed || c.isCorpse) continue;
      if (!WOLF_PREY_KINDS.has(c.kind)) continue;
      if (!this.inVision(c.worldX, c.worldY, currentVision)) continue;

      const d = Math.hypot(c.worldX - this.worldX, c.worldY - this.worldY);
      let weight = 1.0;
      if (c.kind === 'chicken') weight = 1.5;
      else if (c.kind === 'pig') weight = 1.3;
      else if (c.kind === 'cow') weight = 1.0;
      else if (c.kind === 'horse') weight = 0.85;

      // 低血量猎物更好咬死，优先收尾
      const hpFrac =
        c.maximumHp > 0 ? c.currentHp / c.maximumHp : 1;
      const lowHpBonus = hpFrac < 0.5 ? 1.35 : 1.0;

      const score = d / (weight * lowHpBonus);
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    this.prey = best;
  }

  private huntPrey(
    dt: number,
    _eco: CreatureEcologyContext,
  ): { moved: boolean; attackHit: SpiderAttackHit | null } {
    const prey = this.prey;
    if (!prey || !prey.isAlive || prey.destroyed || prey.isCorpse) {
      // 追击中猎物倒地：立刻转进食
      if (prey && prey.isCorpse && !prey.destroyed) {
        this.eatingCorpse = prey;
        this.eatingCorpseTimer = WOLF_ECO.eatDuration;
      }
      this.prey = null;
      this.chargeState = 'approach';
      this.huntTime = 0;
      this.dashMisses = 0;
      return { moved: false, attackHit: null };
    }

    const memoryRange = this.getChaseMemory();
    if (!this.inVision(prey.worldX, prey.worldY, memoryRange)) {
      this.prey = null;
      this.chargeState = 'approach';
      this.retargetCd = WOLF_ECO.retargetCd;
      this.huntTime = 0;
      this.dashMisses = 0;
      return this.forageRoam(dt);
    }

    this.huntTime += dt;

    const huntTimeout = this.isBerserk
      ? WOLF_ECO.berserkHuntTimeout
      : WOLF_ECO.huntTimeout;
    if (this.huntTime >= huntTimeout) {
      this.prey = null;
      this.chargeState = 'approach';
      this.retargetCd = WOLF_ECO.retargetCd;
      this.huntTime = 0;
      this.dashMisses = 0;
      return this.forageRoam(dt, true);
    }

    const dist = Math.hypot(
      prey.worldX - this.worldX,
      prey.worldY - this.worldY,
    );

    // 阶段 1：蓄力 — 缓慢贴身，不全站桩
    if (this.chargeState === 'windup') {
      this.chargeTimer -= dt;
      this.faceToward(prey.worldX, prey.worldY);
      this.aiState = 'attack';
      let moved = false;
      if (dist > WOLF_ECO.eatRange * 0.85) {
        moved = this.moveTowardAvoidingTrees(
          prey.worldX,
          prey.worldY,
          WOLF_ECO.windupSpeed,
          dt,
          WOLF_ECO.eatRange * 0.5,
          22,
        );
      }
      if (this.chargeTimer <= 0) {
        this.chargeState = 'dash';
        this.chargeTimer = WOLF_ECO.dashDuration;
      }
      return { moved, attackHit: null };
    }

    // 阶段 2：猛冲扑杀
    if (this.chargeState === 'dash') {
      this.chargeTimer -= dt;
      this.aiState = 'chase';

      const currentDashSpeed = this.isBerserk
        ? WOLF_ECO.berserkDashSpeed
        : WOLF_ECO.dashSpeed;

      const moved = this.moveTowardAvoidingTrees(
        prey.worldX,
        prey.worldY,
        currentDashSpeed,
        dt,
        WOLF_ECO.eatRange * 0.4,
        22,
      );

      // 用结算时的实时距离（移动后再量一次更准）
      const hitDist = Math.hypot(
        prey.worldX - this.worldX,
        prey.worldY - this.worldY,
      );

      if (hitDist <= WOLF_ECO.eatRange || this.chargeTimer <= 0) {
        if (hitDist <= WOLF_ECO.eatRange + 30) {
          this.dashMisses = 0;
          const dx = prey.worldX - this.worldX;
          const dy = prey.worldY - this.worldY;
          const d = Math.hypot(dx, dy);
          const inv = d > 1e-3 ? 1 / d : 1;

          applyRecoilHop(prey.knock, dx * inv, dy * inv, 220, 320);

          const damage = this.isBerserk
            ? WOLF_ECO.berserkPounceDamage
            : WOLF_ECO.pounceDamage;
          const isAlive = prey.applyDamage(damage);

          this.attackCd = this.isBerserk
            ? WOLF_ECO.berserkAttackInterval
            : WOLF_ECO.attackInterval;

          if (!isAlive) {
            prey.turnIntoCorpse();
            this.eatingCorpse = prey;
            this.eatingCorpseTimer = WOLF_ECO.eatDuration;
            this.prey = null;
            this.chargeState = 'approach';
            this.huntTime = 0;
            this.dashMisses = 0;
            this.aiState = 'patrol';
            return { moved: false, attackHit: null };
          }
        } else {
          this.dashMisses += 1;
          if (this.dashMisses >= 3) {
            this.prey = null;
            this.chargeState = 'approach';
            this.retargetCd = WOLF_ECO.retargetCd;
            this.huntTime = 0;
            this.dashMisses = 0;
            return this.forageRoam(dt, true);
          }
        }
        this.chargeState = 'approach';
      }
      return { moved, attackHit: null };
    }

    // 阶段 3：逼近 → 进入蓄力
    if (
      dist <= WOLF_ECO.chargeRange &&
      this.attackCd <= 0 &&
      this.chargeState === 'approach'
    ) {
      this.chargeState = 'windup';
      this.chargeTimer = this.isBerserk
        ? WOLF_ECO.berserkWindupDuration
        : WOLF_ECO.windupDuration;
      this.faceToward(prey.worldX, prey.worldY);
      return { moved: false, attackHit: null };
    }

    // 冷却中仍用较快跟进速度咬住距离（必须 > 猎物逃速 185）
    const currentSpeed =
      this.attackCd > 0 ? WOLF_ECO.cooldownHuntSpeed : WOLF_ECO.huntSpeed;

    this.aiState = 'chase';
    this.patrolPause = 0;
    const moved = this.moveTowardAvoidingTrees(
      prey.worldX,
      prey.worldY,
      currentSpeed,
      dt,
      WOLF_ECO.eatRange * 0.4,
      22,
    );
    return { moved, attackHit: null };
  }

  /**
   * 刷新歇脚松树：与觅食同一套视野。
   */
  private refreshRestTree(eco: CreatureEcologyContext): void {
    if (this.restTree) {
      const live = eco.trees.find(
        (t) =>
          t.kind === 'pine' &&
          t.isAlive &&
          Math.hypot(
            t.worldX - this.restTree!.worldX,
            t.worldY - this.restTree!.worldY,
          ) < 12,
      );
      if (
        live &&
        this.inVision(live.worldX, live.worldY, WOLF_ECO.chaseMemory)
      ) {
        this.restTree = live;
        return;
      }
      this.restTree = null;
    }

    let best: EcologyTree | null = null;
    let bestD: number = WOLF_ECO.visionRange;
    for (const t of eco.trees) {
      if (!t.isAlive || t.kind !== 'pine') continue;
      const d = Math.hypot(t.worldX - this.worldX, t.worldY - this.worldY);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    this.restTree = best;
  }

  private restSpot(tree: EcologyTree): { x: number; y: number } {
    const hash =
      (Math.abs(Math.sin(this.worldX * 12.9898 + this.worldY * 78.233)) *
        43758.5453) %
      1;
    const offsetX = (hash - 0.5) * 40;
    const offsetY = WOLF_ECO.restOffsetY + (((hash * 17) % 1) - 0.5) * 14;
    return clearOfTreeSolids(
      tree.worldX + offsetX,
      tree.worldY + offsetY,
      22,
    );
  }

  private goRestNearPine(
    dt: number,
    tree: EcologyTree,
  ): { moved: boolean; attackHit: SpiderAttackHit | null } {
    if (!tree.isAlive) {
      this.restTree = null;
      return { moved: false, attackHit: null };
    }

    if (!this.inVision(tree.worldX, tree.worldY, WOLF_ECO.chaseMemory)) {
      this.restTree = null;
      return this.forageRoam(dt, true);
    }

    const spot = this.restSpot(tree);
    const dist = Math.hypot(spot.x - this.worldX, spot.y - this.worldY);

    if (dist <= WOLF_ECO.restArrive) {
      this.aiState = 'patrol';
      this.patrolPause = 1;
      this.wantRest = false;
      this.faceToward(tree.worldX, tree.worldY);
      return { moved: false, attackHit: null };
    }

    this.aiState = 'chase';
    this.patrolPause = 0;
    const speed = this.wantRest
      ? WOLF_ECO.walkSpeed * 1.1
      : WOLF_ECO.walkSpeed;
    const moved = this.moveTowardAvoidingTrees(
      spot.x,
      spot.y,
      speed,
      dt,
      WOLF_ECO.restArrive * 0.65,
      22,
    );
    return { moved, attackHit: null };
  }
}
