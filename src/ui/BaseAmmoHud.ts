import { Container, Sprite, Texture } from 'pixi.js';

export type BaseAmmoHudOptions = {
  /** 单枚图标目标边长（屏幕像素） */
  slotSize?: number;
  /** 相邻图标中心距 */
  gap?: number;
};

export type AmmoSpriteConfig = {
  anchor?: { x: number; y: number };
  rotation?: number;
  alpha?: number;
};

/**
 * 弹药 HUD 通用基类：负责管理渲染槽位、图标销毁与重构逻辑。
 */
export abstract class BaseAmmoHud extends Container {
  protected readonly slotSize: number;
  protected readonly gap: number;
  protected readonly slotsRoot: Container;
  protected icons: Sprite[] = [];
  protected lastCurrent = -1;
  protected hadTexture = false;

  constructor(label: string, defaultSlotSize: number, defaultGap: number, options: BaseAmmoHudOptions = {}) {
    super();
    this.label = label;
    this.eventMode = 'none';

    this.slotSize = options.slotSize ?? defaultSlotSize;
    this.gap = options.gap ?? defaultGap;

    this.slotsRoot = new Container();
    this.slotsRoot.label = `${label}Slots`;
    this.addChild(this.slotsRoot);
  }

  /**
   * 获取当前弹药贴图
   */
  protected abstract getTexture(): Texture | null;

  /**
   * 获取精灵针对特定 UI 的配置（锚点、旋转角等）
   */
  protected getSpriteConfig(): AmmoSpriteConfig {
    return {
      anchor: { x: 0.5, y: 0.5 },
      rotation: 0,
      alpha: 0.95,
    };
  }

  /**
   * 基础图标缩放计算
   */
  protected iconBaseScale(tex: Texture | null, fallback = 0.05): number {
    if (!tex || tex.width < 1) return fallback;
    const longest = Math.max(tex.width, tex.height);
    return (this.slotSize * 0.95) / longest;
  }

  /**
   * 刷新同步弹药数量
   */
  protected updateAmmoCount(currentCount: number): void {
    const n = Math.max(0, Math.floor(currentCount));
    const tex = this.getTexture();
    const hasTex = !!tex && tex.width > 0;
    if (n === this.lastCurrent && hasTex === this.hadTexture) return;

    this.lastCurrent = n;
    this.hadTexture = hasTex;
    this.rebuild(n, tex);
  }

  private rebuild(count: number, tex: Texture | null): void {
    for (const icon of this.icons) {
      icon.destroy();
    }
    this.icons = [];
    this.slotsRoot.removeChildren();

    if (count <= 0 || !tex) return;

    const base = this.iconBaseScale(tex);
    const startX = this.slotSize / 2;
    const cfg = this.getSpriteConfig();

    for (let i = 0; i < count; i++) {
      const sp = new Sprite(tex);
      if (cfg.anchor) sp.anchor.set(cfg.anchor.x, cfg.anchor.y);
      sp.scale.set(base);
      if (cfg.rotation) sp.rotation = cfg.rotation;
      sp.position.set(startX + i * this.gap, 0);
      sp.alpha = cfg.alpha ?? 0.95;

      this.slotsRoot.addChild(sp);
      this.icons.push(sp);
    }
  }
}
