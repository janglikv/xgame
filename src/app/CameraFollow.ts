import { Vector3, type ArcRotateCamera } from '@babylonjs/core';
import { lockFixedOrbit } from '../world/shared/sceneBasics';
import { FIXED_CAMERA, type CameraMode } from '../storage/settingsState';

/** 镜头注视点平滑跟随角色 */
export class CameraFollow {
  private readonly focusPoint = new Vector3();
  private readonly camFollowTarget = new Vector3();
  private readonly shakenTarget = new Vector3();
  private readonly followStrength: number;
  private shake = 0;
  private shakeX = 0;
  private shakeZ = 0;

  constructor(followStrength = 6) {
    this.followStrength = followStrength;
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
      lockFixedOrbit(camera);
    }
  }

  /** 固定镜头把注视点从胸口压向小腿，避免脚被裁出画面 */
  private applyFixedFocus(cameraMode: CameraMode): void {
    if (cameraMode !== 'fixed') return;
    this.focusPoint.y *= FIXED_CAMERA.focusHeightScale;
  }
}
