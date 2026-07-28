import type { Container } from 'pixi.js';
import type { PlayerCharacterBase } from '../entities/PlayerCharacterBase';
import type { HarvestableTree } from '../entities/HarvestableTree';
import type { Spider } from '../entities/Spider';
import {
  TREE_SOLID_R,
  addRuntimeTreeObstacle,
  allocTreeId,
  isOnLand,
  removeRuntimeTreeObstacleById,
  treeIdOf,
  type LevelMapDef,
  type MapTree,
} from '../data/maps';
import type { GodBrush, GodModeHud } from '../ui/GodModeHud';
import type { LevelCamera } from '../scenes/LevelCamera';
import { createEnemyAt, DEFAULT_SPIDER_SCALE } from './enemyFactory';
import type { HarvestWorld } from './HarvestWorld';

export type GodModeDeps = {
  getMapDef: () => LevelMapDef;
  getSpawn: () => { x: number; y: number };
  setSpawn: (x: number, y: number) => void;
  getPlayer: () => PlayerCharacterBase | null;
  sortLayer: Container;
  spiders: Spider[];
  harvest: HarvestWorld;
  camera: LevelCamera;
  hud: GodModeHud;
  spiderScale?: number;
  syncWorldActors: () => void;
  sortDepth: () => void;
  persistMapDraft: () => void;
};

/**
 * 上帝模式：摆放/擦除树与敌人、改出生点，自动 saveMapDraft。
 */
export class GodModeController {
  brush: GodBrush = 'harvest';
  enabled = false;

  constructor(private readonly deps: GodModeDeps) {}

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.deps.hud.visible = on;
    if (on) {
      this.deps.hud.setBrush(this.brush);
      const player = this.deps.getPlayer();
      if (player) {
        player.knock.velX = 0;
        player.knock.velY = 0;
      }
    }
  }

  setBrush(brush: GodBrush): void {
    this.brush = brush;
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const cam = this.deps.camera;
    const z = Math.max(cam.currentZoom, 1e-4);
    return {
      x: cam.x + (sx - cam.width / 2) / z,
      y: cam.y + (sy - cam.height / 2) / z,
    };
  }

  handleClick(sx: number, sy: number): void {
    if (this.deps.hud.containsScreenPoint(sx, sy)) {
      return;
    }
    const w = this.screenToWorld(sx, sy);
    if (this.brush === 'erase') {
      this.eraseAt(w.x, w.y);
      return;
    }
    if (this.brush === 'spawn') {
      this.setSpawnAt(w.x, w.y);
      return;
    }
    const mapDef = this.deps.getMapDef();
    if (!isOnLand(w.x, w.y, mapDef, 0)) return;

    if (this.brush === 'harvest') {
      this.placeHarvestTree(w.x, w.y);
      return;
    }
    this.placeEnemy(w.x, w.y, this.brush);
  }

  placeHarvestTree(x: number, y: number): void {
    const mapDef = this.deps.getMapDef();
    const id = allocTreeId('harv');
    const t: MapTree = { x, y, kind: 'harvest', id };
    mapDef.trees.push(t);
    addRuntimeTreeObstacle({
      x,
      y,
      r: TREE_SOLID_R,
      id,
    });
    this.deps.harvest.mountTree(t);
    this.deps.syncWorldActors();
    this.deps.sortDepth();
    this.deps.persistMapDraft();
  }

  placeEnemy(
    x: number,
    y: number,
    kind: 'spider' | 'flame-flower' | 'wooden-dummy',
  ): void {
    const mapDef = this.deps.getMapDef();
    if (!mapDef.enemies) mapDef.enemies = [];
    mapDef.enemies.push({ kind, x, y });

    const spawn = this.deps.getSpawn();
    const entity = createEnemyAt(kind, x, y, {
      spiderScale: this.deps.spiderScale ?? DEFAULT_SPIDER_SCALE,
    });
    entity.faceToward(spawn.x, spawn.y);
    this.deps.sortLayer.addChild(entity);
    this.deps.spiders.push(entity);
    void entity.load();
    this.deps.syncWorldActors();
    this.deps.sortDepth();
    this.deps.persistMapDraft();
  }

  setSpawnAt(x: number, y: number): void {
    const mapDef = this.deps.getMapDef();
    if (!isOnLand(x, y, mapDef, 8)) return;
    this.deps.setSpawn(x, y);
    mapDef.spawn = { x, y };
    const player = this.deps.getPlayer();
    if (player) {
      player.worldX = x;
      player.worldY = y;
      this.deps.syncWorldActors();
    }
    this.deps.persistMapDraft();
  }

  eraseAt(x: number, y: number): void {
    const PICK_R = 40;
    const { harvest, spiders, getMapDef } = this.deps;
    const mapDef = getMapDef();

    let bestTree: HarvestableTree | null = null;
    let bestTreeD = PICK_R;
    for (const t of harvest.trees) {
      if (!t.isAlive) continue;
      const d = Math.hypot(t.worldX - x, t.worldY - y);
      if (d < bestTreeD) {
        bestTreeD = d;
        bestTree = t;
      }
    }

    let bestEnemy: Spider | null = null;
    let bestEnemyD = PICK_R;
    let bestEnemyI = -1;
    for (let i = 0; i < spiders.length; i++) {
      const s = spiders[i]!;
      if (!s.isAlive) continue;
      const d = Math.hypot(s.worldX - x, s.worldY - y);
      if (d < bestEnemyD) {
        bestEnemyD = d;
        bestEnemy = s;
        bestEnemyI = i;
      }
    }

    type Pick = { kind: 'tree' | 'enemy'; d: number };
    const candidates: Pick[] = [];
    if (bestTree) candidates.push({ kind: 'tree', d: bestTreeD });
    if (bestEnemy) candidates.push({ kind: 'enemy', d: bestEnemyD });
    if (candidates.length === 0) return;
    candidates.sort((a, b) => a.d - b.d);
    const pick = candidates[0]!;

    if (pick.kind === 'tree' && bestTree) {
      if (bestTree.treeId) {
        removeRuntimeTreeObstacleById(bestTree.treeId);
        mapDef.trees = mapDef.trees.filter(
          (t) => treeIdOf(t) !== bestTree!.treeId,
        );
      }
      harvest.removeTreeEntity(bestTree);
      this.deps.persistMapDraft();
      return;
    }

    if (pick.kind === 'enemy' && bestEnemy && bestEnemyI >= 0) {
      const ex = bestEnemy.worldX;
      const ey = bestEnemy.worldY;
      if (mapDef.enemies) {
        let nearestI = -1;
        let nearestD = 24;
        for (let i = 0; i < mapDef.enemies.length; i++) {
          const e = mapDef.enemies[i]!;
          const d = Math.hypot(e.x - ex, e.y - ey);
          if (d < nearestD) {
            nearestD = d;
            nearestI = i;
          }
        }
        if (nearestI >= 0) mapDef.enemies.splice(nearestI, 1);
      }
      bestEnemy.parent?.removeChild(bestEnemy);
      bestEnemy.destroy({ children: true });
      spiders.splice(bestEnemyI, 1);
      this.deps.persistMapDraft();
    }
  }
}
