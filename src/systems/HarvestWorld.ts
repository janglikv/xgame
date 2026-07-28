import type { Container } from 'pixi.js';
import {
  HARVEST_MELEE_DAMAGE,
  HarvestableTree,
} from '../entities/HarvestableTree';
import {
  ItemPickup,
  PICKUP_RADIUS,
} from '../entities/ItemPickup';
import type { PlayerCharacterBase } from '../entities/PlayerCharacterBase';
import {
  normalizeTrees,
  removeRuntimeTreeObstacleById,
  treeIdOf,
  treeSizeOf,
  type LevelMapDef,
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
 * 可砍树 + 掉落拾取：生成、近战、摧毁掉落、进包。
 * 投射物摧毁走 onTreeDestroyed（由 CombatSystem 回调）。
 */
export class HarvestWorld {
  readonly trees: HarvestableTree[] = [];
  readonly pickups: ItemPickup[] = [];

  constructor(private readonly hooks: HarvestWorldHooks) {}

  /** 从地图 def.trees 刷可砍树 */
  spawnFromMap(mapDef: LevelMapDef): void {
    for (const t of normalizeTrees(mapDef)) {
      this.mountTree(t);
    }
  }

  mountTree(t: MapTree): HarvestableTree {
    const id = treeIdOf(t);
    const size = treeSizeOf(t);
    const tree = new HarvestableTree(t.x, t.y, {
      size,
      treeId: id,
    });
    this.hooks.sortLayer.addChild(tree);
    this.trees.push(tree);
    return tree;
  }

  /** 树被摧毁：掉木头 + 移除 solid + 从草稿去掉 */
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
  }

  spawnPickup(
    x: number,
    y: number,
    itemId: 'wood',
    count: number,
  ): void {
    const p = new ItemPickup(x, y, itemId, { count });
    this.hooks.sortLayer.addChild(p);
    this.pickups.push(p);
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
    for (const p of this.pickups) {
      p.syncToWorld();
    }
  }

  tickTrees(deltaMS: number): void {
    for (const tree of this.trees) {
      tree.update(deltaMS);
    }
  }
}
