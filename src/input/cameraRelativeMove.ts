import { Vector3 } from '@babylonjs/core';

export interface CameraOrbitLike {
  position: Vector3;
  target: Vector3;
  alpha: number;
  beta?: number;
}

export interface MoveWish {
  /** 是否有有效移动输入 */
  moving: boolean;
  wishX: number;
  wishZ: number;
  /** 归一化水平朝向（moving 时有效） */
  dirX: number;
  dirZ: number;
}

/**
 * 将 WASD 输入转为相对相机水平方向的世界速度（XZ）。
 * 复用外部 Vector3 缓冲，避免每帧分配。
 */
export function computeCameraRelativeWish(
  ix: number,
  iz: number,
  speed: number,
  camera: CameraOrbitLike,
  moveForward: Vector3,
  moveRight: Vector3,
  moveDelta: Vector3,
): MoveWish {
  if (ix === 0 && iz === 0) {
    return { moving: false, wishX: 0, wishZ: 0, dirX: 0, dirZ: 0 };
  }

  moveForward.copyFrom(camera.target).subtractInPlace(camera.position);
  moveForward.y = 0;
  if (moveForward.lengthSquared() < 1e-8) {
    moveForward.set(Math.sin(camera.alpha), 0, Math.cos(camera.alpha));
  } else {
    moveForward.normalize();
  }

  Vector3.CrossToRef(Vector3.UpReadOnly, moveForward, moveRight);
  if (moveRight.lengthSquared() < 1e-8) {
    moveRight.set(1, 0, 0);
  } else {
    moveRight.normalize();
  }

  // 视角倾角 (beta)。Z 轴在屏幕上的投影比率为 sin(beta)。
  // 为使上下走在屏幕上的像素移动速度与左右走完全一致，纵向添加 1 / sin(beta) 补偿。
  const beta = typeof camera.beta === 'number' ? camera.beta : Math.PI / 3;
  const forwardCompensation = 1 / Math.max(0.25, Math.sin(beta));

  const inputLen = Math.hypot(ix, iz);
  const normalizedIx = ix / inputLen;
  const normalizedIz = iz / inputLen;

  moveDelta.set(0, 0, 0);
  moveDelta.addInPlace(moveRight.scale(normalizedIx));
  moveDelta.addInPlace(moveForward.scale(normalizedIz * forwardCompensation));

  if (moveDelta.lengthSquared() <= 1e-8) {
    return { moving: false, wishX: 0, wishZ: 0, dirX: 0, dirZ: 0 };
  }

  const wishX = moveDelta.x * speed;
  const wishZ = moveDelta.z * speed;
  const dirLen = Math.hypot(wishX, wishZ);

  return {
    moving: true,
    wishX,
    wishZ,
    dirX: dirLen > 1e-6 ? wishX / dirLen : 0,
    dirZ: dirLen > 1e-6 ? wishZ / dirLen : 0,
  };
}
