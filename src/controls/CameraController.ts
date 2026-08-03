import * as THREE from 'three';
import {
  loadCameraState,
  saveCameraState,
  type CameraStateSnapshot,
} from '../storage/cameraState';
import { setGameCursor } from '../ui/GameCursor';

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

export interface CameraParams {
  x: number;
  y: number;
  z: number;
  pitchDeg: number;
  yawDeg: number;
  fov: number;
  near: number;
  far: number;
  moveSpeed: number;
  lookSpeed: number;
  mode: CameraViewMode;
}

/** 相机模式：自由漫游 / 锁定跟随英雄 */
export type CameraViewMode = 'free' | 'locked';

/**
 * 相机控制：
 * - 自由视角：WASD 水平移动 + Space/Shift 升降 + 按住左键拖拽转向
 * - 锁定视角：镜头跟随英雄；WASD 供外部驱动英雄移动（相对镜头水平方向）
 * 自由模式默认将位姿缓存到 localStorage。
 */
export class CameraController {
  /** 预设固定相机相对位移 (X: -0.4, Y: 3.7, Z: 1.5) */
  public static readonly FIXED_POS_OFFSET = new THREE.Vector3(-0.4, 3.7, 1.5);
  /** 预设固定相机俯仰角 Pitch: -66.0° */
  public static readonly FIXED_PITCH_RAD = (-66.0 * Math.PI) / 180;
  /** 预设固定相机偏航角 Yaw: -34.0° */
  public static readonly FIXED_YAW_RAD = (-34.0 * Math.PI) / 180;

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
  private fixedCamera = false;
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

  /**
   * 锁定视角下平滑拉回跟随位姿（复活：从死亡点镜头过渡到水晶前）。
   */
  private panActive = false;
  private panElapsed = 0;
  private panDuration = 1.25;
  private readonly panFrom = new THREE.Vector3();
  private readonly panTo = new THREE.Vector3();

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
        setGameCursor(this.domElement, 'default');
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

  get isFixed(): boolean {
    return this.fixedCamera;
  }

  /**
   * 设置固定相机预设视角 (X: -0.4, Y: 3.7, Z: 1.5, Pitch: -66.0°, Yaw: -34.0°)。
   * 打开后会自动启用锁定跟随模式。
   */
  setFixedCamera(fixed: boolean): void {
    this.fixedCamera = fixed;
    if (fixed) {
      this.pitch = CameraController.FIXED_PITCH_RAD;
      this.yaw = CameraController.FIXED_YAW_RAD;
      this.applyLook();
      this.followOffset.copy(CameraController.FIXED_POS_OFFSET);
      this.followQuaternion.copy(this.camera.quaternion);
      this.hasFollowSnapshot = true;
      if (this.viewMode !== 'locked') {
        this.setViewMode('locked');
      } else {
        this.applyFollowPose();
      }
    }
  }

  getParams(): CameraParams {
    return {
      x: this.camera.position.x,
      y: this.camera.position.y,
      z: this.camera.position.z,
      pitchDeg: (this.pitch * 180) / Math.PI,
      yawDeg: (this.yaw * 180) / Math.PI,
      fov: this.camera.fov,
      near: this.camera.near,
      far: this.camera.far,
      moveSpeed: this.moveSpeed,
      lookSpeed: this.lookSpeed,
      mode: this.viewMode,
    };
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
    this.cancelSmoothPan();

    if (mode === 'locked') {
      if (this.fixedCamera) {
        this.setFixedCamera(true);
      } else {
        this.captureFollowSnapshot();
        this.applyFollowPose();
      }
    } else {
      this.fixedCamera = false;
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
    if (this.viewMode === 'locked' && this.hasFollowSnapshot && !this.panActive) {
      this.applyFollowPose();
    }
  }

  /**
   * 从当前镜头位置平滑过渡到锁定跟随位姿（英雄已在复活点时调用）。
   * 仅锁定视角生效；自由视角忽略。
   * @param duration 过渡时长（秒）
   */
  smoothPanToFollow(duration = 1.25): void {
    if (this.viewMode !== 'locked' || !this.followTarget || !this.hasFollowSnapshot) {
      return;
    }
    this.panFrom.copy(this.camera.position);
    this.panTo.copy(this.followTarget.position).add(this.followOffset);
    // 已几乎贴在目标上则无需动画
    if (this.panFrom.distanceToSquared(this.panTo) < 1e-6) {
      this.panActive = false;
      this.applyFollowPose();
      return;
    }
    this.panElapsed = 0;
    this.panDuration = Math.max(0.05, duration);
    this.panActive = true;
  }

  /** 取消进行中的平滑拉回，下一帧恢复硬跟随 */
  cancelSmoothPan(): void {
    this.panActive = false;
    this.panElapsed = 0;
  }

  get isSmoothPanning(): boolean {
    return this.panActive;
  }

  private refreshCursor(): void {
    // 全局仅两态指针：日常小手 / 可攻击短剑（攻击态由 main 悬停逻辑切换）
    setGameCursor(this.domElement, 'default');
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
   * 根据当前 WASD 与相机水平朝向，写出单位方向（世界 XZ，Y=0）。
   * 无按键 / 未启用 / 无焦点时返回零向量。
   * 锁定视角下由主循环用此方向驱动英雄；自由视角由 update 驱动镜头。
   */
  getWasdWishXZ(out: THREE.Vector3): THREE.Vector3 {
    out.set(0, 0, 0);
    if (!this.enabled || this.fixedCamera) return out;
    if (!document.hasFocus() || document.hidden) return out;

    this.fillHorizontalBasis();

    if (this.keys.has('KeyW')) out.add(this.forward);
    if (this.keys.has('KeyS')) out.sub(this.forward);
    if (this.keys.has('KeyD')) out.add(this.right);
    if (this.keys.has('KeyA')) out.sub(this.right);

    if (out.lengthSq() > 1e-10) out.normalize();
    return out;
  }

  /**
   * 填充 this.forward / this.right（水平、单位）。
   * 锁定视角用相机世界朝向；自由视角用 yaw。
   */
  private fillHorizontalBasis(): void {
    if (this.viewMode === 'locked') {
      this.camera.getWorldDirection(this.forward);
      this.forward.y = 0;
      if (this.forward.lengthSq() < 1e-10) {
        // 镜头近乎竖直时，用 follow 四元数的 -Z 兜底
        this.forward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
        this.forward.y = 0;
      }
      if (this.forward.lengthSq() < 1e-10) {
        this.forward.set(0, 0, -1);
      } else {
        this.forward.normalize();
      }
    } else {
      this.forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
    }
    this.right.crossVectors(this.forward, this.worldUp).normalize();
  }

  /**
   * 每帧调用：
   * - 锁定：镜头跟随目标（英雄 WASD 在外部处理）；复活时可平滑拉回
   * - 自由：按键移动镜头（朝向由鼠标控制）
   */
  update(delta: number): void {
    if (this.viewMode === 'locked') {
      if (this.panActive && this.followTarget && this.hasFollowSnapshot) {
        // 终点随跟随目标更新（复活后英雄站定，基本不变）
        this.panTo.copy(this.followTarget.position).add(this.followOffset);
        this.panElapsed += Math.max(0, delta);
        const t = THREE.MathUtils.clamp(
          this.panElapsed / this.panDuration,
          0,
          1,
        );
        // ease-in-out cubic：慢起 → 快中 → 慢收
        const ease =
          t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        this.camera.position.lerpVectors(this.panFrom, this.panTo, ease);
        this.camera.quaternion.copy(this.followQuaternion);
        if (t >= 1) {
          this.panActive = false;
          this.applyFollowPose();
        }
      } else {
        this.applyFollowPose();
      }
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
    this.fillHorizontalBasis();

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
