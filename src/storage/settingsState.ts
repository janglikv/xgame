/** localStorage 键；改字段结构时递增版本 */
const STORAGE_KEY = 'luolu.settings.v2';

/** 镜头模式：自由轨道 / 固定机位 */
export type CameraMode = 'free' | 'fixed';

export interface SettingsStateSnapshot {
  /** 是否显示左上角 FPS */
  showFps: boolean;
  /** 镜头模式（默认固定） */
  cameraMode: CameraMode;
}

/**
 * 固定镜头：只锁方位角 / 仰角 / 距离；注视点始终跟角色中心。
 * α≈392.4° / β≈24.0° / r=6.67
 */
export const FIXED_CAMERA = {
  alpha: 6.849,
  beta: 0.419,
  radius: 6.67,
} as const;

const DEFAULTS: SettingsStateSnapshot = {
  showFps: true,
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
