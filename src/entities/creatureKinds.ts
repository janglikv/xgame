import type { BodyProfileId } from '../data/bodyProfiles';
import type { EnemyKind } from '../data/maps';

/**
 * 场上生物物种 id。
 * 与地图 EnemyKind 对齐，便于 factory / 存档 / 生态共用一套枚举。
 */
export type CreatureKind = EnemyKind;

/** 农场食草（自然孕育上限、狼猎物） */
export const FARM_HERBIVORE_KINDS = [
  'chicken',
  'pig',
  'cow',
  'horse',
] as const satisfies readonly CreatureKind[];

export type FarmHerbivoreKind = (typeof FARM_HERBIVORE_KINDS)[number];

/** 狼可猎杀的猎物 kind */
export const WOLF_PREY_KINDS: ReadonlySet<CreatureKind> = new Set(
  FARM_HERBIVORE_KINDS,
);

export function isFarmHerbivoreKind(
  kind: CreatureKind | string | null | undefined,
): kind is FarmHerbivoreKind {
  return (
    !!kind &&
    (FARM_HERBIVORE_KINDS as readonly string[]).includes(kind)
  );
}

/** 碰撞体模板：按 kind 映射，不再靠 display label 字符串 */
export function bodyProfileIdForKind(kind: CreatureKind): BodyProfileId {
  switch (kind) {
    case 'wooden-dummy':
      return 'wooden-dummy';
    case 'flame-flower':
      return 'flame-flower';
    default:
      return 'spider';
  }
}
