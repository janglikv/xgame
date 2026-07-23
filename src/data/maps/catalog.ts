import { LEVEL_1 } from './level-1';
import { LEVEL_2 } from './level-2';
import type { LevelMapDef } from './types';

/** 关卡目录（顺序 = 主菜单按钮顺序） */
export const LEVEL_CATALOG: readonly LevelMapDef[] = [LEVEL_1, LEVEL_2];

export type LevelId = (typeof LEVEL_CATALOG)[number]['id'];

export function getLevelById(id: string): LevelMapDef | null {
  return LEVEL_CATALOG.find((l) => l.id === id) ?? null;
}

export function getLevelIndex(id: string): number {
  return LEVEL_CATALOG.findIndex((l) => l.id === id);
}

/** 展示名：第一关 / 第二关 … */
export function levelDisplayName(index: number): string {
  return `第${index + 1}关`;
}
