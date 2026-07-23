import type { Container } from 'pixi.js';
import { MAP_SIZE, WorldMap } from '../world/WorldMap';

export type LevelCameraOptions = {
  worldRoot: Container;
  /** 初始焦点（出生点） */
  spawnX: number;
  spawnY: number;
  viewWidth: number;
  viewHeight: number;
  zoomDefault?: number;
  zoomMax?: number;
  /** 按住 +/- 时的缩放速度（每秒倍率） */
  zoomKeyRate?: number;
  /** 滚轮单次倍率 */
  zoomWheelStep?: number;
  /** 镜头位置跟随（指数趋近） */
  followLambda?: number;
  /** 缩放过渡 */
  zoomLambda?: number;
  /** 切换角色后短暂加快镜头 */
  switchBoostLambda?: number;
  switchBoostTime?: number;
};

/**
 * 关卡镜头：worldRoot 缩放 + 平移，使 cam 落在屏幕中心。
 * 焦点由外部每帧提供（玩家脚底）。
 */
export class LevelCamera {
  private readonly worldRoot: Container;
  private readonly zoomDefault: number;
  private readonly zoomMax: number;
  private readonly zoomKeyRate: number;
  private readonly zoomWheelStep: number;
  private readonly followLambda: number;
  private readonly zoomLambda: number;
  private readonly switchBoostLambda: number;
  private readonly switchBoostDuration: number;

  private viewWidth: number;
  private viewHeight: number;

  /** 实际渲染 cam */
  private camX: number;
  private camY: number;
  private camTargetX: number;
  private camTargetY: number;
  private zoom: number;
  private zoomTarget: number;
  /** 切换角色后的加速跟随剩余时间（秒） */
  private camBoostTime = 0;

  constructor(options: LevelCameraOptions) {
    this.worldRoot = options.worldRoot;
    this.viewWidth = options.viewWidth;
    this.viewHeight = options.viewHeight;
    this.zoomDefault = options.zoomDefault ?? 1;
    this.zoomMax = options.zoomMax ?? 1;
    this.zoomKeyRate = options.zoomKeyRate ?? 1.35;
    this.zoomWheelStep = options.zoomWheelStep ?? 1.12;
    this.followLambda = options.followLambda ?? 12;
    this.zoomLambda = options.zoomLambda ?? 9;
    this.switchBoostLambda = options.switchBoostLambda ?? 16;
    this.switchBoostDuration = options.switchBoostTime ?? 0.35;

    this.camX = options.spawnX;
    this.camY = options.spawnY;
    this.camTargetX = options.spawnX;
    this.camTargetY = options.spawnY;
    this.zoom = this.zoomDefault;
    this.zoomTarget = this.zoomDefault;
  }

  get x(): number {
    return this.camX;
  }

  get y(): number {
    return this.camY;
  }

  get currentZoom(): number {
    return this.zoom;
  }

  get targetZoom(): number {
    return this.zoomTarget;
  }

  get width(): number {
    return this.viewWidth;
  }

  get height(): number {
    return this.viewHeight;
  }

  /** 切换角色后短暂加快跟焦 */
  boostFollow(): void {
    this.camBoostTime = this.switchBoostDuration;
  }

  resize(width: number, height: number): void {
    this.viewWidth = width;
    this.viewHeight = height;
    this.zoomTarget = Math.min(
      this.zoomMax,
      Math.max(this.getMinZoom(), this.zoomTarget),
    );
  }

  /** 当前窗口下能看全地图的最小缩放 */
  getMinZoom(): number {
    if (this.viewWidth <= 0 || this.viewHeight <= 0) return 0.15;
    return (
      Math.min(this.viewWidth / MAP_SIZE, this.viewHeight / MAP_SIZE) * 0.92
    );
  }

  /** 设置缩放目标（由 step 平滑过渡） */
  setZoom(next: number): void {
    const min = this.getMinZoom();
    const z = Math.min(this.zoomMax, Math.max(min, next));
    if (Math.abs(z - this.zoomTarget) < 1e-4) return;
    this.zoomTarget = z;
  }

  /** 缩到刚好看全图 */
  fitOverview(): void {
    this.zoomTarget = this.getMinZoom();
  }

  resetZoom(): void {
    this.setZoom(this.zoomDefault);
  }

  /** 滚轮：deltaY>0 拉远 */
  applyWheel(deltaY: number): void {
    const dir = deltaY > 0 ? 1 / this.zoomWheelStep : this.zoomWheelStep;
    this.setZoom(this.zoom * dir);
  }

  /**
   * 按住 +/- 连续缩放；返回 true 表示本帧改过目标缩放。
   * 由场景读键盘后调用。
   */
  applyZoomKeyHold(zoomIn: boolean, zoomOut: boolean, dt: number): void {
    if (zoomIn === zoomOut) return;
    const factor = Math.pow(this.zoomKeyRate, dt);
    this.setZoom(this.zoomTarget * (zoomIn ? factor : 1 / factor));
  }

  /**
   * 平滑推进镜头到焦点。
   * snap=true：立刻对齐（初始化 / 改窗口）。
   * @returns 镜头是否发生可见位移
   */
  step(dt: number, focusX: number, focusY: number, snap = false): boolean {
    const zForTarget = Math.max(this.zoomTarget, 1e-4);
    const target = WorldMap.clampCamera(
      focusX,
      focusY,
      this.viewWidth / zForTarget,
      this.viewHeight / zForTarget,
    );
    this.camTargetX = target.x;
    this.camTargetY = target.y;

    const prevX = this.camX;
    const prevY = this.camY;
    const prevZ = this.zoom;

    if (snap) {
      this.camX = this.camTargetX;
      this.camY = this.camTargetY;
      this.zoom = this.zoomTarget;
      this.camBoostTime = 0;
    } else if (dt > 0) {
      let posLambda = this.followLambda;
      if (this.camBoostTime > 0) {
        posLambda = this.switchBoostLambda;
        this.camBoostTime = Math.max(0, this.camBoostTime - dt);
      }

      this.camX = expApproach(this.camX, this.camTargetX, posLambda, dt);
      this.camY = expApproach(this.camY, this.camTargetY, posLambda, dt);
      this.zoom = expApproach(this.zoom, this.zoomTarget, this.zoomLambda, dt);

      if (Math.abs(this.camX - this.camTargetX) < 0.05) this.camX = this.camTargetX;
      if (Math.abs(this.camY - this.camTargetY) < 0.05) this.camY = this.camTargetY;
      if (Math.abs(this.zoom - this.zoomTarget) < 0.0004) {
        this.zoom = this.zoomTarget;
      }
    }
    // dt===0 且非 snap：只刷新 camTarget，保持当前 cam 位置（如受击后改焦点）

    // 用当前缩放钳制，防止过渡中露图外
    const z = Math.max(this.zoom, 1e-4);
    const clamped = WorldMap.clampCamera(
      this.camX,
      this.camY,
      this.viewWidth / z,
      this.viewHeight / z,
    );
    this.camX = clamped.x;
    this.camY = clamped.y;

    this.applyToWorldRoot();

    return (
      Math.abs(this.camX - prevX) > 0.01 ||
      Math.abs(this.camY - prevY) > 0.01 ||
      Math.abs(this.zoom - prevZ) > 0.0002
    );
  }

  private applyToWorldRoot(): void {
    const z = this.zoom;
    this.worldRoot.scale.set(z);
    this.worldRoot.position.set(
      this.viewWidth / 2 - this.camX * z,
      this.viewHeight / 2 - this.camY * z,
    );
  }
}

/** 指数趋近（帧率无关） */
function expApproach(
  current: number,
  target: number,
  lambda: number,
  dt: number,
): number {
  if (dt <= 0 || lambda <= 0) return target;
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}
