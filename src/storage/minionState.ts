/** localStorage 键；改字段结构时递增版本 */
const STORAGE_KEY = 'luolu.minion.v1';

/** 小兵地面位置（XZ；Y 恒为贴地 0） */
export interface MinionStateSnapshot {
  x: number;
  z: number;
}

export function loadMinionState(): MinionStateSnapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const data = JSON.parse(raw) as Partial<MinionStateSnapshot>;
    if (!isFiniteNumber(data.x) || !isFiniteNumber(data.z)) {
      return null;
    }

    return { x: data.x, z: data.z };
  } catch {
    return null;
  }
}

export function saveMinionState(state: MinionStateSnapshot): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 隐私模式 / 配额满时忽略
  }
}

export function clearMinionState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
