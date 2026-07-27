import type { Container } from 'pixi.js';
import type { Spider } from '../entities/Spider';
import type { LevelMapDef } from '../data/maps';
import { WorldMap } from '../world/WorldMap';
import { createEnemyAt, DEFAULT_SPIDER_SCALE } from './enemyFactory';

/**
 * 按地图数据刷怪。
 * - 有 `enemies`：按列表放置
 * - 省略字段：兼容旧关卡，出生点两侧各放一只蜘蛛
 */
export function spawnEnemiesInto(
  mapDef: LevelMapDef,
  spawn: { x: number; y: number },
  sortLayer: Container,
  out: Spider[],
  options?: { spiderScale?: number },
): void {
  const scale = options?.spiderScale ?? DEFAULT_SPIDER_SCALE;
  const list = mapDef.enemies;
  if (list === undefined) {
    spawnLegacyCornerSpiders(spawn, sortLayer, out, scale);
    return;
  }
  for (const e of list) {
    const entity = createEnemyAt(e.kind, e.x, e.y, { spiderScale: scale });
    entity.faceToward(spawn.x, spawn.y);
    sortLayer.addChild(entity);
    out.push(entity);
  }
}

function spawnLegacyCornerSpiders(
  spawn: { x: number; y: number },
  sortLayer: Container,
  out: Spider[],
  spiderScale: number,
): void {
  const offsets = [
    { x: -180, y: -160 },
    { x: 180, y: -160 },
  ];
  for (const o of offsets) {
    const tx = spawn.x + o.x;
    const ty = spawn.y + o.y;
    const solid = WorldMap.resolveSolid(spawn.x, spawn.y, tx, ty, 16);
    const spider = createEnemyAt('spider', solid.x, solid.y, {
      spiderScale,
    });
    // createEnemyAt 已 solid 一次；legacy 用 resolve 后的坐标再 face
    spider.worldX = solid.x;
    spider.worldY = solid.y;
    spider.faceToward(spawn.x, spawn.y);
    sortLayer.addChild(spider);
    out.push(spider);
  }
}
