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
 * 自由视角相机：WASD 水平移动 + Space/Shift 升降 + 按住左键拖拽转向。
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
  private isMouseDown = false;
  private lastMouseX = 0;
  private lastMouseY = 0;
  private enabled = true;
  private persistDirty = false;
  private persistElapsed = 0;

  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly wishDir = new THREE.Vector3();
  private readonly worldUp = new THREE.Vector3(0, 1, 0);

  private readonly onKeyDown: (e: KeyboardEvent) => void;
  private readonly onKeyUp: (e: KeyboardEvent) => void;
  private readonly onMouseDown: (e: MouseEvent) => void;
  private readonly onMouseUp: (e: MouseEvent) => void;
  private readonly onMouseMove: (e: MouseEvent) => void;
  private readonly onContextMenu: (e: Event) => void;
  private readonly onPageHide: () => void;
  /** 失焦 / 切 tab 时清空按键，避免 keyup 丢失导致“松手还在走” */
  private readonly clearKeys: () => void;
  private readonly onVisibilityChange: () => void;

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

    this.clearKeys = () => {
      this.keys.clear();
      this.isMouseDown = false;
    };

    this.onVisibilityChange = () => {
      // 切走 tab / 最小化时浏览器常吞掉 keyup，必须主动清空
      if (document.hidden) this.clearKeys();
    };

    this.onKeyDown = (e) => {
      if (!this.enabled) return;
      // 失焦窗口上的 keydown 不可信（例如从其它应用切回来的残留）
      if (!document.hasFocus()) return;

      // e.repeat 时 Set 幂等，无需特殊处理；用 code 而不是 key，避免布局差异
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

    this.onMouseDown = (e: MouseEvent) => {
      if (!this.enabled) return;
      if (e.button === 0) { // 左键
        this.isMouseDown = true;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
        this.domElement.style.cursor = 'grabbing';
      }
    };

    this.onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) {
        this.isMouseDown = false;
        this.domElement.style.cursor = 'grab';
      }
    };

    this.onMouseMove = (e: MouseEvent) => {
      if (!this.enabled || !this.isMouseDown) return;

      const movementX = e.clientX - this.lastMouseX;
      const movementY = e.clientY - this.lastMouseY;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;

      this.yaw -= movementX * this.lookSpeed;
      this.pitch -= movementY * this.lookSpeed;
      this.pitch = THREE.MathUtils.clamp(
        this.pitch,
        -this.pitchLimit,
        this.pitchLimit,
      );
      this.applyLook();
      this.markPersistDirty();
    };

    this.onContextMenu = (e) => {
      e.preventDefault();
    };

    this.onPageHide = () => {
      this.clearKeys();
      this.flushPersist(true);
    };

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    // 失焦时 keyup 经常丢：Cmd/Alt+Tab、点 DevTools、点浏览器外等
    window.addEventListener('blur', this.clearKeys);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.domElement.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    this.domElement.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('pagehide', this.onPageHide);

    this.domElement.style.cursor = 'grab';
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

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.clearKeys();
  }

  get isEnabled(): boolean {
    return this.enabled;
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

    // 窗口无焦点时不移动，并丢弃可能残留的按键状态
    if (!document.hasFocus() || document.hidden) {
      if (this.keys.size > 0) this.clearKeys();
      return;
    }

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
    this.clearKeys();

    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.clearKeys);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.domElement.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    this.domElement.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('pagehide', this.onPageHide);
  }
}
