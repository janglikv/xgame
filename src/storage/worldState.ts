import type { WorldId } from '../world/GameWorld';

/** localStorage 键；改字段结构时递增版本 */
const STORAGE_KEY = 'luolu.world.v1';

/** @deprecated 使用 WorldId；保留兼容旧代码 */
export type WorldMode = WorldId;

function normalizeWorldId(raw: string | null): WorldId {
  // 旧存档 'blank' → level1
  if (raw === 'level1' || raw === 'blank') return 'level1';
  return 'hub';
}

export function loadWorldState(): WorldId {
  try {
    return normalizeWorldId(localStorage.getItem(STORAGE_KEY));
  } catch {
    return 'hub';
  }
}

export function saveWorldState(worldId: WorldId): void {
  try {
    localStorage.setItem(STORAGE_KEY, worldId);
  } catch {
    // 隐私模式 / 配额满时忽略
  }
}

export function clearWorldState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
