import {
  WorldCreature,
  type CreatureEcologyContext,
  type SpiderAttackHit,
  type WalkBobConfig,
} from '../WorldCreature';
import type { CreatureKind } from '../creatureKinds';
import type { BodyProfileId } from '../../data/bodyProfiles';
import { GRASS_ANIMAL_RETARGET_SEC } from '../../data/grassProfiles';
import { isOnGreenLand, landRectOf } from '../../data/maps';
import {
  ANIMAL_SCALE,
  ANIMAL_WALK_BOB,
  animalOptions,
  type FarmAnimalOptions,
} from './animalCommon';

/** 食草动物（牛 / 马）共用参数 */
export type HerbivoreEco = {
  hungerPerSec: number;
  eatRange: number;
  /** 饿时移速 */
  forageSpeed: number;
  /** 饱时移速（更慢） */
  fullSpeed: number;
  grassFeed: { small: number; medium: number; large: number };
  startHunger: number;
  /** 吃草停顿时长（秒） */
  eatPauseSec?: number;
};

export const COW_ECO: HerbivoreEco = {
  hungerPerSec: 0.02,
  eatRange: 38,
  forageSpeed: 72,
  fullSpeed: 28,
  grassFeed: { small: 0.22, medium: 0.4, large: 0.62 },
  startHunger: 0.25,
  eatPauseSec: 3.2,
};

export const HORSE_ECO: HerbivoreEco = {
  hungerPerSec: 0.024,
  eatRange: 36,
  forageSpeed: 108,
  fullSpeed: 42,
  grassFeed: { small: 0.18, medium: 0.34, large: 0.52 },
  startHunger: 0.25,
  eatPauseSec: 2.5,
};

/**
 * 食草基类：只找最近的大草吃；饱了走慢、饿了走快；没草会饿死。
 * 吃草时停下停顿并切换低头吃草贴图，结束后恢复站立贴图。
 */
export abstract class GrassEater extends WorldCreature {
  private hunger: number;
  private readonly ecoCfg: HerbivoreEco;
  private readonly idleTextureUrl: string;
  private readonly eatTextureUrl: string;
  /** 锁定的大草目标（降频重选） */
  private grassTarget: CreatureEcologyContext['grasses'][number] | null = null;
  private retargetT = 0;
  /** 吃草停顿倒计时（秒） */
  private eatTimer = 0;
  /** 当前停下吃的草目标 */
  private eatingGrassTarget: CreatureEcologyContext['grasses'][number] | null = null;
  /** 是否显示吃草贴图 */
  private showingEatPose = false;

  protected constructor(
    worldX: number,
    worldY: number,
    options: FarmAnimalOptions,
    scale: number,
    kind: CreatureKind,
    appearance: {
      textureUrl: string;
      /** 低头吃草贴图 */
      eatTextureUrl: string;
      label: string;
      spriteLabel: string;
    },
    ecoCfg: HerbivoreEco,
    walkBob: WalkBobConfig = ANIMAL_WALK_BOB.large,
  ) {
    super(
      worldX,
      worldY,
      animalOptions(
        options,
        scale,
        kind,
        {
          textureUrl: appearance.textureUrl,
          label: appearance.label,
          spriteLabel: appearance.spriteLabel,
        },
        walkBob,
      ),
    );
    this.ecoCfg = ecoCfg;
    this.hunger = ecoCfg.startHunger;
    this.idleTextureUrl = appearance.textureUrl;
    this.eatTextureUrl = appearance.eatTextureUrl;
  }

  override async load(): Promise<void> {
    await super.load();
    // 预缓存吃草贴图，避免第一次低头时闪一下
    await this.preloadSpriteTexture(this.eatTextureUrl);
  }

  get hunger01(): number {
    return this.hunger;
  }

  /** 切换站立 / 低头吃草贴图 */
  private setEatPose(on: boolean): void {
    if (this.showingEatPose === on) return;
    this.showingEatPose = on;
    void this.applyEatPose(on);
  }

  private async applyEatPose(on: boolean): Promise<void> {
    const url = on ? this.eatTextureUrl : this.idleTextureUrl;
    await this.setSpriteTexture(url);
    // 异步期间姿态可能又切了，以最新状态为准再补一次
    if (this.showingEatPose !== on && !this.destroyed) {
      await this.setSpriteTexture(
        this.showingEatPose ? this.eatTextureUrl : this.idleTextureUrl,
      );
    }
  }

  private clearEating(): void {
    this.eatingGrassTarget = null;
    this.eatTimer = 0;
    this.setEatPose(false);
  }

  /** 越饿越快：hunger 0→fullSpeed，1→forageSpeed */
  private moveSpeed(): number {
    const cfg = this.ecoCfg;
    const t = Math.min(1, Math.max(0, this.hunger));
    return cfg.fullSpeed + t * (cfg.forageSpeed - cfg.fullSpeed);
  }

  /** 场上最近一丛可啃的大草（优先网格） */
  private findNearestGrass(
    eco: CreatureEcologyContext,
  ): { grass: CreatureEcologyContext['grasses'][number]; dist: number } | null {
    if (eco.findNearestLargeGrass) {
      return eco.findNearestLargeGrass(this.worldX, this.worldY);
    }
    let best: CreatureEcologyContext['grasses'][number] | null = null;
    let bestD = Infinity;
    for (const g of eco.grasses) {
      if (g.size !== 'large') continue;
      const grazable =
        'isGrazable' in g ? (g as { isGrazable: boolean }).isGrazable : true;
      if (!grazable) continue;
      const d = Math.hypot(g.worldX - this.worldX, g.worldY - this.worldY);
      if (d < bestD) {
        bestD = d;
        best = g;
      }
    }
    return best ? { grass: best, dist: bestD } : null;
  }

  private refreshGrassTarget(
    eco: CreatureEcologyContext,
    force: boolean,
  ): { grass: CreatureEcologyContext['grasses'][number]; dist: number } | null {
    if (!force && this.grassTarget) {
      const g = this.grassTarget;
      const still =
        g.size === 'large' &&
        ('isGrazable' in g ? (g as { isGrazable: boolean }).isGrazable : true) &&
        eco.grasses.includes(g as (typeof eco.grasses)[number]);
      if (still) {
        const dist = Math.hypot(g.worldX - this.worldX, g.worldY - this.worldY);
        return { grass: g, dist };
      }
      this.grassTarget = null;
    }
    const nearest = this.findNearestGrass(eco);
    this.grassTarget = nearest?.grass ?? null;
    return nearest;
  }

  protected override updateAI(
    dt: number,
    playerX: number,
    playerY: number,
    playerBodyProfileId: BodyProfileId | null = null,
  ): { moved: boolean; attackHit: SpiderAttackHit | null } {
    if (this.locked) {
      this.grassTarget = null;
      this.clearEating();
      return super.updateAI(dt, playerX, playerY, playerBodyProfileId);
    }

    const cfg = this.ecoCfg;
    this.hunger = Math.min(1, this.hunger + cfg.hungerPerSec * dt);
    const eco = this.ecology;
    const speed = this.moveSpeed();

    if (eco && this.hunger >= 1) {
      this.clearEating();
      this.applyDamage(this.maximumHp + 1);
      if (!this.isAlive) eco.removeCreature(this);
      return { moved: false, attackHit: null };
    }

    if (!eco) {
      return { moved: false, attackHit: null };
    }

    // 正在停下吃草中
    if (this.eatingGrassTarget) {
      const g = this.eatingGrassTarget;
      const valid =
        eco.grasses.includes(g as (typeof eco.grasses)[number]) &&
        ('isGrazable' in g ? (g as { isGrazable: boolean }).isGrazable : true);

      if (!valid) {
        this.clearEating();
      } else {
        this.eatTimer -= dt;
        this.faceToward(g.worldX, g.worldY);
        this.aiState = 'patrol';
        this.setEatPose(true);

        if (this.eatTimer > 0) {
          return { moved: false, attackHit: null };
        }

        // 吃草停顿完成，扣减草体型并补充饥饿值
        const sizeBefore = g.size;
        const result = eco.consumeGrass(g);
        if (result) {
          const feed =
            cfg.grassFeed[result] ??
            cfg.grassFeed[sizeBefore] ??
            cfg.grassFeed.medium;
          this.hunger = Math.max(0, this.hunger - feed);
        }
        this.clearEating();
        this.grassTarget = null;
        this.retargetT = 1.0; // 吃完草后多留 1.0 秒停顿，避免无缝奔向下一草丛
        return { moved: false, attackHit: null };
      }
    }

    this.retargetT -= dt;
    const forceRetarget = this.retargetT <= 0 || !this.grassTarget;
    if (forceRetarget) {
      this.retargetT = GRASS_ANIMAL_RETARGET_SEC;
    }
    const nearest = this.refreshGrassTarget(eco, forceRetarget);

    if (nearest) {
      const { grass, dist } = nearest;
      if (dist <= cfg.eatRange) {
        // 到达吃草范围：停下来，开启吃草倒计时并换低头贴图（牛 3.2s，马 2.5s）
        this.eatingGrassTarget = grass;
        this.eatTimer = cfg.eatPauseSec ?? 3.0;
        this.aiState = 'patrol';
        this.faceToward(grass.worldX, grass.worldY);
        this.setEatPose(true);
        return { moved: false, attackHit: null };
      }
      this.aiState = 'chase';
      const moved = this.moveTowardAvoidingTrees(
        grass.worldX,
        grass.worldY,
        speed,
        dt,
        8,
        20,
      );
      return { moved, attackHit: null };
    }

    // 没草：若在沙滩，慢走回岛中心；否则站着等草长
    if (eco.mapDef && !isOnGreenLand(this.worldX, this.worldY, eco.mapDef)) {
      const land = landRectOf(eco.mapDef);
      this.aiState = 'chase';
      const moved = this.moveTowardAvoidingTrees(
        land.x + land.w * 0.5,
        land.y + land.h * 0.5,
        speed,
        dt,
        8,
        20,
      );
      return { moved, attackHit: null };
    }

    return { moved: false, attackHit: null };
  }
}

/** 牛：只找最近大草吃，饱了走慢；没草会饿死 */
export class Cow extends GrassEater {
  constructor(worldX: number, worldY: number, options: FarmAnimalOptions = {}) {
    super(
      worldX,
      worldY,
      options,
      ANIMAL_SCALE.cow,
      'cow',
      {
        textureUrl: '/assets/cow/cow.png',
        eatTextureUrl: '/assets/cow/cow-eat.png',
        label: 'Cow',
        spriteLabel: 'CowSprite',
      },
      COW_ECO,
    );
  }
}

/** 马：只找最近大草吃，饱了走慢、饿了跑快；没草会饿死 */
export class Horse extends GrassEater {
  constructor(worldX: number, worldY: number, options: FarmAnimalOptions = {}) {
    super(
      worldX,
      worldY,
      options,
      ANIMAL_SCALE.horse,
      'horse',
      {
        textureUrl: '/assets/horse/horse.png',
        eatTextureUrl: '/assets/horse/horse-eat.png',
        label: 'Horse',
        spriteLabel: 'HorseSprite',
      },
      HORSE_ECO,
    );
  }
}
