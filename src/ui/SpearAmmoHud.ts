import { Container, Sprite } from 'pixi.js';
import { getSpearTexture, SPEAR_TEX_ANGLE } from '../entities/SpearProjectile';
import type { SpearAmmoSnapshot } from '../entities/SpearAmmo';

export type SpearAmmoHudOptions = {
  /** 单枚图标目标边长（屏幕像素） */
  slotSize?: number;
  /** 沿斜向相邻飞剑中心距 */
  gap?: number;
};

/**
 * 飞剑数量 HUD：血条上方，只画当前持有的飞剑。
 * 水平一排、Y 对齐；每枚自身斜置（\ 方向）；不显示上限、无恢复动画。
 */
export class SpearAmmoHud extends Container {
  private readonly slotSize: number;
  private readonly gap: number;
  private readonly slotsRoot: Container;
  private icons: Sprite[] = [];
  private lastCurrent = -1;
  /** 贴图是否已就绪（避免加载前画占位菱形后数量不变再不刷新） */
  private hadTexture = false;

  /**
   * 单枚斜置角：更斜的 / 排，剑尖朝右上（+π 翻转到贴图尖端一侧）。
   * 贴图默认尖相对 +X 为 SPEAR_TEX_ANGLE。
   */
  private static readonly ICON_TILT =
    Math.PI * 0.72 - SPEAR_TEX_ANGLE + Math.PI;

  constructor(options: SpearAmmoHudOptions = {}) {
    super();
    this.label = 'SpearAmmoHud';
    this.eventMode = 'none';

    this.slotSize = options.slotSize ?? 28;
    this.gap = options.gap ?? 20;

    this.slotsRoot = new Container();
    this.slotsRoot.label = 'SpearSlots';
    this.addChild(this.slotsRoot);
  }

  /**
   * 同步当前数量。
   * current 变化，或飞剑贴图从无到有时重建（与 BombAmmoHud 一致）。
   */
  setAmmo(snap: SpearAmmoSnapshot): void {
    const n = Math.max(0, Math.floor(snap.current));
    const tex = getSpearTexture();
    const hasTex = !!tex && tex.width > 0;
    if (n === this.lastCurrent && hasTex === this.hadTexture) return;
    this.lastCurrent = n;
    this.hadTexture = hasTex;
    this.rebuild(n);
  }

  private iconBaseScale(): number {
    const tex = getSpearTexture();
    if (!tex || tex.width < 1) return 0.08;
    const longest = Math.max(tex.width, tex.height);
    return (this.slotSize * 0.95) / longest;
  }

  private rebuild(count: number): void {
    for (const icon of this.icons) {
      icon.destroy();
    }
    this.icons = [];
    this.slotsRoot.removeChildren();

    if (count <= 0) return;

    const tex = getSpearTexture();
    // 贴图未加载时不画菱形占位，等 loadSpearTexture 后再刷
    if (!tex) return;

    const base = this.iconBaseScale();
    // 水平一排、Y 对齐；原点在左缘，向右铺（与血条左对齐）
    const startX = this.slotSize / 2;

    for (let i = 0; i < count; i++) {
      const sp = new Sprite(tex);
      sp.anchor.set(0.5, 0.5);
      sp.scale.set(base);
      sp.rotation = SpearAmmoHud.ICON_TILT;
      sp.position.set(startX + i * this.gap, 0);
      sp.alpha = 0.95;
      this.slotsRoot.addChild(sp);
      this.icons.push(sp);
    }
  }
}
