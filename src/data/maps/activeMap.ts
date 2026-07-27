import { LEVEL_1 } from './level-1';
import type { LevelMapDef } from './types';
import { syncRuntimeTreesFromDef } from './walkMask';

/** 当前关卡碰撞 / 海岛使用的地图定义 */
let active: LevelMapDef = LEVEL_1;

export function setActiveMapDef(def: LevelMapDef): void {
  active = def;
  syncRuntimeTreesFromDef(def);
}

export function getActiveMapDef(): LevelMapDef {
  return active;
}
