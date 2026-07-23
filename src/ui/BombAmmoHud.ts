import { Container, Sprite } from 'pixi.js';
import { getBombTexture } from '../entities/BombProjectile';
import type { BombAmmoSnapshot } from '../entities/BombAmmo';

export type BombAmmoHudOptions = {
  /** 单枚图标目标边长（屏幕像素） */
  slotSize?: number;
  /** 相邻炸弹中心距 */
  gap?: number;
};

/**
 * 炸药数量 HUD：血条上方，用 `/assets/bomb/bomb.png` 画当前持有数量。
 * 水平一排、Y 对齐；不显示上限、无恢复动画。
 */
export class BombAmmoHud extends Container {
  private readonly slotSize: number;
  private readonly gap: number;
  private readonly slotsRoot: Container;
  private icons: Sprite[] = [];
  private lastCurrent = -1;
  /** 贴图是否已就绪（避免加载前占位后不再刷新） */
  private hadTexture = false;

  constructor(options: BombAmmoHudOptions = {}) {
    super();
    this.label = 'BombAmmoHud';
    this.eventMode = 'none';

    // 默认 12 枚：图标略大，间距仍压在血条宽度内
    this.slotSize = options.slotSize ?? 30;
    this.gap = options.gap ?? 20.3;

    this.slotsRoot = new Container();
    this.slotsRoot.label = 'BombSlots';
    this.addChild(this.slotsRoot);
  }

  /**
   * 同步当前数量。
   * current 变化，或炸弹贴图从无到有时重建（保证用原 bomb.png）。
   */
  setAmmo(snap: BombAmmoSnapshot): void {
    const n = Math.max(0, Math.floor(snap.current));
    const tex = getBombTexture();
    const hasTex = !!tex && tex.width > 0;
    if (n === this.lastCurrent && hasTex === this.hadTexture) return;
    this.lastCurrent = n;
    this.hadTexture = hasTex;
    this.rebuild(n);
  }

  private iconBaseScale(): number {
    const tex = getBombTexture();
    if (!tex || tex.width < 1) return 0.04;
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

    const tex = getBombTexture();
    // 贴图未加载时不画占位，等 loadBombTextures 后再刷
    if (!tex) return;

    const base = this.iconBaseScale();
    const startX = this.slotSize / 2;

    for (let i = 0; i < count; i++) {
      const sp = new Sprite(tex);
      // 与飞行炸弹一致：中心偏下锚点
      sp.anchor.set(0.5, 0.7);
      sp.scale.set(base);
      sp.position.set(startX + i * this.gap, 0);
      sp.alpha = 0.95;
      this.slotsRoot.addChild(sp);
      this.icons.push(sp);
    }
  }
}
