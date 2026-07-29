import {
  WorldCreature,
  type WorldCreatureOptions,
} from './WorldCreature';

const WOODEN_DUMMY_URL = '/assets/wooden-dummy/wooden-dummy.png';

export type WoodenDummyOptions = Pick<WorldCreatureOptions, 'scale'>;

/**
 * 训练木桩：无敌、出生点绝对固定，只挨打不反击。
 * 无血条、无受击反馈、不被挤走、无 AI。
 */
export class WoodenDummy extends WorldCreature {
  constructor(
    worldX: number,
    worldY: number,
    options: WoodenDummyOptions = {},
  ) {
    super(worldX, worldY, {
      scale: options.scale ?? 0.09,
      kind: 'wooden-dummy',
      invincible: true,
      passive: true,
      immovable: true,
      appearance: {
        textureUrl: WOODEN_DUMMY_URL,
        label: 'WoodenDummy',
        spriteLabel: 'WoodenDummySprite',
        footAnchorY: 0.96,
        hpBarOffsetY: 900,
      },
    });
  }
}
