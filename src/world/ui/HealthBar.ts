import * as THREE from 'three';
import type { TeamId } from '../combat/CombatUnit';

export interface HealthBarOptions {
  /** 本地空间宽度（Sprite scale.x） */
  width?: number;
  /** 本地空间高度（Sprite scale.y） */
  height?: number;
  /** 本地 Y 偏移（头顶上方） */
  yOffset?: number;
  /** 队伍色：蓝/红填充 */
  team?: TeamId;
  /** 满血时隐藏（默认 false，始终显示） */
  hideWhenFull?: boolean;
  /** Sprite 屏幕锚点 (X 方向，默认 0.5；小于 0.5 屏幕投影向右偏) */
  centerX?: number;
}

/**
 * 始终朝向相机的世界空间血条（Canvas 纹理 + Sprite）。
 * 作为单位子节点挂载；若父级有缩放，请用 width/height 补偿。
 */
export class HealthBar extends THREE.Sprite {
  private static readonly CANVAS_W = 256;
  private static readonly CANVAS_H = 24;
  private static readonly BORDER = 3;

  /** 视口边距（NDC）；0 = 紧贴屏幕边缘 */
  private static readonly VIEW_MARGIN_NDC = 0;
  /**
   * 判定「父物体在镜头内」时的 NDC 外扩；
   * 略大于 1 以便塔身刚进画、头顶血条尚未进画时也能开始贴边。
   */
  private static readonly STRUCTURE_IN_VIEW_PAD = 0.28;
  /** 血条相对理想头顶位的最大世界偏移（米），避免飞离主体过远 */
  private static readonly MAX_FIT_OFFSET_WORLD = 1.35;

  private static readonly _parentWorld = new THREE.Vector3();
  private static readonly _homeWorld = new THREE.Vector3();
  private static readonly _ndc = new THREE.Vector3();
  private static readonly _probe = new THREE.Vector3();
  private static readonly _camRight = new THREE.Vector3();
  private static readonly _camUp = new THREE.Vector3();
  private static readonly _worldScale = new THREE.Vector3();
  private static readonly _targetWorld = new THREE.Vector3();
  private static readonly _offsetWorld = new THREE.Vector3();
  private static readonly _local = new THREE.Vector3();

  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly team: TeamId;
  private readonly hideWhenFull: boolean;
  /** 构造时的本地位置（理想头顶位）；视口贴合在此基础上偏移 */
  private readonly homePosition = new THREE.Vector3();

  private lastRatio = -1;
  private lastVisible: boolean | null = null;

  constructor(options: HealthBarOptions = {}) {
    const width = options.width ?? 1;
    const height = options.height ?? 0.12;
    const yOffset = options.yOffset ?? 1.2;
    const team = options.team ?? 'blue';
    const hideWhenFull = options.hideWhenFull ?? false;
    const centerX = options.centerX ?? 0.5;

    const canvas = document.createElement('canvas');
    canvas.width = HealthBar.CANVAS_W;
    canvas.height = HealthBar.CANVAS_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable for HealthBar');

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      sizeAttenuation: true,
    });

    super(material);
    this.name = 'HealthBar';
    this.ctx = ctx;
    this.texture = texture;
    this.team = team;
    this.hideWhenFull = hideWhenFull;

    this.center.set(centerX, 0.5);
    this.scale.set(width, height, 1);
    this.position.set(0, yOffset, 0);
    this.homePosition.copy(this.position);
    this.renderOrder = 10;

    this.draw(1);
  }

  /** 按当前/最大生命更新显示 */
  setHp(current: number, max: number): void {
    const safeMax = Math.max(max, 1e-6);
    const ratio = THREE.MathUtils.clamp(current / safeMax, 0, 1);
    const alive = current > 0;
    const visible = alive && (!this.hideWhenFull || ratio < 1 - 1e-6);

    if (this.lastVisible !== visible) {
      this.visible = visible;
      this.lastVisible = visible;
    }

    if (!visible) return;

    if (Math.abs(ratio - this.lastRatio) < 1e-4) return;
    this.draw(ratio);
  }

  /**
   * 父物体在镜头内时，把血条投影夹到安全边距内，尽量完整出现在画面中。
   * 应在相机位姿更新之后、渲染之前调用。
   */
  updateViewportFit(camera: THREE.Camera): void {
    if (!this.visible) {
      this.position.copy(this.homePosition);
      return;
    }
    const parent = this.parent;
    if (!parent) {
      this.position.copy(this.homePosition);
      return;
    }

    parent.updateWorldMatrix(true, false);
    parent.getWorldPosition(HealthBar._parentWorld);
    HealthBar._local.copy(this.homePosition);
    parent.localToWorld(HealthBar._homeWorld.copy(HealthBar._local));

    // 父物体（脚底 + 理想血条位）任一点靠近视口 → 视为「镜头包含该建筑」
    if (
      !HealthBar.isNearViewport(HealthBar._parentWorld, camera) &&
      !HealthBar.isNearViewport(HealthBar._homeWorld, camera)
    ) {
      this.position.copy(this.homePosition);
      return;
    }

    // 理想血条中心 NDC；在相机后或过远裁剪外则不贴合
    HealthBar._ndc.copy(HealthBar._homeWorld).project(camera);
    if (
      !Number.isFinite(HealthBar._ndc.x) ||
      !Number.isFinite(HealthBar._ndc.y) ||
      HealthBar._ndc.z < -1 ||
      HealthBar._ndc.z > 1
    ) {
      this.position.copy(this.homePosition);
      return;
    }

    const centerNdcX = HealthBar._ndc.x;
    const centerNdcY = HealthBar._ndc.y;
    const centerNdcZ = HealthBar._ndc.z;

    // 相机 right / up（Sprite 朝向相机，半宽高沿这两轴）
    camera.matrixWorld.extractBasis(
      HealthBar._camRight,
      HealthBar._camUp,
      HealthBar._probe,
    );
    parent.getWorldScale(HealthBar._worldScale);
    const worldW = Math.abs(this.scale.x * HealthBar._worldScale.x);
    const worldH = Math.abs(this.scale.y * HealthBar._worldScale.y);
    // center 锚点：向左/下延伸 center 比例，向右/上延伸 (1-center)
    const leftW = worldW * this.center.x;
    const rightW = worldW * (1 - this.center.x);
    const downH = worldH * this.center.y;
    const upH = worldH * (1 - this.center.y);

    // 探测 NDC 半宽/半高（取边缘投影与中心差）
    const ndcLeft = HealthBar.edgeNdcDelta(
      HealthBar._homeWorld,
      HealthBar._camRight,
      -leftW,
      camera,
      centerNdcX,
      centerNdcY,
      'x',
    );
    const ndcRight = HealthBar.edgeNdcDelta(
      HealthBar._homeWorld,
      HealthBar._camRight,
      rightW,
      camera,
      centerNdcX,
      centerNdcY,
      'x',
    );
    const ndcDown = HealthBar.edgeNdcDelta(
      HealthBar._homeWorld,
      HealthBar._camUp,
      -downH,
      camera,
      centerNdcX,
      centerNdcY,
      'y',
    );
    const ndcUp = HealthBar.edgeNdcDelta(
      HealthBar._homeWorld,
      HealthBar._camUp,
      upH,
      camera,
      centerNdcX,
      centerNdcY,
      'y',
    );

    const margin = HealthBar.VIEW_MARGIN_NDC;
    const minX = -1 + margin + ndcLeft;
    const maxX = 1 - margin - ndcRight;
    const minY = -1 + margin + ndcDown;
    const maxY = 1 - margin - ndcUp;

    // 安全区退化（血条比屏还大）时仍尽量贴中心
    const clampX =
      minX <= maxX
        ? THREE.MathUtils.clamp(centerNdcX, minX, maxX)
        : 0;
    const clampY =
      minY <= maxY
        ? THREE.MathUtils.clamp(centerNdcY, minY, maxY)
        : 0;

    if (
      Math.abs(clampX - centerNdcX) < 1e-5 &&
      Math.abs(clampY - centerNdcY) < 1e-5
    ) {
      this.position.copy(this.homePosition);
      return;
    }

    // 同深度 unproject → 目标世界坐标
    HealthBar._targetWorld
      .set(clampX, clampY, centerNdcZ)
      .unproject(camera);

    HealthBar._offsetWorld
      .subVectors(HealthBar._targetWorld, HealthBar._homeWorld);
    const maxOff = HealthBar.MAX_FIT_OFFSET_WORLD;
    const offLen = HealthBar._offsetWorld.length();
    if (offLen > maxOff && offLen > 1e-8) {
      HealthBar._offsetWorld.multiplyScalar(maxOff / offLen);
    }

    HealthBar._targetWorld
      .copy(HealthBar._homeWorld)
      .add(HealthBar._offsetWorld);
    parent.worldToLocal(HealthBar._targetWorld);
    this.position.copy(HealthBar._targetWorld);
  }

  /** 恢复理想头顶位（隐藏/销毁时调用） */
  resetViewportFit(): void {
    this.position.copy(this.homePosition);
  }

  dispose(): void {
    this.texture.dispose();
    (this.material as THREE.SpriteMaterial).dispose();
  }

  private static isNearViewport(
    worldPos: THREE.Vector3,
    camera: THREE.Camera,
  ): boolean {
    HealthBar._ndc.copy(worldPos).project(camera);
    if (
      !Number.isFinite(HealthBar._ndc.x) ||
      !Number.isFinite(HealthBar._ndc.y) ||
      HealthBar._ndc.z < -1 ||
      HealthBar._ndc.z > 1
    ) {
      return false;
    }
    const pad = HealthBar.STRUCTURE_IN_VIEW_PAD;
    return (
      HealthBar._ndc.x >= -1 - pad &&
      HealthBar._ndc.x <= 1 + pad &&
      HealthBar._ndc.y >= -1 - pad &&
      HealthBar._ndc.y <= 1 + pad
    );
  }

  /**
   * 从中心沿 camera 轴偏移 worldOffset 后投影，返回该轴上相对中心的 NDC 正距离。
   */
  private static edgeNdcDelta(
    centerWorld: THREE.Vector3,
    axis: THREE.Vector3,
    worldOffset: number,
    camera: THREE.Camera,
    centerNdcX: number,
    centerNdcY: number,
    axisKey: 'x' | 'y',
  ): number {
    if (Math.abs(worldOffset) < 1e-8) return 0;
    HealthBar._probe
      .copy(centerWorld)
      .addScaledVector(axis, worldOffset)
      .project(camera);
    const delta =
      axisKey === 'x'
        ? HealthBar._probe.x - centerNdcX
        : HealthBar._probe.y - centerNdcY;
    // 取与偏移同号侧的幅度；异常时给一个小默认，避免 clamp 区间反转
    return Math.max(Math.abs(delta), 0.01);
  }

  private draw(ratio: number): void {
    this.lastRatio = ratio;
    const w = HealthBar.CANVAS_W;
    const h = HealthBar.CANVAS_H;
    const b = HealthBar.BORDER;
    const ctx = this.ctx;

    ctx.clearRect(0, 0, w, h);

    // 1. 深色精致外框底座 (圆角 5px)
    this.roundRect(0, 0, w, h, 5);
    ctx.fillStyle = '#090d16';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 2. 内部暗色背景槽
    const innerW = w - b * 2;
    const innerH = h - b * 2;
    this.roundRect(b, b, innerW, innerH, 3);
    ctx.fillStyle = '#111827';
    ctx.fill();

    // 3. 血量填充渐变
    const fillW = Math.max(0, Math.round(innerW * ratio));
    if (fillW > 0) {
      this.roundRect(b, b, fillW, innerH, 2.5);
      const grad = ctx.createLinearGradient(b, b, b, b + innerH);

      if (ratio <= 0.2) {
        grad.addColorStop(0, '#f87171');
        grad.addColorStop(1, '#991b1b');
      } else if (ratio <= 0.4) {
        grad.addColorStop(0, '#fbbf24');
        grad.addColorStop(1, '#b45309');
      } else if (this.team === 'blue') {
        grad.addColorStop(0, '#4ade80');
        grad.addColorStop(1, '#16a34a');
      } else {
        grad.addColorStop(0, '#f43f5e');
        grad.addColorStop(1, '#be123c');
      }
      ctx.fillStyle = grad;
      ctx.fill();

      // 4. 顶部镜面高光 (Specular Highlight)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.32)';
      ctx.fillRect(b, b, fillW, Math.max(1, innerH * 0.35));
    }

    // 5. 每 10% 血量细刻度刻印线
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 10; i += 1) {
      const x = b + (innerW * i) / 10;
      ctx.beginPath();
      ctx.moveTo(x, b);
      ctx.lineTo(x, b + innerH);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    for (let i = 1; i < 10; i += 1) {
      const x = b + (innerW * i) / 10 + 1;
      ctx.beginPath();
      ctx.moveTo(x, b);
      ctx.lineTo(x, b + innerH);
      ctx.stroke();
    }

    this.texture.needsUpdate = true;
  }

  private roundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void {
    const ctx = this.ctx;
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }
}
