import type { Spider } from '../entities/Spider';
import type { GrassEntity } from '../entities/GrassEntity';
import type { EnemyKind, LevelMapDef } from '../data/maps';
import { isOnGreenLand, landRectOf } from '../data/maps';
import {
  NATURAL_SPAWN,
  countAliveFarmHerbivores,
  countAliveWithLabel,
  isFarmHerbivoreLabel,
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
 * 生态自然孵化：草丰孕育牛/马、食草引狼、有狼后自然长松。
 * 定时与种群阈值在此；实际种树/刷怪经 hooks 回到世界。
 */
export class EcologySpawnerSystem {
  private naturalAnimalTimer = 20;
  private naturalWolfTimer = 35;
  private naturalPineTimer = 18;

  constructor(private readonly hooks: EcologySpawnerHooks) {}

  public update(
    dt: number,
    grasses: ReadonlyArray<GrassEntity>,
    creatures?: ReadonlyArray<Spider>,
    trees?: ReadonlyArray<EcologyTreeRef>,
  ): void {
    this.tickNaturalAnimalSpawning(dt, grasses);
    this.tickNaturalWolfSpawning(dt, creatures);
    this.tickNaturalPineSpawning(dt, creatures, trees, grasses);
  }

  /** 草繁时自然孕育牛/马 */
  private tickNaturalAnimalSpawning(
    dt: number,
    grasses: ReadonlyArray<GrassEntity>,
  ): void {
    if (!this.hooks.onSpawnNaturalAnimal) return;

    const grassCount = grasses.length;
    if (grassCount < NATURAL_SPAWN.grassForHerbivores) {
      this.naturalAnimalTimer = 20;
      return;
    }

    this.naturalAnimalTimer -= dt;
    if (this.naturalAnimalTimer <= 0) {
      this.naturalAnimalTimer = 20 + Math.random() * 10;

      const candidates = grasses.filter((g) => g.size !== 'small');
      const seedGrass =
        candidates.length > 0
          ? candidates[Math.floor(Math.random() * candidates.length)]!
          : grasses[Math.floor(Math.random() * grasses.length)]!;

      if (!seedGrass) return;

      const angle = Math.random() * Math.PI * 2;
      const dist = 35 + Math.random() * 50;
      const spawnX = seedGrass.worldX + Math.cos(angle) * dist;
      const spawnY = seedGrass.worldY + Math.sin(angle) * dist;

      const mapDef = this.hooks.getMapDef();
      if (!isOnGreenLand(spawnX, spawnY, mapDef, 255)) return;
      if (this.hooks.isGrassTooCloseToTrees(spawnX, spawnY)) return;

      const kinds: EnemyKind[] = ['cow', 'horse'];
      const chosenKind = kinds[Math.floor(Math.random() * kinds.length)]!;

      this.hooks.onSpawnNaturalAnimal(chosenKind, spawnX, spawnY);
    }
  }

  /** 食草动物积累后自然引狼 */
  private tickNaturalWolfSpawning(
    dt: number,
    creatures?: ReadonlyArray<Spider>,
  ): void {
    if (!this.hooks.onSpawnNaturalAnimal || !creatures) return;

    if (countAliveFarmHerbivores(creatures) < NATURAL_SPAWN.herbivoresForWolf) {
      this.naturalWolfTimer = 30;
      return;
    }

    this.naturalWolfTimer -= dt;
    if (this.naturalWolfTimer <= 0) {
      this.naturalWolfTimer = 35 + Math.random() * 15;

      const herbivores = creatures.filter(
        (s) => s.isAlive && !s.destroyed && isFarmHerbivoreLabel(s.label),
      );
      if (herbivores.length === 0) return;

      const target =
        herbivores[Math.floor(Math.random() * herbivores.length)]!;
      const angle = Math.random() * Math.PI * 2;
      const dist = 110 + Math.random() * 60;
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
    creatures?: ReadonlyArray<Spider>,
    trees?: ReadonlyArray<EcologyTreeRef>,
    grasses?: ReadonlyArray<GrassEntity>,
  ): void {
    const wolfCount = creatures
      ? countAliveWithLabel(creatures, 'Wolf')
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
      Math.max(12, 28 - wolfCount * 3) + Math.random() * 10;

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
        const g =
          grassList[Math.floor(Math.random() * grassList.length)]!;
        const ang = Math.random() * Math.PI * 2;
        const dist = 16 + Math.random() * 32;
        x = g.worldX + Math.cos(ang) * dist;
        y = g.worldY + Math.sin(ang) * dist;
      } else {
        x = land.x + 40 + Math.random() * Math.max(1, land.w - 80);
        y = land.y + 40 + Math.random() * Math.max(1, land.h - 80);
      }
      if (!this.hooks.canPlantTreeAt(x, y)) continue;
      if (this.hooks.tryPlantPineAt(x, y)) return;
    }
  }
}
