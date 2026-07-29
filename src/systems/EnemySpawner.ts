import type { Container } from 'pixi.js';
import type { WorldCreature } from '../entities/WorldCreature';
import type { LevelMapDef } from '../data/maps';
import { createEnemyAt, DEFAULT_SPIDER_SCALE } from './enemyFactory';

/** 按地图 enemies 列表刷怪 */
export function spawnEnemiesInto(
  mapDef: LevelMapDef,
  spawn: { x: number; y: number },
  sortLayer: Container,
  out: WorldCreature[],
  options?: { spiderScale?: number },
): void {
  const scale = options?.spiderScale ?? DEFAULT_SPIDER_SCALE;
  for (const e of mapDef.enemies) {
    const entity = createEnemyAt(e.kind, e.x, e.y, { spiderScale: scale });
    entity.faceToward(spawn.x, spawn.y);
    sortLayer.addChild(entity);
    out.push(entity);
  }
}
