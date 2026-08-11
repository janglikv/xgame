/** localStorage 键；改字段结构时递增版本 */
const STORAGE_KEY = 'luolu.world.v1';

export type WorldMode = 'hub' | 'blank';

export function loadWorldState(): WorldMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'blank' || raw === 'hub') {
      return raw;
    }
    return 'hub';
  } catch {
    return 'hub';
  }
}

export function saveWorldState(worldMode: WorldMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, worldMode);
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
