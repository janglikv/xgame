import type { Container } from 'pixi.js';
import type { PlayerCharacterBase } from '../entities/PlayerCharacterBase';
import type { HarvestableTree } from '../entities/HarvestableTree';
import type { GrassEntity } from '../entities/GrassEntity';
import type { WorldCreature } from '../entities/WorldCreature';
import { isEnemyKindEnabled } from '../data/contentDisable';
import {
  addRuntimeTreeObstacle,
  allocGrassId,
  allocTreeId,
  ENEMY_KINDS,
  grassIdOf,
  isOnLand,
  isOnGreenLand,
  removeRuntimeTreeObstacleById,
  treeIdOf,
  treeSolidR,
  type EnemyKind,
  type GrassSize,
  type LevelMapDef,
  type MapGrass,
  type MapTree,
  type TreeKind,
  type TreeSize,
} from '../data/maps';
import type { GodBrush, GodModeHud } from '../ui/GodModeHud';
import type { LevelCamera } from '../scenes/LevelCamera';
import { createEnemyAt, DEFAULT_SPIDER_SCALE } from './enemyFactory';
import type { HarvestWorld } from './HarvestWorld';

/** 与 ENEMY_KINDS 同步；下线 kind 不进刷子 */
const ENEMY_BRUSHES = new Set<GodBrush>(
  ENEMY_KINDS.filter((k) => isEnemyKindEnabled(k)),
);

export type GodModeDeps = {
  getMapDef: () => LevelMapDef;
  getSpawn: () => { x: number; y: number };
  setSpawn: (x: number, y: number) => void;
  getPlayer: () => PlayerCharacterBase | null;
  sortLayer: Container;
  creatures: WorldCreature[];
  harvest: HarvestWorld;
  camera: LevelCamera;
  hud: GodModeHud;
  spiderScale?: number;
  syncWorldActors: () => void;
  sortDepth: () => void;
  persistMapDraft: () => void;
  afterWorldChange?: () => void;
};

/**
 * 上帝模式：摆放/擦除松树、苹果树、无碰撞草地与敌人、改出生点，自动 saveMapDraft。
 */
export class GodModeController {
  brush: GodBrush = 'tree-medium';
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

    if (
      this.brush === 'tree-sapling' ||
      this.brush === 'tree-medium' ||
      this.brush === 'tree-large' ||
      this.brush === 'apple-sapling' ||
      this.brush === 'apple-medium' ||
      this.brush === 'apple-large'
    ) {
      const isApple = this.brush.startsWith('apple');
      const size: TreeSize = this.brush.endsWith('sapling')
        ? 'sapling'
        : this.brush.endsWith('large')
          ? 'large'
          : 'medium';
      this.placeHarvestTree(w.x, w.y, size, isApple ? 'apple' : 'pine');
      return;
    }
    if (
      this.brush === 'grass-small' ||
      this.brush === 'grass-medium' ||
      this.brush === 'grass-large'
    ) {
      const size: GrassSize =
        this.brush === 'grass-small'
          ? 'small'
          : this.brush === 'grass-large'
            ? 'large'
            : 'medium';
      this.placeGrass(w.x, w.y, size);
      return;
    }
    if (ENEMY_BRUSHES.has(this.brush)) {
      this.placeEnemy(w.x, w.y, this.brush as EnemyKind);
    }
  }

  placeHarvestTree(
    x: number,
    y: number,
    size: TreeSize = 'medium',
    kind: TreeKind = 'pine',
  ): void {
    if (this.deps.harvest.isInMudSpot(x, y)) return;
    const mapDef = this.deps.getMapDef();
    const prefix =
      kind === 'apple'
        ? size === 'sapling'
          ? 'apsap'
          : size === 'large'
            ? 'apbig'
            : 'apple'
        : size === 'sapling'
          ? 'sap'
          : size === 'large'
            ? 'big'
            : 'harv';
    const id = allocTreeId(prefix);
    const t: MapTree = { x, y, size, kind, id };
    mapDef.trees.push(t);
    addRuntimeTreeObstacle({
      x,
      y,
      r: treeSolidR(size),
      id,
    });
    this.deps.harvest.mountTree(t);
    this.deps.syncWorldActors();
    this.deps.sortDepth();
    this.deps.afterWorldChange?.();
    this.deps.persistMapDraft();
  }

  placeGrass(x: number, y: number, size: GrassSize = 'medium'): void {
    const mapDef = this.deps.getMapDef();
    // 仅真正的绿色草地上可种（严格排除沙滩与海）
    if (!isOnGreenLand(x, y, mapDef, 255)) return;
    // 树木遮荫与养分竞争拦截：树附近不能种草
    if (this.deps.harvest.isGrassTooCloseToTrees(x, y)) return;
    if (!mapDef.grasses) mapDef.grasses = [];
    const id = allocGrassId(
      size === 'small' ? 'gs' : size === 'large' ? 'bg' : 'grs',
    );
    const g: MapGrass = { x, y, size, id };
    mapDef.grasses.push(g);
    this.deps.harvest.mountGrass(g);
    this.deps.syncWorldActors();
    this.deps.sortDepth();
    this.deps.persistMapDraft();
  }

  placeEnemy(x: number, y: number, kind: EnemyKind): void {
    if (!isEnemyKindEnabled(kind)) return;

    const mapDef = this.deps.getMapDef();
    if (!mapDef.enemies) mapDef.enemies = [];

    const spawn = this.deps.getSpawn();
    const entity = createEnemyAt(kind, x, y, {
      spiderScale: this.deps.spiderScale ?? DEFAULT_SPIDER_SCALE,
    });
    if (!entity) return;

    mapDef.enemies.push({ kind, x, y });
    entity.faceToward(spawn.x, spawn.y);
    this.deps.sortLayer.addChild(entity);
    this.deps.creatures.push(entity);
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
    const { harvest, creatures, getMapDef } = this.deps;
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

    let bestGrass: GrassEntity | null = null;
    let bestGrassD = PICK_R;
    for (const g of harvest.grasses) {
      const d = Math.hypot(g.worldX - x, g.worldY - y);
      if (d < bestGrassD) {
        bestGrassD = d;
        bestGrass = g;
      }
    }

    let bestEnemy: WorldCreature | null = null;
    let bestEnemyD = PICK_R;
    let bestEnemyI = -1;
    for (let i = 0; i < creatures.length; i++) {
      const s = creatures[i]!;
      if (!s.isAlive) continue;
      const d = Math.hypot(s.worldX - x, s.worldY - y);
      if (d < bestEnemyD) {
        bestEnemyD = d;
        bestEnemy = s;
        bestEnemyI = i;
      }
    }

    type Pick = { kind: 'tree' | 'grass' | 'enemy'; d: number };
    const candidates: Pick[] = [];
    if (bestTree) candidates.push({ kind: 'tree', d: bestTreeD });
    if (bestGrass) candidates.push({ kind: 'grass', d: bestGrassD });
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
      this.deps.afterWorldChange?.();
      this.deps.persistMapDraft();
      return;
    }

    if (pick.kind === 'grass' && bestGrass) {
      if (bestGrass.grassId && mapDef.grasses) {
        mapDef.grasses = mapDef.grasses.filter(
          (g) => grassIdOf(g) !== bestGrass!.grassId,
        );
      }
      harvest.removeGrassEntity(bestGrass);
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
      creatures.splice(bestEnemyI, 1);
      this.deps.persistMapDraft();
    }
  }

  /** 一键清空场景：树木、草地、生物、敌人与掉落物 */
  clearScene(): void {
    const mapDef = this.deps.getMapDef();
    mapDef.trees = [];
    mapDef.grasses = [];
    mapDef.enemies = [];

    // 清空收获与自然世界实体
    this.deps.harvest.clearAll();

    // 清空生物/敌人实体
    const creatures = this.deps.creatures;
    for (const s of creatures) {
      if (!s.destroyed) {
        s.parent?.removeChild(s);
        s.destroy({ children: true });
      }
    }
    creatures.length = 0;

    // 同步 Actor、排序、渲染并写回草稿
    this.deps.syncWorldActors();
    this.deps.sortDepth();
    this.deps.afterWorldChange?.();
    this.deps.persistMapDraft();
  }
}

