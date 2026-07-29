import type { Spider } from '../entities/Spider';
import type { GrassEntity } from '../entities/GrassEntity';
import type { EnemyKind, LevelMapDef } from '../data/maps';
import { isOnGreenLand } from '../data/maps';
import {
  NATURAL_SPAWN,
  countAliveFarmHerbivores,
  isFarmHerbivoreLabel,
} from './ecologySpawn';

export type EcologySpawnerHooks = {
  getMapDef: () => LevelMapDef;
  onSpawnNaturalAnimal?: (kind: EnemyKind, x: number, y: number) => void;
  isGrassTooCloseToTrees: (x: number, y: number) => boolean;
};

/**
 * 生态动物孵化系统：负责草丰孕育牛/马与食草动物群引狼逻辑
 */
export class EcologySpawnerSystem {
  private naturalAnimalTimer = 20;
  private naturalWolfTimer = 35;

  constructor(private readonly hooks: EcologySpawnerHooks) {}

  public update(
    dt: number,
    grasses: ReadonlyArray<GrassEntity>,
    creatures?: ReadonlyArray<Spider>,
  ): void {
    this.tickNaturalAnimalSpawning(dt, grasses);
    this.tickNaturalWolfSpawning(dt, creatures);
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
}
