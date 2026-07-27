import { PINE_SPACING } from '../../world/mapLayout';
import type { LevelMapDef } from './types';
import { emptyIslandDef } from './walkMask';

/**
 * 空白海岛模板（替代旧九宫格 walk 光栅化）。
 */
export function buildGridLevelDef(id = 'level-1'): LevelMapDef {
  return emptyIslandDef(id, {
    mapSize: 2880,
    cellSize: PINE_SPACING,
    seaMarginCells: 0,
  });
}

export const GRID_LAYOUT_META = {
  mapSize: 2880,
  cellSize: PINE_SPACING,
  seaMarginCells: 0,
} as const;
