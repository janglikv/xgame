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

/** 相机模式：自由漫游 / 锁定跟随英雄 */
export type CameraViewMode = 'free' | 'locked';

/**
 * 相机控制：
 * - 自由视角：WASD 水平移动 + Space/Shift 升降 + 按住左键拖拽转向
 * - 锁定视角：进入时快照「相对英雄的位移 + 当前朝向」，之后随英雄平移保持该关系
 * 自由模式默认将位姿缓存到 localStorage。
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

  /** free = 自由漫游；locked = 跟随英雄 */
  private viewMode: CameraViewMode = 'free';
  private followTarget: THREE.Object3D | null = null;
  /**
   * 锁定时快照：相机相对目标的世界空间位移
   * （camPos = targetPos + offset）
   */
  private readonly followOffset = new THREE.Vector3();
  /** 锁定时快照：相机世界旋转（保持进入锁定时的视线方向） */
  private readonly followQuaternion = new THREE.Quaternion();
  private hasFollowSnapshot = false;

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
      if (!this.enabled || this.viewMode !== 'free') return;
      if (e.button === 0) {
        // 左键：自由视角拖拽转向
        this.isMouseDown = true;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
        this.domElement.style.cursor = 'grabbing';
      }
    };

    this.onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) {
        this.isMouseDown = false;
        this.refreshCursor();
      }
    };

    this.onMouseMove = (e: MouseEvent) => {
      if (!this.enabled || this.viewMode !== 'free' || !this.isMouseDown) {
        return;
      }

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

    this.refreshCursor();
    this.domElement.tabIndex = 0;
  }

  get mode(): CameraViewMode {
    return this.viewMode;
  }

  get isLocked(): boolean {
    return this.viewMode === 'locked';
  }

  /**
   * 切换自由 / 锁定视角。
   * 进入锁定：以当前镜头相对英雄的位置与朝向为快照；
   * 退出锁定：从当前朝向恢复自由 yaw/pitch。
   */
  setViewMode(mode: CameraViewMode): void {
    if (this.viewMode === mode) return;
    this.viewMode = mode;
    this.clearKeys();
    this.isMouseDown = false;

    if (mode === 'locked') {
      this.captureFollowSnapshot();
      this.applyFollowPose();
    } else {
      this.hasFollowSnapshot = false;
      this.syncAnglesFromCamera();
      this.applyLook();
      this.markPersistDirty();
    }
    this.refreshCursor();
  }

  /** 锁定视角时跟随的目标（通常为英雄） */
  setFollowTarget(target: THREE.Object3D | null): void {
    this.followTarget = target;
    // 已锁定时不重拍快照，避免目标引用更新冲掉当前锁定关系
    if (this.viewMode === 'locked' && this.hasFollowSnapshot) {
      this.applyFollowPose();
    }
  }

  private refreshCursor(): void {
    if (!this.enabled) {
      this.domElement.style.cursor = 'default';
      return;
    }
    if (this.viewMode === 'locked') {
      this.domElement.style.cursor = 'default';
      return;
    }
    this.domElement.style.cursor = this.isMouseDown ? 'grabbing' : 'grab';
  }

  /**
   * 记录进入锁定瞬间的相对位移与相机旋转。
   * 之后英雄移动时：cam = hero + offset，quaternion 保持不变。
   */
  private captureFollowSnapshot(): void {
    if (!this.followTarget) {
      this.hasFollowSnapshot = false;
      return;
    }
    this.followOffset
      .copy(this.camera.position)
      .sub(this.followTarget.position);
    this.followQuaternion.copy(this.camera.quaternion);
    this.hasFollowSnapshot = true;
  }

  /** 用快照相对关系把相机贴到目标上（位置平移，朝向锁定） */
  private applyFollowPose(): void {
    if (!this.followTarget || !this.hasFollowSnapshot) return;
    this.camera.position
      .copy(this.followTarget.position)
      .add(this.followOffset);
    this.camera.quaternion.copy(this.followQuaternion);
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
    if (!enabled) {
      this.clearKeys();
      this.isMouseDown = false;
    }
    this.refreshCursor();
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * 每帧调用：
   * - 锁定：镜头跟随目标
   * - 自由：按键移动（朝向由鼠标控制）
   */
  update(delta: number): void {
    if (this.viewMode === 'locked') {
      this.applyFollowPose();
      return;
    }

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
