/**
 * 物品定义（采集 / 合成 / 背包共用）。
 * P0 仅木头；后续木斧等在此扩展。
 */

export type ItemId = 'wood';

export type ItemDef = {
  id: ItemId;
  /** 中文名 */
  label: string;
  /** 单格堆叠上限 */
  maxStack: number;
  /** HUD / 掉落物主色 */
  color: number;
  /** 掉落物描边色 */
  outline: number;
};

export const ITEMS: Record<ItemId, ItemDef> = {
  wood: {
    id: 'wood',
    label: '木头',
    maxStack: 16,
    color: 0xc4a574,
    outline: 0x5c3d1e,
  },
};

export function getItemDef(id: ItemId): ItemDef {
  return ITEMS[id];
}
