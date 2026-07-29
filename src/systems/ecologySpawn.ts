import type { EnemyKind } from '../data/maps';
import { NATURAL_SPAWN } from '../data/ecologyLabels';
import {
  isFarmHerbivoreKind,
  type CreatureKind,
} from '../entities/creatureKinds';

export { NATURAL_SPAWN } from '../data/ecologyLabels';
export {
  FARM_HERBIVORE_KINDS,
  isFarmHerbivoreKind,
  type FarmHerbivoreKind,
} from '../entities/creatureKinds';

/** 用于种群统计的生物引用（需要 kind） */
export type CreatureKindRef = {
  isAlive: boolean;
  destroyed: boolean;
  kind: CreatureKind | string;
};

export function countAliveWithKind(
  creatures: ReadonlyArray<CreatureKindRef>,
  kind: CreatureKind | string,
): number {
  let n = 0;
  for (const s of creatures) {
    if (s.isAlive && !s.destroyed && s.kind === kind) n += 1;
  }
  return n;
}

export function countAliveFarmHerbivores(
  creatures: ReadonlyArray<CreatureKindRef>,
): number {
  let n = 0;
  for (const s of creatures) {
    if (s.isAlive && !s.destroyed && isFarmHerbivoreKind(s.kind)) n += 1;
  }
  return n;
}

/**
 * 自然孕育是否允许再刷一只（狼 / 牛马等）。
 * 场景与 HarvestWorld 共用，避免上限写死在 LevelScene。
 */
export function canSpawnNaturalAnimal(
  kind: EnemyKind,
  creatures: ReadonlyArray<CreatureKindRef>,
): boolean {
  if (kind === 'wolf') {
    return countAliveWithKind(creatures, 'wolf') < NATURAL_SPAWN.maxWolves;
  }
  if (isFarmHerbivoreKind(kind)) {
    return (
      countAliveFarmHerbivores(creatures) < NATURAL_SPAWN.maxFarmHerbivores
    );
  }
  return true;
}

/** @deprecated 使用 countAliveWithKind */
export const countAliveWithLabel = (
  creatures: ReadonlyArray<CreatureKindRef & { label?: string | null }>,
  label: string,
): number => {
  const kindMap: Record<string, string> = {
    Wolf: 'wolf',
    Chicken: 'chicken',
    Pig: 'pig',
    Cow: 'cow',
    Horse: 'horse',
  };
  const kind = kindMap[label] ?? label.toLowerCase();
  return countAliveWithKind(creatures, kind);
};

/** @deprecated 使用 isFarmHerbivoreKind */
export function isFarmHerbivoreLabel(
  label: string | null | undefined,
): boolean {
  if (!label) return false;
  return ['Chicken', 'Pig', 'Cow', 'Horse'].includes(label);
}
