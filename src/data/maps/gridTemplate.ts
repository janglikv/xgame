import type { LevelMapDef } from './types';
import { emptyIslandDef } from './walkMask';

/**
 * 空白海岛模板。
 */
export function buildGridLevelDef(id = 'level-1'): LevelMapDef {
  return emptyIslandDef(id, {
    mapSize: 2880,
    seaMargin: 0,
  });
}

export const GRID_LAYOUT_META = {
  mapSize: 2880,
  seaMargin: 0,
} as const;
