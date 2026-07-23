import {
  CELL_PITCH,
  FOREST_WIDTH,
  GRID,
  ISLAND_SIZE,
  MAP_SIZE,
  OUTER_FOREST_WIDTH,
  PINE_SPACING,
  islandCenter,
  isRemovedIsland,
} from '../../world/mapLayout';
import type { LevelMapDef } from './types';
import {
  defFromCells,
  gridDims,
  rasterizeWorldRect,
} from './walkMask';

/**
 * 与旧版碰撞一致的过道净空宽度：
 * PATH_WIDTH(156) + 树冠余量(26 * PINE_SCALE≈2.7)
 */
const PATH_CLEAR = 156 + 26 * 2.7;

const SPAWN_ISLAND = { ix: 1, iy: GRID - 1 } as const;

/**
 * 将现行九宫格布局光栅化为「树宽格子」可走区。
 */
export function buildGridLevelDef(id = 'level-1'): LevelMapDef {
  const cellSize = PINE_SPACING;
  const cells = new Set<number>();

  const stamp = (x: number, y: number, w: number, h: number) => {
    rasterizeWorldRect(x, y, w, h, MAP_SIZE, cellSize, cells);
  };

  for (let iy = 0; iy < GRID; iy++) {
    for (let ix = 0; ix < GRID; ix++) {
      if (isRemovedIsland(ix, iy)) continue;
      const c = islandCenter(ix, iy);
      const half = ISLAND_SIZE / 2;
      stamp(c.x - half, c.y - half, ISLAND_SIZE, ISLAND_SIZE);
    }
  }

  const half = PATH_CLEAR / 2;

  for (let iy = 0; iy < GRID; iy++) {
    for (let ix = 0; ix < GRID - 1; ix++) {
      if (
        iy === SPAWN_ISLAND.iy &&
        (ix === SPAWN_ISLAND.ix - 1 || ix === SPAWN_ISLAND.ix)
      ) {
        continue;
      }
      const a = islandCenter(ix, iy);
      const b = islandCenter(ix + 1, iy);
      const x0 = a.x + ISLAND_SIZE / 2;
      const x1 = b.x - ISLAND_SIZE / 2;
      const left = Math.min(x0, x1);
      const len = Math.abs(x1 - x0);
      stamp(left, a.y - half, len, PATH_CLEAR);
    }
  }

  for (let iy = 0; iy < GRID - 1; iy++) {
    for (let ix = 0; ix < GRID; ix++) {
      if (iy === GRID - 2 && (ix === 0 || ix === GRID - 1)) {
        continue;
      }
      const a = islandCenter(ix, iy);
      const b = islandCenter(ix, iy + 1);
      const y0 = a.y + ISLAND_SIZE / 2;
      const y1 = b.y - ISLAND_SIZE / 2;
      const top = Math.min(y0, y1);
      const len = Math.abs(y1 - y0);
      stamp(a.x - half, top, PATH_CLEAR, len);
    }
  }

  const spawn = islandCenter(SPAWN_ISLAND.ix, SPAWN_ISLAND.iy);
  const { cols } = gridDims(MAP_SIZE, cellSize);
  void cols;

  return defFromCells(
    {
      id,
      mapSize: MAP_SIZE,
      cellSize,
      spawn: { x: spawn.x, y: spawn.y },
    },
    cells,
  );
}

export const GRID_LAYOUT_META = {
  grid: GRID,
  islandSize: ISLAND_SIZE,
  forestWidth: FOREST_WIDTH,
  outerForest: OUTER_FOREST_WIDTH,
  cellPitch: CELL_PITCH,
  pathClear: PATH_CLEAR,
  mapSize: MAP_SIZE,
  cellSize: PINE_SPACING,
} as const;
