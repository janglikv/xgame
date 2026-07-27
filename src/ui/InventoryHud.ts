import { Container, Graphics, Text } from 'pixi.js';
import type { InventorySlot } from '../systems/Inventory';
import { getItemDef } from '../data/items';

export type InventoryHudOptions = {
  slotSize?: number;
  gap?: number;
};

/**
 * 背包 HUD：底部一排固定格，显示物品色块 + 数量。
 */
export class InventoryHud extends Container {
  private readonly slotSize: number;
  private readonly gap: number;
  private readonly slotsRoot: Container;
  private slotCount = 0;
  private cells: Array<{
    root: Container;
    fill: Graphics;
    countText: Text;
  }> = [];

  constructor(options: InventoryHudOptions = {}) {
    super();
    this.label = 'InventoryHud';
    this.eventMode = 'none';
    this.slotSize = options.slotSize ?? 36;
    this.gap = options.gap ?? 6;

    this.slotsRoot = new Container();
    this.slotsRoot.label = 'InvSlots';
    this.addChild(this.slotsRoot);

    const title = new Text({
      text: '背包',
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 12,
        fontWeight: '600',
        fill: 0xd8e4f0,
      },
    });
    title.anchor.set(0, 1);
    title.position.set(0, -6);
    this.addChild(title);
  }

  /** 按背包快照刷新；格数变化时重建 */
  setSlots(slots: readonly InventorySlot[]): void {
    if (slots.length !== this.slotCount) {
      this.rebuildCells(slots.length);
    }
    for (let i = 0; i < slots.length; i++) {
      this.paintCell(i, slots[i] ?? null);
    }
  }

  /** 左下角布局：origin = 第一格左上 */
  layout(viewW: number, viewH: number): void {
    const margin = 18;
    const totalW =
      this.slotCount > 0
        ? this.slotCount * this.slotSize + (this.slotCount - 1) * this.gap
        : this.slotSize;
    const x = margin;
    const y = viewH - margin - this.slotSize;
    this.position.set(x, y);
    // 避免 unused（多分辨率时仍可贴右）
    void viewW;
    void totalW;
  }

  private rebuildCells(count: number): void {
    this.slotsRoot.removeChildren();
    for (const c of this.cells) {
      c.root.destroy({ children: true });
    }
    this.cells = [];
    this.slotCount = count;

    for (let i = 0; i < count; i++) {
      const root = new Container();
      root.position.set(i * (this.slotSize + this.gap), 0);

      const bg = new Graphics();
      bg.roundRect(0, 0, this.slotSize, this.slotSize, 6).fill({
        color: 0x0e1624,
        alpha: 0.82,
      });
      bg.roundRect(0, 0, this.slotSize, this.slotSize, 6).stroke({
        width: 1.5,
        color: 0x4a6280,
        alpha: 0.9,
      });
      root.addChild(bg);

      const fill = new Graphics();
      root.addChild(fill);

      const countText = new Text({
        text: '',
        style: {
          fontFamily: 'system-ui, sans-serif',
          fontSize: 12,
          fontWeight: '700',
          fill: 0xfff8e8,
          stroke: { color: 0x101820, width: 3 },
        },
      });
      countText.anchor.set(1, 1);
      countText.position.set(this.slotSize - 4, this.slotSize - 3);
      root.addChild(countText);

      this.slotsRoot.addChild(root);
      this.cells.push({ root, fill, countText });
    }
  }

  private paintCell(index: number, slot: InventorySlot): void {
    const cell = this.cells[index];
    if (!cell) return;
    cell.fill.clear();
    if (!slot) {
      cell.countText.text = '';
      return;
    }
    const def = getItemDef(slot.id);
    const pad = 7;
    const s = this.slotSize - pad * 2;
    cell.fill
      .roundRect(pad, pad, s, s, 4)
      .fill({ color: def.color });
    cell.fill
      .roundRect(pad, pad, s, s, 4)
      .stroke({ width: 1.2, color: def.outline, alpha: 0.9 });
    cell.countText.text = slot.count > 1 ? String(slot.count) : '';
  }
}
