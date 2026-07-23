import { LEVEL_1 } from './level-1';
import type { LevelMapDef } from './types';
import { invalidateWalkCache } from './walkMask';

/** 当前关卡碰撞 / 种树使用的地图定义 */
let active: LevelMapDef = LEVEL_1;

export function setActiveMapDef(def: LevelMapDef): void {
  active = def;
  invalidateWalkCache();
}

export function getActiveMapDef(): LevelMapDef {
  return active;
}
