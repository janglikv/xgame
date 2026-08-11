import type { FloorSurface } from '../world/Floor';

/** localStorage 键；改字段结构时递增版本 */
const STORAGE_KEY = 'luolu.floorSurface.v1';

export function loadFloorSurfaceState(): FloorSurface {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (
      raw === 'tiles' ||
      raw === 'dirtGrass' ||
      raw === 'cyberGrid' ||
      raw === 'checker' ||
      raw === 'cobblestone' ||
      raw === 'sand' ||
      raw === 'marble' ||
      raw === 'woodPlanks' ||
      raw === 'dark'
    ) {
      return raw;
    }
    return 'tiles';
  } catch {
    return 'tiles';
  }
}

export function saveFloorSurfaceState(surface: FloorSurface): void {
  try {
    localStorage.setItem(STORAGE_KEY, surface);
  } catch {
    // 隐私模式 / 配额满时忽略
  }
}
