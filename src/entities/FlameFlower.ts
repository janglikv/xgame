import { Spider, type SpiderOptions } from './Spider';

const FLAME_FLOWER_URL = '/assets/flame-flower/flame-flower.png';

export type FlameFlowerOptions = Pick<SpiderOptions, 'scale' | 'maxHp'>;

/**
 * 火焰花藤怪。
 * 当前沿用蜘蛛的近战 AI 与受击逻辑，只单独定义资源和显示参数。
 */
export class FlameFlower extends Spider {
  constructor(
    worldX: number,
    worldY: number,
    options: FlameFlowerOptions = {},
  ) {
    super(worldX, worldY, {
      scale: options.scale ?? 0.09,
      maxHp: options.maxHp,
      appearance: {
        textureUrl: FLAME_FLOWER_URL,
        label: 'FlameFlower',
        spriteLabel: 'FlameFlowerSprite',
        footAnchorY: 0.94,
        hpBarOffsetY: 900,
      },
    });
  }
}
