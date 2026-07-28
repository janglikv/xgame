import type { Container } from 'pixi.js';
import {
  GRASS_MAX_COUNT,
  GRASS_MIN_SPACING,
  GRASS_OVERCROWD_CHECK_RADIUS,
  GRASS_OVERCROWD_MAX_NEIGHBORS,
  GRASS_SPREAD_ATTEMPTS,
  GRASS_SPREAD_RADIUS_MAX,
  GRASS_SPREAD_RADIUS_MIN,
  TREE_GRASS_COMPETITION_RADIUS,
} from '../data/grassProfiles';
import {
  HARVEST_MELEE_DAMAGE,
  HarvestableTree,
} from '../entities/HarvestableTree';
import { DungEntity } from '../entities/DungEntity';
import { GrassEntity } from '../entities/GrassEntity';
import type { Spider } from '../entities/Spider';
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
  isOnGreenLand,
  landRectOf,
  normalizeGrasses,
  normalizeTrees,
  removeRuntimeTreeObstacleById,
  treeIdOf,
  treeKindOf,
  treeSizeOf,
  treeSolidR,
  type EnemyKind,
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
  /** 草丰水茂时自然孕育诞生的农场动物回调 */
  onSpawnNaturalAnimal?: (kind: EnemyKind, x: number, y: number) => void;
};

/**
 * 可砍树 + 装饰草地 + 掉落拾取：生成、近战、自动生长、四面八方扩散、摧毁掉落、进包。
 * 投射物摧毁走 onTreeDestroyed（由 CombatSystem 回调）。
 */
export class HarvestWorld {
  readonly trees: HarvestableTree[] = [];
  readonly grasses: GrassEntity[] = [];
  readonly pickups: ItemPickup[] = [];
  readonly dungs: DungEntity[] = [];

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
      onWither: (withered) => {
        const mapDef = this.hooks.getMapDef();
        if (withered.grassId && mapDef.grasses) {
          mapDef.grasses = mapDef.grasses.filter(
            (item) => grassIdOf(item) !== withered.grassId,
          );
        }
        this.removeGrassEntity(withered);
        this.hooks.afterWorldChange();
        this.hooks.persistMapDraft();
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
    const targetQuota = GRASS_SPREAD_ATTEMPTS[source.size] ?? 1;
    let spawned = 0;

    for (let q = 0; q < targetQuota; q++) {
      if (this.grasses.length >= GRASS_MAX_COUNT) break;

      // 为每个播种名额最多采样 8 次，确保在 80~220px 的远距离内找到符合 48px 密度限制的落点
      for (let attempt = 0; attempt < 8; attempt++) {
        const angle = Math.random() * Math.PI * 2;
        const dist =
          GRASS_SPREAD_RADIUS_MIN +
          Math.random() * (GRASS_SPREAD_RADIUS_MAX - GRASS_SPREAD_RADIUS_MIN);
        const x = source.worldX + Math.cos(angle) * dist;
        const y = source.worldY + Math.sin(angle) * dist;

        // 仅限真正的绿色草地（严格排除黄色沙滩与海岸）
        if (!isOnGreenLand(x, y, mapDef, 255)) continue;
        // 树木遮荫/养分竞争拦截：树附近不能长草
        if (this.isGrassTooCloseToTrees(x, y)) continue;
        // 严格检查 48px 最小密度间距
        if (this.isGrassTooClose(x, y, GRASS_MIN_SPACING)) continue;

        if (!mapDef.grasses) mapDef.grasses = [];
        const id = allocGrassId('gs');
        const g: MapGrass = { x, y, size: 'small', id };
        mapDef.grasses.push(g);
        this.mountGrass(g);
        spawned += 1;
        break; // 成功放置 1 株后进入下一个名额
      }
    }

    if (spawned > 0) {
      this.hooks.afterWorldChange();
      this.hooks.persistMapDraft();
    }
  }

  /** 排泄生出一堆天然有机肥料粑粑 */
  spawnDung(x: number, y: number): DungEntity | null {
    const mapDef = this.hooks.getMapDef();
    if (!isOnGreenLand(x, y, mapDef, 255)) return null;

    const dung = new DungEntity(x, y, {
      onDepleted: (d) => {
        const idx = this.dungs.indexOf(d);
        if (idx >= 0) this.dungs.splice(idx, 1);
        d.parent?.removeChild(d);
        d.destroy({ children: true });
      },
    });
    this.hooks.sortLayer.addChild(dung);
    this.dungs.push(dung);
    this.hooks.afterWorldChange();
    return dung;
  }

  /** 获取处于某个坐标处的粑粑肥力实体（若有） */
  private findFertileDung(x: number, y: number): DungEntity | null {
    for (const d of this.dungs) {
      if (d.nutrient <= 0) continue;
      const dx = d.worldX - x;
      const dy = d.worldY - y;
      if (dx * dx + dy * dy <= d.radius * d.radius) {
        return d;
      }
    }
    return null;
  }

  /** 与已有草丛是否过近（在粑粑肥力影响圈 120px 范畴内，密度限制允许压缩至 1/3，即草密度解禁允许翻 3 倍！） */
  private isGrassTooClose(x: number, y: number, minDist: number): boolean {
    const dung = this.findFertileDung(x, y);
    // 在粑粑肥力光环内，最小距离缩小为 1/3（如 48px -> 16px），草的密度允许翻三倍！
    const effectiveMinDist = dung ? Math.max(12, minDist / 3) : minDist;
    const min2 = effectiveMinDist * effectiveMinDist;

    for (const g of this.grasses) {
      const dx = g.worldX - x;
      const dy = g.worldY - y;
      if (dx * dx + dy * dy < min2) return true;
    }

    // 成功在肥沃的粑粑光环圈内落子生长新草，消耗 1 点养分
    if (dung) {
      dung.consumeNutrient(1);
    }
    return false;
  }

  /** 检查坐标 (x, y) 是否距离任何树木过近（树木遮荫与养分竞争，草无法存活生长） */
  isGrassTooCloseToTrees(x: number, y: number): boolean {
    for (const tree of this.trees) {
      const radius = TREE_GRASS_COMPETITION_RADIUS[tree.size] ?? 72;
      const dx = tree.worldX - x;
      const dy = tree.worldY - y;
      if (dx * dx + dy * dy <= radius * radius) {
        return true;
      }
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

  /**
   * 牛马啃草：体型缩小一级（大→中→小），小草不消失。
   * 写回地图草稿尺寸并持久化。
   * @returns 啃之前的体型；失败返回 null
   */
  consumeGrass(
    grass: GrassEntity | { grassId: string },
  ): 'small' | 'medium' | 'large' | null {
    const entity =
      grass instanceof GrassEntity
        ? grass
        : this.grasses.find((g) => g === grass || g.grassId === grass.grassId);
    if (!entity || !entity.isGrazable) return null;

    const before = entity.graze();
    if (!before) return null;

    const mapDef = this.hooks.getMapDef();
    if (entity.grassId && mapDef.grasses) {
      const found = mapDef.grasses.find(
        (g) => grassIdOf(g) === entity.grassId,
      );
      if (found) {
        found.size = entity.size;
      }
    }
    this.hooks.afterWorldChange();
    this.hooks.persistMapDraft();
    return before;
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

  tickTrees(deltaMS: number, creatures?: ReadonlyArray<Spider>): void {
    for (const tree of this.trees) {
      tree.update(deltaMS);
    }
    for (const dung of this.dungs.slice()) {
      dung.update(deltaMS);
    }
    const dt = deltaMS / 1000;
    // 场景为空白（全岛无草）时，在绿色陆地上随机孵化 1 棵生命火种小草
    if (this.grasses.length === 0) {
      this.spawnInitialSeedGrass();
      return;
    }

    // 固定本帧数量，避免扩散或老死导致数组变动影响迭代
    const grassCount = this.grasses.length;
    const overcrowdDistSq =
      GRASS_OVERCROWD_CHECK_RADIUS * GRASS_OVERCROWD_CHECK_RADIUS;

    const mapDef = this.hooks.getMapDef();
    for (let i = 0; i < grassCount; i++) {
      const g = this.grasses[i];
      if (!g) continue;

      // 精准绿色草地检查：一旦脱离草地落入黄色沙滩或海洋带，草无法存活，直接触发枯萎离场
      if (!isOnGreenLand(g.worldX, g.worldY, mapDef, 255)) {
        g.wither();
      }

      // 树木遮荫与养分竞争检查：草在树附近（树冠遮挡范畴内）无法存活，直接触发枯萎离场
      if (this.isGrassTooCloseToTrees(g.worldX, g.worldY)) {
        g.wither();
      }

      // 统计周围 90px 范围内的同伴草数量
      let neighbors = 0;
      for (let j = 0; j < grassCount; j++) {
        if (i === j) continue;
        const other = this.grasses[j];
        if (!other) continue;
        const dx = other.worldX - g.worldX;
        const dy = other.worldY - g.worldY;
        if (dx * dx + dy * dy <= overcrowdDistSq) {
          neighbors += 1;
          if (neighbors > GRASS_OVERCROWD_MAX_NEIGHBORS) break;
        }
      }

      // 粑粑肥力庇护判定
      const fertileDung = this.findFertileDung(g.worldX, g.worldY);
      if (fertileDung) {
        // 处于肥力光环内的草受养分滋养，大幅延缓自然衰老（衰老速度仅 30%），且完全免疫过密惩罚
        g.applyFertilizerLongevity(dt);
      } else {
        // 无肥力庇护且过度拥挤（邻居 > 5），加速其寿命流逝（3.5 倍加速衰亡）
        if (neighbors > GRASS_OVERCROWD_MAX_NEIGHBORS) {
          g.applyOvercrowded(3.5, dt);
        }
      }

      g.update(deltaMS);
    }

    this.tickNaturalAnimalSpawning(dt);
    this.tickNaturalWolfSpawning(dt, creatures);
  }

  private naturalAnimalTimer = 20;

  /**
   * 当全岛草繁水茂（草数量 >= 60 株）时，生态系统会自然孕育诞生牛、马、鸡、猪
   */
  private tickNaturalAnimalSpawning(dt: number): void {
    if (!this.hooks.onSpawnNaturalAnimal) return;

    const grassCount = this.grasses.length;
    // 只有全岛草地足够茂盛（>= 60 株）时具备自然孕育条件
    if (grassCount < 60) {
      this.naturalAnimalTimer = 20;
      return;
    }

    this.naturalAnimalTimer -= dt;
    if (this.naturalAnimalTimer <= 0) {
      // 孕育倒计时重置为 20s ~ 30s
      this.naturalAnimalTimer = 20 + Math.random() * 10;

      // 从中草/大草密集区挑选孕育落点
      const candidates = this.grasses.filter((g) => g.size !== 'small');
      const seedGrass =
        candidates.length > 0
          ? candidates[Math.floor(Math.random() * candidates.length)]!
          : this.grasses[Math.floor(Math.random() * this.grasses.length)]!;

      if (!seedGrass) return;

      const angle = Math.random() * Math.PI * 2;
      const dist = 35 + Math.random() * 50;
      const spawnX = seedGrass.worldX + Math.cos(angle) * dist;
      const spawnY = seedGrass.worldY + Math.sin(angle) * dist;

      const mapDef = this.hooks.getMapDef();
      if (!isOnGreenLand(spawnX, spawnY, mapDef, 255)) return;
      if (this.isGrassTooCloseToTrees(spawnX, spawnY)) return;

      // 诞生动物类型限定：仅随机诞生牛 (cow) 和马 (horse)，不诞生猪和鸡
      const kinds: EnemyKind[] = ['cow', 'horse'];
      const chosenKind = kinds[Math.floor(Math.random() * kinds.length)]!;

      this.hooks.onSpawnNaturalAnimal(chosenKind, spawnX, spawnY);
    }
  }

  private naturalWolfTimer = 35;

  /**
   * 当全岛食草动物积累较多（食草动物 >= 8 只）时，自然吸引/生成天敌狼 (Wolf)
   */
  private tickNaturalWolfSpawning(
    dt: number,
    creatures?: ReadonlyArray<Spider>,
  ): void {
    if (!this.hooks.onSpawnNaturalAnimal || !creatures) return;

    // 统计场上存活的农场食草动物
    const farmAnimals = creatures.filter(
      (s) =>
        s.isAlive &&
        !s.destroyed &&
        ['Chicken', 'Pig', 'Cow', 'Horse'].includes(s.label ?? ''),
    );

    // 食草动物不足 8 只时，不具备自然生成天敌狼的条件
    if (farmAnimals.length < 8) {
      this.naturalWolfTimer = 30;
      return;
    }

    this.naturalWolfTimer -= dt;
    if (this.naturalWolfTimer <= 0) {
      this.naturalWolfTimer = 35 + Math.random() * 15;

      // 从食草动物周边随机挑选生成锚点
      const target = farmAnimals[Math.floor(Math.random() * farmAnimals.length)]!;
      const angle = Math.random() * Math.PI * 2;
      const dist = 110 + Math.random() * 60;
      const spawnX = target.worldX + Math.cos(angle) * dist;
      const spawnY = target.worldY + Math.sin(angle) * dist;

      const mapDef = this.hooks.getMapDef();
      if (!isOnGreenLand(spawnX, spawnY, mapDef, 255)) return;

      this.hooks.onSpawnNaturalAnimal('wolf', spawnX, spawnY);
    }
  }

  /** 当场景中完全无草时，随机挑选一处绿地生成 1 棵初始种子草（生命火种） */
  private spawnInitialSeedGrass(): void {
    const mapDef = this.hooks.getMapDef();
    const land = landRectOf(mapDef);
    if (land.w <= 0 || land.h <= 0) return;

    for (let attempt = 0; attempt < 20; attempt++) {
      const x = land.x + Math.random() * land.w;
      const y = land.y + Math.random() * land.h;

      // 必须在绿地上且远离树木
      if (!isOnGreenLand(x, y, mapDef, 255)) continue;
      if (this.isGrassTooCloseToTrees(x, y)) continue;

      if (!mapDef.grasses) mapDef.grasses = [];
      const id = allocGrassId('gs');
      const g: MapGrass = { x, y, size: 'small', id };
      mapDef.grasses.push(g);
      this.mountGrass(g);
      this.hooks.persistMapDraft();
      this.hooks.afterWorldChange();
      break;
    }
  }
}
