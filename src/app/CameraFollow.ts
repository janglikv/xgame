import { Vector3, type ArcRotateCamera } from '@babylonjs/core';
import { lockFixedOrbit } from '../world/shared/sceneBasics';
import { FIXED_CAMERA, type CameraMode } from '../storage/settingsState';

/** 镜头注视点平滑跟随角色，并支持固定视角下的平滑滚轮缩放 */
export class CameraFollow {
  private readonly focusPoint = new Vector3();
  private readonly camFollowTarget = new Vector3();
  private readonly shakenTarget = new Vector3();
  private readonly followStrength: number;
  private shake = 0;
  private shakeX = 0;
  private shakeZ = 0;
  /** 固定视角目标缩放半径与插值半径 */
  private targetRadius: number = FIXED_CAMERA.radius;
  private currentRadius: number = FIXED_CAMERA.radius;

  constructor(followStrength = 6) {
    this.followStrength = followStrength;
  }

  /** 获取当前缩放目标半径 */
  getRadius(): number {
    return this.targetRadius;
  }

  /** 设置/重置缩放半径 */
  setRadius(r: number): void {
    this.targetRadius = Math.min(
      FIXED_CAMERA.maxRadius,
      Math.max(FIXED_CAMERA.minRadius, r),
    );
  }

  /** 绑定画布滚轮缩放 */
  bindCanvas(canvas: HTMLCanvasElement, isBlocked?: () => boolean): () => void {
    const onWheel = (e: WheelEvent): void => {
      if (isBlocked?.()) return;
      e.preventDefault();
      // 向上滚动拉近，向下滚动拉远（相对缩放步进，手感细腻）
      const factor = e.deltaY > 0 ? 1.10 : 0.90;
      this.targetRadius = Math.min(
        FIXED_CAMERA.maxRadius,
        Math.max(FIXED_CAMERA.minRadius, this.targetRadius * factor),
      );
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      canvas.removeEventListener('wheel', onWheel);
    };
  }

  /** 近战打实后的短促镜头顿挫 */
  impulse(strength = 1): void {
    this.shake = Math.max(this.shake, strength);
    const a = Math.random() * Math.PI * 2;
    this.shakeX = Math.cos(a);
    this.shakeZ = Math.sin(a);
  }

  /** 切换世界或重置时，避免注视点跳变 */
  snapTo(getFocus: (out: Vector3) => void, cameraMode: CameraMode = 'fixed'): void {
    getFocus(this.focusPoint);
    this.applyFixedFocus(cameraMode);
    this.camFollowTarget.copyFrom(this.focusPoint);
  }

  update(
    camera: ArcRotateCamera,
    getFocus: (out: Vector3) => void,
    dt: number,
    cameraMode: CameraMode,
  ): void {
    getFocus(this.focusPoint);
    this.applyFixedFocus(cameraMode);
    const jumpX = this.focusPoint.x - this.camFollowTarget.x;
    const jumpZ = this.focusPoint.z - this.camFollowTarget.z;
    // 复活/切场景瞬移：直接咬住，避免镜头先拽回死亡点再慢慢跟过去
    if (jumpX * jumpX + jumpZ * jumpZ > 4) {
      this.camFollowTarget.copyFrom(this.focusPoint);
    } else {
      const t = 1 - Math.exp(-this.followStrength * dt);
      this.camFollowTarget.x += jumpX * t;
      this.camFollowTarget.y += (this.focusPoint.y - this.camFollowTarget.y) * t;
      this.camFollowTarget.z += jumpZ * t;
    }
    this.shakenTarget.copyFrom(this.camFollowTarget);
    if (this.shake > 0) {
      const mag = 0.05 * this.shake;
      this.shakenTarget.x += this.shakeX * mag;
      this.shakenTarget.z += this.shakeZ * mag;
      this.shake = Math.max(0, this.shake - dt * 12);
    }
    if (!camera.target.equalsWithEpsilon(this.shakenTarget, 1e-4)) {
      camera.setTarget(this.shakenTarget);
    }
    if (cameraMode === 'fixed') {
      const tRadius = 1 - Math.exp(-12 * dt);
      this.currentRadius += (this.targetRadius - this.currentRadius) * tRadius;
      lockFixedOrbit(camera, this.currentRadius);
    }
  }

  /** 固定镜头把注视点从胸口压向小腿，避免脚被裁出画面 */
  private applyFixedFocus(cameraMode: CameraMode): void {
    if (cameraMode !== 'fixed') return;
    this.focusPoint.y *= FIXED_CAMERA.focusHeightScale;
  }
}
