import { Assets, Container, Sprite } from 'pixi.js';

const PREVIEW_URL = '/assets/frost-archer/preview.png';

/**
 * 寒冰射手（整图预览）
 * 原点在脚底中心附近。
 */
export class FrostArcher extends Container {
  private sprite: Sprite | null = null;

  constructor(scale = 1) {
    super();
    this.label = 'FrostArcher';
    this.scale.set(scale);
  }

  async load(): Promise<void> {
    if (this.sprite) return;

    const texture = await Assets.load(PREVIEW_URL);
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 0.92);
    sprite.label = 'FrostArcherSprite';
    this.sprite = sprite;
    this.addChild(sprite);
  }
}
