import {
  Color3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
  type Scene,
  type Vector3,
} from '@babylonjs/core';

/**
 * 贴地红色范围圈：画在目标脚下地板上，提示「需靠近到此圈内才能交互」。
 * 圈半径 = 交互距离；不挂在主角身上。
 */
export class RangeRing {
  /** 默认交互半径（世界单位 / 米）— 略紧，需贴近目标 */
  static readonly DEFAULT_RADIUS = 1.35;

  readonly root: TransformNode;
  private readonly disc: Mesh;
  private readonly mat: StandardMaterial;
  private readonly radius: number;
  private visible = false;
  /** 按键距离不足时的强调剩余时间（秒） */
  private pulseLeft = 0;

  constructor(scene: Scene, radius = RangeRing.DEFAULT_RADIUS) {
    this.radius = Math.max(0.2, radius);
    this.root = new TransformNode('RangeRing', scene);
    // 略高于地板，避免 z-fighting
    this.root.position.y = 0.018;

    const dia = this.radius * 2;
    this.disc = MeshBuilder.CreateGround(
      'RangeRingDisc',
      { width: dia, height: dia, subdivisions: 1 },
      scene,
    );
    this.disc.parent = this.root;
    this.disc.isPickable = false;
    this.disc.receiveShadows = false;

    const tex = paintRingTexture(scene, 'RangeRingTex', 256);
    this.mat = new StandardMaterial('RangeRingMat', scene);
    this.mat.diffuseTexture = tex;
    this.mat.opacityTexture = tex;
    this.mat.emissiveTexture = tex;
    this.mat.emissiveColor = new Color3(1, 0.15, 0.1);
    this.mat.diffuseColor = new Color3(1, 0.2, 0.15);
    this.mat.specularColor = Color3.Black();
    this.mat.disableLighting = true;
    this.mat.useAlphaFromDiffuseTexture = true;
    this.mat.transparencyMode = StandardMaterial.MATERIAL_ALPHABLEND;
    this.mat.backFaceCulling = false;
    this.mat.forceDepthWrite = false;
    this.disc.material = this.mat;

    this.root.setEnabled(false);
  }

  getRadius(): number {
    return this.radius;
  }

  /** 立刻挪到目标脚底（世界 x/z） */
  setPosition(pos: Vector3): void {
    this.root.position.x = pos.x;
    this.root.position.z = pos.z;
  }

  setVisible(on: boolean): void {
    this.visible = on;
    this.root.setEnabled(on || this.pulseLeft > 0);
  }

  /** 距离不足按 E/R 时短暂加亮 */
  pulse(duration = 0.55): void {
    this.pulseLeft = Math.max(this.pulseLeft, duration);
    this.root.setEnabled(true);
  }

  /**
   * @param targetPos 目标脚底世界坐标（只用 x/z）；null 则只做动画不挪位
   */
  update(dt: number, targetPos: Vector3 | null): void {
    if (targetPos) {
      this.setPosition(targetPos);
    }

    if (this.pulseLeft > 0) {
      this.pulseLeft = Math.max(0, this.pulseLeft - dt);
      if (this.pulseLeft <= 0 && !this.visible) {
        this.root.setEnabled(false);
      }
    }

    if (!this.root.isEnabled()) return;

    const pulseT = this.pulseLeft > 0 ? Math.min(1, this.pulseLeft / 0.35) : 0;
    const breath = 0.5 + 0.5 * Math.sin(performance.now() * 0.006);
    this.mat.alpha = 0.75 + 0.15 * breath + 0.2 * pulseT;
    const em = 0.7 + 0.3 * pulseT + 0.1 * breath;
    this.mat.emissiveColor.set(em, 0.12 + 0.06 * pulseT, 0.08);
    const s = 1 + 0.05 * pulseT;
    this.disc.scaling.set(s, 1, s);
  }

  dispose(): void {
    this.disc.dispose();
    this.mat.dispose();
    this.root.dispose();
  }
}

/** 画圆环：外沿亮红、内透明，贴在 CreateGround 上 */
function paintRingTexture(
  scene: Scene,
  name: string,
  res: number,
): DynamicTexture {
  const tex = new DynamicTexture(name, { width: res, height: res }, scene, false);
  tex.hasAlpha = true;
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const cx = res / 2;
  const cy = res / 2;
  const outer = res * 0.48;
  const inner = res * 0.4;

  ctx.clearRect(0, 0, res, res);

  // 外环主体
  ctx.beginPath();
  ctx.arc(cx, cy, outer, 0, Math.PI * 2);
  ctx.arc(cx, cy, inner, 0, Math.PI * 2, true);
  ctx.closePath();
  const grad = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
  grad.addColorStop(0, 'rgba(255, 40, 30, 0.15)');
  grad.addColorStop(0.35, 'rgba(255, 50, 40, 0.75)');
  grad.addColorStop(0.75, 'rgba(220, 20, 20, 0.95)');
  grad.addColorStop(1, 'rgba(120, 0, 0, 0.35)');
  ctx.fillStyle = grad;
  ctx.fill();

  // 内侧亮边
  ctx.beginPath();
  ctx.arc(cx, cy, inner + 1.5, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255, 120, 100, 0.9)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // 外侧描边
  ctx.beginPath();
  ctx.arc(cx, cy, outer - 1, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(180, 0, 0, 0.85)';
  ctx.lineWidth = 2;
  ctx.stroke();

  tex.update();
  return tex;
}
