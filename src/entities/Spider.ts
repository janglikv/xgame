/**
 * 蜘蛛：WorldCreature 的默认敌对实现。
 * 通用逻辑见 WorldCreature；此处只钉死蜘蛛 kind 与默认外观。
 */
import {
  WorldCreature,
  type WorldCreatureOptions,
} from './WorldCreature';

export type {
  CreatureEcologyContext,
  EcologyGrass,
  EcologyTree,
  CreatureKind,
  WorldCreatureOptions,
  SpiderAIState,
  SpiderAttackHit,
  SpiderUpdateResult,
  WalkBobConfig,
} from './WorldCreature';

export { WorldCreature, loadSpiderTexture } from './WorldCreature';
export type SpiderOptions = WorldCreatureOptions;

export class Spider extends WorldCreature {
  constructor(
    worldX: number,
    worldY: number,
    options: WorldCreatureOptions = {},
  ) {
    super(worldX, worldY, {
      ...options,
      kind: 'spider',
      appearance: {
        textureUrl: '/assets/spider/spider.png',
        label: 'Spider',
        spriteLabel: 'SpiderSprite',
        footAnchorY: 0.88,
        hpBarOffsetY: 620,
        ...options.appearance,
      },
    });
  }
}
