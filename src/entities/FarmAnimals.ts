import { Spider, type SpiderOptions } from './Spider';

export type FarmAnimalOptions = Pick<SpiderOptions, 'scale' | 'maxHp'>;

/** 相对贴图默认缩放：鸡小、猪/牛中、马/熊大 */
export const ANIMAL_SCALE = {
  chicken: 0.055,
  pig: 0.115,
  cow: 0.125,
  horse: 0.155,
  bear: 0.175,
} as const;

/** 动物脱战距离（世界像素）；超出后取消追击，回领地巡视 */
const ANIMAL_LEASH_RANGE = 380;

const FOOT_ANCHOR_Y = 0.92;
const HP_BAR_OFFSET_Y = 720;

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

export class Pig extends Spider {
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
