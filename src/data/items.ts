/**
 * 物品定义（采集 / 合成 / 背包共用）。
 * P0 仅木头；后续木斧等在此扩展。
 */
import { Assets, Texture } from 'pixi.js';

export type ItemId = 'wood' | 'apple';

export type ItemDef = {
  id: ItemId;
  /** 中文名 */
  label: string;
  /** 单格堆叠上限 */
  maxStack: number;
  /** HUD / 掉落物主色（贴图未就绪时的回退色） */
  color: number;
  /** 掉落物描边色（贴图未就绪时的回退色） */
  outline: number;
  /** 真实物品图标路径（public） */
  iconUrl: string;
};

export const ITEMS: Record<ItemId, ItemDef> = {
  wood: {
    id: 'wood',
    label: '木头',
    maxStack: 16,
    color: 0xc4a574,
    outline: 0x5c3d1e,
    iconUrl: '/assets/items/wood.png',
  },
  apple: {
    id: 'apple',
    label: '苹果',
    maxStack: 16,
    color: 0xef3636,
    outline: 0x730e0e,
    iconUrl: '/assets/items/apple.png',
  },
};

export function getItemDef(id: ItemId): ItemDef {
  return ITEMS[id];
}

const itemTextures: Partial<Record<ItemId, Texture>> = {};
let itemTexturesLoading: Promise<void> | null = null;

/** 预加载全部物品图标（关卡启动时调用） */
export async function loadItemTextures(): Promise<void> {
  if (itemTexturesLoading) return itemTexturesLoading;
  itemTexturesLoading = (async () => {
    const entries = Object.values(ITEMS);
    const loaded = await Promise.all(
      entries.map((def) => Assets.load<Texture>(def.iconUrl)),
    );
    for (let i = 0; i < entries.length; i++) {
      itemTextures[entries[i]!.id] = loaded[i]!;
    }
  })();
  return itemTexturesLoading;
}

/** 取物品图标贴图（需先 loadItemTextures） */
export function getItemTexture(id: ItemId): Texture | null {
  return itemTextures[id] ?? null;
}
