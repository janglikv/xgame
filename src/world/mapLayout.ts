import type { Vec2 } from '../utils/math';

/**
 * 默认关卡尺寸（与 emptyIslandDef 一致）。
 * 具体关卡以 LevelMapDef.mapSize 为准；此处供镜头 fit / 兼容旧常量。
 */
export const MAP_SIZE = 2880;

/** 地图半宽/半高（中心 = 原点） */
export const MAP_WORLD_HALF = MAP_SIZE / 2;

/** 历史松树间距常量（布局已去网格，仅兼容旧 import） */
export const PINE_SPACING = 36;

/** 兼容旧 import（九宫格布局已废弃） */
export const GRID = 1;
export const ISLAND_SIZE = MAP_SIZE;
export const FOREST_WIDTH = 0;
export const OUTER_FOREST_WIDTH = 0;
export const CELL_PITCH = MAP_SIZE;

export function islandCenter(_ix = 0, _iy = 0): Vec2 {
  return { x: 0, y: 0 };
}

export function isRemovedIsland(_ix: number, _iy: number): boolean {
  return false;
}
