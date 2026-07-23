import { Assets, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import type { CharacterId } from '../entities/types';

export type CharacterSwitchHudOptions = {
  onSelect: (id: CharacterId) => void;
  /** 头像卡片宽（屏幕像素） */
  cardWidth?: number;
  /** 头像卡片高（屏幕像素） */
  cardHeight?: number;
  /** 相邻卡片间距 */
  gap?: number;
  /** 距屏幕右缘 */
  marginRight?: number;
  /** 距屏幕底边 */
  marginBottom?: number;
};

type Slot = {
  id: CharacterId;
  root: Container;
  ring: Graphics;
  dim: Graphics;
  sprite: Sprite;
  previewUrl: string;
};

const ROSTER: Array<{ id: CharacterId; previewUrl: string }> = [
  { id: 'bomb-girl', previewUrl: '/assets/bomb-girl/preview.png' },
  { id: 'ice-ranger', previewUrl: '/assets/ice-ranger/preview.png' },
];

/**
 * 右下角角色切换 HUD：横排长方形头像卡，点击切换当前操控角色。
 * 场上只应有一名角色；本组件不负责实体，只发 onSelect。
 */
export class CharacterSwitchHud extends Container {
  private readonly onSelect: (id: CharacterId) => void;
  private readonly cardW: number;
  private readonly cardH: number;
  private readonly gap: number;
  private readonly marginRight: number;
  private readonly marginBottom: number;
  private readonly slots: Slot[] = [];
  private activeId: CharacterId = 'bomb-girl';
  private viewWidth = 0;
  private viewHeight = 0;

  constructor(options: CharacterSwitchHudOptions) {
    super();
    this.label = 'CharacterSwitchHud';
    this.eventMode = 'static';
    this.sortableChildren = true;

    this.onSelect = options.onSelect;
    // 竖向长方形卡：窄且矮，整体占位更小
    this.cardW = options.cardWidth ?? 34;
    this.cardH = options.cardHeight ?? 48;
    this.gap = options.gap ?? 8;
    this.marginRight = options.marginRight ?? 16;
    this.marginBottom = options.marginBottom ?? 20;

    for (const entry of ROSTER) {
      this.slots.push(this.createSlot(entry.id, entry.previewUrl));
    }
    this.layoutSlots();
    this.refreshSelection();
  }

  get activeCharacterId(): CharacterId {
    return this.activeId;
  }

  /** 高亮当前角色；不触发 onSelect */
  setActive(id: CharacterId): void {
    if (this.activeId === id) return;
    this.activeId = id;
    this.refreshSelection();
  }

  async load(): Promise<void> {
    await Promise.all(this.slots.map((slot) => this.loadSlotTexture(slot)));
  }

  layout(width: number, height: number): void {
    this.viewWidth = width;
    this.viewHeight = height;
    this.layoutSlots();
  }

  private createSlot(id: CharacterId, previewUrl: string): Slot {
    const w = this.cardW;
    const h = this.cardH;
    const radius = 6;
    const root = new Container();
    root.label = `CharSlot:${id}`;
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new Rectangle(-w / 2, -h / 2, w, h);

    // 圆角矩形裁剪
    const mask = new Graphics()
      .roundRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4, radius - 1)
      .fill({ color: 0xffffff });
    mask.eventMode = 'none';

    const sprite = new Sprite(Texture.EMPTY);
    sprite.anchor.set(0.5);
    sprite.eventMode = 'none';
    sprite.mask = mask;

    const base = new Graphics()
      .roundRect(-w / 2, -h / 2, w, h, radius)
      .fill({ color: 0x1a2230, alpha: 0.92 });
    base.eventMode = 'none';

    const dim = new Graphics()
      .roundRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4, radius - 1)
      .fill({ color: 0x000000, alpha: 0.42 });
    dim.eventMode = 'none';
    dim.visible = false;

    const ring = new Graphics();
    ring.eventMode = 'none';

    root.addChild(base, sprite, mask, dim, ring);

    root.on('pointerover', () => {
      if (id === this.activeId) return;
      root.scale.set(1.06);
    });
    root.on('pointerout', () => {
      root.scale.set(id === this.activeId ? 1.08 : 1);
    });
    root.on('pointertap', (e) => {
      e.stopPropagation();
      if (id === this.activeId) return;
      this.onSelect(id);
    });

    this.addChild(root);

    return { id, root, ring, dim, sprite, previewUrl };
  }

  private async loadSlotTexture(slot: Slot): Promise<void> {
    try {
      const tex = await Assets.load<Texture>(slot.previewUrl);
      slot.sprite.texture = tex;
      // 竖卡：按高度铺满，略放大取上半身
      const scale = (this.cardH * 1.15) / Math.max(tex.height, 1);
      slot.sprite.scale.set(scale);
      slot.sprite.position.set(0, this.cardH * 0.06);
    } catch (err) {
      console.warn('[CharacterSwitchHud] avatar load failed:', slot.id, err);
    }
  }

  private layoutSlots(): void {
    const n = this.slots.length;
    if (n === 0) return;

    const w = this.cardW;
    const h = this.cardH;
    const totalW = n * w + (n - 1) * this.gap;
    // 横排贴右下角
    const y = this.viewHeight - this.marginBottom - h / 2;
    let x = this.viewWidth - this.marginRight - totalW + w / 2;

    for (const slot of this.slots) {
      slot.root.position.set(x, y);
      x += w + this.gap;
    }
  }

  private refreshSelection(): void {
    for (const slot of this.slots) {
      const active = slot.id === this.activeId;
      slot.dim.visible = !active;
      slot.root.scale.set(active ? 1.08 : 1);
      slot.root.alpha = active ? 1 : 0.88;
      this.paintRing(slot.ring, active);
    }
  }

  private paintRing(g: Graphics, active: boolean): void {
    const w = this.cardW;
    const h = this.cardH;
    const radius = 6;
    g.clear();
    if (active) {
      g.roundRect(-w / 2, -h / 2, w, h, radius).stroke({
        width: 2,
        color: 0xffd76a,
        alpha: 0.95,
      });
      g.roundRect(-w / 2 - 2, -h / 2 - 2, w + 4, h + 4, radius + 1).stroke({
        width: 1.25,
        color: 0xfff0b0,
        alpha: 0.32,
      });
    } else {
      g.roundRect(-w / 2, -h / 2, w, h, radius).stroke({
        width: 1.25,
        color: 0xffffff,
        alpha: 0.28,
      });
    }
  }
}
