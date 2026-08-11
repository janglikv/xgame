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

/** 脚底阵法样式（贴地魔法阵） */
export type FormationStyle =
  | 'crimson' // 赤环：双层红环 + 刻度
  | 'azure' // 青符：冰晶六角 + 符文点
  | 'emerald' // 翠螺：螺旋藤蔓环
  | 'violet' // 紫星：五芒星封印
  | 'solar' // 日印：齿轮日轮
  | 'void' // 虚裂：暗隙裂痕
  | 'triad'; // 三元：三角嵌套 + 轨道

export const FORMATION_STYLES: readonly FormationStyle[] = [
  'crimson',
  'azure',
  'emerald',
  'violet',
  'solar',
  'void',
  'triad',
] as const;

export const FORMATION_LABELS: Record<FormationStyle, string> = {
  crimson: '赤环',
  azure: '青符',
  emerald: '翠螺',
  violet: '紫星',
  solar: '日印',
  void: '虚裂',
  triad: '三元',
};

type LayerPaint = (ctx: CanvasRenderingContext2D, res: number) => void;

interface LayerDef {
  /** 相对 WORLD_DIAMETER 的尺寸比 */
  sizeScale: number;
  y: number;
  spin: number;
  paint: LayerPaint;
}

interface StyleDef {
  diameter: number;
  emissive: Color3;
  diffuse: Color3;
  layers: LayerDef[];
  /** 整体呼吸脉冲幅度（0 = 无） */
  pulse?: number;
}

/**
 * 脚底魔法阵 buff：多样式、多层贴地纹理 + 差速自转。
 * 以宿主 root 为父节点，随角色位移；本地尺寸会再乘 root.scaling。
 */
export class FootRingBuff {
  /** 默认世界空间直径（米） */
  static readonly WORLD_DIAMETER = 1.7;
  static readonly Y_OFFSET = 0.012;

  readonly root: TransformNode;
  readonly style: FormationStyle;
  private readonly layers: { mesh: Mesh; spin: number }[] = [];
  private baseScale: number;
  private readonly pulse: number;
  private age = 0;

  constructor(
    scene: Scene,
    hostRoot: TransformNode,
    style: FormationStyle = 'crimson',
  ) {
    this.style = style;
    const def = STYLE_DEFS[style];

    this.root = new TransformNode(`Formation_${style}`, scene);
    this.root.parent = hostRoot;
    this.root.position = new Vector3(0, FootRingBuff.Y_OFFSET, 0);
    // 抵消宿主缩放，保持世界直径稳定
    const s = Math.max(hostRoot.scaling.x, 1e-6);
    this.baseScale = 1 / s;
    this.root.scaling = new Vector3(this.baseScale, this.baseScale, this.baseScale);
    this.pulse = def.pulse ?? 0;

    const size = def.diameter;
    def.layers.forEach((layer, i) => {
      const dia = size * layer.sizeScale;
      const tex = paintToTexture(scene, `form_${style}_${i}`, layer.paint);
      const mesh = makeDisc(
        scene,
        `form_${style}_mesh_${i}`,
        dia,
        tex,
        def.emissive,
        def.diffuse,
      );
      mesh.parent = this.root;
      mesh.position.y = layer.y;
      this.layers.push({ mesh, spin: layer.spin });
    });
  }

  /** 宿主 root.scaling 变化后调用，保持世界直径 */
  refreshHostScale(): void {
    const parent = this.root.parent as TransformNode | null;
    if (!parent) return;
    const s = Math.max(parent.scaling.x, 1e-6);
    this.baseScale = 1 / s;
    this.root.scaling.setAll(this.baseScale);
  }

  /** 每帧：差速旋转 + 可选呼吸 + 抵消宿主 yaw */
  update(dt: number): void {
    this.age += dt;
    for (const layer of this.layers) {
      layer.mesh.rotation.y += layer.spin * dt;
    }
    if (this.pulse > 0) {
      const k = 1 + Math.sin(this.age * 2.2) * this.pulse;
      this.root.scaling.setAll(this.baseScale * k);
    }
    const parent = this.root.parent as TransformNode | null;
    if (parent) {
      this.root.rotation.y = -parent.rotation.y;
    }
  }

  dispose(): void {
    for (const layer of this.layers) {
      layer.mesh.dispose();
    }
    this.layers.length = 0;
    this.root.dispose();
  }
}

// ─── 样式表 ───────────────────────────────────────────────

const STYLE_DEFS: Record<FormationStyle, StyleDef> = {
  crimson: {
    diameter: 1.7,
    emissive: new Color3(1, 0.15, 0.12),
    diffuse: new Color3(1, 0.2, 0.15),
    layers: [
      {
        sizeScale: 1,
        y: 0,
        spin: 0.55,
        paint: (ctx, res) => paintCrimson(ctx, res, false),
      },
      {
        sizeScale: 0.72,
        y: 0.002,
        spin: -0.9,
        paint: (ctx, res) => paintCrimson(ctx, res, true),
      },
    ],
  },
  azure: {
    diameter: 1.75,
    emissive: new Color3(0.25, 0.65, 1),
    diffuse: new Color3(0.35, 0.75, 1),
    layers: [
      {
        sizeScale: 1,
        y: 0,
        spin: 0.35,
        paint: (ctx, res) => paintAzure(ctx, res, false),
      },
      {
        sizeScale: 0.62,
        y: 0.002,
        spin: -0.7,
        paint: (ctx, res) => paintAzure(ctx, res, true),
      },
    ],
  },
  emerald: {
    diameter: 1.8,
    emissive: new Color3(0.2, 0.95, 0.45),
    diffuse: new Color3(0.25, 0.9, 0.4),
    pulse: 0.03,
    layers: [
      {
        sizeScale: 1,
        y: 0,
        spin: 0.4,
        paint: (ctx, res) => paintEmerald(ctx, res, false),
      },
      {
        sizeScale: 0.68,
        y: 0.002,
        spin: 0.85,
        paint: (ctx, res) => paintEmerald(ctx, res, true),
      },
    ],
  },
  violet: {
    diameter: 1.72,
    emissive: new Color3(0.75, 0.25, 1),
    diffuse: new Color3(0.7, 0.3, 1),
    layers: [
      {
        sizeScale: 1,
        y: 0,
        spin: -0.3,
        paint: (ctx, res) => paintViolet(ctx, res, false),
      },
      {
        sizeScale: 0.78,
        y: 0.002,
        spin: 0.65,
        paint: (ctx, res) => paintViolet(ctx, res, true),
      },
    ],
  },
  solar: {
    diameter: 1.85,
    emissive: new Color3(1, 0.7, 0.15),
    diffuse: new Color3(1, 0.75, 0.2),
    pulse: 0.04,
    layers: [
      {
        sizeScale: 1,
        y: 0,
        spin: 0.25,
        paint: (ctx, res) => paintSolar(ctx, res, false),
      },
      {
        sizeScale: 0.55,
        y: 0.002,
        spin: -1.1,
        paint: (ctx, res) => paintSolar(ctx, res, true),
      },
    ],
  },
  void: {
    diameter: 1.78,
    emissive: new Color3(0.55, 0.15, 0.85),
    diffuse: new Color3(0.45, 0.12, 0.7),
    layers: [
      {
        sizeScale: 1,
        y: 0,
        spin: 0.2,
        paint: (ctx, res) => paintVoid(ctx, res, 0),
      },
      {
        sizeScale: 0.8,
        y: 0.002,
        spin: -0.55,
        paint: (ctx, res) => paintVoid(ctx, res, 1),
      },
      {
        sizeScale: 0.48,
        y: 0.004,
        spin: 1.2,
        paint: (ctx, res) => paintVoid(ctx, res, 2),
      },
    ],
  },
  triad: {
    diameter: 1.7,
    emissive: new Color3(0.2, 0.95, 0.95),
    diffuse: new Color3(0.25, 0.9, 0.9),
    layers: [
      {
        sizeScale: 1,
        y: 0,
        spin: 0.45,
        paint: (ctx, res) => paintTriad(ctx, res, false),
      },
      {
        sizeScale: 0.7,
        y: 0.002,
        spin: -0.75,
        paint: (ctx, res) => paintTriad(ctx, res, true),
      },
    ],
  },
};

// ─── 网格 / 纹理工具 ─────────────────────────────────────

function makeDisc(
  scene: Scene,
  name: string,
  diameter: number,
  texture: DynamicTexture,
  emissive: Color3,
  diffuse: Color3,
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
  mat.emissiveColor = emissive;
  mat.diffuseColor = diffuse;
  mat.specularColor = Color3.Black();
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  mat.useAlphaFromDiffuseTexture = true;
  mat.transparencyMode = StandardMaterial.MATERIAL_ALPHABLEND;
  mat.forceDepthWrite = false;
  disc.material = mat;
  return disc;
}

function paintToTexture(
  scene: Scene,
  name: string,
  paint: LayerPaint,
): DynamicTexture {
  const res = 512;
  const tex = new DynamicTexture(name, { width: res, height: res }, scene, true);
  tex.hasAlpha = true;
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, res, res);
  paint(ctx, res);
  tex.update();
  return tex;
}

function rgba(r: number, g: number, b: number, a: number): string {
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function strokeCircle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  width: number,
  color: string,
  dash?: number[],
): void {
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash ?? []);
  ctx.stroke();
  ctx.setLineDash([]);
}

function fillPoly(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  sides: number,
  rot: number,
  stroke: string,
  width: number,
  fill?: string,
): void {
  ctx.beginPath();
  for (let i = 0; i <= sides; i++) {
    const a = (i / sides) * Math.PI * 2 + rot;
    const x = cx + Math.cos(a) * radius;
    const y = cy + Math.sin(a) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.stroke();
}

function drawStar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  points: number,
  rot: number,
  stroke: string,
  width: number,
): void {
  ctx.beginPath();
  const n = points * 2;
  for (let i = 0; i <= n; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const a = (i / n) * Math.PI * 2 + rot;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.stroke();
}

// ─── 各风格绘制 ──────────────────────────────────────────

/** 赤环：多层同心环 + 放射刻度 + 内多边形（原红环加强） */
function paintCrimson(
  ctx: CanvasRenderingContext2D,
  res: number,
  accent: boolean,
): void {
  const cx = res / 2;
  const cy = res / 2;
  const R = res * 0.48;
  const c = (a: number) => rgba(255, 56, 48, a);

  const glow = ctx.createRadialGradient(cx, cy, R * 0.55, cx, cy, R);
  glow.addColorStop(0, rgba(255, 40, 40, 0));
  glow.addColorStop(0.72, rgba(220, 20, 30, 0.08));
  glow.addColorStop(0.9, rgba(255, 50, 40, 0.35));
  glow.addColorStop(1, rgba(120, 0, 0, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();

  strokeCircle(ctx, cx, cy, R * 0.98, 3.2, c(0.95));
  strokeCircle(ctx, cx, cy, R * 0.92, 1.4, c(0.7), [6, 5]);
  strokeCircle(ctx, cx, cy, R * 0.84, 2.2, c(0.85));
  strokeCircle(ctx, cx, cy, R * 0.76, 1.1, c(0.55), [2, 6]);
  strokeCircle(ctx, cx, cy, R * 0.62, 2.6, c(0.9));
  strokeCircle(ctx, cx, cy, R * 0.48, 1.3, c(0.65), [10, 4, 2, 4]);
  strokeCircle(ctx, cx, cy, R * 0.34, 2.0, c(0.8));
  if (accent) {
    strokeCircle(ctx, cx, cy, R * 0.22, 1.2, c(0.75), [3, 3]);
    strokeCircle(ctx, cx, cy, R * 0.12, 1.8, c(0.9));
  }

  const arcCount = accent ? 12 : 8;
  for (let i = 0; i < arcCount; i++) {
    const a0 = (i / arcCount) * Math.PI * 2 + 0.08;
    const a1 = a0 + (Math.PI * 2) / arcCount - 0.2;
    ctx.beginPath();
    ctx.arc(cx, cy, R * (accent ? 0.7 : 0.88), a0, a1);
    ctx.strokeStyle = rgba(255, 70, 55, 0.55 + (i % 2) * 0.25);
    ctx.lineWidth = accent ? 2.4 : 3.5;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  const ticks = accent ? 36 : 24;
  for (let i = 0; i < ticks; i++) {
    const a = (i / ticks) * Math.PI * 2;
    const major = i % 3 === 0;
    const r0 = R * (major ? 0.58 : 0.64);
    const r1 = R * (major ? 0.96 : 0.9);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    ctx.strokeStyle = major ? rgba(255, 90, 70, 0.85) : rgba(255, 50, 45, 0.4);
    ctx.lineWidth = major ? 2 : 1;
    ctx.stroke();
    if (major) {
      const rx = cx + Math.cos(a) * R * 0.98;
      const ry = cy + Math.sin(a) * R * 0.98;
      const d = 5;
      ctx.beginPath();
      ctx.moveTo(rx + Math.cos(a) * d, ry + Math.sin(a) * d);
      ctx.lineTo(
        rx + Math.cos(a + Math.PI / 2) * d * 0.6,
        ry + Math.sin(a + Math.PI / 2) * d * 0.6,
      );
      ctx.lineTo(rx - Math.cos(a) * d, ry - Math.sin(a) * d);
      ctx.lineTo(
        rx + Math.cos(a - Math.PI / 2) * d * 0.6,
        ry + Math.sin(a - Math.PI / 2) * d * 0.6,
      );
      ctx.closePath();
      ctx.fillStyle = rgba(255, 80, 60, 0.85);
      ctx.fill();
    }
  }

  const sides = accent ? 8 : 6;
  const polyR = R * (accent ? 0.4 : 0.5);
  fillPoly(ctx, cx, cy, polyR, sides, -Math.PI / 2, rgba(255, 70, 55, 0.9), 2.2);
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2 - Math.PI / 2;
    const a1 = ((i + Math.floor(sides / 2)) / sides) * Math.PI * 2 - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a0) * polyR * 0.92, cy + Math.sin(a0) * polyR * 0.92);
    ctx.lineTo(cx + Math.cos(a1) * polyR * 0.92, cy + Math.sin(a1) * polyR * 0.92);
    ctx.strokeStyle = rgba(255, 40, 40, 0.22);
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.14);
  core.addColorStop(0, rgba(255, 180, 160, 0.55));
  core.addColorStop(0.45, rgba(255, 50, 40, 0.35));
  core.addColorStop(1, rgba(180, 0, 0, 0));
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.14, 0, Math.PI * 2);
  ctx.fill();

  const dots = accent ? 16 : 12;
  for (let i = 0; i < dots; i++) {
    const a = (i / dots) * Math.PI * 2 + 0.12;
    const rr = R * (accent ? 0.28 : 0.42);
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, accent ? 2.4 : 3.2, 0, Math.PI * 2);
    ctx.fillStyle = rgba(255, 100, 80, 0.9);
    ctx.fill();
  }
}

/** 青符：冰晶六角 + 内嵌菱形符文 + 霜环 */
function paintAzure(
  ctx: CanvasRenderingContext2D,
  res: number,
  accent: boolean,
): void {
  const cx = res / 2;
  const cy = res / 2;
  const R = res * 0.48;
  const c = (a: number) => rgba(90, 180, 255, a);

  const glow = ctx.createRadialGradient(cx, cy, R * 0.4, cx, cy, R);
  glow.addColorStop(0, rgba(120, 200, 255, 0));
  glow.addColorStop(0.75, rgba(60, 160, 255, 0.12));
  glow.addColorStop(0.92, rgba(100, 200, 255, 0.4));
  glow.addColorStop(1, rgba(20, 80, 160, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();

  strokeCircle(ctx, cx, cy, R * 0.97, 2.8, c(0.9));
  strokeCircle(ctx, cx, cy, R * 0.88, 1.2, c(0.55), [4, 8]);
  strokeCircle(ctx, cx, cy, R * 0.55, 2.0, c(0.75));
  if (accent) strokeCircle(ctx, cx, cy, R * 0.22, 1.6, c(0.85));

  // 外六角 + 内六角
  fillPoly(ctx, cx, cy, R * 0.9, 6, 0, c(0.95), 2.4);
  fillPoly(ctx, cx, cy, R * 0.72, 6, Math.PI / 6, c(0.7), 1.6);
  fillPoly(ctx, cx, cy, R * (accent ? 0.38 : 0.48), 6, 0, c(0.85), 2.0);

  // 雪花放射线
  const rays = accent ? 12 : 6;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2 + (accent ? Math.PI / 12 : 0);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * R * 0.18, cy + Math.sin(a) * R * 0.18);
    ctx.lineTo(cx + Math.cos(a) * R * 0.95, cy + Math.sin(a) * R * 0.95);
    ctx.strokeStyle = rgba(140, 210, 255, accent ? 0.55 : 0.35);
    ctx.lineWidth = accent ? 1.4 : 2.2;
    ctx.stroke();
    // 分叉
    const mid = R * 0.62;
    const mx = cx + Math.cos(a) * mid;
    const my = cy + Math.sin(a) * mid;
    for (const sign of [-1, 1]) {
      const ba = a + sign * 0.45;
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.lineTo(mx + Math.cos(ba) * R * 0.12, my + Math.sin(ba) * R * 0.12);
      ctx.strokeStyle = rgba(160, 220, 255, 0.55);
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }

  // 符文小菱形环
  const gems = accent ? 12 : 6;
  for (let i = 0; i < gems; i++) {
    const a = (i / gems) * Math.PI * 2 + Math.PI / gems;
    const rr = R * (accent ? 0.3 : 0.58);
    const gx = cx + Math.cos(a) * rr;
    const gy = cy + Math.sin(a) * rr;
    const d = accent ? 4 : 6;
    ctx.beginPath();
    ctx.moveTo(gx, gy - d);
    ctx.lineTo(gx + d * 0.7, gy);
    ctx.lineTo(gx, gy + d);
    ctx.lineTo(gx - d * 0.7, gy);
    ctx.closePath();
    ctx.fillStyle = rgba(180, 230, 255, 0.85);
    ctx.fill();
  }

  // 中心冰核
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.12);
  core.addColorStop(0, rgba(230, 250, 255, 0.7));
  core.addColorStop(0.5, rgba(100, 190, 255, 0.4));
  core.addColorStop(1, rgba(40, 100, 200, 0));
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.12, 0, Math.PI * 2);
  ctx.fill();
}

/** 翠螺：阿基米德螺旋 + 叶状刻度 */
function paintEmerald(
  ctx: CanvasRenderingContext2D,
  res: number,
  accent: boolean,
): void {
  const cx = res / 2;
  const cy = res / 2;
  const R = res * 0.48;
  const c = (a: number) => rgba(60, 220, 110, a);

  const glow = ctx.createRadialGradient(cx, cy, R * 0.5, cx, cy, R);
  glow.addColorStop(0, rgba(40, 200, 80, 0));
  glow.addColorStop(0.8, rgba(40, 180, 80, 0.1));
  glow.addColorStop(0.94, rgba(80, 240, 120, 0.38));
  glow.addColorStop(1, rgba(0, 80, 30, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();

  strokeCircle(ctx, cx, cy, R * 0.98, 2.5, c(0.85));
  strokeCircle(ctx, cx, cy, R * 0.7, 1.4, c(0.5), [8, 6]);
  strokeCircle(ctx, cx, cy, R * 0.4, 1.8, c(0.7));

  // 双螺旋
  const turns = accent ? 3.2 : 2.4;
  const steps = 180;
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = t * Math.PI * 2 * turns;
    const r = R * (0.08 + t * 0.88);
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = rgba(90, 255, 140, 0.9);
  ctx.lineWidth = accent ? 2.2 : 2.8;
  ctx.lineCap = 'round';
  ctx.stroke();

  // 反向细螺旋
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = -t * Math.PI * 2 * turns + Math.PI;
    const r = R * (0.1 + t * 0.82);
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = rgba(40, 180, 90, 0.45);
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // 叶尖装饰
  const leaves = accent ? 10 : 8;
  for (let i = 0; i < leaves; i++) {
    const a = (i / leaves) * Math.PI * 2;
    const r0 = R * 0.78;
    const r1 = R * 0.96;
    const x0 = cx + Math.cos(a) * r0;
    const y0 = cy + Math.sin(a) * r0;
    const x1 = cx + Math.cos(a) * r1;
    const y1 = cy + Math.sin(a) * r1;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(
      cx + Math.cos(a + 0.15) * ((r0 + r1) / 2),
      cy + Math.sin(a + 0.15) * ((r0 + r1) / 2),
      x1,
      y1,
    );
    ctx.quadraticCurveTo(
      cx + Math.cos(a - 0.15) * ((r0 + r1) / 2),
      cy + Math.sin(a - 0.15) * ((r0 + r1) / 2),
      x0,
      y0,
    );
    ctx.fillStyle = rgba(70, 230, 120, 0.55);
    ctx.fill();
  }

  // 内三角叶
  if (accent) {
    fillPoly(ctx, cx, cy, R * 0.28, 3, -Math.PI / 2, c(0.9), 2.0);
    fillPoly(ctx, cx, cy, R * 0.16, 3, Math.PI / 6, c(0.7), 1.4);
  }

  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.1);
  core.addColorStop(0, rgba(200, 255, 200, 0.65));
  core.addColorStop(1, rgba(20, 120, 40, 0));
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.1, 0, Math.PI * 2);
  ctx.fill();
}

/** 紫星：五芒星 + 双环封印 + 符文点 */
function paintViolet(
  ctx: CanvasRenderingContext2D,
  res: number,
  accent: boolean,
): void {
  const cx = res / 2;
  const cy = res / 2;
  const R = res * 0.48;
  const c = (a: number) => rgba(190, 90, 255, a);

  const glow = ctx.createRadialGradient(cx, cy, R * 0.45, cx, cy, R);
  glow.addColorStop(0, rgba(160, 40, 255, 0));
  glow.addColorStop(0.78, rgba(140, 40, 220, 0.12));
  glow.addColorStop(0.93, rgba(200, 100, 255, 0.42));
  glow.addColorStop(1, rgba(60, 0, 100, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();

  strokeCircle(ctx, cx, cy, R * 0.98, 3.0, c(0.92));
  strokeCircle(ctx, cx, cy, R * 0.9, 1.3, c(0.55), [3, 5, 10, 5]);
  strokeCircle(ctx, cx, cy, R * 0.52, 2.2, c(0.8));

  // 外五边形
  fillPoly(ctx, cx, cy, R * 0.86, 5, -Math.PI / 2, c(0.85), 2.0);
  // 大五芒星
  drawStar(
    ctx,
    cx,
    cy,
    R * (accent ? 0.78 : 0.82),
    R * (accent ? 0.32 : 0.34),
    5,
    -Math.PI / 2,
    rgba(220, 140, 255, 0.95),
    accent ? 2.0 : 2.6,
  );
  // 内反相小星
  drawStar(
    ctx,
    cx,
    cy,
    R * 0.42,
    R * 0.18,
    5,
    Math.PI / 2,
    rgba(170, 80, 255, 0.75),
    1.6,
  );

  // 顶点圆印
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    const rr = R * 0.86;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 5, 0, Math.PI * 2);
    ctx.fillStyle = rgba(230, 160, 255, 0.9);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 2.2, 0, Math.PI * 2);
    ctx.fillStyle = rgba(80, 20, 120, 0.9);
    ctx.fill();
  }

  if (accent) {
    // 内圈符文弧
    for (let i = 0; i < 10; i++) {
      const a0 = (i / 10) * Math.PI * 2 + 0.05;
      const a1 = a0 + Math.PI / 10 - 0.12;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.28, a0, a1);
      ctx.strokeStyle = rgba(200, 120, 255, 0.7);
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.12);
  core.addColorStop(0, rgba(255, 220, 255, 0.7));
  core.addColorStop(0.5, rgba(180, 80, 255, 0.4));
  core.addColorStop(1, rgba(80, 0, 140, 0));
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.12, 0, Math.PI * 2);
  ctx.fill();
}

/** 日印：外齿轮 + 放射光柱 + 内日轮 */
function paintSolar(
  ctx: CanvasRenderingContext2D,
  res: number,
  accent: boolean,
): void {
  const cx = res / 2;
  const cy = res / 2;
  const R = res * 0.48;
  const c = (a: number) => rgba(255, 190, 40, a);

  const glow = ctx.createRadialGradient(cx, cy, R * 0.3, cx, cy, R);
  glow.addColorStop(0, rgba(255, 220, 80, 0.15));
  glow.addColorStop(0.55, rgba(255, 160, 20, 0.08));
  glow.addColorStop(0.9, rgba(255, 200, 60, 0.4));
  glow.addColorStop(1, rgba(120, 60, 0, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();

  // 齿轮齿
  const teeth = accent ? 16 : 20;
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2;
    const a1 = a0 + (Math.PI * 2) / teeth * 0.55;
    const rIn = R * 0.82;
    const rOut = R * 0.98;
    ctx.beginPath();
    ctx.arc(cx, cy, rOut, a0, a1);
    ctx.arc(cx, cy, rIn, a1, a0, true);
    ctx.closePath();
    ctx.fillStyle = rgba(255, 180, 30, 0.75);
    ctx.fill();
  }

  strokeCircle(ctx, cx, cy, R * 0.8, 2.6, c(0.95));
  strokeCircle(ctx, cx, cy, R * 0.68, 1.4, c(0.55), [6, 4]);

  // 光柱
  const rays = accent ? 12 : 16;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2;
    const major = i % 2 === 0;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * R * 0.2, cy + Math.sin(a) * R * 0.2);
    ctx.lineTo(
      cx + Math.cos(a) * R * (major ? 0.78 : 0.62),
      cy + Math.sin(a) * R * (major ? 0.78 : 0.62),
    );
    ctx.strokeStyle = rgba(255, 210, 80, major ? 0.85 : 0.4);
    ctx.lineWidth = major ? 3.2 : 1.4;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  // 内日轮环
  strokeCircle(ctx, cx, cy, R * 0.38, 3.0, c(0.9));
  strokeCircle(ctx, cx, cy, R * 0.28, 1.5, c(0.6));
  if (accent) {
    fillPoly(ctx, cx, cy, R * 0.22, 8, Math.PI / 8, c(0.85), 1.8);
  }

  // 中心日核
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.16);
  core.addColorStop(0, rgba(255, 255, 220, 0.85));
  core.addColorStop(0.4, rgba(255, 200, 60, 0.55));
  core.addColorStop(1, rgba(200, 80, 0, 0));
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.16, 0, Math.PI * 2);
  ctx.fill();
}

/** 虚裂：破碎环 + 裂痕 + 暗核（三层：外/中/内） */
function paintVoid(
  ctx: CanvasRenderingContext2D,
  res: number,
  layer: number,
): void {
  const cx = res / 2;
  const cy = res / 2;
  const R = res * 0.48;
  const c = (a: number) => rgba(160, 60, 255, a);
  const d = (a: number) => rgba(30, 10, 50, a);

  if (layer === 0) {
    const glow = ctx.createRadialGradient(cx, cy, R * 0.5, cx, cy, R);
    glow.addColorStop(0, rgba(80, 20, 140, 0));
    glow.addColorStop(0.85, rgba(100, 30, 180, 0.15));
    glow.addColorStop(0.95, rgba(180, 80, 255, 0.45));
    glow.addColorStop(1, rgba(20, 0, 40, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();

    // 破碎外环（缺齿）
    const segs = 14;
    for (let i = 0; i < segs; i++) {
      if (i % 5 === 2) continue; // 缺口
      const a0 = (i / segs) * Math.PI * 2 + 0.04;
      const a1 = a0 + (Math.PI * 2) / segs - 0.1;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.95, a0, a1);
      ctx.strokeStyle = c(0.9);
      ctx.lineWidth = 4.5;
      ctx.lineCap = 'butt';
      ctx.stroke();
    }
    strokeCircle(ctx, cx, cy, R * 0.78, 1.5, c(0.45), [12, 8]);

    // 放射裂痕
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.2;
      const jagged = 4;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * R * 0.25, cy + Math.sin(a) * R * 0.25);
      for (let j = 1; j <= jagged; j++) {
        const t = j / jagged;
        const wobble = ((j % 2) * 2 - 1) * 0.06;
        const r = R * (0.25 + t * 0.7);
        ctx.lineTo(
          cx + Math.cos(a + wobble) * r,
          cy + Math.sin(a + wobble) * r,
        );
      }
      ctx.strokeStyle = rgba(200, 100, 255, 0.35 + (i % 3) * 0.15);
      ctx.lineWidth = 1.2 + (i % 2);
      ctx.stroke();
    }
  } else if (layer === 1) {
    strokeCircle(ctx, cx, cy, R * 0.9, 2.2, c(0.7));
    strokeCircle(ctx, cx, cy, R * 0.55, 1.6, c(0.55), [4, 6]);
    // 不规则多边形
    fillPoly(ctx, cx, cy, R * 0.72, 7, 0.3, c(0.75), 1.8);
    fillPoly(ctx, cx, cy, R * 0.48, 7, -0.2, c(0.5), 1.2);
    // 漂浮碎片点
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + 0.4;
      const rr = R * (0.35 + (i % 3) * 0.15);
      ctx.beginPath();
      ctx.arc(
        cx + Math.cos(a) * rr,
        cy + Math.sin(a) * rr,
        1.5 + (i % 3),
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = rgba(200, 120, 255, 0.7);
      ctx.fill();
    }
  } else {
    // 内暗核 + 亮环
    const hole = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.55);
    hole.addColorStop(0, d(0.75));
    hole.addColorStop(0.55, rgba(60, 10, 100, 0.35));
    hole.addColorStop(1, rgba(40, 0, 80, 0));
    ctx.fillStyle = hole;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.55, 0, Math.PI * 2);
    ctx.fill();

    strokeCircle(ctx, cx, cy, R * 0.5, 2.5, c(0.9));
    strokeCircle(ctx, cx, cy, R * 0.28, 1.5, c(0.7), [2, 4]);
    // 小三角涡
    fillPoly(ctx, cx, cy, R * 0.2, 3, 0, c(0.85), 1.6);
    fillPoly(ctx, cx, cy, R * 0.12, 3, Math.PI, c(0.6), 1.2);

    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.1);
    core.addColorStop(0, rgba(230, 180, 255, 0.8));
    core.addColorStop(1, rgba(80, 0, 140, 0));
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.1, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 三元：嵌套正三角 + 轨道点 + 圆环 */
function paintTriad(
  ctx: CanvasRenderingContext2D,
  res: number,
  accent: boolean,
): void {
  const cx = res / 2;
  const cy = res / 2;
  const R = res * 0.48;
  const c = (a: number) => rgba(40, 230, 230, a);

  const glow = ctx.createRadialGradient(cx, cy, R * 0.45, cx, cy, R);
  glow.addColorStop(0, rgba(20, 200, 200, 0));
  glow.addColorStop(0.8, rgba(20, 180, 180, 0.1));
  glow.addColorStop(0.93, rgba(60, 240, 240, 0.4));
  glow.addColorStop(1, rgba(0, 80, 80, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();

  strokeCircle(ctx, cx, cy, R * 0.97, 2.6, c(0.9));
  strokeCircle(ctx, cx, cy, R * 0.85, 1.2, c(0.5), [10, 6]);
  strokeCircle(ctx, cx, cy, R * 0.42, 1.8, c(0.7));

  // 正三角 + 倒三角（大卫之星感但青色科技风）
  fillPoly(ctx, cx, cy, R * 0.78, 3, -Math.PI / 2, c(0.95), 2.8);
  fillPoly(ctx, cx, cy, R * 0.78, 3, Math.PI / 2, c(0.75), 2.2);
  fillPoly(ctx, cx, cy, R * 0.5, 3, -Math.PI / 2, c(0.85), 2.0);
  fillPoly(ctx, cx, cy, R * 0.5, 3, Math.PI / 2, c(0.65), 1.6);
  if (accent) {
    fillPoly(ctx, cx, cy, R * 0.28, 3, -Math.PI / 2, c(0.9), 1.8);
  }

  // 三顶点大节点
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 - Math.PI / 2;
    const px = cx + Math.cos(a) * R * 0.78;
    const py = cy + Math.sin(a) * R * 0.78;
    ctx.beginPath();
    ctx.arc(px, py, 8, 0, Math.PI * 2);
    ctx.strokeStyle = c(0.95);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px, py, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = rgba(180, 255, 255, 0.9);
    ctx.fill();
  }

  // 轨道卫星点
  const sats = accent ? 18 : 12;
  for (let i = 0; i < sats; i++) {
    const a = (i / sats) * Math.PI * 2;
    const rr = R * (accent ? 0.62 : 0.9);
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, i % 3 === 0 ? 3.2 : 1.8, 0, Math.PI * 2);
    ctx.fillStyle = rgba(100, 255, 255, i % 3 === 0 ? 0.9 : 0.5);
    ctx.fill();
  }

  // 中心三环核
  strokeCircle(ctx, cx, cy, R * 0.14, 2.0, c(0.9));
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.1);
  core.addColorStop(0, rgba(220, 255, 255, 0.75));
  core.addColorStop(1, rgba(0, 100, 100, 0));
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.1, 0, Math.PI * 2);
  ctx.fill();
}
