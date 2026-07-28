import {
  Spider,
  type CreatureEcologyContext,
  type SpiderAttackHit,
  type SpiderOptions,
} from './Spider';
import type { BodyProfileId } from '../data/bodyProfiles';

export type FarmAnimalOptions = Pick<SpiderOptions, 'scale' | 'maxHp'>;

/** 相对贴图默认缩放：鸡小、猪/牛中、马/熊大 */
export const ANIMAL_SCALE = {
  chicken: 0.042,
  pig: 0.115,
  cow: 0.125,
  horse: 0.155,
  wolf: 0.06,
  bear: 0.175,
} as const;

/** 动物脱战距离（世界像素）；超出后取消追击，回领地巡视 */
const ANIMAL_LEASH_RANGE = 380;

const FOOT_ANCHOR_Y = 0.92;
const HP_BAR_OFFSET_Y = 720;

/** 猪觅食参数 */
const PIG_ECO = {
  /** 饥饿增长速度：约 35 秒从 0→1 */
  hungerPerSec: 0.028,
  /** 开始找苹果 */
  seekAppleAt: 0.32,
  /** 饿极了：范围内没有苹果才吃鸡 */
  seekChickenAt: 0.72,
  /** 感知苹果半径 */
  appleSense: 480,
  /** 感知鸡半径 */
  chickenSense: 400,
  /** 吃到距离 */
  eatRange: 32,
  /** 觅食移速 */
  forageSpeed: 98,
  /** 吃一个苹果减少的饥饿 */
  appleFeed: 0.48,
  /** 开局略饿，方便观察觅食 */
  startHunger: 0.4,
} as const;

/**
 * 农场动物：只巡视；玩家不打则完全忽略。
 * 被打后短追但不近战；超出脱战距离回巡视。
 */
function animalOptions(
  options: FarmAnimalOptions,
  defaultScale: number,
  appearance: {
    textureUrl: string;
    label: string;
    spriteLabel: string;
  },
): SpiderOptions {
  return {
    scale: options.scale ?? defaultScale,
    maxHp: options.maxHp,
    canAttack: false,
    aggroOnDetect: false,
    leashRange: ANIMAL_LEASH_RANGE,
    appearance: {
      textureUrl: appearance.textureUrl,
      label: appearance.label,
      spriteLabel: appearance.spriteLabel,
      footAnchorY: FOOT_ANCHOR_Y,
      hpBarOffsetY: HP_BAR_OFFSET_Y,
    },
  };
}

export class Chicken extends Spider {
  constructor(worldX: number, worldY: number, options: FarmAnimalOptions = {}) {
    super(
      worldX,
      worldY,
      animalOptions(options, ANIMAL_SCALE.chicken, {
        textureUrl: '/assets/chicken/chicken.png',
        label: 'Chicken',
        spriteLabel: 'ChickenSprite',
      }),
    );
  }
}

/**
 * 猪：优先找地上苹果吃；饿极了且附近没苹果才吃鸡。
 * 玩家不打则忽略玩家；被打后短追（继承动物设定）。
 */
export class Pig extends Spider {
  /** 0 饱 → 1 极饿 */
  private hunger: number = PIG_ECO.startHunger;

  constructor(worldX: number, worldY: number, options: FarmAnimalOptions = {}) {
    super(
      worldX,
      worldY,
      animalOptions(options, ANIMAL_SCALE.pig, {
        textureUrl: '/assets/pig/pig.png',
        label: 'Pig',
        spriteLabel: 'PigSprite',
      }),
    );
  }

  get hunger01(): number {
    return this.hunger;
  }

  protected override updateAI(
    dt: number,
    playerX: number,
    playerY: number,
    playerBodyProfileId: BodyProfileId | null = null,
  ): { moved: boolean; attackHit: SpiderAttackHit | null } {
    // 被玩家打后：沿用基类追击 / 脱战
    if (this.locked) {
      return super.updateAI(dt, playerX, playerY, playerBodyProfileId);
    }

    this.hunger = Math.min(1, this.hunger + PIG_ECO.hungerPerSec * dt);

    const eco = this.ecology;
    if (eco && this.hunger >= PIG_ECO.seekAppleAt) {
      const apple = this.findNearestApple(eco);
      if (apple) {
        return this.seekApple(dt, apple, eco);
      }
      if (this.hunger >= PIG_ECO.seekChickenAt) {
        const chicken = this.findNearestChicken(eco);
        if (chicken) {
          return this.seekChicken(dt, chicken, eco);
        }
      }
    }

    return { moved: this.updatePatrol(dt), attackHit: null };
  }

  private findNearestApple(
    eco: CreatureEcologyContext,
  ): CreatureEcologyContext['pickups'][number] | null {
    let best: CreatureEcologyContext['pickups'][number] | null = null;
    let bestD: number = PIG_ECO.appleSense;
    for (const p of eco.pickups) {
      if (p.isCollected || p.itemId !== 'apple') continue;
      const d = Math.hypot(p.worldX - this.worldX, p.worldY - this.worldY);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  private findNearestChicken(eco: CreatureEcologyContext): Spider | null {
    let best: Spider | null = null;
    let bestD: number = PIG_ECO.chickenSense;
    for (const c of eco.creatures) {
      if (c === this || !c.isAlive || c.label !== 'Chicken') continue;
      const d = Math.hypot(c.worldX - this.worldX, c.worldY - this.worldY);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  private seekApple(
    dt: number,
    apple: CreatureEcologyContext['pickups'][number],
    eco: CreatureEcologyContext,
  ): { moved: boolean; attackHit: SpiderAttackHit | null } {
    this.aiState = 'chase';
    this.patrolPause = 0;
    const dist = Math.hypot(
      apple.worldX - this.worldX,
      apple.worldY - this.worldY,
    );
    if (dist <= PIG_ECO.eatRange) {
      if (!apple.isCollected) {
        eco.consumePickup(apple);
        this.hunger = Math.max(0, this.hunger - PIG_ECO.appleFeed);
      }
      return { moved: false, attackHit: null };
    }
    const moved = this.moveToward(
      apple.worldX,
      apple.worldY,
      PIG_ECO.forageSpeed,
      dt,
      PIG_ECO.eatRange * 0.5,
    );
    return { moved, attackHit: null };
  }

  private seekChicken(
    dt: number,
    chicken: Spider,
    eco: CreatureEcologyContext,
  ): { moved: boolean; attackHit: SpiderAttackHit | null } {
    this.aiState = 'chase';
    this.patrolPause = 0;
    if (!chicken.isAlive) {
      return { moved: this.updatePatrol(dt), attackHit: null };
    }
    const dist = Math.hypot(
      chicken.worldX - this.worldX,
      chicken.worldY - this.worldY,
    );
    if (dist <= PIG_ECO.eatRange) {
      // 一口闷：生态捕食，不走玩家受击逻辑
      chicken.applyDamage(chicken.maximumHp + 1);
      if (!chicken.isAlive) {
        eco.removeCreature(chicken);
      }
      this.hunger = 0;
      return { moved: false, attackHit: null };
    }
    const moved = this.moveToward(
      chicken.worldX,
      chicken.worldY,
      PIG_ECO.forageSpeed * 1.05,
      dt,
      PIG_ECO.eatRange * 0.45,
    );
    return { moved, attackHit: null };
  }
}

export class Cow extends Spider {
  constructor(worldX: number, worldY: number, options: FarmAnimalOptions = {}) {
    super(
      worldX,
      worldY,
      animalOptions(options, ANIMAL_SCALE.cow, {
        textureUrl: '/assets/cow/cow.png',
        label: 'Cow',
        spriteLabel: 'CowSprite',
      }),
    );
  }
}

export class Horse extends Spider {
  constructor(worldX: number, worldY: number, options: FarmAnimalOptions = {}) {
    super(
      worldX,
      worldY,
      animalOptions(options, ANIMAL_SCALE.horse, {
        textureUrl: '/assets/horse/horse.png',
        label: 'Horse',
        spriteLabel: 'HorseSprite',
      }),
    );
  }
}

export class Wolf extends Spider {
  constructor(worldX: number, worldY: number, options: FarmAnimalOptions = {}) {
    super(
      worldX,
      worldY,
      animalOptions(options, ANIMAL_SCALE.wolf, {
        textureUrl: '/assets/wolf/wolf.png',
        label: 'Wolf',
        spriteLabel: 'WolfSprite',
      }),
    );
  }
}

export class Bear extends Spider {
  constructor(worldX: number, worldY: number, options: FarmAnimalOptions = {}) {
    super(
      worldX,
      worldY,
      animalOptions(options, ANIMAL_SCALE.bear, {
        textureUrl: '/assets/bear/bear.png',
        label: 'Bear',
        spriteLabel: 'BearSprite',
      }),
    );
  }
}
