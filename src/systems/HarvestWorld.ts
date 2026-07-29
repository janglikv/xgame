import type { Container } from 'pixi.js';
import {
  GRASS_GRID_CELL,
  GRASS_LOGIC_SLICES,
  GRASS_MAX_COUNT,
  GRASS_MIN_SPACING,
  GRASS_PERSIST_DEBOUNCE_SEC,
  GRASS_SPREAD_ATTEMPTS,
  GRASS_SPREAD_RADIUS_MAX,
  GRASS_SPREAD_RADIUS_MIN,
  TREE_GRASS_COMPETITION_RADIUS,
} from '../data/grassProfiles';
import {
  HARVEST_MELEE_DAMAGE,
  HarvestableTree,
} from '../entities/HarvestableTree';
import {
  GrassEntity,
  type GrassViewBounds,
} from '../entities/GrassEntity';
import type { Spider } from '../entities/Spider';
import {
  ItemPickup,
  PICKUP_RADIUS,
} from '../entities/ItemPickup';
import type { PlayerCharacterBase } from '../entities/PlayerCharacterBase';
import {
  addRuntimeTreeObstacle,
  allocGrassId,
  allocTreeId,
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
import { GrassSpatialIndex } from './GrassSpatialIndex';

export type HarvestWorldHooks = {
  sortLayer: Container;
  /**
   * 全景 / 屏外草层：不参与角色每帧深度排序。
   * 缺省时草始终在 sortLayer。
   */
  grassFarLayer?: Container;
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
 * 草：空间网格 + 全景 LOD 合批层 + 逻辑分片；投射物摧毁走 onTreeDestroyed。
 */
export class HarvestWorld {
  readonly trees: HarvestableTree[] = [];
  readonly grasses: GrassEntity[] = [];
  readonly pickups: ItemPickup[] = [];

  private readonly grassIndex = new GrassSpatialIndex<GrassEntity>(GRASS_GRID_CELL);
  private grassLogicSlice = 0;
  private lodFar = false;
  private persistDirty = false;
  private persistCooldown = 0;

  constructor(private readonly hooks: HarvestWorldHooks) {}

  /** 从地图刷可砍树与无碰撞草地 */
  spawnFromMap(mapDef: LevelMapDef): void {
    for (const t of normalizeTrees(mapDef)) {
      this.mountTree(t);
    }
    for (const g of normalizeGrasses(mapDef)) {
      if (this.grasses.length >= GRASS_MAX_COUNT) break;
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
        this.markGrassPersistDirty();
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
        this.markGrassPersistDirty();
      },
    });
    this.grasses.push(grass);
    this.grassIndex.insert(grass);
    this.placeGrassDisplay(grass, /* forceInView */ this.lodFar);
    return grass;
  }

  private get farLayer(): Container {
    return this.hooks.grassFarLayer ?? this.hooks.sortLayer;
  }

  /** 近景：屏内进 sortLayer；全景 / 屏外进 far 层 */
  private placeGrassDisplay(grass: GrassEntity, inDepthSort: boolean): void {
    if (!grass || grass.destroyed) return;
    const target =
      inDepthSort && !this.lodFar
        ? this.hooks.sortLayer
        : this.farLayer;
    if (grass.parent !== target) {
      // addChild 会自动从旧 parent 卸下；避免对已销毁节点操作
      target.addChild(grass);
    }
    if (grass.destroyed) return;
    grass.sortedForDepth = inDepthSort && !this.lodFar;
    grass.zIndex = grass.worldY;
  }

  /** 由场景根据 zoom 设置全景 LOD */
  setGrassLodFar(far: boolean): void {
    if (this.lodFar === far) return;
    this.lodFar = far;
    for (const g of this.grasses) {
      if (!g || g.destroyed) continue;
      if (far) {
        this.placeGrassDisplay(g, false);
      } else if (g.isWitheringOut) {
        this.placeGrassDisplay(g, true);
      } else {
        // 近景：先放 far，本帧 tick 再按可视区挂回 sortLayer
        this.placeGrassDisplay(g, false);
      }
    }
    // 全景：草层内按 Y 排一次即可，不进角色每帧 sort
    if (far && this.hooks.grassFarLayer?.sortableChildren) {
      this.hooks.grassFarLayer.sortChildren();
    }
  }

  get isGrassLodFar(): boolean {
    return this.lodFar;
  }

  /** 牛马：网格查最近可啃大草 */
  findNearestLargeGrass(
    x: number,
    y: number,
  ): { grass: GrassEntity; dist: number } | null {
    const hit = this.grassIndex.findNearest(
      x,
      y,
      (g) => g.size === 'large' && g.isGrazable,
    );
    if (!hit) return null;
    return { grass: hit.item, dist: hit.dist };
  }

  private markGrassPersistDirty(): void {
    this.persistDirty = true;
  }

  private flushGrassPersist(force = false): void {
    if (!this.persistDirty) return;
    if (!force && this.persistCooldown > 0) return;
    this.persistDirty = false;
    this.persistCooldown = GRASS_PERSIST_DEBOUNCE_SEC;
    this.hooks.persistMapDraft();
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
      this.markGrassPersistDirty();
    }
  }

  /** 与已有草丛是否过近（网格邻域） */
  private isGrassTooClose(x: number, y: number, minDist: number): boolean {
    return this.grassIndex.anyWithin(x, y, minDist);
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
    if (idx >= 0) {
      this.grasses.splice(idx, 1);
    }
    this.grassIndex.remove(grass);
    if (!grass || grass.destroyed) return;
    // destroy 会从 parent 卸下；勿在 destroy 后再 addChild/换层
    grass.destroy({ children: true });
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
      mapDef.grasses = mapDef.grasses.filter(
        (g) => grassIdOf(g) !== entity.grassId,
      );
    }
    this.hooks.afterWorldChange();
    this.markGrassPersistDirty();
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
    // 草在 tick 里自行 sync；此处只补同步仍在深度排序层的可见株
    for (const grass of this.grasses) {
      if (grass.destroyed) continue;
      if (grass.visible && grass.sortedForDepth) {
        grass.syncToWorld(!this.lodFar);
      }
    }
    for (const p of this.pickups) {
      p.syncToWorld();
    }
  }

  /**
   * @param view 镜头可视区（世界坐标）；近景屏外跳过摇摆并卸下 sortLayer
   */
  tickTrees(
    deltaMS: number,
    creatures?: ReadonlyArray<Spider>,
    view?: GrassViewBounds | null,
  ): void {
    for (const tree of this.trees) {
      tree.update(deltaMS);
    }
    const dt = deltaMS / 1000;
    if (this.persistCooldown > 0) {
      this.persistCooldown = Math.max(0, this.persistCooldown - dt);
    }

    // 场景为空白（全岛无草）时，在绿色陆地上随机孵化 1 棵生命火种小草
    if (this.grasses.length === 0) {
      this.spawnInitialSeedGrass();
      this.flushGrassPersist();
      return;
    }

    const slices = Math.max(1, GRASS_LOGIC_SLICES);
    this.grassLogicSlice = (this.grassLogicSlice + 1) % slices;
    const slice = this.grassLogicSlice;
    const lodFar = this.lodFar;

    // 快照：update 中可能 onWither → removeGrassEntity 改数组
    const snapshot = this.grasses.slice();
    for (let i = 0; i < snapshot.length; i++) {
      const g = snapshot[i];
      if (!g || g.destroyed) continue;

      const runLogic = g.isWitheringOut || i % slices === slice;
      g.update(deltaMS, {
        view,
        lodFar,
        runLogic,
        logicScale: runLogic && !g.isWitheringOut ? slices : 1,
      });

      // 本帧已销毁（枯萎结束）→ 禁止再换层 / 写 transform
      if (g.destroyed) continue;

      // 近景：屏内进深度排序层，屏外进 far 层
      if (!lodFar) {
        const wantSort =
          g.isWitheringOut || (g.visible && g.inView(view));
        if (wantSort !== g.sortedForDepth) {
          this.placeGrassDisplay(g, wantSort);
        }
      }
    }

    this.tickNaturalAnimalSpawning(dt);
    this.tickNaturalWolfSpawning(dt, creatures);
    this.tickNaturalPineSpawning(dt, creatures);
    this.flushGrassPersist();
  }

  private naturalAnimalTimer = 20;
  private naturalPineTimer = 18;

  /** 场上存活狼数量 */
  private countWolves(creatures?: ReadonlyArray<Spider>): number {
    if (!creatures) return 0;
    let n = 0;
    for (const s of creatures) {
      if (s.isAlive && !s.destroyed && s.label === 'Wolf') n += 1;
    }
    return n;
  }

  /**
   * 有狼之后：自然生成松树（狼吃完爱在松树边休息）。
   * 狼越多略加快长树；全岛松树有上限。
   */
  private tickNaturalPineSpawning(
    dt: number,
    creatures?: ReadonlyArray<Spider>,
  ): void {
    const wolfCount = this.countWolves(creatures);
    if (wolfCount <= 0) {
      this.naturalPineTimer = 18;
      return;
    }

    const pineCount = this.trees.filter(
      (t) => t.isAlive && t.treeKind === 'pine',
    ).length;
    /** 自然松树上限：基础 6 + 每只狼 +3，最多 24 */
    const pineCap = Math.min(24, 6 + wolfCount * 3);
    if (pineCount >= pineCap) {
      this.naturalPineTimer = 25;
      return;
    }

    this.naturalPineTimer -= dt;
    if (this.naturalPineTimer > 0) return;

    // 狼多时稍快长树
    this.naturalPineTimer = Math.max(12, 28 - wolfCount * 3) + Math.random() * 10;

    const mapDef = this.hooks.getMapDef();
    const land = landRectOf(mapDef);
    if (land.w <= 0 || land.h <= 0) return;

    // 优先在草地区域附近落树，否则绿地随机
    for (let attempt = 0; attempt < 16; attempt++) {
      let x: number;
      let y: number;
      if (this.grasses.length > 0 && Math.random() < 0.7) {
        const g =
          this.grasses[Math.floor(Math.random() * this.grasses.length)]!;
        const ang = Math.random() * Math.PI * 2;
        const dist = 80 + Math.random() * 140;
        x = g.worldX + Math.cos(ang) * dist;
        y = g.worldY + Math.sin(ang) * dist;
      } else {
        x = land.x + 40 + Math.random() * Math.max(1, land.w - 80);
        y = land.y + 40 + Math.random() * Math.max(1, land.h - 80);
      }

      if (!isOnGreenLand(x, y, mapDef, 255)) continue;
      if (this.isTreeTooClose(x, y, 130)) continue;

      const id = allocTreeId('pine');
      const t: MapTree = { x, y, size: 'sapling', kind: 'pine', id };
      mapDef.trees.push(t);
      addRuntimeTreeObstacle({
        x,
        y,
        r: treeSolidR('sapling'),
        id,
      });
      this.mountTree(t);
      this.hooks.afterWorldChange();
      this.hooks.persistMapDraft();
      return;
    }
  }

  /** 树与树之间是否过近 */
  private isTreeTooClose(x: number, y: number, minDist: number): boolean {
    const min2 = minDist * minDist;
    for (const t of this.trees) {
      if (!t.isAlive) continue;
      const dx = t.worldX - x;
      const dy = t.worldY - y;
      if (dx * dx + dy * dy < min2) return true;
    }
    return false;
  }

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
