import type { EnemyKind } from '../data/maps';
import {
  FARM_HERBIVORE_LABELS,
  NATURAL_SPAWN,
  type FarmHerbivoreLabel,
} from '../data/ecologyLabels';

export {
  FARM_HERBIVORE_LABELS,
  NATURAL_SPAWN,
  type FarmHerbivoreLabel,
} from '../data/ecologyLabels';

export type CreatureLabelRef = {
  isAlive: boolean;
  destroyed: boolean;
  label?: string | null;
};

export function isFarmHerbivoreLabel(
  label: string | null | undefined,
): label is FarmHerbivoreLabel {
  return (
    !!label &&
    (FARM_HERBIVORE_LABELS as readonly string[]).includes(label)
  );
}

export function countAliveWithLabel(
  creatures: ReadonlyArray<CreatureLabelRef>,
  label: string,
): number {
  let n = 0;
  for (const s of creatures) {
    if (s.isAlive && !s.destroyed && s.label === label) n += 1;
  }
  return n;
}

export function countAliveFarmHerbivores(
  creatures: ReadonlyArray<CreatureLabelRef>,
): number {
  let n = 0;
  for (const s of creatures) {
    if (s.isAlive && !s.destroyed && isFarmHerbivoreLabel(s.label)) n += 1;
  }
  return n;
}

/**
 * 自然孕育是否允许再刷一只（狼 / 牛马等）。
 * 场景与 HarvestWorld 共用，避免上限写死在 LevelScene。
 */
export function canSpawnNaturalAnimal(
  kind: EnemyKind,
  creatures: ReadonlyArray<CreatureLabelRef>,
): boolean {
  if (kind === 'wolf') {
    return countAliveWithLabel(creatures, 'Wolf') < NATURAL_SPAWN.maxWolves;
  }
  if (
    kind === 'chicken' ||
    kind === 'pig' ||
    kind === 'cow' ||
    kind === 'horse'
  ) {
    return (
      countAliveFarmHerbivores(creatures) < NATURAL_SPAWN.maxFarmHerbivores
    );
  }
  return true;
}
