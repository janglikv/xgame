import type { WorldCreature } from '../entities/WorldCreature';
import type { GrassEntity } from '../entities/GrassEntity';
import type { EnemyKind, LevelMapDef } from '../data/maps';
import { isOnGreenLand, landRectOf } from '../data/maps';
import {
  NATURAL_SPAWN,
  countAliveFarmHerbivores,
  countAliveWithKind,
  isFarmHerbivoreKind,
} from './ecologySpawn';

/** 种松所需的树摘要（避免依赖 HarvestableTree） */
export type EcologyTreeRef = {
  worldX: number;
  worldY: number;
  isAlive: boolean;
  treeKind: string;
};

export type EcologySpawnerHooks = {
  getMapDef: () => LevelMapDef;
  onSpawnNaturalAnimal?: (kind: EnemyKind, x: number, y: number) => void;
  isGrassTooCloseToTrees: (x: number, y: number) => boolean;
  /** 是否已有活树主林（有则只扩林缘，不开新核） */
  hasMainForest: () => boolean;
  /**
   * 在主林林缘种一棵松。
   * 种树副作用（solid / persist / redraw）由 HarvestWorld 实现。
   */
  tryPlantPineOnMainForestEdge: () => boolean;
  /** 在可种点落下松树种核；失败返回 false */
  tryPlantPineAt: (x: number, y: number) => boolean;
  /** 落点是否允许种树（绿地、间距等） */
  canPlantTreeAt: (x: number, y: number) => boolean;
};

/**
 * 确定性伪随机数生成器 (Mulberry32 PRNG)
 * 代码内严格禁止使用 non-deterministic 的 Math.random()。
 */
class SeededRandom {
  private seed: number;

  constructor(initialSeed = 0x61c88647) {
    this.seed = initialSeed >>> 0;
  }

  /** 返回 [0, 1) 的确定性伪随机数 */
  next01(): number {
    this.seed = (this.seed + 0x6d2b79f5) >>> 0;
    let t = Math.imul(this.seed ^ (this.seed >>> 15), 1 | this.seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** 返回 [min, max) 之间的确定性伪随机数 */
  range(min: number, max: number): number {
    return min + this.next01() * (max - min);
  }

  /** 从只读数组中确定性挑选一个元素 */
  pick<T>(arr: ReadonlyArray<T>): T | undefined {
    if (arr.length === 0) return undefined;
    const idx = Math.floor(this.next01() * arr.length);
    return arr[idx];
  }
}

/**
 * 生态自然孵化：草丰孕育牛/马、食草引狼、有狼后自然长松。
 * 全程使用伪随机 PRNG，禁止 Math.random()。
 */
export class EcologySpawnerSystem {
  private naturalAnimalTimer = 20;
  private naturalWolfTimer = 35;
  private naturalPineTimer = 18;
  private totalHorsesSpawned = 0;
  private readonly rng = new SeededRandom(0x9e3779b9);

  constructor(private readonly hooks: EcologySpawnerHooks) {}

  public update(
    dt: number,
    grasses: ReadonlyArray<GrassEntity>,
    creatures?: ReadonlyArray<WorldCreature>,
    trees?: ReadonlyArray<EcologyTreeRef>,
  ): void {
    this.tickNaturalAnimalSpawning(dt, grasses, creatures);
    this.tickNaturalWolfSpawning(dt, creatures);
    this.tickNaturalPineSpawning(dt, creatures, trees, grasses);
  }

  /**
   * 草繁时自然孕育牛/马（伪随机，马多了才生成牛）：
   * 记录累计诞生的马匹数，避免狼捕食马导致“马存活数永远达不到阈值”而卡死牛的生成。
   */
  private tickNaturalAnimalSpawning(
    dt: number,
    grasses: ReadonlyArray<GrassEntity>,
    creatures?: ReadonlyArray<WorldCreature>,
  ): void {
    if (!this.hooks.onSpawnNaturalAnimal) return;

    const grassCount = grasses.length;
    if (grassCount < NATURAL_SPAWN.grassForHerbivores) {
      this.naturalAnimalTimer = 20;
      return;
    }

    this.naturalAnimalTimer -= dt;
    if (this.naturalAnimalTimer <= 0) {
      this.naturalAnimalTimer = this.rng.range(20, 30);

      const candidates = grasses.filter((g) => g.size !== 'small');
      const seedGrass =
        candidates.length > 0
          ? this.rng.pick(candidates)!
          : this.rng.pick(grasses)!;

      if (!seedGrass) return;

      const angle = this.rng.range(0, Math.PI * 2);
      const dist = this.rng.range(35, 85);
      const spawnX = seedGrass.worldX + Math.cos(angle) * dist;
      const spawnY = seedGrass.worldY + Math.sin(angle) * dist;

      const mapDef = this.hooks.getMapDef();
      if (!isOnGreenLand(spawnX, spawnY, mapDef, 255)) return;
      if (this.hooks.isGrassTooCloseToTrees(spawnX, spawnY)) return;

      // 马多了才生成牛：当累计诞生马匹 >= 2（或当前存活马 >= 2）且牛数量 <= 马数量时允许生成牛
      const horseCount = creatures
        ? countAliveWithKind(creatures, 'horse')
        : 0;
      const cowCount = creatures
        ? countAliveWithKind(creatures, 'cow')
        : 0;

      const hasHorseFoundation =
        this.totalHorsesSpawned >= 2 || horseCount >= 2;
      const chosenKind: EnemyKind =
        hasHorseFoundation && cowCount <= horseCount
          ? 'cow'
          : 'horse';

      if (chosenKind === 'horse') {
        this.totalHorsesSpawned += 1;
      }

      this.hooks.onSpawnNaturalAnimal(chosenKind, spawnX, spawnY);
    }
  }

  /** 食草动物积累后自然引狼 */
  private tickNaturalWolfSpawning(
    dt: number,
    creatures?: ReadonlyArray<WorldCreature>,
  ): void {
    if (!this.hooks.onSpawnNaturalAnimal || !creatures) return;

    if (countAliveFarmHerbivores(creatures) < NATURAL_SPAWN.herbivoresForWolf) {
      this.naturalWolfTimer = 30;
      return;
    }

    this.naturalWolfTimer -= dt;
    if (this.naturalWolfTimer <= 0) {
      this.naturalWolfTimer = this.rng.range(35, 50);

      const herbivores = creatures.filter(
        (s) => s.isAlive && !s.destroyed && isFarmHerbivoreKind(s.kind),
      );
      if (herbivores.length === 0) return;

      const target = this.rng.pick(herbivores)!;
      const angle = this.rng.range(0, Math.PI * 2);
      const dist = this.rng.range(110, 170);
      const spawnX = target.worldX + Math.cos(angle) * dist;
      const spawnY = target.worldY + Math.sin(angle) * dist;

      const mapDef = this.hooks.getMapDef();
      if (!isOnGreenLand(spawnX, spawnY, mapDef, 255)) return;

      this.hooks.onSpawnNaturalAnimal('wolf', spawnX, spawnY);
    }
  }

  /**
   * 有狼之后：自然生成松树（狼吃完爱在松树边休息）。
   * 狼越多略加快长树；优先向现有树木/树林抱团。
   */
  private tickNaturalPineSpawning(
    dt: number,
    creatures?: ReadonlyArray<WorldCreature>,
    trees?: ReadonlyArray<EcologyTreeRef>,
    grasses?: ReadonlyArray<GrassEntity>,
  ): void {
    const wolfCount = creatures
      ? countAliveWithKind(creatures, 'wolf')
      : 0;
    if (wolfCount <= 0) {
      this.naturalPineTimer = 18;
      return;
    }

    const treeList = trees ?? [];
    const pineCount = treeList.filter(
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
    this.naturalPineTimer =
      Math.max(12, 28 - wolfCount * 3) + this.rng.range(0, 10);

    const mapDef = this.hooks.getMapDef();
    const land = landRectOf(mapDef);
    if (land.w <= 0 || land.h <= 0) return;

    // 有树：只扩主林（失败也本轮结束，不开新核）；无树：才允许开松树种核
    if (this.hooks.hasMainForest()) {
      this.hooks.tryPlantPineOnMainForestEdge();
      return;
    }

    const grassList = grasses ?? [];
    for (let attempt = 0; attempt < 16; attempt++) {
      let x: number;
      let y: number;
      if (grassList.length > 0) {
        const g = this.rng.pick(grassList)!;
        const ang = this.rng.range(0, Math.PI * 2);
        const dist = this.rng.range(16, 48);
        x = g.worldX + Math.cos(ang) * dist;
        y = g.worldY + Math.sin(ang) * dist;
      } else {
        x = land.x + 40 + this.rng.range(0, Math.max(1, land.w - 80));
        y = land.y + 40 + this.rng.range(0, Math.max(1, land.h - 80));
      }
      if (!this.hooks.canPlantTreeAt(x, y)) continue;
      if (this.hooks.tryPlantPineAt(x, y)) return;
    }
  }
}
