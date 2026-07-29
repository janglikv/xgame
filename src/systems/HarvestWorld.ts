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
  TREE_MIN_SPACING,
  TREE_MAX_COUNT,
  TREE_SPREAD_ATTEMPTS,
  TREE_SPREAD_RADIUS_MAX,
  TREE_SPREAD_RADIUS_MIN,
  TREE_CLUSTER_RADIUS,
  TREE_CLUSTER_SPEEDUP,
  TREE_GRID_CELL,
  TREE_LOGIC_SLICES,
  TREE_PERSIST_DEBOUNCE_SEC,
} from '../data/treeProfiles';
import {
  HARVEST_MELEE_DAMAGE,
  HarvestableTree,
  type TreeViewBounds,
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

/** 世界变更标志：控制昂贵的陆地泥土重绘 */
export type HarvestWorldChangeOpts = {
  /**
   * 是否需要重绘树林黄泥土（仅树布局/体型变时）。
   * 草的生长/枯萎不需要，默认 false。
   */
  redrawLand?: boolean;
};

export type MudSpot = {
  x: number;
  y: number;
  radius: number;
  fertility: number; // 0 -> 100 (100 = 恢复为肥沃绿地)
};

export type HarvestWorldHooks = {
  sortLayer: Container;
  /**
   * 植被底层：全部草 + 屏外树。不参与角色每帧深度排序。
   */
  grassFarLayer?: Container;
  /**
   * 树在角色「身后」的层（worldY 明显小于参考点）。
   * 缺省时回退 grassFarLayer。
   */
  treeBackLayer?: Container;
  /**
   * 树在角色「身前」的层（worldY 明显大于参考点）。
   * 缺省时回退 sortLayer 上方由场景保证顺序。
   */
  treeFrontLayer?: Container;
  /** 深度分带参考 Y（通常是玩家脚底）；缺省不做前后带 */
  getDepthRefY?: () => number;
  inventory: Inventory;
  getMapDef: () => LevelMapDef;
  /** 树从 def 移除 solid 后持久化草稿 */
  persistMapDraft: () => void;
  /** 世界坐标 / 深度刷新 */
  afterWorldChange: (opts?: HarvestWorldChangeOpts) => void;
  /** 草丰水茂时自然孕育诞生的农场动物回调 */
  onSpawnNaturalAnimal?: (kind: EnemyKind, x: number, y: number) => void;
};

/** 与角色精细 Y 排序的半宽（世界像素）；带外进前后静态层 */
const TREE_DEPTH_BAND = 36;

/**
 * 可砍树 + 装饰草地 + 掉落拾取：生成、近战、自动生长、四面八方扩散、摧毁掉落、进包。
 * 草/树：空间网格 + 屏外分层 + 逻辑分片；投射物摧毁走 onTreeDestroyed。
 */
export class HarvestWorld {
  readonly trees: HarvestableTree[] = [];
  readonly grasses: GrassEntity[] = [];
  readonly pickups: ItemPickup[] = [];
  readonly mudSpots: MudSpot[] = [];

  private readonly grassIndex = new GrassSpatialIndex<GrassEntity>(GRASS_GRID_CELL);
  private readonly treeIndex = new GrassSpatialIndex<HarvestableTree>(TREE_GRID_CELL);
  private grassLogicSlice = 0;
  private treeLogicSlice = 0;
  private lodFar = false;
  private persistDirty = false;
  private persistCooldown = 0;
  private treePersistDirty = false;
  private treePersistCooldown = 0;

  constructor(private readonly hooks: HarvestWorldHooks) {}

  /** 判定坐标 (x, y) 是否位于泥地/休耕地范围内 */
  isInMudSpot(x: number, y: number): boolean {
    for (let i = 0; i < this.mudSpots.length; i++) {
      const m = this.mudSpots[i]!;
      const dx = x - m.x;
      const dy = y - m.y;
      if (dx * dx + dy * dy <= m.radius * m.radius) {
        return true;
      }
    }
    return false;
  }

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
        this.hooks.afterWorldChange({ redrawLand: true });
        this.markTreePersistDirty();
      },
      onSpread: (source) => {
        this.trySpreadTreeFrom(source);
      },
      onWither: (witheredTree) => {
        this.onTreeWithered(witheredTree);
      },
      onAppleDrop: (worldX, worldY) => {
        this.spawnPickup(worldX, worldY, 'apple', 1);
      },
    });
    this.trees.push(tree);
    this.treeIndex.insert(tree);
    // 默认按深度分带；本帧 tick 再按可视区校正
    this.placeTreeDisplay(tree, true);
    return tree;
  }

  private get treeBack(): Container {
    return this.hooks.treeBackLayer ?? this.farLayer;
  }

  private get treeFront(): Container {
    return this.hooks.treeFrontLayer ?? this.hooks.sortLayer;
  }

  /**
   * 树分层：
   * - 屏外 → far
   * - 相对玩家 Y 偏北 → back（整层在角色下）
   * - 相对玩家 Y 偏南 → front（整层在角色上）
   * - 接近玩家 Y → sortLayer 精细 zIndex
   * 大幅减少每帧 sortChildren 的节点数（玩法逻辑不变）。
   */
  private placeTreeDisplay(tree: HarvestableTree, inView: boolean): void {
    if (!tree || tree.destroyed) return;

    let target: Container;
    let inDepthSort = false;

    if (!inView) {
      target = this.farLayer;
    } else {
      const refY = this.hooks.getDepthRefY?.();
      if (refY === undefined) {
        target = this.hooks.sortLayer;
        inDepthSort = true;
      } else if (tree.worldY < refY - TREE_DEPTH_BAND) {
        target = this.treeBack;
      } else if (tree.worldY > refY + TREE_DEPTH_BAND) {
        target = this.treeFront;
      } else {
        target = this.hooks.sortLayer;
        inDepthSort = true;
      }
    }

    if (tree.parent !== target) {
      target.addChild(tree);
    }
    if (tree.destroyed) return;
    tree.sortedForDepth = inDepthSort;
    tree.zIndex = tree.worldY;
  }

  private markTreePersistDirty(): void {
    this.treePersistDirty = true;
  }

  private flushTreePersist(force = false): void {
    if (!this.treePersistDirty) return;
    if (!force && this.treePersistCooldown > 0) return;
    this.treePersistDirty = false;
    this.treePersistCooldown = TREE_PERSIST_DEBOUNCE_SEC;
    this.hooks.persistMapDraft();
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
    // 草永远在 far 层：矮草无需与角色 Y 交错，避免塞进每帧 sort
    this.placeGrassDisplay(grass);
    this.markGrassFarSortDirty();
    return grass;
  }

  private get farLayer(): Container {
    return this.hooks.grassFarLayer ?? this.hooks.sortLayer;
  }

  /** 草固定挂 far 层（角色始终画在草上） */
  private placeGrassDisplay(grass: GrassEntity): void {
    if (!grass || grass.destroyed) return;
    const target = this.farLayer;
    if (grass.parent !== target) {
      target.addChild(grass);
    }
    if (grass.destroyed) return;
    grass.sortedForDepth = false;
    grass.zIndex = grass.worldY;
  }

  private grassFarSortDirty = false;

  /** 由场景根据 zoom 设置全景 LOD（草已不进 sortLayer，仅保留接口） */
  setGrassLodFar(far: boolean): void {
    if (this.lodFar === far) return;
    this.lodFar = far;
    // 草始终 far；全景时低频整理一次草层 Y 序
    if (far) this.grassFarSortDirty = true;
  }

  /** 草层有新增时标记，tick 内低频 sort */
  private markGrassFarSortDirty(): void {
    this.grassFarSortDirty = true;
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

  /**
   * 统计坐标 (x, y) 指定半径内的存活树木数量（空间网格）
   */
  countNearbyTrees(x: number, y: number, radius: number): number {
    return this.treeIndex.countWithin(x, y, radius, (t) => t.isAlive);
  }

  /**
   * 母树向四周尝试播种新树苗。
   * 抱团机制：优先在母树/树丛周边 (45~135px) 紧凑吸附落点，天然形成林区。
   */
  private trySpreadTreeFrom(source: HarvestableTree): void {
    if (this.trees.length >= TREE_MAX_COUNT) return;

    const mapDef = this.hooks.getMapDef();
    const targetQuota = TREE_SPREAD_ATTEMPTS[source.size] ?? 1;
    let spawned = 0;

    for (let q = 0; q < targetQuota; q++) {
      if (this.trees.length >= TREE_MAX_COUNT) break;

      // 寻找落点：优先以母树或现有集群为中心抱团聚落
      for (let attempt = 0; attempt < 12; attempt++) {
        // 80% 概率紧贴母树周边，20% 概率随机向外伸展
        const anchor =
          Math.random() < 0.8 || this.trees.length <= 1
            ? source
            : this.trees[Math.floor(Math.random() * this.trees.length)]!;

        const angle = Math.random() * Math.PI * 2;
        const dist =
          TREE_SPREAD_RADIUS_MIN +
          Math.random() * (TREE_SPREAD_RADIUS_MAX - TREE_SPREAD_RADIUS_MIN);
        const x = anchor.worldX + Math.cos(angle) * dist;
        const y = anchor.worldY + Math.sin(angle) * dist;

        // 仅限绿色陆地
        if (!isOnGreenLand(x, y, mapDef, 255)) continue;
        // 泥地上绝对不能播种发芽树木！
        if (this.isInMudSpot(x, y)) continue;
        // 树木之间保持最小保护间距
        if (this.isTreeTooClose(x, y, TREE_MIN_SPACING)) continue;

        const prefix = source.treeKind === 'apple' ? 'apsap' : 'sap';
        const id = allocTreeId(prefix);
        const t: MapTree = {
          x,
          y,
          size: 'sapling',
          kind: source.treeKind,
          id,
        };
        mapDef.trees.push(t);
        addRuntimeTreeObstacle({
          x,
          y,
          r: treeSolidR('sapling'),
          id,
        });
        this.mountTree(t);
        spawned += 1;
        break;
      }
    }

    if (spawned > 0) {
      this.hooks.afterWorldChange({ redrawLand: true });
      this.markTreePersistDirty();
    }
  }

  /** 与已有草丛是否过近（网格邻域） */
  private isGrassTooClose(x: number, y: number, minDist: number): boolean {
    return this.grassIndex.anyWithin(x, y, minDist);
  }

  /** 检查坐标 (x, y) 是否距离任何树木过近（树木遮荫与养分竞争，草无法存活生长） */
  isGrassTooCloseToTrees(x: number, y: number): boolean {
    // 最大竞争半径（large）；再按体型精确判定
    let blocked = false;
    this.treeIndex.forEachWithin(x, y, 135, (tree, dist2) => {
      if (!tree.isAlive) return;
      const radius = TREE_GRASS_COMPETITION_RADIUS[tree.size] ?? 72;
      if (dist2 <= radius * radius) {
        blocked = true;
        return true;
      }
    });
    return blocked;
  }

  /** 树被摧毁：掉木头（苹果树额外掉落苹果） + 移除 solid + 从草稿去掉 */
  onTreeDestroyed(tree: HarvestableTree): void {
    this.treeIndex.remove(tree);
    if (tree.treeId) {
      removeRuntimeTreeObstacleById(tree.treeId);
      const mapDef = this.hooks.getMapDef();
      mapDef.trees = mapDef.trees.filter(
        (t) => treeIdOf(t) !== tree.treeId,
      );
      this.markTreePersistDirty();
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

  /** 树自然衰老枯萎：耗尽地力生成泥地/休耕地 + 移除实体 + 掉落 1 木头残余 */
  onTreeWithered(tree: HarvestableTree): void {
    this.removeTreeEntity(tree);
    this.mudSpots.push({
      x: tree.worldX,
      y: tree.worldY,
      radius: 130,
      fertility: 0,
    });
    this.spawnPickup(tree.worldX, tree.worldY, 'wood', 1);
    this.hooks.afterWorldChange({ redrawLand: true });
    this.markTreePersistDirty();
  }

  spawnPickup(
    x: number,
    y: number,
    itemId: 'wood' | 'apple',
    count: number,
  ): void {
    // 场上掉落物上限 50 个，超过时将最老的掉落物回收，避免过量积压
    if (this.pickups.length >= 50) {
      const oldest = this.pickups.shift();
      if (oldest) {
        this.hooks.sortLayer.removeChild(oldest);
        oldest.destroy({ children: true });
      }
    }
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
    let felled = false;
    if (!alive) {
      const idx = this.trees.indexOf(best);
      if (idx >= 0) {
        this.onTreeDestroyed(best);
        best.parent?.removeChild(best);
        best.destroy({ children: true });
        this.trees.splice(idx, 1);
        felled = true;
      }
    }
    this.hooks.afterWorldChange(felled ? { redrawLand: true } : undefined);
    return true;
  }

  /** 从列表移除实体（上帝模式擦除等，不触发掉落） */
  removeTreeEntity(tree: HarvestableTree): void {
    const idx = this.trees.indexOf(tree);
    if (idx < 0) return;
    this.treeIndex.remove(tree);
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
      if (p.isCollected || p.isExpired) {
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
    // 树/草在 tick 里自行 sync；此处只补同步仍在深度排序层的可见实体
    for (const tree of this.trees) {
      if (tree.destroyed) continue;
      if (tree.visible && tree.sortedForDepth) {
        tree.syncToWorld();
      }
    }
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
   * @param view 镜头可视区（世界坐标）；屏外跳过视觉并卸下 sortLayer
   */
  tickTrees(
    deltaMS: number,
    creatures?: ReadonlyArray<Spider>,
    view?: GrassViewBounds | TreeViewBounds | null,
  ): void {
    const dt = deltaMS / 1000;
    if (this.persistCooldown > 0) {
      this.persistCooldown = Math.max(0, this.persistCooldown - dt);
    }
    if (this.treePersistCooldown > 0) {
      this.treePersistCooldown = Math.max(0, this.treePersistCooldown - dt);
    }

    this.tickTreeEntities(deltaMS, view);
    this.tickTreeSproutFromLushGrass(dt);

    // 场景为空白（全岛无草）时，在绿色陆地上随机孵化 1 棵初始种子草（生命火种）
    if (this.grasses.length === 0) {
      this.spawnInitialSeedGrass();
      this.flushGrassPersist();
      this.flushTreePersist();
      return;
    }

    // 推进泥地/休耕地地力恢复过程（草的根系改良土壤）
    for (let i = this.mudSpots.length - 1; i >= 0; i--) {
      const m = this.mudSpots[i]!;
      const grassCount = this.grassIndex.countWithin(
        m.x,
        m.y,
        m.radius,
        (g) => !g.isWitheringOut,
      );
      if (grassCount > 0) {
        // 泥地上有草在生根滋养土壤，草越多积累肥力越快
        m.fertility += dt * (4.0 + grassCount * 3.5);
      } else {
        // 无草时极慢自然休耕恢复
        m.fertility += dt * 0.8;
      }
      if (m.fertility >= 100) {
        this.mudSpots.splice(i, 1); // 肥力满 100，修养完毕，恢复为肥沃绿地
      }
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

      const inMud = this.isInMudSpot(g.worldX, g.worldY);
      const runLogic = g.isWitheringOut || i % slices === slice;
      g.update(deltaMS, {
        view,
        lodFar,
        speedup: inMud ? 0.25 : 1.0, // 泥地上草生长减慢至 25%
        runLogic,
        logicScale: runLogic && !g.isWitheringOut ? slices : 1,
      });
    }

    // 草层 Y 序：仅在新增/LOD 时低频整理一次（不进角色 sort）
    if (this.grassFarSortDirty && this.hooks.grassFarLayer?.sortableChildren) {
      this.hooks.grassFarLayer.sortChildren();
      this.grassFarSortDirty = false;
    }

    this.tickNaturalAnimalSpawning(dt);
    this.tickNaturalWolfSpawning(dt, creatures);
    this.tickNaturalPineSpawning(dt, creatures);
    this.flushGrassPersist();
    this.flushTreePersist();
  }

  /** 树：逻辑分片 + 屏外剔除 + Y 分带（减少 sortLayer 节点） */
  private tickTreeEntities(
    deltaMS: number,
    view?: TreeViewBounds | null,
  ): void {
    const slices = Math.max(1, TREE_LOGIC_SLICES);
    this.treeLogicSlice = (this.treeLogicSlice + 1) % slices;
    const slice = this.treeLogicSlice;

    // 快照：扩散可能 mount 新树改数组
    const snapshot = this.trees.slice();
    for (let i = 0; i < snapshot.length; i++) {
      const tree = snapshot[i];
      if (!tree || tree.destroyed || (!tree.isAlive && !tree.isWitheringOut)) continue;

      const runLogic = i % slices === slice || tree.isWitheringOut;
      // 计算 120px 范围内的存活同伴树数量 N
      const neighbors = this.treeIndex.countWithin(
        tree.worldX,
        tree.worldY,
        TREE_CLUSTER_RADIUS,
        (t) => t.isAlive,
        tree,
      );

      // 密度依存自然死亡率（生态自我循环法则）：
      // 1) N = 0（孤树）：无庇护，死亡率较高 (1.8x)
      // 2) N = 1~3（黄金小树林）：适度庇护，阳光充足，死亡率极低 (0.2x)，蓬勃生长
      // 3) N >= 4（过密老林）：严重遮阴与根系竞争，触发自然凋亡与稀疏，死亡率陡增 (3.6x)
      let deathRateMultiplier = 1.0;
      if (neighbors === 0) {
        deathRateMultiplier = 1.8;
      } else if (neighbors <= 3) {
        deathRateMultiplier = 0.2;
      } else {
        deathRateMultiplier = 3.6;
      }

      tree.clusterSpeedup = neighbors >= 1 && neighbors <= 3 ? TREE_CLUSTER_SPEEDUP : 1;

      tree.update(deltaMS, {
        view,
        speedup: tree.clusterSpeedup,
        deathRateMultiplier,
        runLogic,
        logicScale: runLogic && !tree.isWitheringOut ? slices : 1,
      });

      if (tree.destroyed) continue;

      // 每帧按可视 + 玩家 Y 分带（parent 不变时 addChild 极轻）
      const inView = tree.visible && tree.inView(view);
      this.placeTreeDisplay(tree, inView);
    }
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
   * 狼越多略加快长树；优先向现有树木/树林抱团聚落。
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

    // 优先向场上已有树木周边（50px ~ 130px）抱团聚落，更容易形成森林
    for (let attempt = 0; attempt < 16; attempt++) {
      let x: number;
      let y: number;

      if (this.trees.length > 0 && Math.random() < 0.75) {
        const anchor =
          this.trees[Math.floor(Math.random() * this.trees.length)]!;
        const ang = Math.random() * Math.PI * 2;
        const dist =
          TREE_SPREAD_RADIUS_MIN +
          Math.random() * (TREE_SPREAD_RADIUS_MAX - TREE_SPREAD_RADIUS_MIN);
        x = anchor.worldX + Math.cos(ang) * dist;
        y = anchor.worldY + Math.sin(ang) * dist;
      } else if (this.grasses.length > 0 && Math.random() < 0.7) {
        const g =
          this.grasses[Math.floor(Math.random() * this.grasses.length)]!;
        const ang = Math.random() * Math.PI * 2;
        const dist = 60 + Math.random() * 100;
        x = g.worldX + Math.cos(ang) * dist;
        y = g.worldY + Math.sin(ang) * dist;
      } else {
        x = land.x + 40 + Math.random() * Math.max(1, land.w - 80);
        y = land.y + 40 + Math.random() * Math.max(1, land.h - 80);
      }

      if (!isOnGreenLand(x, y, mapDef, 255)) continue;
      if (this.isTreeTooClose(x, y, TREE_MIN_SPACING)) continue;

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
      this.hooks.afterWorldChange({ redrawLand: true });
      this.markTreePersistDirty();
      return;
    }
  }

  /** 树与树之间是否过近（空间网格） */
  private isTreeTooClose(x: number, y: number, minDist: number): boolean {
    let tooClose = false;
    this.treeIndex.forEachWithin(x, y, minDist, (t, dist2) => {
      if (!t.isAlive) return;
      if (dist2 < minDist * minDist) {
        tooClose = true;
        return true;
      }
    });
    return tooClose;
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

  /** 统计指定坐标指定半径内的活草数量 */
  countNearbyGrasses(x: number, y: number, radius: number): number {
    return this.grassIndex.countWithin(x, y, radius, (g) => !g.isWitheringOut);
  }

  private treeSproutTimer = 10;

  /** 在草丛茂盛区（大草或高密度草丛）孕育发芽新树苗 */
  private tickTreeSproutFromLushGrass(dt: number): void {
    if (this.trees.length >= TREE_MAX_COUNT) return;
    this.treeSproutTimer -= dt;
    if (this.treeSproutTimer > 0) return;

    this.treeSproutTimer = 18 + Math.random() * 14;

    if (this.grasses.length === 0) return;

    const mapDef = this.hooks.getMapDef();
    const candidates = this.grasses.filter((g) => !g.isWitheringOut);
    if (candidates.length === 0) return;

    for (let i = 0; i < 12; i++) {
      const g = candidates[Math.floor(Math.random() * candidates.length)]!;
      const nearbyGrassCount = this.countNearbyGrasses(g.worldX, g.worldY, 140);
      const isLush = g.size === 'large' || nearbyGrassCount >= 3;

      if (!isLush) continue;

      // 距离已有树木至少 80px，不在已有树木正下方发芽
      if (this.countNearbyTrees(g.worldX, g.worldY, 80) > 0) continue;

      const angle = Math.random() * Math.PI * 2;
      const dist = 22 + Math.random() * 26;
      const x = g.worldX + Math.cos(angle) * dist;
      const y = g.worldY + Math.sin(angle) * dist;

      if (!isOnGreenLand(x, y, mapDef, 255)) continue;
      // 泥地上绝不长树！必须修复变回肥沃绿地后才能发芽
      if (this.isInMudSpot(x, y)) continue;
      if (this.isTreeTooClose(x, y, TREE_MIN_SPACING)) continue;

      const kind = Math.random() < 0.5 ? 'pine' : 'apple';
      const prefix = kind === 'apple' ? 'apsap' : 'sap';
      const id = allocTreeId(prefix);
      const t: MapTree = { x, y, size: 'sapling', kind, id };
      if (!mapDef.trees) mapDef.trees = [];
      mapDef.trees.push(t);
      addRuntimeTreeObstacle({
        x,
        y,
        r: treeSolidR('sapling'),
        id,
      });
      this.mountTree(t);
      this.markTreePersistDirty();
      this.hooks.afterWorldChange({ redrawLand: true });
      break;
    }
  }
}
