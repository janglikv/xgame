import type { ItemId } from '../data/items';
import { getItemDef } from '../data/items';

/** 一格：空或一种物品 + 数量 */
export type InventorySlot =
  | { id: ItemId; count: number }
  | null;

export type InventoryOptions = {
  /** 总格数（默认 8） */
  slotCount?: number;
  /** 内容变化时回调（HUD 刷新） */
  onChange?: () => void;
};

/**
 * 固定格背包：同类堆叠，满格后放新格；放不下返回剩余数量。
 */
export class Inventory {
  readonly slotCount: number;
  private readonly slots: InventorySlot[];
  private readonly onChange?: () => void;

  constructor(options: InventoryOptions = {}) {
    this.slotCount = Math.max(1, options.slotCount ?? 8);
    this.slots = Array.from({ length: this.slotCount }, () => null);
    this.onChange = options.onChange;
  }

  /** 只读快照（每格拷贝，避免外部改内部） */
  getSlots(): readonly InventorySlot[] {
    return this.slots.map((s) =>
      s ? { id: s.id, count: s.count } : null,
    );
  }

  /** 某物品总数量 */
  countOf(id: ItemId): number {
    let n = 0;
    for (const s of this.slots) {
      if (s?.id === id) n += s.count;
    }
    return n;
  }

  /**
   * 尝试放入；返回未能放入的剩余数量（0 = 全收）。
   */
  add(id: ItemId, count: number): number {
    let left = Math.max(0, Math.floor(count));
    if (left <= 0) return 0;

    const maxStack = getItemDef(id).maxStack;

    // 先填已有堆
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      const s = this.slots[i];
      if (!s || s.id !== id) continue;
      const room = maxStack - s.count;
      if (room <= 0) continue;
      const take = Math.min(room, left);
      s.count += take;
      left -= take;
    }

    // 再开新格
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      if (this.slots[i]) continue;
      const take = Math.min(maxStack, left);
      this.slots[i] = { id, count: take };
      left -= take;
    }

    if (left < count) this.notify();
    return left;
  }

  /** 是否至少能再收 1 个该物品 */
  canAccept(id: ItemId, count = 1): boolean {
    const need = Math.max(1, Math.floor(count));
    const maxStack = getItemDef(id).maxStack;
    let room = 0;
    for (const s of this.slots) {
      if (!s) {
        room += maxStack;
      } else if (s.id === id) {
        room += Math.max(0, maxStack - s.count);
      }
      if (room >= need) return true;
    }
    return false;
  }

  private notify(): void {
    this.onChange?.();
  }
}
