import * as THREE from 'three';

export interface CameraControllerOptions {
  /** 水平移动速度（单位/秒） */
  moveSpeed?: number;
  /** 鼠标灵敏度 */
  lookSpeed?: number;
  /** 俯仰角限制（弧度） */
  pitchLimit?: number;
}

/**
 * 自由视角相机：WASD 水平移动 + Space/Shift 升降 + 鼠标控制朝向。
 * 点击画布锁定指针后，移动鼠标转向；Esc 退出锁定。
 */
export class CameraController {
  private readonly camera: THREE.PerspectiveCamera;
  private readonly domElement: HTMLElement;
  private readonly moveSpeed: number;
  private readonly lookSpeed: number;
  private readonly pitchLimit: number;

  private readonly keys = new Set<string>();
  private yaw = 0;
  private pitch = 0;
  private pointerLocked = false;

  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly wishDir = new THREE.Vector3();
  private readonly worldUp = new THREE.Vector3(0, 1, 0);

  private readonly onKeyDown: (e: KeyboardEvent) => void;
  private readonly onKeyUp: (e: KeyboardEvent) => void;
  private readonly onClick: () => void;
  private readonly onMouseMove: (e: MouseEvent) => void;
  private readonly onPointerLockChange: () => void;
  private readonly onContextMenu: (e: Event) => void;

  constructor(
    camera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
    options: CameraControllerOptions = {},
  ) {
    this.camera = camera;
    this.domElement = domElement;
    this.moveSpeed = options.moveSpeed ?? 10;
    this.lookSpeed = options.lookSpeed ?? 0.002;
    this.pitchLimit = options.pitchLimit ?? Math.PI / 2 - 0.05;

    this.syncAnglesFromCamera();
    this.applyLook();

    this.onKeyDown = (e) => {
      this.keys.add(e.code);
      // 避免 WASD / Space / Shift 触发浏览器默认行为
      if (
        e.code === 'KeyW' ||
        e.code === 'KeyA' ||
        e.code === 'KeyS' ||
        e.code === 'KeyD' ||
        e.code === 'Space' ||
        e.code === 'ShiftLeft' ||
        e.code === 'ShiftRight'
      ) {
        e.preventDefault();
      }
    };

    this.onKeyUp = (e) => {
      this.keys.delete(e.code);
    };

    this.onClick = () => {
      if (!this.pointerLocked) {
        this.domElement.requestPointerLock();
      }
    };

    this.onMouseMove = (e) => {
      if (!this.pointerLocked) return;

      this.yaw -= e.movementX * this.lookSpeed;
      this.pitch -= e.movementY * this.lookSpeed;
      this.pitch = THREE.MathUtils.clamp(
        this.pitch,
        -this.pitchLimit,
        this.pitchLimit,
      );
      this.applyLook();
    };

    this.onPointerLockChange = () => {
      this.pointerLocked = document.pointerLockElement === this.domElement;
      this.domElement.style.cursor = this.pointerLocked ? 'none' : 'crosshair';
    };

    this.onContextMenu = (e) => {
      e.preventDefault();
    };

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.domElement.addEventListener('click', this.onClick);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    this.domElement.addEventListener('contextmenu', this.onContextMenu);

    this.domElement.style.cursor = 'crosshair';
    this.domElement.tabIndex = 0;
  }

  /** 从当前相机朝向同步 yaw / pitch */
  private syncAnglesFromCamera(): void {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);

    this.yaw = Math.atan2(-dir.x, -dir.z);
    this.pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
  }

  private applyLook(): void {
    // 由 yaw / pitch 重建朝向（Y 轴上、绕 Y 水平转）
    const cosPitch = Math.cos(this.pitch);
    const dir = new THREE.Vector3(
      -Math.sin(this.yaw) * cosPitch,
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * cosPitch,
    );
    const target = this.camera.position.clone().add(dir);
    this.camera.lookAt(target);
  }

  /**
   * 每帧调用：根据按键移动相机（只改位置，朝向由鼠标控制）。
   */
  update(delta: number): void {
    this.wishDir.set(0, 0, 0);

    // 水平前进方向（忽略俯仰，避免抬头时飞起来）
    this.forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
    this.right.crossVectors(this.forward, this.worldUp).normalize();

    if (this.keys.has('KeyW')) this.wishDir.add(this.forward);
    if (this.keys.has('KeyS')) this.wishDir.sub(this.forward);
    if (this.keys.has('KeyD')) this.wishDir.add(this.right);
    if (this.keys.has('KeyA')) this.wishDir.sub(this.right);
    // Space 上升，Shift 下降
    if (this.keys.has('Space')) this.wishDir.add(this.worldUp);
    if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) {
      this.wishDir.sub(this.worldUp);
    }

    if (this.wishDir.lengthSq() > 0) {
      this.wishDir.normalize().multiplyScalar(this.moveSpeed * delta);
      this.camera.position.add(this.wishDir);
    }
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.domElement.removeEventListener('click', this.onClick);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.domElement.removeEventListener('contextmenu', this.onContextMenu);

    if (document.pointerLockElement === this.domElement) {
      document.exitPointerLock();
    }
  }
}
