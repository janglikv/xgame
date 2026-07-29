/**
 * 暂时下线的内容（编辑列表 + 场上均不出现）。
 * 恢复时从对应数组删掉 id 即可。
 */

import type { CharacterId } from '../entities/types';
import type { EnemyKind } from './maps/types';

/** 暂时不刷、不放、不进碰撞编辑的敌人 */
export const DISABLED_ENEMY_KINDS = [
  'spider', // 蜘蛛
  'chicken', // 鸡
  'bear', // 熊
] as const satisfies readonly EnemyKind[];

/** 暂时不上场、不进碰撞编辑的角色 */
export const DISABLED_CHARACTER_IDS = [
  'bomb-girl', // 炸炸
] as const satisfies readonly CharacterId[];

const disabledEnemySet = new Set<string>(DISABLED_ENEMY_KINDS);
const disabledCharacterSet = new Set<string>(DISABLED_CHARACTER_IDS);

export function isEnemyKindEnabled(
  kind: EnemyKind | string | null | undefined,
): boolean {
  return !!kind && !disabledEnemySet.has(kind);
}

export function isCharacterEnabled(
  id: CharacterId | string | null | undefined,
): boolean {
  return !!id && !disabledCharacterSet.has(id);
}

/** 当前可用敌人（保持 ENEMY_KINDS 顺序） */
export function filterEnabledEnemyKinds<T extends EnemyKind>(
  kinds: readonly T[],
): T[] {
  return kinds.filter((k) => isEnemyKindEnabled(k));
}

/** 当前可用角色（保持 CHARACTER_IDS 顺序） */
export function filterEnabledCharacterIds<T extends CharacterId>(
  ids: readonly T[],
): T[] {
  return ids.filter((id) => isCharacterEnabled(id));
}

/** 默认上场角色（第一个未下线的角色；全下线时回退 ice-ranger） */
export const DEFAULT_PLAYABLE_CHARACTER: CharacterId = 'ice-ranger';
