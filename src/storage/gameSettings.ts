/** localStorage 键；改字段结构时递增版本 */
const STORAGE_KEY = 'xgame.settings.v1';

export interface GameSettingsSnapshot {
  /** 坐标参考线 */
  showAxes: boolean;
  /** 碰撞体积白圈 */
  showColliderMarkers: boolean;
  /**
   * 全局亮度滑条 0~1（1=最亮）。
   * 实际压暗强度由 ScreenBrightness.MIN/MAX 映射。
   */
  brightnessUi: number;
  /**
   * true = 锁定视角（镜头跟随英雄 + 右键点地移动）；
   * false = 自由视角（WASD / 拖拽）。
   */
  cameraLocked: boolean;
}

export const DEFAULT_GAME_SETTINGS: GameSettingsSnapshot = {
  showAxes: true,
  showColliderMarkers: true,
  brightnessUi: 1,
  cameraLocked: false,
};

export function loadGameSettings(): GameSettingsSnapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_GAME_SETTINGS };

    const data = JSON.parse(raw) as Partial<GameSettingsSnapshot>;
    return {
      showAxes:
        typeof data.showAxes === 'boolean'
          ? data.showAxes
          : DEFAULT_GAME_SETTINGS.showAxes,
      showColliderMarkers:
        typeof data.showColliderMarkers === 'boolean'
          ? data.showColliderMarkers
          : DEFAULT_GAME_SETTINGS.showColliderMarkers,
      brightnessUi: clamp01(
        typeof data.brightnessUi === 'number' &&
          Number.isFinite(data.brightnessUi)
          ? data.brightnessUi
          : DEFAULT_GAME_SETTINGS.brightnessUi,
      ),
      cameraLocked:
        typeof data.cameraLocked === 'boolean'
          ? data.cameraLocked
          : DEFAULT_GAME_SETTINGS.cameraLocked,
    };
  } catch {
    return { ...DEFAULT_GAME_SETTINGS };
  }
}

export function saveGameSettings(state: GameSettingsSnapshot): void {
  try {
    const snapshot: GameSettingsSnapshot = {
      showAxes: !!state.showAxes,
      showColliderMarkers: !!state.showColliderMarkers,
      brightnessUi: clamp01(state.brightnessUi),
      cameraLocked: !!state.cameraLocked,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // 隐私模式 / 配额满时忽略
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_GAME_SETTINGS.brightnessUi;
  return Math.min(1, Math.max(0, value));
}
