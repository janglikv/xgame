import type { Container } from 'pixi.js';
import { EcologySpawnerSystem } from './EcologySpawnerSystem';
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
  updateMapTreeSize,
  type EnemyKind,
  type LevelMapDef,
  type MapGrass,
  type MapTree,
} from '../data/maps';
import {
  COLLAPSE_MUD_RADIUS,
  ECO_R,
  FOREST_CLUSTER_JOIN_R,
  FOREST_EDGE_DIST_MAX,
  FOREST_EDGE_DIST_MIN,
  FOREST_MAIN_NEIGHBOR_R,
  FOREST_TREE_COLLAPSE,
  MEADOW_GRASS_FOR_TREE,
  MUD_ATTRACT_R,
  MUD_CLEAR_GRASS,
  MUD_FERTILITY_BARE,
  MUD_FERTILITY_WITH_GRASS,
  MUD_GRASS_CAP,
  MUD_GRASS_SPACING,
  MUD_RADIUS_MAX,
  MUD_TREE_DEATH_MULT,
  MUD_TREE_GROW_MULT,
} from '../data/mudProfiles';
import type { Inventory } from './Inventory';
import { GrassSpatialIndex } from './GrassSpatialIndex';
import {
  MudSpotField,
  type MudSpot,
} from './MudSpotField';


/** 世界变更标志：控制昂贵的陆地泥土重绘 */
export type HarvestWorldChangeOpts = {
  /**
   * 是否需要重绘树林黄泥土 / 泥地（树布局或泥地变化时）。
   * 草的生长/枯萎不需要，默认 false。
   */
  redrawLand?: boolean;
};

/** 泥斑类型 re-export，外部/草稿兼容 */
export type { MudSpot } from './MudSpotField';

/**
 * 极简生态轮动：泥地 → 稀草 → 草地 → 密树 → 泥地
 * 数值见 data/mudProfiles；泥斑几何见 MudSpotField。
 */
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
  private readonly mudField = new MudSpotField();
  /** 与 mudField.spots 同一引用，供场景重绘泥土 */
  get mudSpots(): MudSpot[] {
    return this.mudField.spots;
  }

  private readonly grassIndex = new GrassSpatialIndex<GrassEntity>(GRASS_GRID_CELL);
  private readonly treeIndex = new GrassSpatialIndex<HarvestableTree>(TREE_GRID_CELL);
  private grassLogicSlice = 0;
  private treeLogicSlice = 0;
  private lodFar = false;
  private persistDirty = false;
  private persistCooldown = 0;
  private treePersistDirty = false;
  private treePersistCooldown = 0;
  private readonly ecologySpawner: EcologySpawnerSystem;

  constructor(private readonly hooks: HarvestWorldHooks) {
    this.ecologySpawner = new EcologySpawnerSystem({
      getMapDef: () => this.hooks.getMapDef(),
      onSpawnNaturalAnimal: (kind, x, y) =>
        this.hooks.onSpawnNaturalAnimal?.(kind, x, y),
      isGrassTooCloseToTrees: (x, y) => this.isGrassTooCloseToTrees(x, y),
    });
  }

  /** 判定坐标 (x, y) 是否位于泥地/休耕地范围内 */
  isInMudSpot(x: number, y: number): boolean {
    return this.mudField.isInMudSpot(x, y);
  }

  /** 从地图刷可砍树与无碰撞草地 */
  spawnFromMap(mapDef: LevelMapDef): void {
    // 先草后树：树 mount 时会清掉遮荫内草，与运行时诞生规则一致
    for (const g of normalizeGrasses(mapDef)) {
      if (this.grasses.length >= GRASS_MAX_COUNT) break;
      this.mountGrass(g);
    }
    for (const t of normalizeTrees(mapDef)) {
      this.mountTree(t);
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
        updateMapTreeSize(
          this.hooks.getMapDef(),
          grownTree.treeId,
          grownTree.size,
        );
        addRuntimeTreeObstacle({
          x: grownTree.worldX,
          y: grownTree.worldY,
          r: treeSolidR(grownTree.size),
          id: grownTree.treeId,
        });
        // 长大后遮荫扩大：再清一圈草
        this.killGrassNearTree(grownTree);
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
    // 树诞生：周围草枯死（遮荫/养分竞争）
    this.killGrassNearTree(tree);
    // 默认按深度分带；本帧 tick 再按可视区校正
    this.placeTreeDisplay(tree, true);
    return tree;
  }

  /**
   * 树体型对应遮荫半径内的草枯萎死亡。
   * 诞生 / 长大时调用；草走 wither 动画，由 onWither 卸实体与草稿。
   */
  private killGrassNearTree(tree: HarvestableTree): void {
    if (!tree || tree.destroyed || !tree.isAlive) return;
    const radius = TREE_GRASS_COMPETITION_RADIUS[tree.size] ?? 48;
    const r2 = radius * radius;
    // 先收集再 wither，避免遍历中改索引桶
    const victims: GrassEntity[] = [];
    this.grassIndex.forEachWithin(
      tree.worldX,
      tree.worldY,
      radius,
      (g, dist2) => {
        if (!g || g.destroyed || g.isWitheringOut) return;
        if (dist2 <= r2) victims.push(g);
      },
    );
    for (const g of victims) {
      g.wither();
    }
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
    const onMud = this.isInMudSpot(g.x, g.y);
    const grass = new GrassEntity(g.x, g.y, {
      size: onMud ? 'small' : size,
      grassId: id,
      maxSize: onMud ? 'small' : null,
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
   * 母株播种：优先贴着母株成片扩张（近距），少量中距填洞，极少远距拓殖空地。
   * 泥地：稀草（宽间距 + 数量上限）。
   */
  private trySpreadFrom(source: GrassEntity): void {
    if (this.grasses.length >= GRASS_MAX_COUNT) return;

    const mapDef = this.hooks.getMapDef();
    const sourceInMud = this.isInMudSpot(source.worldX, source.worldY);
    const targetQuota = sourceInMud
      ? 1
      : (GRASS_SPREAD_ATTEMPTS[source.size] ?? 1);
    let spawned = 0;

    for (let q = 0; q < targetQuota; q++) {
      if (this.grasses.length >= GRASS_MAX_COUNT) break;

      for (let attempt = 0; attempt < 10; attempt++) {
        const angle = Math.random() * Math.PI * 2;
        // 近 70% / 中 22% / 远 8% —— 先连片，再拓荒
        const roll = Math.random();
        let dist: number;
        if (sourceInMud) {
          dist = 50 + Math.random() * 40;
        } else if (roll < 0.7) {
          dist =
            GRASS_SPREAD_RADIUS_MIN +
            Math.random() *
              (GRASS_SPREAD_RADIUS_MAX - GRASS_SPREAD_RADIUS_MIN);
        } else if (roll < 0.92) {
          dist = GRASS_SPREAD_RADIUS_MAX + Math.random() * 50;
        } else {
          dist = 140 + Math.random() * 80;
        }
        const x = source.worldX + Math.cos(angle) * dist;
        const y = source.worldY + Math.sin(angle) * dist;

        if (!isOnGreenLand(x, y, mapDef, 255)) continue;
        if (this.isGrassTooCloseToTrees(x, y)) continue;

        const mud = this.findMudSpot(x, y);
        if (mud) {
          const mudGrass = this.grassIndex.countWithin(
            mud.x,
            mud.y,
            mud.radius,
            (g) => !g.isWitheringOut,
          );
          if (mudGrass >= MUD_GRASS_CAP) continue;
          if (this.isGrassTooClose(x, y, MUD_GRASS_SPACING)) continue;
        } else if (this.isGrassTooClose(x, y, GRASS_MIN_SPACING)) {
          continue;
        }

        if (!mapDef.grasses) mapDef.grasses = [];
        const id = allocGrassId('gs');
        const g: MapGrass = { x, y, size: 'small', id };
        mapDef.grasses.push(g);
        this.mountGrass(g);
        spawned += 1;
        break;
      }
    }

    if (spawned > 0) {
      this.hooks.afterWorldChange();
      this.markGrassPersistDirty();
    }
  }

  /** 坐标所在泥地；无则 null */
  findMudSpot(x: number, y: number): MudSpot | null {
    return this.mudField.findMudSpot(x, y);
  }


  /**
   * 统计坐标 (x, y) 指定半径内的存活树木数量（空间网格）
   */
  countNearbyTrees(x: number, y: number, radius: number): number {
    return this.treeIndex.countWithin(x, y, radius, (t) => t.isAlive);
  }

  /**
   * 母树播种：只在母树紧邻林缘落苗（强制同簇扩张）。
   */
  private trySpreadTreeFrom(source: HarvestableTree): void {
    if (this.trees.length >= TREE_MAX_COUNT) return;
    if (!source.isAlive) return;

    const mapDef = this.hooks.getMapDef();
    // 孤树播种略少；成簇后加速外扩
    const neighbors = this.countNearbyTrees(
      source.worldX,
      source.worldY,
      FOREST_MAIN_NEIGHBOR_R,
    );
    const baseQuota = TREE_SPREAD_ATTEMPTS[source.size] ?? 1;
    const targetQuota =
      neighbors >= 2 ? baseQuota + 1 : neighbors === 0 ? 1 : baseQuota;
    let spawned = 0;

    for (let q = 0; q < targetQuota; q++) {
      if (this.trees.length >= TREE_MAX_COUNT) break;

      // 多试几次找「仍贴母树、但局部邻居较少」的林缘空位
      let best: { x: number; y: number; score: number } | null = null;
      for (let attempt = 0; attempt < 22; attempt++) {
        const angle = Math.random() * Math.PI * 2;
        const dist =
          FOREST_EDGE_DIST_MIN +
          Math.random() * (FOREST_EDGE_DIST_MAX - FOREST_EDGE_DIST_MIN);
        const x = source.worldX + Math.cos(angle) * dist;
        const y = source.worldY + Math.sin(angle) * dist;
        if (!this.canPlantTreeAt(x, y, mapDef)) continue;
        if (this.countNearbyTrees(x, y, FOREST_CLUSTER_JOIN_R) < 1) continue;
        // 偏好：贴母树且该方向不那么挤 → 向外缘扩张
        const localN = this.countNearbyTrees(x, y, FOREST_CLUSTER_JOIN_R);
        const score = 10 - localN + Math.random() * 0.5;
        if (!best || score > best.score) best = { x, y, score };
      }
      if (!best) break;
      this.plantSapling(best.x, best.y, source.treeKind, mapDef);
      spawned += 1;
    }

    if (spawned > 0) {
      this.hooks.afterWorldChange({ redrawLand: true });
      this.markTreePersistDirty();
    }
  }

  /** 落点是否可种树（绿地、非泥、间距、未达塌缩密度） */
  private canPlantTreeAt(
    x: number,
    y: number,
    mapDef: LevelMapDef,
  ): boolean {
    if (!isOnGreenLand(x, y, mapDef, 255)) return false;
    if (this.isInMudSpot(x, y)) return false;
    if (this.isTreeTooClose(x, y, TREE_MIN_SPACING)) return false;
    if (this.countNearbyTrees(x, y, ECO_R) >= FOREST_TREE_COLLAPSE) {
      return false;
    }
    return true;
  }

  /**
   * 选「主林」扩张锚点：邻居越多权重越高，孤树几乎轮不到。
   * 这样全岛增长都集中在最大那一团，而不是满图散点扩。
   */
  private pickMainForestAnchor(): HarvestableTree | null {
    const alive = this.trees.filter((t) => t.isAlive && !t.destroyed);
    if (alive.length === 0) return null;
    if (alive.length === 1) return alive[0]!;

    // 抽样评估，树多时避免 O(n²) 过重
    const samples =
      alive.length <= 24
        ? alive
        : Array.from({ length: 24 }, () => {
            return alive[Math.floor(Math.random() * alive.length)]!;
          });

    let best: HarvestableTree | null = null;
    let bestWeight = 0;
    for (const t of samples) {
      const n = this.countNearbyTrees(
        t.worldX,
        t.worldY,
        FOREST_MAIN_NEIGHBOR_R,
      );
      // (n+1)^2：主林远高于孤树；加一点噪声避免永远同一棵
      const w = (n + 1) * (n + 1) * (0.85 + Math.random() * 0.3);
      if (w > bestWeight) {
        bestWeight = w;
        best = t;
      }
    }
    return best;
  }

  /**
   * 在主林林缘尝试落一棵苗。成功返回 true。
   */
  private tryPlantOnForestEdge(
    anchor: HarvestableTree,
    mapDef: LevelMapDef,
    kind?: NonNullable<MapTree['kind']>,
  ): boolean {
    const treeKind = kind ?? anchor.treeKind;
    for (let attempt = 0; attempt < 16; attempt++) {
      const ang = Math.random() * Math.PI * 2;
      const dist =
        FOREST_EDGE_DIST_MIN +
        Math.random() * (FOREST_EDGE_DIST_MAX - FOREST_EDGE_DIST_MIN);
      const x = anchor.worldX + Math.cos(ang) * dist;
      const y = anchor.worldY + Math.sin(ang) * dist;
      if (!this.canPlantTreeAt(x, y, mapDef)) continue;
      if (this.countNearbyTrees(x, y, FOREST_CLUSTER_JOIN_R) < 1) continue;
      this.plantSapling(x, y, treeKind, mapDef);
      return true;
    }
    return false;
  }

  /** 写入地图 + solid + mount 一棵树苗 */
  private plantSapling(
    x: number,
    y: number,
    kind: MapTree['kind'] extends infer K ? NonNullable<K> : 'pine',
    mapDef: LevelMapDef,
  ): HarvestableTree {
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
    return this.mountTree(t);
  }

  /** 与已有草丛是否过近（网格邻域） */
  private isGrassTooClose(x: number, y: number, minDist: number): boolean {
    return this.grassIndex.anyWithin(x, y, minDist);
  }

  /** 检查坐标 (x, y) 是否距离任何树木过近（树木遮荫与养分竞争，草无法存活生长） */
  isGrassTooCloseToTrees(x: number, y: number): boolean {
    // 最大竞争半径（large）；再按体型精确判定
    let blocked = false;
    this.treeIndex.forEachWithin(x, y, 72, (tree, dist2) => {
      if (!tree.isAlive) return;
      const radius = TREE_GRASS_COMPETITION_RADIUS[tree.size] ?? 48;
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

  /**
   * 单株枯萎：只让出空地给草/绿地连片，不造泥。
   * 密林塌泥只由 tickForestCollapse 触发，避免满图碎泥斑。
   */
  onTreeWithered(tree: HarvestableTree): void {
    this.removeTreeEntity(tree);
    this.spawnPickup(tree.worldX, tree.worldY, 'wood', 1);
    this.hooks.afterWorldChange({ redrawLand: true });
    this.markTreePersistDirty();
  }

  private addMudSpot(x: number, y: number, radius: number): void {
    this.mudField.addMudSpot(x, y, radius);
  }

  private consolidateMudSpots(): void {
    this.mudField.consolidate();
  }

  /**
   * 密树 → 泥地：清林心；泥斑尽量并入/贴向已有大泥地。
   */
  private collapseForestToMud(cx: number, cy: number): void {
    // 若附近已有大泥，塌缩中心略向其靠拢，方便连成一片
    let mudCx = cx;
    let mudCy = cy;
    let r = COLLAPSE_MUD_RADIUS;
    const nearMud = this.mudField.findNearestMud(cx, cy, MUD_ATTRACT_R);
    if (nearMud) {
      const d = Math.hypot(nearMud.x - cx, nearMud.y - cy);
      // 向大泥靠 35%～55%，半径略加大以便搭上
      const pull = 0.35 + Math.min(0.2, nearMud.radius / 800);
      mudCx = cx + (nearMud.x - cx) * pull;
      mudCy = cy + (nearMud.y - cy) * pull;
      r = Math.min(
        MUD_RADIUS_MAX * 0.75,
        COLLAPSE_MUD_RADIUS + nearMud.radius * 0.18 + Math.max(0, 40 - d * 0.1),
      );
    }

    const clearR = Math.max(r, COLLAPSE_MUD_RADIUS) * 1.12;
    const clearR2 = clearR * clearR;
    const r2 = r * r;

    const treeSnap = this.trees.slice();
    for (const t of treeSnap) {
      if (!t || t.destroyed) continue;
      const dx = t.worldX - mudCx;
      const dy = t.worldY - mudCy;
      if (dx * dx + dy * dy > clearR2) continue;
      if (t.isAlive) {
        this.spawnPickup(t.worldX, t.worldY, 'wood', 1);
      }
      this.removeTreeEntity(t);
    }

    // 泥斑内草清掉，留 1～2 株稀草火种
    const grassSnap = this.grasses.slice();
    let kept = 0;
    for (const g of grassSnap) {
      if (!g || g.destroyed || g.isWitheringOut) continue;
      const dx = g.worldX - mudCx;
      const dy = g.worldY - mudCy;
      if (dx * dx + dy * dy > r2) continue;
      if (kept < 2 && g.size === 'small') {
        g.setMaxSize('small');
        kept += 1;
        continue;
      }
      this.forceRemoveGrass(g);
    }

    this.addMudSpot(mudCx, mudCy, r);

    // 火种落在合并后的主泥斑上
    const host = this.mudField.findNearestMud(mudCx, mudCy, MUD_RADIUS_MAX) ?? {
      x: mudCx,
      y: mudCy,
      radius: r,
      fertility: 0,
    };
    while (kept < 2) {
      this.spawnSparseGrassOnMud(host.x, host.y, host.radius * 0.7);
      kept += 1;
    }

    this.hooks.afterWorldChange({ redrawLand: true });
    this.markTreePersistDirty();
    this.markGrassPersistDirty();
  }

  private forceRemoveGrass(grass: GrassEntity): void {
    const mapDef = this.hooks.getMapDef();
    if (grass.grassId && mapDef.grasses) {
      mapDef.grasses = mapDef.grasses.filter(
        (item) => grassIdOf(item) !== grass.grassId,
      );
    }
    this.removeGrassEntity(grass);
  }

  /** 泥地上种一株稀草火种 */
  private spawnSparseGrassOnMud(cx: number, cy: number, radius: number): void {
    const mapDef = this.hooks.getMapDef();
    for (let attempt = 0; attempt < 12; attempt++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = Math.random() * radius * 0.55;
      const x = cx + Math.cos(ang) * dist;
      const y = cy + Math.sin(ang) * dist;
      if (!isOnGreenLand(x, y, mapDef, 255)) continue;
      if (this.isGrassTooClose(x, y, MUD_GRASS_SPACING)) continue;
      if (!mapDef.grasses) mapDef.grasses = [];
      const id = allocGrassId('gs');
      const g: MapGrass = { x, y, size: 'small', id };
      mapDef.grasses.push(g);
      this.mountGrass(g);
      return;
    }
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
    if (idx < 0) {
      // 可能已从列表摘掉，仍尽量清 solid / 草稿
    } else {
      this.trees.splice(idx, 1);
    }
    this.treeIndex.remove(tree);
    if (tree.treeId) {
      removeRuntimeTreeObstacleById(tree.treeId);
      const mapDef = this.hooks.getMapDef();
      mapDef.trees = mapDef.trees.filter((t) => treeIdOf(t) !== tree.treeId);
    }
    if (!tree.destroyed) {
      tree.parent?.removeChild(tree);
      tree.destroy({ children: true });
    }
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

  /** 清空场景中的所有树木、草地、掉落物和泥斑 */
  clearAll(): void {
    while (this.trees.length > 0) {
      const t = this.trees.pop()!;
      if (t.treeId) {
        removeRuntimeTreeObstacleById(t.treeId);
      }
      if (!t.destroyed) {
        t.parent?.removeChild(t);
        t.destroy({ children: true });
      }
    }
    this.treeIndex.clear();

    while (this.grasses.length > 0) {
      const g = this.grasses.pop()!;
      if (!g.destroyed) {
        g.parent?.removeChild(g);
        g.destroy({ children: true });
      }
    }
    this.grassIndex.clear();

    for (const p of this.pickups) {
      if (!p.destroyed) {
        p.parent?.removeChild(p);
        p.destroy({ children: true });
      }
    }
    this.pickups.length = 0;
    this.mudField.clear();

    const mapDef = this.hooks.getMapDef();
    mapDef.trees = [];
    mapDef.grasses = [];
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
    this.tickForestCollapse(dt);
    this.tickTreeSproutFromLushGrass(dt);

    // 全岛无草：种子火种，保证循环能启动
    if (this.grasses.length === 0) {
      this.spawnInitialSeedGrass();
      this.flushGrassPersist();
      this.flushTreePersist();
      return;
    }

    // 泥地：先合并趋近大片，再改土
    if (this.mudSpots.length > 1) {
      const before = this.mudSpots.length;
      this.consolidateMudSpots();
      if (this.mudSpots.length !== before) {
        this.hooks.afterWorldChange({ redrawLand: true });
      }
    }

    // 泥地 → 稀草改土 → 草地（大斑改土更慢，整片更持久）
    let mudChanged = false;
    for (let i = this.mudSpots.length - 1; i >= 0; i--) {
      const m = this.mudSpots[i]!;
      const grassCount = this.grassIndex.countWithin(
        m.x,
        m.y,
        m.radius,
        (g) => !g.isWitheringOut,
      );
      // 半径越大，改土越慢（一大片不会瞬间变绿）
      const sizeSlow = 90 / Math.max(90, m.radius * 0.85);
      if (grassCount >= MUD_CLEAR_GRASS) {
        m.fertility +=
          dt * (MUD_FERTILITY_WITH_GRASS + grassCount * 2) * sizeSlow;
      } else if (grassCount > 0) {
        m.fertility += dt * MUD_FERTILITY_WITH_GRASS * 0.45 * sizeSlow;
      } else {
        m.fertility += dt * MUD_FERTILITY_BARE * sizeSlow;
      }
      if (m.fertility >= 100) {
        this.mudSpots.splice(i, 1);
        mudChanged = true;
      }
    }
    if (mudChanged) {
      this.hooks.afterWorldChange({ redrawLand: true });
      this.mudVisualTimer = 1.2;
    } else if (this.mudSpots.length > 0) {
      this.mudVisualTimer -= dt;
      if (this.mudVisualTimer <= 0) {
        this.mudVisualTimer = 1.2;
        this.hooks.afterWorldChange({ redrawLand: true });
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

      // 泥地 = 稀草（只 small）；离开泥地 = 草地（可长大）
      const inMud = this.isInMudSpot(g.worldX, g.worldY);
      g.setMaxSize(inMud ? 'small' : null);

      const runLogic = g.isWitheringOut || i % slices === slice;
      g.update(deltaMS, {
        view,
        lodFar,
        // 泥地稀草长得慢；草地正常
        speedup: inMud ? 0.45 : 1.0,
        runLogic,
        logicScale: runLogic && !g.isWitheringOut ? slices : 1,
      });
    }

    // 草层 Y 序：仅在新增/LOD 时低频整理一次（不进角色 sort）
    if (this.grassFarSortDirty && this.hooks.grassFarLayer?.sortableChildren) {
      this.hooks.grassFarLayer.sortChildren();
      this.grassFarSortDirty = false;
    }

    this.ecologySpawner.update(dt, this.grasses, creatures);
    this.tickNaturalPineSpawning(dt, creatures);
    this.flushGrassPersist();
    this.flushTreePersist();
  }

  /** 密树塌缩检测冷却（秒）——故意偏慢，给大片林时间成型 */
  private forestCollapseTimer = 12;
  /** 泥地地表刷新冷却（秒） */
  private mudVisualTimer = 1.2;

  /**
   * 密树 → 泥地：优先塌「靠已有泥地」的密林，便于泥斑连成一大片。
   */
  private tickForestCollapse(dt: number): void {
    this.forestCollapseTimer -= dt;
    if (this.forestCollapseTimer > 0) return;
    this.forestCollapseTimer = 8 + Math.random() * 6;

    if (this.trees.length < FOREST_TREE_COLLAPSE) return;

    const samples = Math.min(14, this.trees.length);
    let best: HarvestableTree | null = null;
    let bestScore = -1;
    for (let s = 0; s < samples; s++) {
      const t = this.trees[Math.floor(Math.random() * this.trees.length)]!;
      if (!t || t.destroyed || !t.isAlive) continue;
      const n = this.countNearbyTrees(t.worldX, t.worldY, ECO_R);
      if (n < FOREST_TREE_COLLAPSE) continue;
      // 密度分 + 靠近已有泥地加分（趋近并片）
      let score = n * 3;
      const mud = this.mudField.findNearestMud(
        t.worldX,
        t.worldY,
        MUD_ATTRACT_R,
      );
      if (mud) {
        const d = Math.hypot(mud.x - t.worldX, mud.y - t.worldY);
        score += 12 + mud.radius * 0.08 - d * 0.04;
      }
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }
    if (best) {
      this.collapseForestToMud(best.worldX, best.worldY);
      this.forestCollapseTimer = 18 + Math.random() * 12;
    }
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
      // 同伴数：抱团略加速生长；过密由 tickForestCollapse 整片塌成泥地
      const neighbors = this.treeIndex.countWithin(
        tree.worldX,
        tree.worldY,
        TREE_CLUSTER_RADIUS,
        (t) => t.isAlive,
        tree,
      );

      tree.clusterSpeedup =
        neighbors >= 1 && neighbors < FOREST_TREE_COLLAPSE
          ? TREE_CLUSTER_SPEEDUP
          : 1;

      // 孤树快死、成团稳健 —— 散点会被自然清掉，主林留下来
      let deathRateMultiplier = 0.5;
      if (neighbors === 0) {
        deathRateMultiplier = 2.2;
      } else if (neighbors === 1) {
        deathRateMultiplier = 1.1;
      } else if (neighbors <= 8) {
        deathRateMultiplier = 0.28;
      } else if (neighbors >= FOREST_TREE_COLLAPSE - 2) {
        deathRateMultiplier = 0.65;
      }

      // 抱团生长/播种加速更强
      let growBoost =
        neighbors >= 2 ? TREE_CLUSTER_SPEEDUP * 1.15 : tree.clusterSpeedup;

      // 泥地：树加速死亡 + 几乎不长不播 → 林被迫往外缘迁，生态轮动起来
      const onMud = this.isInMudSpot(tree.worldX, tree.worldY);
      if (onMud) {
        deathRateMultiplier *= MUD_TREE_DEATH_MULT;
        growBoost *= MUD_TREE_GROW_MULT;
      }

      tree.update(deltaMS, {
        view,
        speedup: growBoost,
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

    // 有树：只扩主林；无树：才允许开一个松树种核
    const anchor = this.pickMainForestAnchor();
    if (anchor) {
      if (this.tryPlantOnForestEdge(anchor, mapDef, 'pine')) {
        this.hooks.afterWorldChange({ redrawLand: true });
        this.markTreePersistDirty();
      }
      return;
    }

    for (let attempt = 0; attempt < 16; attempt++) {
      let x: number;
      let y: number;
      if (this.grasses.length > 0) {
        const g =
          this.grasses[Math.floor(Math.random() * this.grasses.length)]!;
        const ang = Math.random() * Math.PI * 2;
        const dist = 16 + Math.random() * 32;
        x = g.worldX + Math.cos(ang) * dist;
        y = g.worldY + Math.sin(ang) * dist;
      } else {
        x = land.x + 40 + Math.random() * Math.max(1, land.w - 80);
        y = land.y + 40 + Math.random() * Math.max(1, land.h - 80);
      }
      if (!this.canPlantTreeAt(x, y, mapDef)) continue;
      this.plantSapling(x, y, 'pine', mapDef);
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
   * 全岛无草时：种一小簇种子草（3～5 株），方便立刻连成片而不是单点散落。
   */
  private spawnInitialSeedGrass(): void {
    const mapDef = this.hooks.getMapDef();
    const land = landRectOf(mapDef);
    if (land.w <= 0 || land.h <= 0) return;

    for (let attempt = 0; attempt < 24; attempt++) {
      const cx = land.x + 40 + Math.random() * Math.max(1, land.w - 80);
      const cy = land.y + 40 + Math.random() * Math.max(1, land.h - 80);
      if (!isOnGreenLand(cx, cy, mapDef, 255)) continue;
      if (this.isInMudSpot(cx, cy)) continue;
      if (this.isGrassTooCloseToTrees(cx, cy)) continue;

      if (!mapDef.grasses) mapDef.grasses = [];
      const cluster = 3 + Math.floor(Math.random() * 3);
      let planted = 0;
      for (let i = 0; i < cluster * 3 && planted < cluster; i++) {
        const ang = Math.random() * Math.PI * 2;
        const dist = i === 0 ? 0 : 28 + Math.random() * 48;
        const x = cx + Math.cos(ang) * dist;
        const y = cy + Math.sin(ang) * dist;
        if (!isOnGreenLand(x, y, mapDef, 255)) continue;
        if (this.isGrassTooCloseToTrees(x, y)) continue;
        if (this.isGrassTooClose(x, y, GRASS_MIN_SPACING)) continue;
        const id = allocGrassId('gs');
        const g: MapGrass = { x, y, size: 'small', id };
        mapDef.grasses.push(g);
        this.mountGrass(g);
        planted += 1;
      }
      if (planted > 0) {
        this.hooks.persistMapDraft();
        this.hooks.afterWorldChange();
        return;
      }
    }
  }

  /** 统计指定坐标指定半径内的活草数量 */
  countNearbyGrasses(x: number, y: number, radius: number): number {
    return this.grassIndex.countWithin(x, y, radius, (g) => !g.isWitheringOut);
  }

  private treeSproutTimer = 10;

  /**
   * 草地 → 树（强制抱团，禁止满图散点）：
   * - 有活树：只在主林林缘长苗（可连种 2 棵）
   * - 无树：茂密草地只开 1 个种核，之后全部贴林长
   */
  private tickTreeSproutFromLushGrass(dt: number): void {
    if (this.trees.length >= TREE_MAX_COUNT) return;
    this.treeSproutTimer -= dt;
    if (this.treeSproutTimer > 0) return;

    this.treeSproutTimer = 7 + Math.random() * 5;
    if (this.grasses.length === 0) return;

    const mapDef = this.hooks.getMapDef();
    const anchor = this.pickMainForestAnchor();
    let planted = 0;

    if (anchor) {
      // 主林扩张：一次最多 2 株，全贴主林缘
      const maxPlant = 2;
      for (let i = 0; i < maxPlant; i++) {
        if (this.trees.length >= TREE_MAX_COUNT) break;
        if (this.tryPlantOnForestEdge(anchor, mapDef)) planted += 1;
      }
    } else {
      // 唯一种核：全岛 0 树时才允许
      const candidates = this.grasses.filter((g) => !g.isWitheringOut);
      if (candidates.length === 0) return;

      for (let i = 0; i < 24; i++) {
        const g =
          candidates[Math.floor(Math.random() * candidates.length)]!;
        if (this.isInMudSpot(g.worldX, g.worldY)) continue;
        const nearbyGrass = this.countNearbyGrasses(
          g.worldX,
          g.worldY,
          ECO_R,
        );
        const isMeadow =
          nearbyGrass >= MEADOW_GRASS_FOR_TREE ||
          (g.size === 'large' && nearbyGrass >= 5);
        if (!isMeadow) continue;

        const ang = Math.random() * Math.PI * 2;
        const dist = 10 + Math.random() * 22;
        const x = g.worldX + Math.cos(ang) * dist;
        const y = g.worldY + Math.sin(ang) * dist;
        if (!this.canPlantTreeAt(x, y, mapDef)) continue;

        const kind = Math.random() < 0.5 ? 'pine' : 'apple';
        this.plantSapling(x, y, kind, mapDef);
        planted = 1;
        break;
      }
    }

    if (planted > 0) {
      this.markTreePersistDirty();
      this.hooks.afterWorldChange({ redrawLand: true });
    }
  }
}
