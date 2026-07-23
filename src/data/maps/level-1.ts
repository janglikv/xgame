import { buildGridLevelDef } from './gridTemplate';
import type { LevelMapDef } from './types';

/**
 * 默认关卡：与历史九宫格布局等价（由模板生成）。
 * 地图编辑器导出后可整份替换本对象。
 */
export const LEVEL_1: LevelMapDef = buildGridLevelDef('level-1');
