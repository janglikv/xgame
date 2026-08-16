import type { ArcRotateCamera, Scene } from '@babylonjs/core';
import type { MoveWish } from '../input/cameraRelativeMove';
import type { CameraMode } from '../storage/settingsState';
import type { Minion, MinionAppearance } from './Minion';
import type { MinionPhysicsProxy } from './physics/MinionPhysicsProxy';
import type { SpellProjectileSystem } from './SpellProjectileSystem';

/** 可切换的世界 ID（存档兼容旧值 `blank` → `level1`） */
export type WorldId = 'hub' | 'level1' | 'level2';

/** 世界切换请求（由世界 update 返回，由 GameApp 执行） */
export type WorldTransition =
  | { type: 'goto'; world: WorldId; /** 是否恢复该世界上次位置 */ restorePosition?: boolean }
  | null;

/** 每帧传给世界的共享上下文 */
export interface WorldFrameContext {
  dt: number;
  menuOpen: boolean;
  cameraMode: CameraMode;
  moveWish: MoveWish;
  /** 指针在画布上且未开菜单时由 App 驱动悬停等 */
  pointerOverCanvas: boolean;
}

/** 激活世界时的参数 */
export interface WorldActivateOptions {
  canvas: HTMLCanvasElement;
  cameraMode: CameraMode;
  menuOpen: boolean;
  showGrid: boolean;
  /** 从另一世界带入外观 */
  appearance?: MinionAppearance;
  /** 覆盖出生点；缺省用世界自己的默认/存档点 */
  spawn?: { x: number; z: number };
  /** 诞生/落地的角色朝向 yaw */
  spawnYaw?: number;
  /** 是否播放落地下落动画 */
  playLandingWarp?: boolean;
}

/**
 * 枢纽 / 关卡世界的统一接口。
 * GameApp 只依赖此接口，不再对 hub / level1 写 if-else 细节。
 */
export interface GameWorld {
  readonly id: WorldId;
  readonly scene: Scene;
  readonly camera: ArcRotateCamera;

  getPlayer(): Minion;
  getPlayerPhys(): MinionPhysicsProxy;
  getSpellSystem(): SpellProjectileSystem;

  attachCamera(canvas: HTMLCanvasElement): void;
  detachCamera(): void;
  setCameraMode(
    mode: CameraMode,
    canvas: HTMLCanvasElement,
    menuOpen: boolean,
  ): void;
  setGridVisible(visible: boolean): void;

  getAppearance(): MinionAppearance;
  applyAppearance(appearance: MinionAppearance): void;

  getPlayerXZ(): { x: number; z: number };
  /** 瞬移玩家（无落地动画） */
  teleportPlayer(x: number, z: number): void;

  /** 传送阵视觉蓄力 0~1（无阵时为 0；驱动黑场遮罩） */
  getTeleportCharge01(): number;

  /**
   * 传送进入本世界时的默认落点。
   * 可传入角色当前朝向 yaw，计算落在传送阵前方一点的位置；未传则使用默认 fallback。
   */
  getDefaultLandingXZ(yaw?: number): { x: number; z: number };

  /**
   * 成为当前活动世界：挂相机、同步外观/网格、必要时落地动画与传送阵 disarm。
   * 返回落地动画句柄（若有），由 App 驱动进度。
   */
  activate(opts: WorldActivateOptions): void;

  /** 失去活动权：卸相机、清输入相关状态 */
  deactivate(): void;

  /**
   * 世界专属逻辑（敌人、展台、传送阵检测等）。
   * 返回非 null 时 App 执行场景切换。
   */
  update(ctx: WorldFrameContext): WorldTransition;

  dispose(): void;
}
