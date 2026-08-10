import {
  Color3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  type Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core';

/**
 * 脚底红色复杂环形 buff：贴地魔法阵 + 缓慢自转。
 * 以宿主 root 为父节点，随角色位移；本地尺寸会再乘 root.scaling。
 */
export class FootRingBuff {
  /** 世界空间直径（米）；内部按宿主 scale 反算本地尺寸 */
  static readonly WORLD_DIAMETER = 1.7;
  /** 略抬离地面，避免 z-fighting */
  static readonly Y_OFFSET = 0.012;
  /** 自转角速度（弧度/秒） */
  static readonly SPIN_SPEED = 0.55;
  /** 内环反向自转 */
  static readonly INNER_SPIN_SPEED = -0.9;

  readonly root: TransformNode;
  private readonly outer: Mesh;
  private readonly inner: Mesh;

  constructor(scene: Scene, hostRoot: TransformNode) {
    this.root = new TransformNode('FootRingBuff', scene);
    this.root.parent = hostRoot;
    this.root.position = new Vector3(0, FootRingBuff.Y_OFFSET, 0);
    // 抵消宿主缩放，保持世界直径稳定；同时不继承宿主 yaw（阵纹贴地固定朝向感）
    const s = Math.max(hostRoot.scaling.x, 1e-6);
    const inv = 1 / s;
    this.root.scaling = new Vector3(inv, inv, inv);

    const size = FootRingBuff.WORLD_DIAMETER;
    const outerTex = paintRingTexture(scene, 'footRingOuter', size, false);
    const innerTex = paintRingTexture(scene, 'footRingInner', size * 0.72, true);

    this.outer = makeDisc(scene, 'footRingOuterMesh', size, outerTex);
    this.outer.parent = this.root;

    this.inner = makeDisc(scene, 'footRingInnerMesh', size * 0.72, innerTex);
    this.inner.parent = this.root;
    this.inner.position.y = 0.002;
  }

  /** 每帧更新：双层反向旋转 */
  update(dt: number): void {
    this.outer.rotation.y += FootRingBuff.SPIN_SPEED * dt;
    this.inner.rotation.y += FootRingBuff.INNER_SPIN_SPEED * dt;
    // 抵消宿主 yaw，让纹路相对地面更稳定（外圈仍自转）
    const parent = this.root.parent as TransformNode | null;
    if (parent) {
      this.root.rotation.y = -parent.rotation.y;
    }
  }
}

function makeDisc(
  scene: Scene,
  name: string,
  diameter: number,
  texture: DynamicTexture,
): Mesh {
  const disc = MeshBuilder.CreateGround(
    name,
    { width: diameter, height: diameter, subdivisions: 1 },
    scene,
  );
  disc.isPickable = false;

  const mat = new StandardMaterial(`${name}Mat`, scene);
  mat.diffuseTexture = texture;
  mat.opacityTexture = texture;
  mat.emissiveTexture = texture;
  mat.emissiveColor = new Color3(1, 0.15, 0.12);
  mat.diffuseColor = new Color3(1, 0.2, 0.15);
  mat.specularColor = Color3.Black();
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  mat.useAlphaFromDiffuseTexture = true;
  mat.transparencyMode = StandardMaterial.MATERIAL_ALPHABLEND;
  // 透明贴花：少写深度，减少与地板穿插闪烁
  mat.forceDepthWrite = false;
  disc.material = mat;
  return disc;
}

/**
 * 绘制复杂红色环形纹路（同心环 + 分段弧 + 放射刻度 + 内多边形）。
 * @param accent 内层纹理：更密的符文感刻线
 */
function paintRingTexture(
  scene: Scene,
  name: string,
  _worldSize: number,
  accent: boolean,
): DynamicTexture {
  const res = 512;
  const tex = new DynamicTexture(name, { width: res, height: res }, scene, true);
  tex.hasAlpha = true;
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const cx = res / 2;
  const cy = res / 2;
  const R = res * 0.48;

  ctx.clearRect(0, 0, res, res);

  // 外缘柔光晕
  const glow = ctx.createRadialGradient(cx, cy, R * 0.55, cx, cy, R);
  glow.addColorStop(0, 'rgba(255, 40, 40, 0)');
  glow.addColorStop(0.72, 'rgba(220, 20, 30, 0.08)');
  glow.addColorStop(0.9, 'rgba(255, 50, 40, 0.35)');
  glow.addColorStop(1, 'rgba(120, 0, 0, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();

  const stroke = (
    radius: number,
    width: number,
    alpha: number,
    dash?: number[],
  ): void => {
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 56, 48, ${alpha})`;
    ctx.lineWidth = width;
    ctx.setLineDash(dash ?? []);
    ctx.stroke();
    ctx.setLineDash([]);
  };

  // 多层同心环
  stroke(R * 0.98, 3.2, 0.95);
  stroke(R * 0.92, 1.4, 0.7, [6, 5]);
  stroke(R * 0.84, 2.2, 0.85);
  stroke(R * 0.76, 1.1, 0.55, [2, 6]);
  stroke(R * 0.62, 2.6, 0.9);
  stroke(R * 0.48, 1.3, 0.65, [10, 4, 2, 4]);
  stroke(R * 0.34, 2.0, 0.8);
  if (accent) {
    stroke(R * 0.22, 1.2, 0.75, [3, 3]);
    stroke(R * 0.12, 1.8, 0.9);
  }

  // 分段粗弧（罗盘感）
  const arcCount = accent ? 12 : 8;
  for (let i = 0; i < arcCount; i++) {
    const a0 = (i / arcCount) * Math.PI * 2 + 0.08;
    const a1 = a0 + (Math.PI * 2) / arcCount - 0.2;
    ctx.beginPath();
    ctx.arc(cx, cy, R * (accent ? 0.7 : 0.88), a0, a1);
    ctx.strokeStyle = `rgba(255, 70, 55, ${0.55 + (i % 2) * 0.25})`;
    ctx.lineWidth = accent ? 2.4 : 3.5;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  // 放射刻度 + 菱形节点
  const ticks = accent ? 36 : 24;
  for (let i = 0; i < ticks; i++) {
    const a = (i / ticks) * Math.PI * 2;
    const major = i % 3 === 0;
    const r0 = R * (major ? 0.58 : 0.64);
    const r1 = R * (major ? 0.96 : 0.9);
    const x0 = cx + Math.cos(a) * r0;
    const y0 = cy + Math.sin(a) * r0;
    const x1 = cx + Math.cos(a) * r1;
    const y1 = cy + Math.sin(a) * r1;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.strokeStyle = major
      ? 'rgba(255, 90, 70, 0.85)'
      : 'rgba(255, 50, 45, 0.4)';
    ctx.lineWidth = major ? 2 : 1;
    ctx.stroke();

    if (major) {
      // 外缘菱形装饰
      const rx = cx + Math.cos(a) * R * 0.98;
      const ry = cy + Math.sin(a) * R * 0.98;
      const d = 5;
      ctx.beginPath();
      ctx.moveTo(rx + Math.cos(a) * d, ry + Math.sin(a) * d);
      ctx.lineTo(rx + Math.cos(a + Math.PI / 2) * d * 0.6, ry + Math.sin(a + Math.PI / 2) * d * 0.6);
      ctx.lineTo(rx - Math.cos(a) * d, ry - Math.sin(a) * d);
      ctx.lineTo(rx + Math.cos(a - Math.PI / 2) * d * 0.6, ry + Math.sin(a - Math.PI / 2) * d * 0.6);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255, 80, 60, 0.85)';
      ctx.fill();
    }
  }

  // 内多边形
  const sides = accent ? 8 : 6;
  const polyR = R * (accent ? 0.4 : 0.5);
  ctx.beginPath();
  for (let i = 0; i <= sides; i++) {
    const a = (i / sides) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(a) * polyR;
    const y = cy + Math.sin(a) * polyR;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = 'rgba(255, 70, 55, 0.9)';
  ctx.lineWidth = 2.2;
  ctx.stroke();

  // 内多边形对角连线
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2 - Math.PI / 2;
    const a1 = ((i + Math.floor(sides / 2)) / sides) * Math.PI * 2 - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a0) * polyR * 0.92, cy + Math.sin(a0) * polyR * 0.92);
    ctx.lineTo(cx + Math.cos(a1) * polyR * 0.92, cy + Math.sin(a1) * polyR * 0.92);
    ctx.strokeStyle = 'rgba(255, 40, 40, 0.22)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // 中心核
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.14);
  core.addColorStop(0, 'rgba(255, 180, 160, 0.55)');
  core.addColorStop(0.45, 'rgba(255, 50, 40, 0.35)');
  core.addColorStop(1, 'rgba(180, 0, 0, 0)');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.14, 0, Math.PI * 2);
  ctx.fill();

  // 小符文点环
  const dots = accent ? 16 : 12;
  for (let i = 0; i < dots; i++) {
    const a = (i / dots) * Math.PI * 2 + 0.12;
    const rr = R * (accent ? 0.28 : 0.42);
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    ctx.beginPath();
    ctx.arc(x, y, accent ? 2.4 : 3.2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 100, 80, 0.9)';
    ctx.fill();
  }

  tex.update();
  return tex;
}
