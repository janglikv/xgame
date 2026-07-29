import {
  WorldCreature,
  type WorldCreatureOptions,
} from './WorldCreature';

const FLAME_FLOWER_URL = '/assets/flame-flower/flame-flower.png';

export type FlameFlowerOptions = Pick<
  WorldCreatureOptions,
  'scale' | 'maxHp'
>;

/**
 * 火焰花藤怪。
 * 沿用 WorldCreature 近战 AI 与受击逻辑，单独定义资源与 kind。
 */
export class FlameFlower extends WorldCreature {
  constructor(
    worldX: number,
    worldY: number,
    options: FlameFlowerOptions = {},
  ) {
    super(worldX, worldY, {
      scale: options.scale ?? 0.09,
      maxHp: options.maxHp,
      kind: 'flame-flower',
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
