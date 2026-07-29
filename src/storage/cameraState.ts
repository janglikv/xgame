/** localStorage 键；改字段结构时递增版本 */
const STORAGE_KEY = 'xgame.camera.v1';

export interface CameraStateSnapshot {
  x: number;
  y: number;
  z: number;
  /** 弧度 */
  yaw: number;
  /** 弧度 */
  pitch: number;
}

export function loadCameraState(): CameraStateSnapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const data = JSON.parse(raw) as Partial<CameraStateSnapshot>;
    if (
      !isFiniteNumber(data.x) ||
      !isFiniteNumber(data.y) ||
      !isFiniteNumber(data.z) ||
      !isFiniteNumber(data.yaw) ||
      !isFiniteNumber(data.pitch)
    ) {
      return null;
    }

    return {
      x: data.x,
      y: data.y,
      z: data.z,
      yaw: data.yaw,
      pitch: data.pitch,
    };
  } catch {
    return null;
  }
}

export function saveCameraState(state: CameraStateSnapshot): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 隐私模式 / 配额满时忽略
  }
}

export function clearCameraState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
