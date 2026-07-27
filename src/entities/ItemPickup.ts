import { Container, Graphics, Text } from 'pixi.js';
import type { ItemId } from '../data/items';
import { getItemDef } from '../data/items';

/** 自动拾取半径（脚底距离） */
export const PICKUP_RADIUS = 42;
/** 拾取物存在上限（秒），超时仍可捡 */
const BOB_SPEED = 3.2;
const BOB_AMP = 3.5;

export type ItemPickupOptions = {
  count?: number;
};

/**
 * 地上掉落物：靠近自动进包。
 * 原点 ≈ 图标中心略抬；zIndex 用脚底 worldY。
 */
export class ItemPickup extends Container {
  readonly itemId: ItemId;
  readonly count: number;
  worldX: number;
  worldY: number;

  private readonly bobPhase: number;
  private age = 0;
  private collected = false;

  constructor(
    worldX: number,
    worldY: number,
    itemId: ItemId,
    options: ItemPickupOptions = {},
  ) {
    super();
    this.label = 'ItemPickup';
    this.eventMode = 'none';
    this.itemId = itemId;
    this.count = Math.max(1, Math.floor(options.count ?? 1));
    this.worldX = worldX;
    this.worldY = worldY;
    this.bobPhase = Math.random() * Math.PI * 2;

    const def = getItemDef(itemId);
    const g = new Graphics();
    g.label = 'PickupGfx';
    // 简易「原木」方块
    g.roundRect(-9, -7, 18, 14, 3).fill({ color: def.color });
    g.roundRect(-9, -7, 18, 14, 3).stroke({
      width: 1.5,
      color: def.outline,
      alpha: 0.95,
    });
    g.circle(-4, 0, 2.2).fill({ color: def.outline, alpha: 0.35 });
    g.circle(3, 1, 1.8).fill({ color: def.outline, alpha: 0.28 });
    this.addChild(g);

    if (this.count > 1) {
      const t = new Text({
        text: `×${this.count}`,
        style: {
          fontFamily: 'system-ui, sans-serif',
          fontSize: 11,
          fontWeight: '700',
          fill: 0xfff6e0,
          stroke: { color: 0x1a1208, width: 3 },
        },
      });
      t.anchor.set(0.5, 0);
      t.position.set(0, 8);
      this.addChild(t);
    }

    this.syncToWorld();
  }

  get isCollected(): boolean {
    return this.collected;
  }

  markCollected(): void {
    this.collected = true;
  }

  update(deltaMS: number): void {
    this.age += deltaMS / 1000;
    this.syncToWorld();
  }

  syncToWorld(): void {
    const bob = Math.sin(this.age * BOB_SPEED + this.bobPhase) * BOB_AMP;
    this.position.set(this.worldX, this.worldY - 10 + bob);
    this.zIndex = this.worldY + 0.5;
  }
}
