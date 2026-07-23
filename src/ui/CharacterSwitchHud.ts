import { Assets, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import type { CharacterId } from '../entities/types';

export type CharacterSwitchHudOptions = {
  onSelect: (id: CharacterId) => void;
  /** 头像直径（屏幕像素） */
  avatarSize?: number;
  /** 相邻头像间距 */
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
 * 右下角角色切换 HUD：竖排小圆形头像，点击切换当前操控角色。
 * 场上只应有一名角色；本组件不负责实体，只发 onSelect。
 */
export class CharacterSwitchHud extends Container {
  private readonly onSelect: (id: CharacterId) => void;
  private readonly avatarSize: number;
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
    this.avatarSize = options.avatarSize ?? 48;
    this.gap = options.gap ?? 10;
    this.marginRight = options.marginRight ?? 18;
    this.marginBottom = options.marginBottom ?? 22;

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
    const size = this.avatarSize;
    const root = new Container();
    root.label = `CharSlot:${id}`;
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new Rectangle(-size / 2, -size / 2, size, size);

    // 圆形裁剪：mask 与头像同父级
    const mask = new Graphics()
      .circle(0, 0, size / 2 - 3)
      .fill({ color: 0xffffff });
    mask.eventMode = 'none';

    const sprite = new Sprite(Texture.EMPTY);
    sprite.anchor.set(0.5);
    sprite.eventMode = 'none';
    sprite.mask = mask;

    // 暗角底，贴图未就绪时也能看出槽位
    const base = new Graphics()
      .circle(0, 0, size / 2 - 2)
      .fill({ color: 0x1a2230, alpha: 0.92 });
    base.eventMode = 'none';

    const dim = new Graphics()
      .circle(0, 0, size / 2 - 3)
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
      // 头像偏上半身：略放大并以胸口为中心
      const size = this.avatarSize;
      const scale = (size * 1.35) / Math.max(tex.width, tex.height);
      slot.sprite.scale.set(scale);
      slot.sprite.position.set(0, size * 0.08);
    } catch (err) {
      console.warn('[CharacterSwitchHud] avatar load failed:', slot.id, err);
    }
  }

  private layoutSlots(): void {
    const n = this.slots.length;
    if (n === 0) return;

    const size = this.avatarSize;
    const x = this.viewWidth - this.marginRight - size / 2;
    // 自下而上堆叠：roster 顺序从上到下，最底一个贴底边 margin
    let y = this.viewHeight - this.marginBottom - size / 2;
    for (let i = n - 1; i >= 0; i--) {
      const slot = this.slots[i]!;
      slot.root.position.set(x, y);
      y -= size + this.gap;
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
    const r = this.avatarSize / 2;
    g.clear();
    if (active) {
      g.circle(0, 0, r).stroke({
        width: 2.5,
        color: 0xffd76a,
        alpha: 0.95,
      });
      g.circle(0, 0, r + 3).stroke({
        width: 1.5,
        color: 0xfff0b0,
        alpha: 0.35,
      });
    } else {
      g.circle(0, 0, r).stroke({
        width: 1.5,
        color: 0xffffff,
        alpha: 0.28,
      });
    }
  }
}
