/** localStorage 键；改字段结构时递增版本 */
const STORAGE_KEY = 'luolu.settings.v2';

/** 镜头模式：自由轨道（调试）/ 略倾俯视固定 */
export type CameraMode = 'free' | 'fixed';

export interface SettingsStateSnapshot {
  /** 是否显示左上角 FPS */
  showFps: boolean;
  /** 是否显示空间坐标系与网格 */
  showGrid: boolean;
  /** 是否显示隐形盒体碰撞体（调试） */
  showColliders: boolean;
  /** 镜头模式（默认固定略倾俯视） */
  cameraMode: CameraMode;
}

/** 自由/调试镜头默认垂直 FOV（Babylon 默认约 0.8） */
export const FREE_CAMERA_FOV = 0.8;

/**
 * 固定镜头：角色始终居中；略倾俯视 + 窄 FOV 弱透视（接近 MOBA 观感）。
 * - beta：与 Y 轴夹角，0=正上方，π/2=水平。约 0.75≈43°，可读侧身。
 * - alpha：屏幕「上」对应的水平方位（WASD 相对此方向）
 * - fov：收窄压近大远小；radius 按「约保持角色屏幕大小」相对默认 0.8FOV/r12 拉远
 *   （R_new ≈ 12 * 0.8 / fov）
 * 注视点由跟随逻辑写角色中心，不在此锁定。
 */
export const FIXED_CAMERA = {
  /** 方位回正：屏幕「上」对齐世界 +Z 前方（WASD 相对此方向） */
  alpha: 0,
  /** 略倾俯视（可调：0.55 更俯 / 0.95 更侧） */
  beta: 0.75,
  /**
   * 窄垂直 FOV（约 28.6°）：长焦压缩透视。
   * 更扁可试 0.42；仍偏透视可试 0.55。
   */
  fov: 0.5,
  /** 与窄 FOV 配对的跟拍距离（角色体量接近旧 r=12 @ fov0.8） */
  radius: 19.2,
} as const;

const DEFAULTS: SettingsStateSnapshot = {
  showFps: true,
  showGrid: true,
  showColliders: false,
  cameraMode: 'fixed',
};

export function loadSettingsState(): SettingsStateSnapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    // 兼容 v1
    if (!raw) {
      const legacy = localStorage.getItem('luolu.settings.v1');
      if (legacy) {
        try {
          const old = JSON.parse(legacy) as Partial<SettingsStateSnapshot>;
          return {
            showFps:
              typeof old.showFps === 'boolean' ? old.showFps : DEFAULTS.showFps,
            showGrid: DEFAULTS.showGrid,
            showColliders: DEFAULTS.showColliders,
            cameraMode: DEFAULTS.cameraMode,
          };
        } catch {
          return { ...DEFAULTS };
        }
      }
      return { ...DEFAULTS };
    }

    const data = JSON.parse(raw) as Partial<SettingsStateSnapshot>;
    const mode = data.cameraMode;
    return {
      showFps: typeof data.showFps === 'boolean' ? data.showFps : DEFAULTS.showFps,
      showGrid: typeof data.showGrid === 'boolean' ? data.showGrid : DEFAULTS.showGrid,
      showColliders: typeof data.showColliders === 'boolean' ? data.showColliders : DEFAULTS.showColliders,
      cameraMode: mode === 'free' || mode === 'fixed' ? mode : DEFAULTS.cameraMode,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettingsState(state: SettingsStateSnapshot): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 隐私模式 / 配额满时忽略
  }
}
