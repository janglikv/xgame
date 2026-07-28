import type { Container } from 'pixi.js';
import {
  GRASS_GREEN_LAND_MARGIN,
  GRASS_MAX_COUNT,
  GRASS_MIN_SPACING,
  GRASS_SPREAD_ATTEMPTS,
  GRASS_SPREAD_RADIUS_MAX,
  GRASS_SPREAD_RADIUS_MIN,
} from '../data/grassProfiles';
import {
  HARVEST_MELEE_DAMAGE,
  HarvestableTree,
} from '../entities/HarvestableTree';
import { GrassEntity } from '../entities/GrassEntity';
import {
  ItemPickup,
  PICKUP_RADIUS,
} from '../entities/ItemPickup';
import type { PlayerCharacterBase } from '../entities/PlayerCharacterBase';
import {
  addRuntimeTreeObstacle,
  allocGrassId,
  grassIdOf,
  grassSizeOf,
  isOnLand,
  normalizeGrasses,
  normalizeTrees,
  removeRuntimeTreeObstacleById,
  treeIdOf,
  treeKindOf,
  treeSizeOf,
  treeSolidR,
  type LevelMapDef,
  type MapGrass,
  type MapTree,
} from '../data/maps';
import type { Inventory } from './Inventory';

export type HarvestWorldHooks = {
  sortLayer: Container;
  inventory: Inventory;
  getMapDef: () => LevelMapDef;
  /** 树从 def 移除 solid 后持久化草稿 */
  persistMapDraft: () => void;
  /** 世界坐标 / 深度刷新 */
  afterWorldChange: () => void;
};

/**
 * 可砍树 + 装饰草地 + 掉落拾取：生成、近战、自动生长、四面八方扩散、摧毁掉落、进包。
 * 投射物摧毁走 onTreeDestroyed（由 CombatSystem 回调）。
 */
export class HarvestWorld {
  readonly trees: HarvestableTree[] = [];
  readonly grasses: GrassEntity[] = [];
  readonly pickups: ItemPickup[] = [];

  constructor(private readonly hooks: HarvestWorldHooks) {}

  /** 从地图刷可砍树与无碰撞草地 */
  spawnFromMap(mapDef: LevelMapDef): void {
    for (const t of normalizeTrees(mapDef)) {
      this.mountTree(t);
    }
    for (const g of normalizeGrasses(mapDef)) {
      this.mountGrass(g);
    }
  }

  mountTree(t: MapTree): HarvestableTree {
    const id = treeIdOf(t);
    const size = treeSizeOf(t);
    const kind = treeKindOf(t);
    const tree = new HarvestableTree(t.x, t.y, {
      size,
      kind,
      treeId: id,
      onGrown: (grownTree) => {
        const mapDef = this.hooks.getMapDef();
        const found = mapDef.trees.find(
          (item) => treeIdOf(item) === grownTree.treeId,
        );
        if (found) {
          found.size = grownTree.size;
        }
        addRuntimeTreeObstacle({
          x: grownTree.worldX,
          y: grownTree.worldY,
          r: treeSolidR(grownTree.size),
          id: grownTree.treeId,
        });
        this.hooks.afterWorldChange();
        this.hooks.persistMapDraft();
      },
      onAppleDrop: (worldX, worldY) => {
        this.spawnPickup(worldX, worldY, 'apple', 1);
      },
    });
    this.hooks.sortLayer.addChild(tree);
    this.trees.push(tree);
    return tree;
  }

  mountGrass(g: MapGrass): GrassEntity {
    const id = grassIdOf(g);
    const size = grassSizeOf(g);
    const grass = new GrassEntity(g.x, g.y, {
      size,
      grassId: id,
      onGrown: (grownGrass) => {
        const mapDef = this.hooks.getMapDef();
        const found = (mapDef.grasses ?? []).find(
          (item) => grassIdOf(item) === grownGrass.grassId,
        );
        if (found) {
          found.size = grownGrass.size;
        }
        this.hooks.afterWorldChange();
        this.hooks.persistMapDraft();
      },
      onSpread: (source) => {
        this.trySpreadFrom(source);
      },
    });
    this.hooks.sortLayer.addChild(grass);
    this.grasses.push(grass);
    return grass;
  }

  /**
   * 母株向四面八方尝试播种小草。
   * 仅绿地上、保持间距，并写入地图草稿。
   */
  private trySpreadFrom(source: GrassEntity): void {
    if (this.grasses.length >= GRASS_MAX_COUNT) return;

    const mapDef = this.hooks.getMapDef();
    const attempts = GRASS_SPREAD_ATTEMPTS[source.size] ?? 1;
    const baseAngle = Math.random() * Math.PI * 2;
    let spawned = 0;

    for (let i = 0; i < attempts; i++) {
      if (this.grasses.length >= GRASS_MAX_COUNT) break;

      // 均分方位 + 随机抖动，形成四面八方扩散
      const angle =
        baseAngle +
        (i * Math.PI * 2) / attempts +
        (Math.random() - 0.5) * 0.7;
      const dist =
        GRASS_SPREAD_RADIUS_MIN +
        Math.random() * (GRASS_SPREAD_RADIUS_MAX - GRASS_SPREAD_RADIUS_MIN);
      const x = source.worldX + Math.cos(angle) * dist;
      const y = source.worldY + Math.sin(angle) * dist;

      // 仅限绿地（margin 排除金沙滩与海岸）
      if (!isOnLand(x, y, mapDef, GRASS_GREEN_LAND_MARGIN)) continue;
      if (this.isGrassTooClose(x, y, GRASS_MIN_SPACING)) continue;

      if (!mapDef.grasses) mapDef.grasses = [];
      const id = allocGrassId('gs');
      const g: MapGrass = { x, y, size: 'small', id };
      mapDef.grasses.push(g);
      this.mountGrass(g);
      spawned += 1;
    }

    if (spawned > 0) {
      this.hooks.afterWorldChange();
      this.hooks.persistMapDraft();
    }
  }

  /** 与已有草丛是否过近 */
  private isGrassTooClose(x: number, y: number, minDist: number): boolean {
    const min2 = minDist * minDist;
    for (const g of this.grasses) {
      const dx = g.worldX - x;
      const dy = g.worldY - y;
      if (dx * dx + dy * dy < min2) return true;
    }
    return false;
  }

  /** 树被摧毁：掉木头（苹果树额外掉落苹果） + 移除 solid + 从草稿去掉 */
  onTreeDestroyed(tree: HarvestableTree): void {
    if (tree.treeId) {
      removeRuntimeTreeObstacleById(tree.treeId);
      const mapDef = this.hooks.getMapDef();
      mapDef.trees = mapDef.trees.filter(
        (t) => treeIdOf(t) !== tree.treeId,
      );
      this.hooks.persistMapDraft();
    }
    const n = tree.woodDrop;
    for (let i = 0; i < n; i++) {
      const ang = (Math.PI * 2 * i) / n + Math.random() * 0.4;
      const dist = 10 + Math.random() * 14;
      const px = tree.worldX + Math.cos(ang) * dist;
      const py = tree.worldY + Math.sin(ang) * dist * 0.65;
      this.spawnPickup(px, py, 'wood', 1);
    }
    if (tree.treeKind === 'apple' && tree.size === 'large') {
      const appleCount = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < appleCount; i++) {
        const ang = Math.random() * Math.PI * 2;
        const dist = 12 + Math.random() * 16;
        const px = tree.worldX + Math.cos(ang) * dist;
        const py = tree.worldY + Math.sin(ang) * dist * 0.65;
        this.spawnPickup(px, py, 'apple', 1);
      }
    }
  }

  spawnPickup(
    x: number,
    y: number,
    itemId: 'wood' | 'apple',
    count: number,
  ): void {
    const p = new ItemPickup(x, y, itemId, { count });
    this.hooks.sortLayer.addChild(p);
    this.pickups.push(p);
  }

  /** 猪等生物吃掉地上掉落（不进玩家背包） */
  consumePickup(pickup: ItemPickup | { isCollected: boolean }): void {
    if (pickup.isCollected) return;
    const p =
      pickup instanceof ItemPickup
        ? pickup
        : this.pickups.find((item) => item === pickup);
    if (!p || p.isCollected) return;
    p.markCollected();
    const idx = this.pickups.indexOf(p);
    if (idx < 0) return;
    this.hooks.sortLayer.removeChild(p);
    p.destroy({ children: true });
    this.pickups.splice(idx, 1);
  }

  /**
   * 近战砍最近一棵在范围内的可砍树。
   * 摧毁时掉落；投射物摧毁走 onTreeDestroyed。
   */
  tryMelee(player: PlayerCharacterBase): boolean {
    if (player.entranceLocks.attack) return false;

    let best: HarvestableTree | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const tree of this.trees) {
      if (!tree.isAlive) continue;
      const d = Math.hypot(
        tree.worldX - player.worldX,
        tree.worldY - player.worldY,
      );
      if (d > tree.interactR) continue;
      // 优先更近；同距时大树可砍区更大也能命中
      if (d < bestScore) {
        bestScore = d;
        best = tree;
      }
    }
    if (!best) return false;

    player.setFacingFromMoveX(best.worldX - player.worldX);
    const alive = best.applyDamage(HARVEST_MELEE_DAMAGE);
    if (!alive) {
      const idx = this.trees.indexOf(best);
      if (idx >= 0) {
        this.onTreeDestroyed(best);
        this.hooks.sortLayer.removeChild(best);
        best.destroy({ children: true });
        this.trees.splice(idx, 1);
      }
    }
    this.hooks.afterWorldChange();
    return true;
  }

  /** 从列表移除实体（上帝模式擦除等，不触发掉落） */
  removeTreeEntity(tree: HarvestableTree): void {
    const idx = this.trees.indexOf(tree);
    if (idx < 0) return;
    tree.parent?.removeChild(tree);
    tree.destroy({ children: true });
    this.trees.splice(idx, 1);
  }

  /** 移除草地实体 */
  removeGrassEntity(grass: GrassEntity): void {
    const idx = this.grasses.indexOf(grass);
    if (idx < 0) return;
    grass.parent?.removeChild(grass);
    grass.destroy({ children: true });
    this.grasses.splice(idx, 1);
  }

  /** 掉落物漂浮 + 靠近自动进包 */
  update(deltaMS: number, playerX: number, playerY: number): void {
    const r2 = PICKUP_RADIUS * PICKUP_RADIUS;
    const { inventory, sortLayer } = this.hooks;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i]!;
      p.update(deltaMS);
      if (p.isCollected) {
        sortLayer.removeChild(p);
        p.destroy({ children: true });
        this.pickups.splice(i, 1);
        continue;
      }
      const dx = p.worldX - playerX;
      const dy = p.worldY - playerY;
      if (dx * dx + dy * dy > r2) continue;
      if (!inventory.canAccept(p.itemId, p.count)) continue;
      const left = inventory.add(p.itemId, p.count);
      if (left < p.count) {
        // 全收或半收：半收时简化为全收失败保留（堆叠够用时通常全收）
        if (left === 0) {
          p.markCollected();
          sortLayer.removeChild(p);
          p.destroy({ children: true });
          this.pickups.splice(i, 1);
        }
      }
    }
  }

  syncToWorld(): void {
    for (const tree of this.trees) {
      tree.syncToWorld();
    }
    for (const grass of this.grasses) {
      grass.syncToWorld();
    }
    for (const p of this.pickups) {
      p.syncToWorld();
    }
  }

  tickTrees(deltaMS: number): void {
    for (const tree of this.trees) {
      tree.update(deltaMS);
    }
    // 固定本帧数量，避免扩散中途 push 导致同帧连更
    const grassCount = this.grasses.length;
    for (let i = 0; i < grassCount; i++) {
      this.grasses[i]!.update(deltaMS);
    }
  }
}
