import { Vector3 } from '@babylonjs/core';
import {
  computeCameraRelativeWish,
  type CameraOrbitLike,
  type MoveWish,
} from '../input/cameraRelativeMove';

const MOVE_KEYS = ['w', 'a', 's', 'd'] as const;
type MoveKey = (typeof MOVE_KEYS)[number];

/**
 * WASD 状态 + 相对镜头移动意图。
 * 与世界无关，由 GameApp 每帧读一次再注入当前世界。
 */
export class MoveInput {
  readonly keys = { w: false, a: false, s: false, d: false };

  private readonly moveForward = new Vector3();
  private readonly moveRight = new Vector3();
  private readonly moveDelta = new Vector3();

  isMoveKey(key: string): key is MoveKey {
    return (MOVE_KEYS as readonly string[]).includes(key);
  }

  setKey(key: MoveKey, down: boolean): void {
    this.keys[key] = down;
  }

  clear(): void {
    this.keys.w = this.keys.a = this.keys.s = this.keys.d = false;
  }

  readWish(
    camera: CameraOrbitLike,
    speed: number,
    menuOpen: boolean,
  ): MoveWish {
    if (menuOpen) {
      return { moving: false, wishX: 0, wishZ: 0, dirX: 0, dirZ: 0 };
    }
    const ix = (this.keys.a ? 1 : 0) - (this.keys.d ? 1 : 0);
    const iz = (this.keys.w ? 1 : 0) - (this.keys.s ? 1 : 0);
    return computeCameraRelativeWish(
      ix,
      iz,
      speed,
      camera,
      this.moveForward,
      this.moveRight,
      this.moveDelta,
    );
  }
}
