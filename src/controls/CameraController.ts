import * as THREE from 'three';
import {
  loadCameraState,
  saveCameraState,
  type CameraStateSnapshot,
} from '../storage/cameraState';

export interface CameraControllerOptions {
  /** 水平移动速度（单位/秒） */
  moveSpeed?: number;
  /** 鼠标灵敏度 */
  lookSpeed?: number;
  /** 俯仰角限制（弧度） */
  pitchLimit?: number;
  /** 是否将位置/朝向写入 localStorage，默认 true */
  persist?: boolean;
  /** 持久化写入最小间隔（秒），默认 0.4 */
  persistInterval?: number;
}

/**
 * 自由视角相机：WASD 水平移动 + Space/Shift 升降 + 鼠标控制朝向。
 * 点击画布锁定指针后，移动鼠标转向。
 * 默认将位姿缓存到 localStorage，刷新后恢复。
 */
export class CameraController {
  private readonly camera: THREE.PerspectiveCamera;
  private readonly domElement: HTMLElement;
  private readonly moveSpeed: number;
  private readonly lookSpeed: number;
  private readonly pitchLimit: number;
  private readonly persist: boolean;
  private readonly persistInterval: number;

  private readonly keys = new Set<string>();
  private yaw = 0;
  private pitch = 0;
  private pointerLocked = false;
  private enabled = true;
  /** 浏览器禁止立刻重新 requestPointerLock，需冷却 */
  private lockCooldownUntil = 0;
  private persistDirty = false;
  private persistElapsed = 0;

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
  private readonly onPageHide: () => void;

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
    this.persist = options.persist ?? true;
    this.persistInterval = options.persistInterval ?? 0.4;

    // 优先恢复缓存位姿，否则沿用相机当前朝向
    const saved = this.persist ? loadCameraState() : null;
    if (saved) {
      this.applySnapshot(saved);
    } else {
      this.syncAnglesFromCamera();
      this.applyLook();
    }

    this.onKeyDown = (e) => {
      if (!this.enabled) return;
      // 属性面板快捷键不计入移动
      if (e.code === 'Tab') return;

      this.keys.add(e.code);
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
      void this.tryRequestPointerLock();
    };

    this.onMouseMove = (e) => {
      if (!this.enabled || !this.pointerLocked) return;

      this.yaw -= e.movementX * this.lookSpeed;
      this.pitch -= e.movementY * this.lookSpeed;
      this.pitch = THREE.MathUtils.clamp(
        this.pitch,
        -this.pitchLimit,
        this.pitchLimit,
      );
      this.applyLook();
      this.markPersistDirty();
    };

    this.onPointerLockChange = () => {
      const locked = document.pointerLockElement === this.domElement;
      const wasLocked = this.pointerLocked;
      this.pointerLocked = locked;
      this.domElement.style.cursor = locked ? 'none' : 'crosshair';

      if (wasLocked && !locked) {
        this.keys.clear();
      }
    };

    this.onContextMenu = (e) => {
      e.preventDefault();
    };

    this.onPageHide = () => {
      this.flushPersist(true);
    };

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.domElement.addEventListener('click', this.onClick);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    this.domElement.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('pagehide', this.onPageHide);

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
    const cosPitch = Math.cos(this.pitch);
    const dir = new THREE.Vector3(
      -Math.sin(this.yaw) * cosPitch,
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * cosPitch,
    );
    const target = this.camera.position.clone().add(dir);
    this.camera.lookAt(target);
  }

  private applySnapshot(state: CameraStateSnapshot): void {
    this.camera.position.set(state.x, state.y, state.z);
    this.yaw = state.yaw;
    this.pitch = THREE.MathUtils.clamp(
      state.pitch,
      -this.pitchLimit,
      this.pitchLimit,
    );
    this.applyLook();
  }

  private captureSnapshot(): CameraStateSnapshot {
    return {
      x: this.camera.position.x,
      y: this.camera.position.y,
      z: this.camera.position.z,
      yaw: this.yaw,
      pitch: this.pitch,
    };
  }

  private markPersistDirty(): void {
    if (!this.persist) return;
    this.persistDirty = true;
  }

  private flushPersist(force = false): void {
    if (!this.persist || !this.persistDirty) return;
    if (!force && this.persistElapsed < this.persistInterval) return;

    saveCameraState(this.captureSnapshot());
    this.persistDirty = false;
    this.persistElapsed = 0;
  }

  /**
   * 请求指针锁定。必须在用户手势（click 等）的调用栈中触发。
   * 若浏览器拒绝（刚退出锁定过近），静默失败，下次点击可再试。
   */
  async requestPointerLock(): Promise<boolean> {
    if (!this.enabled || this.pointerLocked) return this.pointerLocked;
    if (performance.now() < this.lockCooldownUntil) return false;
    if (document.pointerLockElement) return false;

    try {
      const result = this.domElement.requestPointerLock();
      // 新规范返回 Promise；旧浏览器可能返回 undefined
      if (result != null && typeof (result as Promise<void>).then === 'function') {
        await result;
      }
      return document.pointerLockElement === this.domElement;
    } catch {
      // SecurityError：刚退出锁定后过早请求，短冷却后允许再点
      this.lockCooldownUntil = performance.now() + 250;
      return false;
    }
  }

  private async tryRequestPointerLock(): Promise<void> {
    await this.requestPointerLock();
  }

  /**
   * 启用 / 禁用输入（暂停时关闭移动与视角）。
   * 不释放指针锁定，便于暂停结束后立刻继续控镜头。
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.keys.clear();
    }
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  get isPointerLocked(): boolean {
    return this.pointerLocked;
  }

  /**
   * 每帧调用：根据按键移动相机（只改位置，朝向由鼠标控制）。
   */
  update(delta: number): void {
    if (this.persist) {
      this.persistElapsed += delta;
      this.flushPersist(false);
    }

    if (!this.enabled) return;

    this.wishDir.set(0, 0, 0);

    this.forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
    this.right.crossVectors(this.forward, this.worldUp).normalize();

    if (this.keys.has('KeyW')) this.wishDir.add(this.forward);
    if (this.keys.has('KeyS')) this.wishDir.sub(this.forward);
    if (this.keys.has('KeyD')) this.wishDir.add(this.right);
    if (this.keys.has('KeyA')) this.wishDir.sub(this.right);
    if (this.keys.has('Space')) this.wishDir.add(this.worldUp);
    if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) {
      this.wishDir.sub(this.worldUp);
    }

    if (this.wishDir.lengthSq() > 0) {
      this.wishDir.normalize().multiplyScalar(this.moveSpeed * delta);
      this.camera.position.add(this.wishDir);
      this.markPersistDirty();
    }
  }

  dispose(): void {
    this.flushPersist(true);

    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.domElement.removeEventListener('click', this.onClick);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.domElement.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('pagehide', this.onPageHide);

    if (document.pointerLockElement === this.domElement) {
      document.exitPointerLock();
    }
  }
}
