import { Spider, type SpiderOptions } from './Spider';

const WOODEN_DUMMY_URL = '/assets/wooden-dummy/wooden-dummy.png';

export type WoodenDummyOptions = Pick<SpiderOptions, 'scale'>;

/**
 * 训练木桩：无敌、出生点绝对固定，只挨打不反击。
 * 受击有抖动反馈，无血条、不被挤走、无 AI。
 */
export class WoodenDummy extends Spider {
  constructor(
    worldX: number,
    worldY: number,
    options: WoodenDummyOptions = {},
  ) {
    super(worldX, worldY, {
      scale: options.scale ?? 0.09,
      invincible: true,
      passive: true,
      immovable: true,
      appearance: {
        textureUrl: WOODEN_DUMMY_URL,
        label: 'WoodenDummy',
        spriteLabel: 'WoodenDummySprite',
        // 竖直木桩脚底偏下
        footAnchorY: 0.96,
        hpBarOffsetY: 900,
      },
    });
  }
}
