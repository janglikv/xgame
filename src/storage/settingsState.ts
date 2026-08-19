import { isHitSfxId, type HitSfxId } from '../audio/hitSfx';
import { isGraphicsQuality, type GraphicsQuality } from './graphicsQuality';

export type { HitSfxId };

/** localStorage 键；改字段结构时递增版本 */
const STORAGE_KEY = 'luolu.settings.v7';

export type { GraphicsQuality };

/** 子弹墙体反弹次数选项：0（关闭） | 1 | 2 | 3 */
export type BulletBounceCount = 0 | 1 | 2 | 3;

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
  /** 子弹墙体反弹次数（0: 关闭 / 1 / 2 / 3，开发者调试） */
  bulletBounceCount: BulletBounceCount;
  /** 镜头模式（默认固定略倾俯视） */
  cameraMode: CameraMode;
  /** 固定视角是否允许广角拉远缩小（开发者调试选项，默认关闭） */
  allowZoomOut: boolean;
  /** 是否播放背景音乐 */
  bgmEnabled: boolean;
  /** 画质档次 */
  graphicsQuality: GraphicsQuality;
  /** 玩家掉血音效（开发者调试） */
  hitSfxId: HitSfxId;
}

/** 自由/调试镜头默认垂直 FOV（Babylon 默认约 0.8） */
export const FREE_CAMERA_FOV = 0.8;

/**
 * 固定镜头：略倾俯视，但 beta 够大才能从侧前方看见脚
 * （过陡时身体球体把脚挡在下面）。
 */
export const FIXED_CAMERA = {
  /** 方位角 α：斜向 45° (3.91 rad / 225°) */
  alpha: 3.91,
  /** 仰/俯角 β：经典 Isometric 俯角 54.74° (0.9553 rad) */
  beta: 0.9553,
  /** 垂直 FOV：0.24 */
  fov: 0.24,
  /** 跟拍距离基准值：匹配 0.24 FOV 的显示比例 */
  radius: 30.0,
  /** 滚轮拉近放大最小半径（角色极致放大特写） */
  minRadius: 4.5,
  /** 开启开发者设置后，滚轮拉远无上限限制（超广角宏观俯瞰，画面缩到极小） */
  maxRadius: Infinity,
  /** 注视高度相对身体中心的比例 */
  focusHeightScale: 0.35,
} as const;

const DEFAULTS: SettingsStateSnapshot = {
  showFps: true,
  showGrid: true,
  showColliders: false,
  isInvincible: false,
  bulletBounceCount: 0,
  cameraMode: 'fixed',
  allowZoomOut: false,
  bgmEnabled: true,
  graphicsQuality: 'medium',
  hitSfxId: 'original',
};

export function loadSettingsState(): SettingsStateSnapshot {
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY) ??
      localStorage.getItem('luolu.settings.v6') ??
      localStorage.getItem('luolu.settings.v5') ??
      localStorage.getItem('luolu.settings.v4') ??
      localStorage.getItem('luolu.settings.v3') ??
      localStorage.getItem('luolu.settings.v1');
    if (!raw) return { ...DEFAULTS };

    const data = JSON.parse(raw) as Partial<SettingsStateSnapshot>;
    const mode = data.cameraMode;
    const bounceCount = data.bulletBounceCount;
    return {
      showFps: typeof data.showFps === 'boolean' ? data.showFps : DEFAULTS.showFps,
      showGrid: typeof data.showGrid === 'boolean' ? data.showGrid : DEFAULTS.showGrid,
      showColliders: typeof data.showColliders === 'boolean' ? data.showColliders : DEFAULTS.showColliders,
      isInvincible: typeof data.isInvincible === 'boolean' ? data.isInvincible : DEFAULTS.isInvincible,
      bulletBounceCount:
        bounceCount === 0 || bounceCount === 1 || bounceCount === 2 || bounceCount === 3
          ? bounceCount
          : DEFAULTS.bulletBounceCount,
      cameraMode: mode === 'free' || mode === 'fixed' ? mode : DEFAULTS.cameraMode,
      allowZoomOut: typeof data.allowZoomOut === 'boolean' ? data.allowZoomOut : DEFAULTS.allowZoomOut,
      bgmEnabled: typeof data.bgmEnabled === 'boolean' ? data.bgmEnabled : DEFAULTS.bgmEnabled,
      graphicsQuality: isGraphicsQuality(data.graphicsQuality)
        ? data.graphicsQuality
        : DEFAULTS.graphicsQuality,
      hitSfxId: isHitSfxId(data.hitSfxId) ? data.hitSfxId : DEFAULTS.hitSfxId,
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
