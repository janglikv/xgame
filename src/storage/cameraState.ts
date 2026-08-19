/** localStorage 键；改字段结构或默认注视点时递增版本 */
const STORAGE_KEY = 'luolu.camera.v3';

/**
 * ArcRotateCamera 可恢复参数：
 * - alpha / beta / radius：轨道方位、仰角、距离
 * - fixedRadius：固定视角下的平滑缩放半径
 * - target：注视点
 */
export interface CameraStateSnapshot {
  /** 水平方位角（弧度） */
  alpha: number;
  /** 垂直仰角（弧度） */
  beta: number;
  /** 到目标点的距离（自由模式） */
  radius: number;
  /** 固定视角下的缩放目标距离（半径） */
  fixedRadius?: number;
  /** 注视点 */
  targetX: number;
  targetY: number;
  targetZ: number;
}

export function loadCameraState(): CameraStateSnapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const data = JSON.parse(raw) as Partial<CameraStateSnapshot>;
    if (
      !isFiniteNumber(data.alpha) ||
      !isFiniteNumber(data.beta) ||
      !isFiniteNumber(data.radius) ||
      !isFiniteNumber(data.targetX) ||
      !isFiniteNumber(data.targetY) ||
      !isFiniteNumber(data.targetZ)
    ) {
      return null;
    }

    return {
      alpha: data.alpha,
      beta: data.beta,
      radius: data.radius,
      fixedRadius: isFiniteNumber(data.fixedRadius) ? data.fixedRadius : undefined,
      targetX: data.targetX,
      targetY: data.targetY,
      targetZ: data.targetZ,
    };
  } catch {
    return null;
  }
}

export function loadFixedRadius(): number | null {
  const state = loadCameraState();
  return state && isFiniteNumber(state.fixedRadius) ? state.fixedRadius : null;
}

export function saveFixedRadius(fixedRadius: number): void {
  try {
    const current = loadCameraState();
    if (current) {
      saveCameraState({ ...current, fixedRadius });
    } else {
      saveCameraState({
        alpha: 3.91,
        beta: 0.9553,
        radius: 30.0,
        fixedRadius,
        targetX: 0,
        targetY: 0,
        targetZ: 0,
      });
    }
  } catch {
    // 隐私模式 / 配额满时忽略
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
