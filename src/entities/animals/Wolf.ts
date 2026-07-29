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
  /** 饥饿基础增长速率（秒） */
  hungerPerSec: 0.012,
  /** 开始猎食 */
  seekPreyAt: 0.18,
  /**
   * 视野半径：发现猎物 / 发现歇脚松树（无透视，只认范围内的）
   */
  visionRange: 300,
  /**
   * 已锁定目标的追击记忆半径：略大于视野，贴边不立刻丢；
   * 超出则彻底丢失，需重新进入视野才能锁定。
   */
  chaseMemory: 380,
  eatRange: 54,
  /** 扑杀移速（高于牛马） */
  huntSpeed: 188,
  /** 觅食巡游移速（视野内无猎物时） */
  forageSpeed: 118,
  /** 觅食巡游半径 */
  forageRadius: 200,
  walkSpeed: 96,
  startHunger: 0.55,
  /** 吃一顿回饱量 */
  mealFeed: 0.55,
  restArrive: 28,
  restOffsetY: 40,
  retargetCd: 0.22,
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

  constructor(worldX: number, worldY: number, options: FarmAnimalOptions = {}) {
    super(
      worldX,
      worldY,
      animalOptions(
        { ...options, maxHp: options.maxHp ?? WOLF_ECO.maxHp },
        ANIMAL_SCALE.wolf,
        'wolf',
        {
          textureUrl: '/assets/wolf/wolf.png',
          label: 'Wolf',
          spriteLabel: 'WolfSprite',
        },
        ANIMAL_WALK_BOB.medium,
      ),
    );
  }

  get hunger01(): number {
    return this.hunger;
  }

  /** 点是否在给定半径内（默认视野） */
  private inVision(tx: number, ty: number, range?: number): boolean {
    const r = range ?? WOLF_ECO.visionRange;
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

    // 食物不足（平均每只狼不足 2 只猎物）时，竞争加剧导致饥饿速率大幅提升
    let hungerMult = 1.0;
    if (wolfCount > 0 && preyCount < wolfCount * 2) {
      const deficit = wolfCount * 2 - preyCount;
      hungerMult = Math.min(3.5, 1.0 + deficit * 0.7);
    }

    this.hunger += WOLF_ECO.hungerPerSec * hungerMult * dt;

    // 饿死判定：食物不足或长时间未猎捕到食物，饿死并从生态移除
    if (this.hunger >= 1.0) {
      this.prey = null;
      this.restTree = null;
      this.applyDamage(this.maximumHp + 1);
      if (!this.isAlive) eco.removeCreature(this);
      return { moved: false, attackHit: null };
    }

    // 1) 饿了：视野内觅食 / 追击
    if (this.hunger >= WOLF_ECO.seekPreyAt) {
      this.wantRest = false;
      this.refreshPrey(eco);
      if (this.prey) {
        return this.huntPrey(dt, eco);
      }
      // 视野内无猎物：扩大巡游寻找（仍不是透视）
      return this.forageRoam(dt);
    }

    this.prey = null;

    // 2) 不饿 / 刚吃完：视野内就近松树休息
    this.refreshRestTree(eco);
    if (this.restTree) {
      return this.goRestNearPine(dt, this.restTree);
    }

    // 3) 视野内没树：小范围走着找（与觅食同机制）
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
   * - 新锁定：必须在 visionRange 内
   * - 已锁定：chaseMemory 内可继续追，超出则丢失
   */
  private refreshPrey(eco: CreatureEcologyContext): void {
    if (this.prey) {
      if (
        this.prey.isAlive &&
        !this.prey.destroyed &&
        eco.creatures.includes(this.prey) &&
        this.inVision(
          this.prey.worldX,
          this.prey.worldY,
          WOLF_ECO.chaseMemory,
        )
      ) {
        return;
      }
      this.prey = null;
      this.retargetCd = WOLF_ECO.retargetCd;
    }
    if (this.retargetCd > 0) return;

    let best: WorldCreature | null = null;
    let bestD: number = WOLF_ECO.visionRange;
    for (const c of eco.creatures) {
      if (c === this || !c.isAlive || c.destroyed) continue;
      if (!WOLF_PREY_KINDS.has(c.kind)) continue;
      const d = Math.hypot(c.worldX - this.worldX, c.worldY - this.worldY);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    this.prey = best;
  }

  private huntPrey(
    dt: number,
    eco: CreatureEcologyContext,
  ): { moved: boolean; attackHit: SpiderAttackHit | null } {
    const prey = this.prey;
    if (!prey || !prey.isAlive || prey.destroyed) {
      this.prey = null;
      return { moved: false, attackHit: null };
    }

    // 追击中超出记忆距离 → 丢失
    if (!this.inVision(prey.worldX, prey.worldY, WOLF_ECO.chaseMemory)) {
      this.prey = null;
      this.retargetCd = WOLF_ECO.retargetCd;
      return this.forageRoam(dt);
    }

    const dist = Math.hypot(
      prey.worldX - this.worldX,
      prey.worldY - this.worldY,
    );
    if (dist <= WOLF_ECO.eatRange) {
      prey.applyDamage(prey.maximumHp + 1);
      if (!prey.isAlive) {
        eco.removeCreature(prey);
      }
      this.hunger = Math.max(0, this.hunger - WOLF_ECO.mealFeed);
      this.wantRest = true;
      this.prey = null;
      this.restTree = null;
      this.retargetCd = WOLF_ECO.retargetCd;
      this.aiState = 'patrol';
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
