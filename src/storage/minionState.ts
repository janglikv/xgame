/** localStorage 键；改字段结构时递增版本 */
const STORAGE_KEY = 'luolu.minion.v1';

/** 小兵地面位置（XZ；Y 恒为贴地 0） */
export interface MinionStateSnapshot {
  x: number;
  z: number;
  hubX?: number;
  hubZ?: number;
  /** 第一关坐标 */
  level1X?: number;
  level1Z?: number;
  /** 第二关坐标 */
  level2X?: number;
  level2Z?: number;
  /** 测试仓库坐标 */
  debugWarehouseX?: number;
  debugWarehouseZ?: number;
  /** @deprecated 旧字段，读档时映射到 level1X/Z */
  blankX?: number;
  blankZ?: number;
}

export function loadMinionState(): MinionStateSnapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const data = JSON.parse(raw) as Partial<MinionStateSnapshot>;
    if (!isFiniteNumber(data.x) || !isFiniteNumber(data.z)) {
      return null;
    }

    const level1X = firstFinite(data.level1X, data.blankX, data.x);
    const level1Z = firstFinite(data.level1Z, data.blankZ, data.z);
    const level2X = isFiniteNumber(data.level2X) ? data.level2X : undefined;
    const level2Z = isFiniteNumber(data.level2Z) ? data.level2Z : undefined;
    const debugWarehouseX = isFiniteNumber(data.debugWarehouseX)
      ? data.debugWarehouseX
      : undefined;
    const debugWarehouseZ = isFiniteNumber(data.debugWarehouseZ)
      ? data.debugWarehouseZ
      : undefined;

    return {
      x: data.x,
      z: data.z,
      hubX: isFiniteNumber(data.hubX) ? data.hubX : data.x,
      hubZ: isFiniteNumber(data.hubZ) ? data.hubZ : data.z,
      level1X,
      level1Z,
      level2X,
      level2Z,
      debugWarehouseX,
      debugWarehouseZ,
      // 写回时仍带 blank 字段，兼容可能读旧 key 的中间版本
      blankX: level1X,
      blankZ: level1Z,
    };
  } catch {
    return null;
  }
}

export function saveMinionState(state: MinionStateSnapshot): void {
  try {
    const level1X = firstFinite(state.level1X, state.blankX, state.x);
    const level1Z = firstFinite(state.level1Z, state.blankZ, state.z);
    const payload: MinionStateSnapshot = {
      x: state.x,
      z: state.z,
      hubX: state.hubX,
      hubZ: state.hubZ,
      level1X,
      level1Z,
      level2X: state.level2X,
      level2Z: state.level2Z,
      debugWarehouseX: state.debugWarehouseX,
      debugWarehouseZ: state.debugWarehouseZ,
      blankX: level1X,
      blankZ: level1Z,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
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

function firstFinite(
  ...values: Array<number | undefined>
): number | undefined {
  for (const v of values) {
    if (isFiniteNumber(v)) return v;
  }
  return undefined;
}
