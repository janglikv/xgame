import type { MinionAppearance } from '../world/Minion';

/** localStorage 键；保存角色（主控制小兵）的换装造型快照 */
const STORAGE_KEY = 'luolu.minionAppearance.v1';

export function loadMinionAppearanceState(): Partial<MinionAppearance> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Partial<MinionAppearance>;
  } catch {
    return null;
  }
}

export function saveMinionAppearanceState(appearance: MinionAppearance): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appearance));
  } catch {
    // 隐私模式 / 配额满时忽略
  }
}

export function clearMinionAppearanceState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
