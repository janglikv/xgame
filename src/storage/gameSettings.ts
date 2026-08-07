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
   * true = 锁定视角（镜头跟随英雄 + 右键点地 / WASD 移动）；
   * false = 自由视角（WASD 移镜头 / 拖拽）。
   */
  cameraLocked: boolean;
  /** 固定相机（开启后定位于 Pitch -66°, Yaw -34°, Offset (-0.4, 3.7, 1.5)） */
  fixedCamera: boolean;
  /** 英雄无敌 */
  godMode: boolean;
  /** 自动出兵 */
  minionSpawn: boolean;
  /** 防御塔无敌 */
  towerInvincible: boolean;
  /** 控制按键（'right' = 鼠标右键控制，'left' = 鼠标左键控制） */
  mouseControl: 'right' | 'left';
  /** 闪现技能开关（F 键） */
  flashSkillEnabled: boolean;
  /** 音效音量 0~1 */
  sfxVolume: number;
  /** 背景音乐音量 0~1 */
  bgmVolume: number;
}

export const DEFAULT_GAME_SETTINGS: GameSettingsSnapshot = {
  showAxes: true,
  showColliderMarkers: true,
  brightnessUi: 1,
  cameraLocked: false,
  fixedCamera: false,
  godMode: false,
  minionSpawn: true,
  towerInvincible: false,
  mouseControl: 'right',
  flashSkillEnabled: true,
  sfxVolume: 0.72,
  bgmVolume: 0.65,
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
      fixedCamera:
        typeof data.fixedCamera === 'boolean'
          ? data.fixedCamera
          : DEFAULT_GAME_SETTINGS.fixedCamera,
      godMode:
        typeof data.godMode === 'boolean'
          ? data.godMode
          : DEFAULT_GAME_SETTINGS.godMode,
      minionSpawn:
        typeof data.minionSpawn === 'boolean'
          ? data.minionSpawn
          : DEFAULT_GAME_SETTINGS.minionSpawn,
      towerInvincible:
        typeof data.towerInvincible === 'boolean'
          ? data.towerInvincible
          : DEFAULT_GAME_SETTINGS.towerInvincible,
      mouseControl:
        data.mouseControl === 'left' ? 'left' : DEFAULT_GAME_SETTINGS.mouseControl,
      flashSkillEnabled:
        typeof data.flashSkillEnabled === 'boolean'
          ? data.flashSkillEnabled
          : DEFAULT_GAME_SETTINGS.flashSkillEnabled,
      sfxVolume: clamp01(
        typeof data.sfxVolume === 'number' && Number.isFinite(data.sfxVolume)
          ? data.sfxVolume
          : DEFAULT_GAME_SETTINGS.sfxVolume,
      ),
      bgmVolume: clamp01(
        typeof data.bgmVolume === 'number' && Number.isFinite(data.bgmVolume)
          ? data.bgmVolume
          : DEFAULT_GAME_SETTINGS.bgmVolume,
      ),
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
      fixedCamera: !!state.fixedCamera,
      godMode: !!state.godMode,
      minionSpawn: !!state.minionSpawn,
      towerInvincible: !!state.towerInvincible,
      mouseControl: state.mouseControl === 'left' ? 'left' : 'right',
      flashSkillEnabled: typeof state.flashSkillEnabled === 'boolean' ? state.flashSkillEnabled : true,
      sfxVolume: clamp01(state.sfxVolume),
      bgmVolume: clamp01(state.bgmVolume),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // 隐私模式 / 配额满时忽略
  }
}

/** 清除设置缓存（localStorage） */
export function clearGameSettings(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_GAME_SETTINGS.brightnessUi;
  return Math.min(1, Math.max(0, value));
}
