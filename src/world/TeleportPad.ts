import {
  Color3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
  Vector3,
  type Scene,
} from '@babylonjs/core';

/**
 * 地面传送阵：贴地魔法阵 + 小光柱。
 * 默认慢转；角色站上后逐渐加速，蓄力 CHARGE_TIME 秒后触发传送。
 */
export class TeleportPad {
  /** 默认放置 X */
  static readonly DEFAULT_X = 15;
  static readonly DEFAULT_Z = 0;
  /** 触发半径（世界单位） */
  static readonly RADIUS = 1.45;
  /** 光柱高度 */
  static readonly PILLAR_HEIGHT = 2.0;
  /** 站上后蓄力传送时间（秒） */
  static readonly CHARGE_TIME = 3;
  /** 满蓄时相对默认转速的倍率（站上后要明显加速） */
  static readonly SPIN_MAX_MUL = 16;
  /** 光柱最小缩放（空闲 / 进度起点） */
  static readonly PILLAR_SCALE_MIN = 0.28;
  /**
   * 满进度时光柱半径相对传送阵半径的比例（几何按此建，缩放=1 即最大）
   * 1 = 与阵法触发半径同大
   */
  static readonly PILLAR_RADIUS_FRAC = 1;

  readonly root: TransformNode;
  readonly x: number;
  readonly z: number;
  readonly radius: number;

  private readonly groundLayers: { mesh: Mesh; spin: number }[] = [];
  private readonly pillar: Mesh;
  private readonly pillarMat: StandardMaterial;
  /** 当前蓄力（秒） */
  private charge = 0;
  /** 视觉蓄力（用于离开传送阵时的快速平滑缩回归位，防闪现跳变） */
  private visualCharge = 0;
  /**
   * 传送落地后需先离开阵法才能再次蓄力，
   * 避免出生在阵上立刻又传回去。
   */
  private requireLeave = false;

  constructor(
    scene: Scene,
    x = TeleportPad.DEFAULT_X,
    z = TeleportPad.DEFAULT_Z,
    radius = TeleportPad.RADIUS,
  ) {
    this.x = x;
    this.z = z;
    this.radius = radius;

    this.root = new TransformNode(`TeleportPad_${x}_${z}`, scene);
    this.root.position = new Vector3(x, 0, z);

    const dia = radius * 2;

    // ── 地面阵法：三层差速旋转（默认偏慢） ──────────────
    const groundDefs: {
      scale: number;
      y: number;
      spin: number;
      paint: (ctx: CanvasRenderingContext2D, res: number) => void;
      emissive: Color3;
    }[] = [
      {
        scale: 1,
        y: 0.012,
        spin: 0.12,
        paint: paintOuterRing,
        emissive: new Color3(0.2, 0.75, 1),
      },
      {
        scale: 0.78,
        y: 0.016,
        spin: -0.18,
        paint: paintRuneRing,
        emissive: new Color3(0.55, 0.4, 1),
      },
      {
        scale: 0.48,
        y: 0.02,
        spin: 0.28,
        paint: paintCoreSeal,
        emissive: new Color3(0.7, 0.95, 1),
      },
    ];

    groundDefs.forEach((def, i) => {
      const tex = paintToTexture(scene, `tpGround_${i}`, def.paint);
      const mesh = makeGroundDisc(
        scene,
        `tpGroundMesh_${i}`,
        dia * def.scale,
        tex,
        def.emissive,
      );
      mesh.parent = this.root;
      mesh.position.y = def.y;
      this.groundLayers.push({ mesh, spin: def.spin });
    });

    // ── 小光柱：半径更小，缩放作蓄力进度条（满=传送） ──
    const pillarH = TeleportPad.PILLAR_HEIGHT * 0.92;
    const pillarR = radius * TeleportPad.PILLAR_RADIUS_FRAC;
    this.pillar = createRingPillar(scene, 'tpPillar', pillarR, pillarH, 40);
    this.pillar.parent = this.root;
    this.pillar.position.y = 0.02;
    this.pillar.isPickable = false;
    // 空闲时缩到最小
    const s0 = TeleportPad.PILLAR_SCALE_MIN;
    this.pillar.scaling.set(s0, 1, s0);

    const pillarTex = paintPillarTexture(scene, 'tpPillarTex', 128, 512);
    this.pillarMat = new StandardMaterial('tpPillarMat', scene);
    this.pillarMat.diffuseTexture = pillarTex;
    this.pillarMat.opacityTexture = pillarTex;
    this.pillarMat.emissiveTexture = pillarTex;
    this.pillarMat.emissiveColor = new Color3(0.65, 0.45, 1);
    this.pillarMat.diffuseColor = new Color3(0.5, 0.35, 0.95);
    this.pillarMat.specularColor = Color3.Black();
    this.pillarMat.disableLighting = true;
    this.pillarMat.useAlphaFromDiffuseTexture = true;
    this.pillarMat.transparencyMode = StandardMaterial.MATERIAL_ALPHABLEND;
    this.pillarMat.backFaceCulling = false;
    this.pillarMat.forceDepthWrite = false;
    this.pillar.material = this.pillarMat;
  }

  /** 点是否在传送阵触发圆内（XZ） */
  contains(px: number, pz: number): boolean {
    const dx = px - this.x;
    const dz = pz - this.z;
    return dx * dx + dz * dz <= this.radius * this.radius;
  }

  /** 传送落地后调用：必须先离开再站上才重新蓄力 */
  disarmUntilLeave(): void {
    this.requireLeave = true;
    this.charge = 0;
  }

  resetCharge(): void {
    this.charge = 0;
  }

  /** 蓄力进度 0~1 */
  getCharge01(): number {
    return Math.min(1, this.charge / TeleportPad.CHARGE_TIME);
  }

  /**
   * @param occupied 角色是否站在阵上
   * @returns 是否本帧应触发传送（蓄满 3s）
   */
  update(dt: number, occupied: boolean): boolean {
    let triggered = false;
    // 落地保护：仍在阵上则不蓄力，离开后重新允许
    if (this.requireLeave) {
      if (!occupied) this.requireLeave = false;
      this.charge = 0;
    } else if (occupied) {
      this.charge = Math.min(TeleportPad.CHARGE_TIME, this.charge + dt);
      if (this.charge >= TeleportPad.CHARGE_TIME) {
        this.charge = 0;
        triggered = true;
      }
    } else {
      // 离开立刻逻辑清空
      this.charge = 0;
    }

    // 离阵平滑归位：若视觉蓄力大于逻辑蓄力，按 4x 速率快速衰减缩回归位（约 0.25s），避免闪现
    if (this.charge > this.visualCharge) {
      this.visualCharge = this.charge;
    } else {
      const decaySpeed = TeleportPad.CHARGE_TIME * 4.0;
      this.visualCharge = Math.max(0, this.visualCharge - dt * decaySpeed);
    }

    const u = Math.min(1, this.visualCharge / TeleportPad.CHARGE_TIME);
    // 明显加速：中段就提速，末段冲到满速（无抖动）
    const ease = u * u * (3 - 2 * u); // smoothstep
    const spinMul = 1 + ease * (TeleportPad.SPIN_MAX_MUL - 1);

    for (const layer of this.groundLayers) {
      layer.mesh.rotation.y += layer.spin * spinMul * dt;
    }

    // 光柱 = 进度条：半径从最小线性放大到满尺寸，满时传送
    const sMin = TeleportPad.PILLAR_SCALE_MIN;
    const s = sMin + (1 - sMin) * u;
    this.pillar.scaling.set(s, 1, s);
    this.pillar.rotation.y -= (0.12 + 2.4 * ease) * dt;
    const bright = 0.45 + 0.75 * u;
    this.pillarMat.emissiveColor.set(0.55 * bright, 0.35 * bright, bright);
    this.pillarMat.alpha = 0.28 + 0.55 * u;

    return triggered;
  }

  dispose(): void {
    for (const layer of this.groundLayers) {
      layer.mesh.dispose();
    }
    this.groundLayers.length = 0;
    this.pillar.dispose();
    this.pillarMat.dispose();
    this.root.dispose();
  }
}

// ─── 几何 ─────────────────────────────────────────────────

/** 空心圆柱光壁：底圆与顶圆 ribbon */
function createRingPillar(
  scene: Scene,
  name: string,
  radius: number,
  height: number,
  segs: number,
): Mesh {
  const bottom: Vector3[] = [];
  const top: Vector3[] = [];
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const x = Math.cos(a) * radius;
    const z = Math.sin(a) * radius;
    bottom.push(new Vector3(x, 0, z));
    top.push(new Vector3(x, height, z));
  }
  return MeshBuilder.CreateRibbon(
    name,
    {
      pathArray: [bottom, top],
      closeArray: false,
      closePath: true,
      sideOrientation: Mesh.DOUBLESIDE,
    },
    scene,
  );
}

function makeGroundDisc(
  scene: Scene,
  name: string,
  diameter: number,
  texture: DynamicTexture,
  emissive: Color3,
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
  mat.diffuseColor = emissive.scale(0.85);
  mat.specularColor = Color3.Black();
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  mat.useAlphaFromDiffuseTexture = true;
  mat.transparencyMode = StandardMaterial.MATERIAL_ALPHABLEND;
  mat.forceDepthWrite = false;
  disc.material = mat;
  return disc;
}

// ─── 纹理绘制 ─────────────────────────────────────────────

function paintToTexture(
  scene: Scene,
  name: string,
  paint: (ctx: CanvasRenderingContext2D, res: number) => void,
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

/** 光柱竖直渐变：底亮顶淡，无横向环纹 */
function paintPillarTexture(
  scene: Scene,
  name: string,
  w: number,
  h: number,
): DynamicTexture {
  const tex = new DynamicTexture(name, { width: w, height: h }, scene, false);
  tex.hasAlpha = true;
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, w, h);

  const grad = ctx.createLinearGradient(0, h, 0, 0);
  grad.addColorStop(0, 'rgba(120, 220, 255, 0.55)');
  grad.addColorStop(0.15, 'rgba(100, 200, 255, 0.42)');
  grad.addColorStop(0.55, 'rgba(140, 160, 255, 0.22)');
  grad.addColorStop(0.85, 'rgba(180, 140, 255, 0.1)');
  grad.addColorStop(1, 'rgba(200, 160, 255, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  tex.update();
  return tex;
}

function paintOuterRing(ctx: CanvasRenderingContext2D, res: number): void {
  const cx = res / 2;
  const cy = res / 2;
  const R = res * 0.48;

  const glow = ctx.createRadialGradient(cx, cy, R * 0.55, cx, cy, R);
  glow.addColorStop(0, 'rgba(40, 160, 255, 0)');
  glow.addColorStop(0.7, 'rgba(40, 180, 255, 0.08)');
  glow.addColorStop(0.9, 'rgba(80, 200, 255, 0.45)');
  glow.addColorStop(1, 'rgba(20, 80, 160, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();

  strokeCircle(ctx, cx, cy, R * 0.98, 5, 'rgba(120, 220, 255, 0.95)');
  strokeCircle(ctx, cx, cy, R * 0.88, 2.5, 'rgba(80, 180, 255, 0.7)');

  const n = 36;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const long = i % 3 === 0;
    const r0 = R * (long ? 0.78 : 0.84);
    const r1 = R * 0.95;
    ctx.strokeStyle = long
      ? 'rgba(180, 240, 255, 0.9)'
      : 'rgba(100, 200, 255, 0.55)';
    ctx.lineWidth = long ? 3 : 1.5;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    ctx.stroke();
  }
}

function paintRuneRing(ctx: CanvasRenderingContext2D, res: number): void {
  const cx = res / 2;
  const cy = res / 2;
  const R = res * 0.46;

  strokeCircle(ctx, cx, cy, R * 0.98, 3, 'rgba(180, 140, 255, 0.85)');
  strokeCircle(ctx, cx, cy, R * 0.72, 2, 'rgba(140, 100, 255, 0.65)');

  ctx.strokeStyle = 'rgba(200, 170, 255, 0.8)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / 6;
    const x = cx + Math.cos(a) * R * 0.85;
    const y = cy + Math.sin(a) * R * 0.85;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();

  const m = 12;
  for (let i = 0; i < m; i++) {
    const a = (i / m) * Math.PI * 2 + 0.2;
    const x = cx + Math.cos(a) * R * 0.9;
    const y = cy + Math.sin(a) * R * 0.9;
    ctx.fillStyle =
      i % 2 === 0 ? 'rgba(220, 200, 255, 0.95)' : 'rgba(120, 200, 255, 0.85)';
    ctx.beginPath();
    ctx.arc(x, y, i % 2 === 0 ? 5 : 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = 0; i < 16; i++) {
    const a0 = (i / 16) * Math.PI * 2;
    const a1 = a0 + 0.18;
    ctx.strokeStyle = 'rgba(160, 220, 255, 0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.58, a0, a1);
    ctx.stroke();
  }
}

function paintCoreSeal(ctx: CanvasRenderingContext2D, res: number): void {
  const cx = res / 2;
  const cy = res / 2;
  const R = res * 0.46;

  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
  glow.addColorStop(0, 'rgba(200, 240, 255, 0.35)');
  glow.addColorStop(0.45, 'rgba(100, 180, 255, 0.12)');
  glow.addColorStop(1, 'rgba(40, 80, 200, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();

  strokeCircle(ctx, cx, cy, R * 0.9, 3, 'rgba(180, 240, 255, 0.9)');
  strokeCircle(ctx, cx, cy, R * 0.55, 2, 'rgba(140, 200, 255, 0.7)');

  ctx.strokeStyle = 'rgba(220, 250, 255, 0.95)';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * R * 0.15, cy + Math.sin(a) * R * 0.15);
    ctx.lineTo(cx + Math.cos(a) * R * 0.72, cy + Math.sin(a) * R * 0.72);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(200, 240, 255, 0.95)';
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.12, 0, Math.PI * 2);
  ctx.fill();
}

function strokeCircle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  lineWidth: number,
  color: string,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
}
