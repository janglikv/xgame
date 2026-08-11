import {
  Color3,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
  Vector3,
  type Scene,
} from '@babylonjs/core';

/**
 * 贴地黄色发光范围圈：画在目标脚下地板上。
 * 仅在距离不足并按 E/R 时短暂显示。
 * 使用实体管状环 + 深度测试，可被角色/地形遮挡（非后处理 glow，避免穿模发光）。
 */
export class RangeRing {
  /** 默认交互半径（世界单位 / 米） */
  static readonly DEFAULT_RADIUS = 1.35;

  readonly root: TransformNode;
  private readonly tube: Mesh;
  private readonly mat: StandardMaterial;
  private readonly radius: number;
  /** 显示剩余时间（秒）；>0 才可见 */
  private showLeft = 0;

  constructor(scene: Scene, radius = RangeRing.DEFAULT_RADIUS) {
    this.radius = Math.max(0.2, radius);
    this.root = new TransformNode('RangeRing', scene);
    // 略高于地板，避免与地面 z-fighting
    this.root.position.y = 0.028;

    // 闭合圆环路径 → 管状细环（比 Lines 粗、可发光，且走正常深度）
    const segs = 64;
    const path: Vector3[] = [];
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      path.push(
        new Vector3(Math.cos(a) * this.radius, 0, Math.sin(a) * this.radius),
      );
    }

    this.tube = MeshBuilder.CreateTube(
      'RangeRingTube',
      {
        path,
        // 略粗于细线，仍保持圈形清晰
        radius: 0.028,
        tessellation: 8,
        cap: Mesh.NO_CAP,
      },
      scene,
    );
    this.tube.parent = this.root;
    this.tube.isPickable = false;
    this.tube.receiveShadows = false;
    // 默认 renderingGroupId=0，参与场景深度，可被遮挡
    this.tube.renderingGroupId = 0;

    this.mat = new StandardMaterial('RangeRingMat', scene);
    // 黄圈 + 自发光（不走 GlowLayer，避免穿墙发亮）
    this.mat.diffuseColor = new Color3(1, 0.82, 0.15);
    this.mat.emissiveColor = new Color3(1.0, 0.75, 0.12);
    this.mat.specularColor = Color3.Black();
    this.mat.disableLighting = true;
    this.mat.alpha = 0.95;
    this.mat.transparencyMode = StandardMaterial.MATERIAL_ALPHABLEND;
    // 允许被遮挡：写深度、测深度
    this.mat.forceDepthWrite = true;
    this.mat.backFaceCulling = true;
    this.tube.material = this.mat;
    // 显式开启深度检测（默认 true，写明意图）
    this.tube.material.needDepthPrePass = false;

    this.root.setEnabled(false);
  }

  getRadius(): number {
    return this.radius;
  }

  /** 立刻挪到目标脚底（世界 x/z） */
  setPosition(pos: { x: number; z: number }): void {
    this.root.position.x = pos.x;
    this.root.position.z = pos.z;
  }

  /**
   * 距离不足按 E/R 时在目标脚下显示黄圈。
   */
  show(pos: { x: number; z: number }, duration = 0.75): void {
    this.setPosition(pos);
    this.showLeft = Math.max(this.showLeft, duration);
    this.root.setEnabled(true);
    this.mat.alpha = 0.95;
    this.mat.emissiveColor.set(1.0, 0.78, 0.14);
  }

  update(dt: number): void {
    if (this.showLeft <= 0) return;

    this.showLeft = Math.max(0, this.showLeft - dt);
    if (this.showLeft <= 0) {
      this.root.setEnabled(false);
      this.mat.alpha = 0.95;
      return;
    }

    // 轻微呼吸发光 + 尾段淡出
    const fade = Math.min(1, this.showLeft / 0.22);
    const breath = 0.5 + 0.5 * Math.sin(performance.now() * 0.01);
    this.mat.alpha = (0.55 + 0.4 * fade) * (0.88 + 0.12 * breath);
    const em = 0.75 + 0.25 * breath;
    this.mat.emissiveColor.set(em, 0.55 + 0.2 * breath, 0.08 + 0.06 * breath);
  }

  dispose(): void {
    this.tube.dispose();
    this.mat.dispose();
    this.root.dispose();
  }
}
