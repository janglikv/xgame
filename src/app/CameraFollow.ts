import { Vector3, type ArcRotateCamera } from '@babylonjs/core';
import { lockFixedOrbit } from '../world/shared/sceneBasics';
import type { CameraMode } from '../storage/settingsState';

/** 镜头注视点平滑跟随角色 */
export class CameraFollow {
  private readonly focusPoint = new Vector3();
  private readonly camFollowTarget = new Vector3();
  private readonly followStrength: number;

  constructor(followStrength = 6) {
    this.followStrength = followStrength;
  }

  /** 切换世界或重置时，避免注视点跳变 */
  snapTo(getFocus: (out: Vector3) => void): void {
    getFocus(this.focusPoint);
    this.camFollowTarget.copyFrom(this.focusPoint);
  }

  update(
    camera: ArcRotateCamera,
    getFocus: (out: Vector3) => void,
    dt: number,
    cameraMode: CameraMode,
  ): void {
    getFocus(this.focusPoint);
    const t = 1 - Math.exp(-this.followStrength * dt);
    this.camFollowTarget.x += (this.focusPoint.x - this.camFollowTarget.x) * t;
    this.camFollowTarget.y += (this.focusPoint.y - this.camFollowTarget.y) * t;
    this.camFollowTarget.z += (this.focusPoint.z - this.camFollowTarget.z) * t;
    if (!camera.target.equalsWithEpsilon(this.camFollowTarget, 1e-4)) {
      camera.setTarget(this.camFollowTarget);
    }
    if (cameraMode === 'fixed') {
      lockFixedOrbit(camera);
    }
  }
}
