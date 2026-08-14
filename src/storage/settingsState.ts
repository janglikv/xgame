/** localStorage 键；改字段结构时递增版本 */
const STORAGE_KEY = 'luolu.settings.v3';

/** 镜头模式：自由轨道（调试）/ 略倾俯视固定 */
export type CameraMode = 'free' | 'fixed';

export interface SettingsStateSnapshot {
  /** 是否显示左上角 FPS */
  showFps: boolean;
  /** 是否显示空间坐标系与网格 */
  showGrid: boolean;
  /** 是否显示隐形盒体碰撞体（调试） */
  showColliders: boolean;
  /** 是否开启角色无敌（不扣血） */
  isInvincible: boolean;
  /** 镜头模式（默认固定略倾俯视） */
  cameraMode: CameraMode;
}

/** 自由/调试镜头默认垂直 FOV（Babylon 默认约 0.8） */
export const FREE_CAMERA_FOV = 0.8;

/**
 * 固定镜头：参照用户提供的参考图参数进行设定。
 * - alpha：方位角约 269.0° (4.695 rad)
 * - beta：俯角/仰角约 32.5° (0.568 rad)
 * - radius：距离约 12.39
 */
export const FIXED_CAMERA = {
  /** 方位角 α：269.0° (4.695 rad) */
  alpha: 4.695,
  /** 仰/俯角 β：32.5° (0.568 rad) */
  beta: 0.568,
  /** 垂直 FOV */
  fov: 0.6,
  /** 跟拍距离：12.39 */
  radius: 12.39,
} as const;

const DEFAULTS: SettingsStateSnapshot = {
  showFps: true,
  showGrid: true,
  showColliders: false,
  isInvincible: false,
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
            isInvincible: DEFAULTS.isInvincible,
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
      isInvincible: typeof data.isInvincible === 'boolean' ? data.isInvincible : DEFAULTS.isInvincible,
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
