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
import { LoopSfx } from '../audio/Sfx';

export type TeleportPadTheme = 'default' | 'orange' | 'emerald';

/** 成对传送：两端必须用同一 theme */
export const TeleportPairTheme = {
  hubLevel1: 'default',
  hubWarehouse: 'orange',
  level1Level2: 'emerald',
} as const satisfies Record<string, TeleportPadTheme>;

export interface TeleportPadOptions {
  theme?: TeleportPadTheme;
}

interface OuterTint {
  glowInner: string;
  glowMid: string;
  glowEdge: string;
  glowOut: string;
  ringA: string;
  ringB: string;
  tickLong: string;
  tickShort: string;
}

interface RuneTint {
  ringA: string;
  ringB: string;
  hex: string;
  dotA: string;
  dotB: string;
  arc: string;
}

interface CoreTint {
  glow0: string;
  glow1: string;
  glow2: string;
  ringA: string;
  ringB: string;
  cross: string;
  core: string;
}

interface ThemePalette {
  outer: OuterTint;
  rune: RuneTint;
  core: CoreTint;
  emissiveOuter: Color3;
  emissiveRune: Color3;
  emissiveCore: Color3;
  pillarStops: readonly string[];
  pillarEmissive: Color3;
  pillarDiffuse: Color3;
  pillarPulse: { r: number; g: number; b: number };
}

const THEME_PALETTE: Record<TeleportPadTheme, ThemePalette> = {
  default: {
    outer: {
      glowInner: 'rgba(40, 160, 255, 0)',
      glowMid: 'rgba(40, 180, 255, 0.08)',
      glowEdge: 'rgba(80, 200, 255, 0.45)',
      glowOut: 'rgba(20, 80, 160, 0)',
      ringA: 'rgba(120, 220, 255, 0.95)',
      ringB: 'rgba(80, 180, 255, 0.7)',
      tickLong: 'rgba(180, 240, 255, 0.9)',
      tickShort: 'rgba(100, 200, 255, 0.55)',
    },
    rune: {
      ringA: 'rgba(180, 140, 255, 0.85)',
      ringB: 'rgba(140, 100, 255, 0.65)',
      hex: 'rgba(200, 170, 255, 0.8)',
      dotA: 'rgba(220, 200, 255, 0.95)',
      dotB: 'rgba(120, 200, 255, 0.85)',
      arc: 'rgba(160, 220, 255, 0.55)',
    },
    core: {
      glow0: 'rgba(200, 240, 255, 0.35)',
      glow1: 'rgba(100, 180, 255, 0.12)',
      glow2: 'rgba(40, 80, 200, 0)',
      ringA: 'rgba(180, 240, 255, 0.9)',
      ringB: 'rgba(140, 200, 255, 0.7)',
      cross: 'rgba(220, 250, 255, 0.95)',
      core: 'rgba(200, 240, 255, 0.95)',
    },
    emissiveOuter: new Color3(0.2, 0.75, 1),
    emissiveRune: new Color3(0.55, 0.4, 1),
    emissiveCore: new Color3(0.7, 0.95, 1),
    pillarStops: [
      'rgba(120, 220, 255, 0.55)',
      'rgba(100, 200, 255, 0.42)',
      'rgba(140, 160, 255, 0.22)',
      'rgba(180, 140, 255, 0.1)',
      'rgba(200, 160, 255, 0)',
    ],
    pillarEmissive: new Color3(0.65, 0.45, 1),
    pillarDiffuse: new Color3(0.5, 0.35, 0.95),
    pillarPulse: { r: 0.7, g: 0.55, b: 1.35 },
  },
  orange: {
    outer: {
      glowInner: 'rgba(255, 120, 0, 0)',
      glowMid: 'rgba(255, 140, 20, 0.1)',
      glowEdge: 'rgba(255, 160, 40, 0.5)',
      glowOut: 'rgba(160, 60, 0, 0)',
      ringA: 'rgba(255, 200, 80, 0.95)',
      ringB: 'rgba(255, 140, 30, 0.75)',
      tickLong: 'rgba(255, 230, 150, 0.95)',
      tickShort: 'rgba(255, 150, 40, 0.6)',
    },
    rune: {
      ringA: 'rgba(255, 170, 50, 0.9)',
      ringB: 'rgba(255, 110, 20, 0.7)',
      hex: 'rgba(255, 190, 80, 0.85)',
      dotA: 'rgba(255, 230, 140, 0.95)',
      dotB: 'rgba(255, 140, 40, 0.85)',
      arc: 'rgba(255, 160, 50, 0.55)',
    },
    core: {
      glow0: 'rgba(255, 230, 140, 0.4)',
      glow1: 'rgba(255, 140, 30, 0.16)',
      glow2: 'rgba(180, 60, 0, 0)',
      ringA: 'rgba(255, 210, 90, 0.92)',
      ringB: 'rgba(255, 150, 40, 0.75)',
      cross: 'rgba(255, 240, 180, 0.95)',
      core: 'rgba(255, 220, 120, 0.95)',
    },
    emissiveOuter: new Color3(1, 0.45, 0.08),
    emissiveRune: new Color3(1, 0.35, 0.05),
    emissiveCore: new Color3(1, 0.72, 0.18),
    pillarStops: [
      'rgba(255, 170, 40, 0.6)',
      'rgba(255, 130, 20, 0.45)',
      'rgba(255, 90, 10, 0.24)',
      'rgba(220, 70, 0, 0.1)',
      'rgba(180, 50, 0, 0)',
    ],
    pillarEmissive: new Color3(1, 0.48, 0.08),
    pillarDiffuse: new Color3(1, 0.4, 0.05),
    pillarPulse: { r: 1.2, g: 0.48, b: 0.08 },
  },
  emerald: {
    outer: {
      glowInner: 'rgba(20, 200, 120, 0)',
      glowMid: 'rgba(30, 220, 130, 0.1)',
      glowEdge: 'rgba(60, 255, 160, 0.48)',
      glowOut: 'rgba(10, 80, 50, 0)',
      ringA: 'rgba(140, 255, 200, 0.95)',
      ringB: 'rgba(50, 220, 140, 0.75)',
      tickLong: 'rgba(200, 255, 220, 0.95)',
      tickShort: 'rgba(70, 230, 150, 0.6)',
    },
    rune: {
      ringA: 'rgba(80, 240, 180, 0.9)',
      ringB: 'rgba(30, 200, 130, 0.7)',
      hex: 'rgba(140, 255, 200, 0.85)',
      dotA: 'rgba(200, 255, 220, 0.95)',
      dotB: 'rgba(60, 220, 150, 0.85)',
      arc: 'rgba(80, 240, 170, 0.55)',
    },
    core: {
      glow0: 'rgba(180, 255, 220, 0.4)',
      glow1: 'rgba(50, 220, 140, 0.16)',
      glow2: 'rgba(10, 80, 50, 0)',
      ringA: 'rgba(160, 255, 210, 0.92)',
      ringB: 'rgba(70, 230, 150, 0.75)',
      cross: 'rgba(220, 255, 230, 0.95)',
      core: 'rgba(180, 255, 210, 0.95)',
    },
    emissiveOuter: new Color3(0.15, 0.95, 0.5),
    emissiveRune: new Color3(0.1, 0.8, 0.45),
    emissiveCore: new Color3(0.45, 1, 0.7),
    pillarStops: [
      'rgba(80, 255, 180, 0.58)',
      'rgba(40, 230, 140, 0.42)',
      'rgba(30, 200, 120, 0.22)',
      'rgba(20, 160, 90, 0.1)',
      'rgba(10, 100, 60, 0)',
    ],
    pillarEmissive: new Color3(0.25, 1, 0.55),
    pillarDiffuse: new Color3(0.15, 0.85, 0.4),
    pillarPulse: { r: 0.22, g: 1.15, b: 0.55 },
  },
};

/**
 * 地面传送阵：贴地魔法阵 + 小光柱。
 * 默认慢转；角色站上后逐渐加速，蓄力 CHARGE_TIME 秒后触发传送。
 */
export class TeleportPad {
  /** 默认放置 X */
  static readonly DEFAULT_X = 0;
  static readonly DEFAULT_Z = -7;
  /**
   * 传送落地相对阵心偏移距离（米）。
   * 必须大于 RADIUS(0.725)，落在阵外避免一落地又站上触发。
   */
  static readonly LANDING_DISTANCE = 1.6;
  /** 默认备用固定偏移（未提供 yaw 时使用，面向 +Z 竞技场中心方向） */
  static readonly LANDING_OFFSET_X = 0;
  static readonly LANDING_OFFSET_Z = 1.6;

  /**
   * 传送成功后的落地点。
   * 若传入角色朝向 yaw，则根据角色前方延伸 LANDING_DISTANCE 确定落点；
   * 否则保留默认 fallback 偏移。
   */
  getLandingXZ(yaw?: number): { x: number; z: number } {
    if (yaw !== undefined) {
      return {
        x: this.x + Math.sin(yaw) * TeleportPad.LANDING_DISTANCE,
        z: this.z + Math.cos(yaw) * TeleportPad.LANDING_DISTANCE,
      };
    }
    return {
      x: this.x + TeleportPad.LANDING_OFFSET_X,
      z: this.z + TeleportPad.LANDING_OFFSET_Z,
    };
  }

  /** 枢纽默认阵的落地点（无实例时用） */
  static defaultLandingXZ(yaw?: number): { x: number; z: number } {
    if (yaw !== undefined) {
      return {
        x: TeleportPad.DEFAULT_X + Math.sin(yaw) * TeleportPad.LANDING_DISTANCE,
        z: TeleportPad.DEFAULT_Z + Math.cos(yaw) * TeleportPad.LANDING_DISTANCE,
      };
    }
    return {
      x: TeleportPad.DEFAULT_X + TeleportPad.LANDING_OFFSET_X,
      z: TeleportPad.DEFAULT_Z + TeleportPad.LANDING_OFFSET_Z,
    };
  }
  /** 触发半径（世界单位，原 1.45 缩小一倍） */
  static readonly RADIUS = 0.725;
  /** 光柱高度 */
  static readonly PILLAR_HEIGHT = 1.2;
  /** 站上后蓄力传送时间（秒） */
  static readonly CHARGE_TIME = 0.75;
  /** 满蓄时相对默认转速的倍率（站上后要明显加速） */
  static readonly SPIN_MAX_MUL = 16;
  /** 空闲时细高光束：更极细的极光束半径比例 (3.5%) */
  static readonly PILLAR_SCALE_XZ_IDLE = 0.035;
  /** 空闲时细高光束：通天拔高高度倍率 (5.5 倍高) */
  static readonly PILLAR_SCALE_Y_IDLE = 5.5;
  /** 站上蓄力满时：充盈扩展半径比例 (100%) */
  static readonly PILLAR_SCALE_XZ_MAX = 1.0;
  /** 站上蓄力满时：充满沉淀的高度倍率 */
  static readonly PILLAR_SCALE_Y_MAX = 0.95;
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
  private readonly occupySfx = new LoopSfx('/audio/teleport.mp3', 0.55);
  private readonly theme: TeleportPadTheme;

  constructor(
    scene: Scene,
    x = TeleportPad.DEFAULT_X,
    z = TeleportPad.DEFAULT_Z,
    radius = TeleportPad.RADIUS,
    options: TeleportPadOptions = {},
  ) {
    this.x = x;
    this.z = z;
    this.radius = radius;
    this.theme = options.theme ?? 'default';
    const uid = `${this.theme}_${x}_${z}`;

    this.root = new TransformNode(`TeleportPad_${uid}`, scene);
    this.root.position = new Vector3(x, 0, z);

    const dia = radius * 2;
    const pal = THEME_PALETTE[this.theme];

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
        paint: (ctx, res) => paintOuterRingTinted(ctx, res, pal.outer),
        emissive: pal.emissiveOuter,
      },
      {
        scale: 0.78,
        y: 0.016,
        spin: -0.18,
        paint: (ctx, res) => paintRuneRingTinted(ctx, res, pal.rune),
        emissive: pal.emissiveRune,
      },
      {
        scale: 0.48,
        y: 0.02,
        spin: 0.28,
        paint: (ctx, res) => paintCoreSealTinted(ctx, res, pal.core),
        emissive: pal.emissiveCore,
      },
    ];

    groundDefs.forEach((def, i) => {
      const tex = paintToTexture(scene, `tpGround_${uid}_${i}`, def.paint);
      const mesh = makeGroundDisc(
        scene,
        `tpGroundMesh_${uid}_${i}`,
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
    this.pillar = createRingPillar(scene, `tpPillar_${uid}`, pillarR, pillarH, 40);
    this.pillar.parent = this.root;
    this.pillar.position.y = 0.02;
    this.pillar.isPickable = false;
    // 空闲时：细高通天光束
    const sxz0 = TeleportPad.PILLAR_SCALE_XZ_IDLE;
    const sy0 = TeleportPad.PILLAR_SCALE_Y_IDLE;
    this.pillar.scaling.set(sxz0, sy0, sxz0);

    const pillarTex = paintPillarTexture(
      scene,
      `tpPillarTex_${uid}`,
      128,
      512,
      pal.pillarStops,
    );
    this.pillarMat = new StandardMaterial(`tpPillarMat_${uid}`, scene);
    this.pillarMat.diffuseTexture = pillarTex;
    this.pillarMat.opacityTexture = pillarTex;
    this.pillarMat.emissiveTexture = pillarTex;
    this.pillarMat.emissiveColor = pal.pillarEmissive.clone();
    this.pillarMat.diffuseColor = pal.pillarDiffuse.clone();
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

  setVisible(visible: boolean): void {
    this.root.setEnabled(visible);
    if (!visible) {
      this.occupySfx.stop();
      this.charge = 0;
      this.visualCharge = 0;
    }
  }

  isVisible(): boolean {
    return this.root.isEnabled();
  }

  /** 传送落地后调用：必须先离开再站上才重新蓄力 */
  disarmUntilLeave(): void {
    this.requireLeave = true;
    this.charge = 0;
  }

  resetCharge(): void {
    this.charge = 0;
  }

  /** 逻辑蓄力进度 0~1（离开阵立刻归零） */
  getCharge01(): number {
    return Math.min(1, this.charge / TeleportPad.CHARGE_TIME);
  }

  /**
   * 视觉蓄力进度 0~1（离阵时平滑衰减，适合驱动黑场遮罩）。
   * 蓄满触发传送时会锁在 1，避免 charge 清零导致遮罩闪回透明。
   */
  getVisualCharge01(): number {
    return Math.min(1, this.visualCharge / TeleportPad.CHARGE_TIME);
  }

  /**
   * @param occupied 角色是否站在阵上
   * @returns 是否本帧应触发传送（蓄满 0.75s）
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
        // 触发瞬间视觉锁满，避免 charge 归零后黑场遮罩闪一下
        this.visualCharge = TeleportPad.CHARGE_TIME;
        this.charge = 0;
        triggered = true;
      }
    } else {
      // 离开立刻逻辑清空
      this.charge = 0;
    }

    const shouldHum = occupied && !this.requireLeave && !triggered;
    if (shouldHum) this.occupySfx.start();
    else this.occupySfx.stop();

    // 离阵平滑归位：若视觉蓄力大于逻辑蓄力，按 4x 速率快速衰减缩回归位（约 0.25s），避免闪现
    // 触发传送当帧不衰减，保证遮罩能接到 100% 全黑
    if (triggered) {
      this.visualCharge = TeleportPad.CHARGE_TIME;
    } else if (this.charge > this.visualCharge) {
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

    // 光柱动画：空闲时很细很高（细光射线），站上去蓄力时半径变大且高度降低
    const sxzMin = TeleportPad.PILLAR_SCALE_XZ_IDLE;
    const sxzMax = TeleportPad.PILLAR_SCALE_XZ_MAX;
    const syIdle = TeleportPad.PILLAR_SCALE_Y_IDLE;
    const syMax = TeleportPad.PILLAR_SCALE_Y_MAX;

    const sxz = sxzMin + (sxzMax - sxzMin) * ease;
    const sy = syIdle + (syMax - syIdle) * ease;

    this.pillar.scaling.set(sxz, sy, sxz);
    this.pillar.rotation.y -= (0.12 + 2.4 * ease) * dt;
    const bright = 0.95 + 0.55 * u;
    const pulse = THEME_PALETTE[this.theme].pillarPulse;
    this.pillarMat.emissiveColor.set(
      pulse.r * bright,
      pulse.g * bright,
      pulse.b * bright,
    );
    this.pillarMat.alpha = 0.65 + 0.3 * u;

    return triggered;
  }

  dispose(): void {
    this.occupySfx.stop();
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
  stops: readonly string[],
): DynamicTexture {
  const tex = new DynamicTexture(name, { width: w, height: h }, scene, false);
  tex.hasAlpha = true;
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, w, h);

  const grad = ctx.createLinearGradient(0, h, 0, 0);
  const last = Math.max(1, stops.length - 1);
  stops.forEach((color, i) => {
    grad.addColorStop(i / last, color);
  });
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  tex.update();
  return tex;
}

function paintOuterRingTinted(
  ctx: CanvasRenderingContext2D,
  res: number,
  c: {
    glowInner: string;
    glowMid: string;
    glowEdge: string;
    glowOut: string;
    ringA: string;
    ringB: string;
    tickLong: string;
    tickShort: string;
  },
): void {
  const cx = res / 2;
  const cy = res / 2;
  const R = res * 0.48;

  const glow = ctx.createRadialGradient(cx, cy, R * 0.55, cx, cy, R);
  glow.addColorStop(0, c.glowInner);
  glow.addColorStop(0.7, c.glowMid);
  glow.addColorStop(0.9, c.glowEdge);
  glow.addColorStop(1, c.glowOut);
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();

  strokeCircle(ctx, cx, cy, R * 0.98, 5, c.ringA);
  strokeCircle(ctx, cx, cy, R * 0.88, 2.5, c.ringB);

  const n = 36;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const long = i % 3 === 0;
    const r0 = R * (long ? 0.78 : 0.84);
    const r1 = R * 0.95;
    ctx.strokeStyle = long ? c.tickLong : c.tickShort;
    ctx.lineWidth = long ? 3 : 1.5;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    ctx.stroke();
  }
}

function paintRuneRingTinted(
  ctx: CanvasRenderingContext2D,
  res: number,
  c: {
    ringA: string;
    ringB: string;
    hex: string;
    dotA: string;
    dotB: string;
    arc: string;
  },
): void {
  const cx = res / 2;
  const cy = res / 2;
  const R = res * 0.46;

  strokeCircle(ctx, cx, cy, R * 0.98, 3, c.ringA);
  strokeCircle(ctx, cx, cy, R * 0.72, 2, c.ringB);

  ctx.strokeStyle = c.hex;
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
    ctx.fillStyle = i % 2 === 0 ? c.dotA : c.dotB;
    ctx.beginPath();
    ctx.arc(x, y, i % 2 === 0 ? 5 : 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = 0; i < 16; i++) {
    const a0 = (i / 16) * Math.PI * 2;
    const a1 = a0 + 0.18;
    ctx.strokeStyle = c.arc;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.58, a0, a1);
    ctx.stroke();
  }
}

function paintCoreSealTinted(
  ctx: CanvasRenderingContext2D,
  res: number,
  c: {
    glow0: string;
    glow1: string;
    glow2: string;
    ringA: string;
    ringB: string;
    cross: string;
    core: string;
  },
): void {
  const cx = res / 2;
  const cy = res / 2;
  const R = res * 0.46;

  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
  glow.addColorStop(0, c.glow0);
  glow.addColorStop(0.45, c.glow1);
  glow.addColorStop(1, c.glow2);
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();

  strokeCircle(ctx, cx, cy, R * 0.9, 3, c.ringA);
  strokeCircle(ctx, cx, cy, R * 0.55, 2, c.ringB);

  ctx.strokeStyle = c.cross;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * R * 0.15, cy + Math.sin(a) * R * 0.15);
    ctx.lineTo(cx + Math.cos(a) * R * 0.72, cy + Math.sin(a) * R * 0.72);
    ctx.stroke();
  }

  ctx.fillStyle = c.core;
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
