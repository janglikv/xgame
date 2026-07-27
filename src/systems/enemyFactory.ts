import { FlameFlower } from '../entities/FlameFlower';
import { Spider } from '../entities/Spider';
import { WoodenDummy } from '../entities/WoodenDummy';
import type { EnemyKind } from '../data/maps';
import { WorldMap } from '../world/WorldMap';

export const DEFAULT_SPIDER_SCALE = 0.1;

/** 按 kind 生成敌人实体，落点经 solid 校正 */
export function createEnemyAt(
  kind: EnemyKind,
  x: number,
  y: number,
  options?: { spiderScale?: number },
): Spider {
  const solid = WorldMap.resolveSolid(x, y, x, y, 16);
  if (kind === 'flame-flower') {
    return new FlameFlower(solid.x, solid.y);
  }
  if (kind === 'wooden-dummy') {
    return new WoodenDummy(solid.x, solid.y);
  }
  return new Spider(solid.x, solid.y, {
    scale: options?.spiderScale ?? DEFAULT_SPIDER_SCALE,
  });
}
