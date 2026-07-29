import { Bear, Chicken, Cow, Horse, Pig, Wolf } from '../entities/FarmAnimals';
import { FlameFlower } from '../entities/FlameFlower';
import { Spider } from '../entities/Spider';
import type { WorldCreature } from '../entities/WorldCreature';
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
): WorldCreature {
  const solid = WorldMap.resolveSolid(x, y, x, y, 16);

  if (kind === 'flame-flower') {
    return new FlameFlower(solid.x, solid.y);
  }
  if (kind === 'wooden-dummy') {
    return new WoodenDummy(solid.x, solid.y);
  }
  if (kind === 'chicken') {
    return new Chicken(solid.x, solid.y);
  }
  if (kind === 'pig') {
    return new Pig(solid.x, solid.y);
  }
  if (kind === 'cow') {
    return new Cow(solid.x, solid.y);
  }
  if (kind === 'horse') {
    return new Horse(solid.x, solid.y);
  }
  if (kind === 'wolf') {
    return new Wolf(solid.x, solid.y);
  }
  if (kind === 'bear') {
    return new Bear(solid.x, solid.y);
  }
  return new Spider(solid.x, solid.y, {
    scale: options?.spiderScale ?? DEFAULT_SPIDER_SCALE,
  });
}
