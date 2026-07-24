import type { Vec2 } from '../utils/math';

/** 九宫格边长（3×3 岛） */
export const GRID = 3;

/** 单岛外沿边长（世界像素） */
export const ISLAND_SIZE = 1920;

/** 松树网格间距 */
export const PINE_SPACING = 36;

/** 林带厚度：十二棵树 */
const FOREST_TREE_DEPTH = 12;

/** 岛与岛之间的森林走廊宽度 */
export const FOREST_WIDTH = FOREST_TREE_DEPTH * PINE_SPACING;

/** 整图最外圈松林带宽 */
export const OUTER_FOREST_WIDTH = FOREST_TREE_DEPTH * PINE_SPACING;

/** 相邻岛中心距 */
export const CELL_PITCH = ISLAND_SIZE + FOREST_WIDTH;

/** 九宫格核心区边长（不含外圈林带） */
const CORE_SIZE = GRID * ISLAND_SIZE + (GRID - 1) * FOREST_WIDTH;

/** 整图边长（核心 + 外圈林带） */
export const MAP_SIZE = CORE_SIZE + 2 * OUTER_FOREST_WIDTH;

/** 地图半宽/半高（中心 = 原点） */
export const MAP_WORLD_HALF = MAP_SIZE / 2;


/**
 * 九宫格岛中心（世界坐标）。
 * ix/iy ∈ [0, GRID)，(0,0) 为左上，(1,1) 为中心岛。
 */
export function islandCenter(ix: number, iy: number): Vec2 {
  const start = -MAP_WORLD_HALF + OUTER_FOREST_WIDTH + ISLAND_SIZE / 2;
  return {
    x: start + ix * CELL_PITCH,
    y: start + iy * CELL_PITCH,
  };
}

/** 被密林填满的房间（出生点左右：(0, 2) 与 (2, 2)） */
export function isRemovedIsland(ix: number, iy: number): boolean {
  return iy === GRID - 1 && (ix === 0 || ix === GRID - 1);
}
