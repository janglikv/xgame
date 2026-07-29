import { Texture } from 'pixi.js';
import { getBombTexture } from '../entities/BombProjectile';
import type { BombAmmoSnapshot } from '../entities/BombAmmo';
import { BaseAmmoHud, type BaseAmmoHudOptions, type AmmoSpriteConfig } from './BaseAmmoHud';

export type BombAmmoHudOptions = BaseAmmoHudOptions;

/**
 * 炸药数量 HUD：血条上方，用 `/assets/bomb/bomb.png` 画当前持有数量。
 */
export class BombAmmoHud extends BaseAmmoHud {
  constructor(options: BombAmmoHudOptions = {}) {
    super('BombAmmoHud', 30, 20.3, options);
  }

  protected getTexture(): Texture | null {
    return getBombTexture();
  }

  protected override getSpriteConfig(): AmmoSpriteConfig {
    return {
      anchor: { x: 0.5, y: 0.7 },
      rotation: 0,
      alpha: 0.95,
    };
  }

  /**
   * 同步当前数量
   */
  setAmmo(snap: BombAmmoSnapshot): void {
    this.updateAmmoCount(snap.current);
  }
}
