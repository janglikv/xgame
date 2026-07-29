import { Texture } from 'pixi.js';
import { getSpearTexture, SPEAR_TEX_ANGLE } from '../entities/SpearProjectile';
import type { SpearAmmoSnapshot } from '../entities/SpearAmmo';
import { BaseAmmoHud, type BaseAmmoHudOptions, type AmmoSpriteConfig } from './BaseAmmoHud';

export type SpearAmmoHudOptions = BaseAmmoHudOptions;

/**
 * 飞剑数量 HUD：血条上方，只画当前持有的飞剑。
 */
export class SpearAmmoHud extends BaseAmmoHud {
  private static readonly ICON_TILT =
    Math.PI * 0.72 - SPEAR_TEX_ANGLE + Math.PI;

  constructor(options: SpearAmmoHudOptions = {}) {
    super('SpearAmmoHud', 28, 20, options);
  }

  protected getTexture(): Texture | null {
    return getSpearTexture();
  }

  protected override getSpriteConfig(): AmmoSpriteConfig {
    return {
      anchor: { x: 0.5, y: 0.5 },
      rotation: SpearAmmoHud.ICON_TILT,
      alpha: 0.95,
    };
  }

  /**
   * 同步当前数量
   */
  setAmmo(snap: SpearAmmoSnapshot): void {
    this.updateAmmoCount(snap.current);
  }
}
