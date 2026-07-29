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
  /** 饥饿基础增长速率（秒，基础寿命延长至 160 秒） */
  hungerPerSec: 0.006,
  /** 开始猎食 */
  seekPreyAt: 0.15,
  /** 触发饥饿「暴走状态」门槛 (55% 饥饿度) */
  berserkHungerAt: 0.55,
  /** 基础搜寻视野 (500px) / 饥饿嗅觉扩展视野 (680px) */
  visionRange: 500,
  hungryVisionRange: 680,
  chaseMemory: 550,
  hungryChaseMemory: 750,
  eatRange: 58,
  /** 常规逼近移速（提升至 290px/s，远高于猎物 185px/s 逃跑速度） */
  huntSpeed: 290,
  /** 猛冲「扑咬」触发感知距离 */
  chargeRange: 165,
  /** 猛冲「扑咬」极速 (560px/s) / 暴走极速 (680px/s) */
  dashSpeed: 560,
  berserkDashSpeed: 680,
  /** 「扑咬」前摇蓄力时间（秒） */
  windupDuration: 0.22,
  berserkWindupDuration: 0.1,
  /** 「扑咬」猛冲持续时间（秒） */
  dashDuration: 0.35,
  forageSpeed: 120,
  forageRadius: 240,
  walkSpeed: 90,
  startHunger: 0.45,
  /** 常规「扑咬」攻击力 (15 HP) */
  pounceDamage: 15,
  /** 饥饿暴走「扑咬」攻击力（翻倍至 30 HP） */
  berserkPounceDamage: 30,
  /** 对玩家反击时的攻击力 */
  counterAttackDamage: 60,
  /** 常规「扑咬」攻击冷却间隔 (1.5s) */
  attackInterval: 1.5,
  /** 暴走「扑咬」攻击冷却间隔（0.75s） */
  berserkAttackInterval: 0.75,
  /** 吃完一具倒地尸体恢复 85% 饱腹度 */
  mealFeed: 0.85,
  restArrive: 28,
  restOffsetY: 40,
  /** 重索敌调整冷却（从 5.0s 缩短至 0.6s，绝不发呆） */
  retargetCd: 0.6,
  maxHp: 120,
} as const;

/** @deprecated 使用 WOLF_PREY_KINDS；保留 label 集合仅兼容旧调试 */
export const WOLF_PREY_LABELS = new Set(['Chicken', 'Pig', 'Cow', 'Horse']);

/**
 * 狼：视野内觅食猎杀；成功后在视野内就近找松树休息。
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

  /** 极度饥饿（>= 65% 饥饿度）触发暴走状态：伤害翻倍(30HP)、攻击频率翻倍(0.75s) */
  get isBerserk(): boolean {
    return this.hunger >= WOLF_ECO.berserkHungerAt;
  }

  /** 获取当前视野半径（饥饿时凭借嗅觉大幅扩大） */
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

  protected override updateAI(
    dt: number,
    playerX: number,
    playerY: number,
    playerBodyProfileId: BodyProfileId | null = null,
  ): { moved: boolean; attackHit: SpiderAttackHit | null } {
    // 暴走视觉反馈：暴走状态下狼身呈绯红发光 (0xff4444)
    if (this.sprite && !this.isCorpse) {
      this.sprite.tint = this.isBerserk ? 0xff4444 : 0xffffff;
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

    // 狼多食物少时的生存竞争机制：
    // 统计全场狼数量与可捕捉的食草猎物（牛/马/鸡/猪）数量
    let wolfCount = 0;
    let preyCount = 0;
    for (const c of eco.creatures) {
      if (!c.isAlive || c.destroyed) continue;
      if (c.kind === 'wolf') wolfCount += 1;
      else if (WOLF_PREY_KINDS.has(c.kind)) preyCount += 1;
    }

    // 食物不足（平均每只狼不足 2 只猎物）时，适度提升饥饿消耗（最高 1.8 倍，避免急剧死）
    let hungerMult = 1.0;
    if (wolfCount > 0 && preyCount < wolfCount * 2) {
      const deficit = wolfCount * 2 - preyCount;
      hungerMult = Math.min(1.8, 1.0 + deficit * 0.3);
    }

    this.hunger += WOLF_ECO.hungerPerSec * hungerMult * dt;

    // 饿死判定：食物不足或长时间未猎捕到食物，饿死并倒地变为颠倒尸体
    if (this.hunger >= 1.0) {
      this.prey = null;
      this.restTree = null;
      this.applyDamage(this.maximumHp + 1);
      if (!this.isAlive && !this.isCorpse) {
        this.turnIntoCorpse(6.0);
      }
      return { moved: false, attackHit: null };
    }

    // 0) 进食倒地尸体状态：走到倒下尸体旁趴下进食 2.5 秒，吃完恢复饱腹并移除尸体
    if (this.eatingCorpse) {
      const corpse = this.eatingCorpse;
      if (!corpse.destroyed && eco.creatures.includes(corpse)) {
        const dist = Math.hypot(
          corpse.worldX - this.worldX,
          corpse.worldY - this.worldY,
        );
        this.faceToward(corpse.worldX, corpse.worldY);

        if (dist > WOLF_ECO.eatRange * 0.6) {
          const moved = this.moveTowardAvoidingTrees(
            corpse.worldX,
            corpse.worldY,
            WOLF_ECO.walkSpeed,
            dt,
            WOLF_ECO.eatRange * 0.4,
            22,
          );
          return { moved, attackHit: null };
        }

        // 到达尸体旁：开始进食
        this.eatingCorpseTimer -= dt;
        this.aiState = 'patrol';

        if (this.eatingCorpseTimer <= 0) {
          // 进食 2.5 秒结束：恢复 85% 饱腹度，尸体被吃完消失，狼准备去树下休息
          this.hunger = Math.max(0, this.hunger - WOLF_ECO.mealFeed);
          eco.removeCreature(corpse);
          this.eatingCorpse = null;
          this.wantRest = true;
          this.restTree = null;
          this.retargetCd = WOLF_ECO.retargetCd;
        }
        return { moved: false, attackHit: null };
      } else {
        this.eatingCorpse = null;
      }
    }

    // 1) 无论饥饿度如何，只要附近/视野内有捕食目标（牛/马/鸡/猪），立刻触发猎捕
    this.refreshPrey(eco);
    if (this.prey) {
      this.wantRest = false;
      return this.huntPrey(dt, eco);
    }

    // 2) 视野内暂无猎物，但饿了：主动巡游搜寻猎物
    if (this.hunger >= WOLF_ECO.seekPreyAt) {
      this.wantRest = false;
      return this.forageRoam(dt);
    }

    // 3) 视野内无猎物且饱腹：寻找松树休息
    this.refreshRestTree(eco);
    if (this.restTree) {
      return this.goRestNearPine(dt, this.restTree);
    }

    // 4) 视野内没树：散步游荡
    return this.forageRoam(dt, /* lookingForRest */ true);
  }

  /** 视野内觅食 / 找歇脚点游荡 */
  private forageRoam(
    dt: number,
    lookingForRest = false,
  ): { moved: boolean; attackHit: SpiderAttackHit | null } {
    return {
      moved: this.updateSearchRoam(dt, {
        radius: lookingForRest
          ? WOLF_ECO.forageRadius * 0.85
          : WOLF_ECO.forageRadius,
        speed: lookingForRest
          ? WOLF_ECO.walkSpeed
          : WOLF_ECO.forageSpeed,
        pauseMin: 0.12,
        pauseMax: lookingForRest ? 0.55 : 0.35,
        preferFar: 0.62,
        leisurely: lookingForRest,
      }),
      attackHit: null,
    };
  }

  /**
   * 刷新猎物：
   * - 新锁定：支持饥饿嗅觉扩展视野 (680px)
   * - 智商权重：距离更近、体型更小(Chicken/Pig)的猎物优先
   */
  private refreshPrey(eco: CreatureEcologyContext): void {
    const memoryRange = this.getChaseMemory();
    if (this.prey) {
      if (
        this.prey.isAlive &&
        !this.prey.destroyed &&
        eco.creatures.includes(this.prey) &&
        this.inVision(
          this.prey.worldX,
          this.prey.worldY,
          memoryRange,
        )
      ) {
        return;
      }
      this.prey = null;
      this.retargetCd = WOLF_ECO.retargetCd;
    }
    if (this.retargetCd > 0) return;

    let best: WorldCreature | null = null;
    let bestScore = Infinity;
    const currentVision = this.getVisionRange();

    for (const c of eco.creatures) {
      if (c === this || !c.isAlive || c.destroyed) continue;
      if (!WOLF_PREY_KINDS.has(c.kind)) continue;
      if (!this.inVision(c.worldX, c.worldY, currentVision)) continue;

      const d = Math.hypot(c.worldX - this.worldX, c.worldY - this.worldY);
      // 智商挑选：易捕获的小体型猎物优先 (Chicken: 1.5, Pig: 1.3, Cow: 1.0, Horse: 0.85)
      let weight = 1.0;
      if (c.kind === 'chicken') weight = 1.5;
      else if (c.kind === 'pig') weight = 1.3;
      else if (c.kind === 'cow') weight = 1.0;
      else if (c.kind === 'horse') weight = 0.85;

      const score = d / weight;
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
    if (!prey || !prey.isAlive || prey.destroyed) {
      this.prey = null;
      this.chargeState = 'approach';
      this.huntTime = 0;
      this.dashMisses = 0;
      return { moved: false, attackHit: null };
    }

    // 追击中超出记忆距离 → 丢失
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

    // 防止死追机制 1：追击超时 (>= 5.5 秒) 换目标，短暂调整 0.6s
    if (this.huntTime >= 5.5) {
      this.prey = null;
      this.chargeState = 'approach';
      this.retargetCd = WOLF_ECO.retargetCd; // 0.6 秒警觉调整，绝不呆立发呆 5 秒
      this.huntTime = 0;
      this.dashMisses = 0;
      return this.forageRoam(dt, true);
    }

    const dist = Math.hypot(
      prey.worldX - this.worldX,
      prey.worldY - this.worldY,
    );

    // 阶段 1：蓄力准备 (windup)
    if (this.chargeState === 'windup') {
      this.chargeTimer -= dt;
      this.faceToward(prey.worldX, prey.worldY);
      this.aiState = 'attack';
      if (this.chargeTimer <= 0) {
        this.chargeState = 'dash';
        this.chargeTimer = WOLF_ECO.dashDuration;
      }
      return { moved: false, attackHit: null };
    }

    // 阶段 2：猛冲扑杀 (dash)
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

      // 扑杀命中结算
      if (dist <= WOLF_ECO.eatRange || this.chargeTimer <= 0) {
        if (dist <= WOLF_ECO.eatRange + 25) {
          this.dashMisses = 0;
          const dx = prey.worldX - this.worldX;
          const dy = prey.worldY - this.worldY;
          const d = Math.hypot(dx, dy);
          const inv = d > 1e-3 ? 1 / d : 1;

          // 猛烈推开与冲击高弹跳 (220px/s 位移, 320px/s 垂直起跳)
          applyRecoilHop(prey.knock, dx * inv, dy * inv, 220, 320);

          // 暴走状态下「扑咬」伤害翻倍 (30 HP vs 15 HP)
          const damage = this.isBerserk
            ? WOLF_ECO.berserkPounceDamage
            : WOLF_ECO.pounceDamage;
          const isAlive = prey.applyDamage(damage);

          // 暴走状态下攻击频率翻倍（攻击冷却减半 0.75s vs 1.5s）
          this.attackCd = this.isBerserk
            ? WOLF_ECO.berserkAttackInterval
            : WOLF_ECO.attackInterval;

          if (!isAlive) {
            // 猎物死亡：不直接移除，而是转为倒地尸体（颠倒），狼开始在原地进食尸体！
            prey.turnIntoCorpse();
            this.eatingCorpse = prey;
            this.eatingCorpseTimer = 2.5; // 2.5 秒进食尸体过程
            this.prey = null;
            this.chargeState = 'approach';
            this.huntTime = 0;
            this.dashMisses = 0;
            this.aiState = 'patrol';
            return { moved: false, attackHit: null };
          }
        } else {
          // 防止死追机制 2：猛冲扑空 2 次，换目标调整 0.6 秒
          this.dashMisses += 1;
          if (this.dashMisses >= 2) {
            this.prey = null;
            this.chargeState = 'approach';
            this.retargetCd = WOLF_ECO.retargetCd; // 0.6 秒调整，绝不呆立发呆
            this.huntTime = 0;
            this.dashMisses = 0;
            return this.forageRoam(dt, true);
          }
        }
        this.chargeState = 'approach';
      }
      return { moved, attackHit: null };
    }

    // 阶段 3：索敌逼近 (approach) -> 满足触发距离且攻击冷却完毕时切蓄力
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

    this.aiState = 'chase';
    this.patrolPause = 0;
    const moved = this.moveTowardAvoidingTrees(
      prey.worldX,
      prey.worldY,
      WOLF_ECO.huntSpeed,
      dt,
      WOLF_ECO.eatRange * 0.4,
      22,
    );
    return { moved, attackHit: null };
  }

  /**
   * 刷新歇脚松树：与觅食同一套视野。
   * - 新目标：必须在 visionRange 内就近
   * - 已锁定：chaseMemory 内可继续走向该树
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

    // 走向歇脚点途中若树已远超记忆距离，放弃重觅
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
