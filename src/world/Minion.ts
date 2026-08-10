import {
  Color3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  type Scene,
  ShadowGenerator,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
} from '@babylonjs/core';

/**
 * 极简五球小兵模型：身体 + 双手 + 双脚（可选小帽 / 魔法杖）。
 * 仅视觉。
 */
export class Minion {
  static readonly SCALE = 0.5;
  /** 身体球心本地 Y（用于镜头注视点） */
  static readonly BODY_LOCAL_Y = 0.63;
  /** 默认纯白身体 */
  static readonly BODY = 0xffffff;
  /** 默认纯白四肢 */
  static readonly LIMB = 0xffffff;
  /** 灰黑变体肤色（保留脸部明暗对比） */
  static readonly CHARCOAL = 0x3a3a42;
  /** 巫师帽红色 */
  static readonly HAT_RED = 0xef4444;
  /** 帽环深红色 */
  static readonly HAT_RED_BAND = 0xb91c1c;

  /** 行走周期（Hz） */
  static readonly WALK_HZ = 2.4;
  /** 手前后摆幅（本地单位） */
  static readonly HAND_SWING = 0.16;
  /** 手轻微上下 */
  static readonly HAND_BOB = 0.04;
  /** 脚前后跨步 */
  static readonly FOOT_STRIDE = 0.14;
  /** 脚抬起高度 */
  static readonly FOOT_LIFT = 0.1;
  /** 身体上下颠簸 */
  static readonly BODY_BOB = 0.035;
  /** 转向角速度（弧度/秒） */
  static readonly TURN_SPEED = 14;

  readonly root: TransformNode;
  readonly bodyRoot: TransformNode;

  private readonly leftHand: Mesh;
  private readonly rightHand: Mesh;
  private readonly leftFoot: Mesh;
  private readonly rightFoot: Mesh;

  private readonly leftHandRest: Vector3;
  private readonly rightHandRest: Vector3;
  private readonly leftFootRest: Vector3;
  private readonly rightFootRest: Vector3;

  /** 行走相位（弧度） */
  private walkPhase = 0;
  /** 0 静止 → 1 满步态，进出平滑 */
  private walkWeight = 0;
  /** 目标朝向 yaw（本地 +Z 为前，对应世界 XZ） */
  private targetYaw = 0;

  /** 魔法杖动态部件（无杖时为 null） */
  private readonly staffFx: StaffFx | null = null;

  constructor(
    scene: Scene,
    x = 0,
    z = 0,
    options: {
      /** 面朝 +X（蓝）或 -X（红） */
      facePositiveX?: boolean;
      shadowGenerator?: ShadowGenerator;
      /** 全身灰黑（身体/手脚 + 同色脸贴图，保留表情） */
      allBlack?: boolean;
      /** 相对默认 SCALE 的倍率（1 = 正常，0.5 = 缩小一半） */
      scaleMultiplier?: number;
      /** 戴红色巫师帽 */
      redHat?: boolean;
      /** 右手持炫酷魔法杖 */
      magicStaff?: boolean;
      /** 表情：cute / fierce / dumb / sad */
      face?: FaceStyle;
      /**
       * 对当前表情贴图做马赛克像素化（与表情类型无关，滤镜后处理）。
       */
      mosaicFace?: boolean;
      /**
       * 低面数 + 平面着色：球 segments 降低、flat 法线，菱角明显。
       */
      lowPolyFlat?: boolean;
    } = {},
  ) {
    const facePositiveX = options.facePositiveX ?? true;
    const shadowGen = options.shadowGenerator;
    const allBlack = options.allBlack ?? false;
    const redHat = options.redHat ?? false;
    const magicStaff = options.magicStaff ?? false;
    const faceStyle: FaceStyle = options.face ?? 'cute';
    const mosaicFace = options.mosaicFace ?? false;
    const lowPolyFlat = options.lowPolyFlat ?? false;
    // 身体稍细一些；手脚更糙
    const sphereSegments = lowPolyFlat ? 10 : 24;
    const limbSegments = lowPolyFlat ? 3 : 16;
    const scale = Minion.SCALE * (options.scaleMultiplier ?? 1);

    this.root = new TransformNode(`Minion_${x}_${z}`, scene);
    this.root.position = new Vector3(x, 0, z);
    this.root.scaling = new Vector3(scale, scale, scale);
    // 蓝方面朝 +X，红方面朝 -X（本地 +Z → 世界 (sin yaw, cos yaw)）
    this.root.rotation.y = facePositiveX ? Math.PI / 2 : -Math.PI / 2;
    this.targetYaw = this.root.rotation.y;

    this.bodyRoot = new TransformNode('bodyRoot', scene);
    this.bodyRoot.parent = this.root;

    // 默认纯白全身；灰黑变体共用同一材质做手脚
    const limbColor = allBlack ? Minion.CHARCOAL : Minion.LIMB;
    const limbMat = mat(scene, 'minionLimb', limbColor);
    const leftHandMat = limbMat;
    const rightHandMat = limbMat;

    const bodyMat = new StandardMaterial('minionBody', scene);
    bodyMat.specularColor = Color3.Black();
    bodyMat.diffuseTexture = getFaceTexture(
      scene,
      allBlack ? Minion.CHARCOAL : Minion.BODY,
      faceStyle,
      mosaicFace,
    );

    // 身体：贴图脸在 u≈0.5；Babylon 球面与 Three 经度起点相反，+Y 旋转把脸转到本地 +Z
    const body = MeshBuilder.CreateSphere(
      'body',
      { diameter: 0.84, segments: sphereSegments },
      scene,
    );
    // 身体底 y≈0.21、脚顶 y=0.2 → 与脚间隔 0.01；脚仍贴地
    body.position.y = Minion.BODY_LOCAL_Y;
    body.rotation.y = Math.PI / 2;
    body.material = bodyMat;
    body.parent = this.bodyRoot;
    if (lowPolyFlat) applyFlatShading(body);
    cast(body, shadowGen);

    // 双手（左右镜像对称；略靠后；持杖时右手抬高前伸）
    this.leftHandRest = new Vector3(0.5, 0.5, 0.05);
    this.rightHandRest = magicStaff
      ? new Vector3(-0.52, 0.68, 0.28)
      : new Vector3(-0.5, 0.5, 0.05);
    this.leftHand = ball(scene, 'leftHand', 0.2, leftHandMat, limbSegments, lowPolyFlat);
    this.leftHand.position.copyFrom(this.leftHandRest);
    this.leftHand.parent = this.bodyRoot;
    cast(this.leftHand, shadowGen);

    this.rightHand = ball(scene, 'rightHand', 0.2, rightHandMat, limbSegments, lowPolyFlat);
    this.rightHand.position.copyFrom(this.rightHandRest);
    this.rightHand.parent = this.bodyRoot;
    cast(this.rightHand, shadowGen);

    // 双脚（脚心约 y=0.1，半径 0.1 → 底贴地）
    this.leftFootRest = new Vector3(0.14, 0.1, 0.02);
    this.rightFootRest = new Vector3(-0.14, 0.1, 0.02);
    this.leftFoot = ball(scene, 'leftFoot', 0.2, limbMat, limbSegments, lowPolyFlat);
    this.leftFoot.position.copyFrom(this.leftFootRest);
    this.leftFoot.parent = this.bodyRoot;
    cast(this.leftFoot, shadowGen);

    this.rightFoot = ball(scene, 'rightFoot', 0.2, limbMat, limbSegments, lowPolyFlat);
    this.rightFoot.position.copyFrom(this.rightFootRest);
    this.rightFoot.parent = this.bodyRoot;
    cast(this.rightFoot, shadowGen);

    if (redHat) {
      attachWizardHat(scene, this.bodyRoot, shadowGen);
    }
    if (magicStaff) {
      this.staffFx = attachMagicStaff(scene, this.rightHand, shadowGen);
    }
  }

  /** 地面 XZ 位移（Y 保持贴地） */
  moveBy(dx: number, dz: number): void {
    this.root.position.x += dx;
    this.root.position.z += dz;
  }

  /**
   * 面向世界 XZ 位移方向。
   * 模型前向为本地 +Z，与 yaw 的关系：世界方向 = (sin yaw, cos yaw)。
   */
  faceToward(dx: number, dz: number): void {
    if (dx * dx + dz * dz < 1e-12) return;
    this.targetYaw = Math.atan2(dx, dz);
  }

  /**
   * 每帧更新转向 + 行走动画。
   * @param moving 本帧是否在位移
   */
  update(dt: number, moving: boolean): void {
    this.applyTurn(dt);
    this.updateStaffFx(dt);

    const blend = 10;
    if (moving) {
      this.walkWeight = Math.min(1, this.walkWeight + dt * blend);
      this.walkPhase += dt * Math.PI * 2 * Minion.WALK_HZ;
    } else {
      this.walkWeight = Math.max(0, this.walkWeight - dt * blend);
      // 减速时相位仍轻微推进，避免骤停
      if (this.walkWeight > 0.01) {
        this.walkPhase += dt * Math.PI * 2 * Minion.WALK_HZ * this.walkWeight;
      }
    }

    const w = this.walkWeight;
    if (w < 1e-4) {
      this.leftHand.position.copyFrom(this.leftHandRest);
      this.rightHand.position.copyFrom(this.rightHandRest);
      this.leftFoot.position.copyFrom(this.leftFootRest);
      this.rightFoot.position.copyFrom(this.rightFootRest);
      this.bodyRoot.position.y = 0;
      return;
    }

    // 对侧步态：左脚/右手同相，右脚/左手同相
    const swing = Math.sin(this.walkPhase) * w;
    const liftPhase = Math.cos(this.walkPhase);

    // 双手：前后摆 + 轻微上下（持杖时右手摆幅略减）
    const handSwing = this.staffFx ? Minion.HAND_SWING * 0.45 : Minion.HAND_SWING;
    this.leftHand.position.set(
      this.leftHandRest.x,
      this.leftHandRest.y + Minion.HAND_BOB * swing,
      this.leftHandRest.z + Minion.HAND_SWING * swing,
    );
    this.rightHand.position.set(
      this.rightHandRest.x,
      this.rightHandRest.y - Minion.HAND_BOB * swing * 0.6,
      this.rightHandRest.z - handSwing * swing,
    );

    // 双脚：前后跨步；摆动腿抬起（cos 正半周离地）
    const leftLift = Math.max(0, -liftPhase) * Minion.FOOT_LIFT * w;
    const rightLift = Math.max(0, liftPhase) * Minion.FOOT_LIFT * w;
    this.leftFoot.position.set(
      this.leftFootRest.x,
      this.leftFootRest.y + leftLift,
      this.leftFootRest.z - Minion.FOOT_STRIDE * swing,
    );
    this.rightFoot.position.set(
      this.rightFootRest.x,
      this.rightFootRest.y + rightLift,
      this.rightFootRest.z + Minion.FOOT_STRIDE * swing,
    );

    // 身体轻颠（两倍频，每一步一次）
    this.bodyRoot.position.y =
      Math.abs(Math.sin(this.walkPhase)) * Minion.BODY_BOB * w;
  }

  /** 杖顶：强脉动、多层光环狂转、双层星轨、外层光晕呼吸、尖冠自旋 */
  private updateStaffFx(dt: number): void {
    const fx = this.staffFx;
    if (!fx) return;
    fx.t += dt;
    const t = fx.t;

    // 青↔紫炫彩脉动
    const pulse = 0.65 + 0.55 * (0.5 + 0.5 * Math.sin(t * 5.5));
    const hue = 0.5 + 0.5 * Math.sin(t * 2.2);
    const r = (0.45 + 0.55 * hue) * pulse;
    const g = (0.35 + 0.4 * (1 - hue)) * pulse;
    const b = 1.0 * pulse;
    fx.orbMat.emissiveColor.set(r, g, b * 0.95 + 0.3);
    fx.orbMat.diffuseColor.set(r * 0.85, g * 0.9, b);

    const corePulse = 0.75 + 0.5 * Math.sin(t * 8);
    fx.coreMat.emissiveColor.set(corePulse, corePulse, corePulse);
    fx.core.scaling.setAll(0.9 + 0.25 * Math.sin(t * 7));

    // 主球轻微呼吸
    fx.orb.scaling.setAll(0.95 + 0.12 * Math.sin(t * 3.4));

    // 三层原子轨：不同轴、反向狂转
    const speeds = [3.8, -2.9, 4.6];
    for (let i = 0; i < fx.halos.length; i++) {
      const h = fx.halos[i];
      h.rotation.y += dt * speeds[i % speeds.length];
      h.rotation.x += dt * (1.2 + i * 0.4) * (i % 2 === 0 ? 1 : -1);
      h.rotation.z = Math.sin(t * (1.5 + i * 0.3) + i) * 0.45;
      const s = 1 + 0.08 * Math.sin(t * 4 + i);
      h.scaling.set(s, s, s);
    }

    // 外层大光晕呼吸 + 慢转
    const auraS = 1.05 + 0.18 * Math.sin(t * 2.6);
    fx.aura.scaling.setAll(auraS);
    fx.aura.rotation.y += dt * 0.8;
    const ap = 0.35 + 0.25 * Math.sin(t * 3);
    fx.auraMat.emissiveColor.set(0.5 * ap, 0.2 * ap, 0.95 * ap);
    fx.auraMat.alpha = 0.18 + 0.12 * Math.sin(t * 3);

    // 尖冠自旋
    fx.crown.rotation.y += dt * 2.2;

    // 双层星轨（内快外慢、反向）
    for (let i = 0; i < fx.sparks.length; i++) {
      const inner = i < 6;
      const n = inner ? 6 : fx.sparks.length - 6;
      const idx = inner ? i : i - 6;
      const speed = inner ? 5.5 : -3.2;
      const radius = inner ? 0.16 : 0.26;
      const a = t * speed + (idx / Math.max(n, 1)) * Math.PI * 2;
      const yOff = (inner ? 0.04 : 0.07) * Math.sin(t * 6 + i * 1.3);
      fx.sparks[i].position.set(
        Math.cos(a) * radius,
        yOff,
        Math.sin(a) * radius,
      );
      const ps = 0.7 + 0.5 * Math.sin(t * 9 + i);
      fx.sparks[i].scaling.setAll(ps);
    }
  }

  /** 最短路径转向目标 yaw */
  private applyTurn(dt: number): void {
    let diff = this.targetYaw - this.root.rotation.y;
    // 归一化到 (-π, π]
    diff = ((diff + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    const maxStep = Minion.TURN_SPEED * dt;
    if (Math.abs(diff) <= maxStep) {
      this.root.rotation.y = this.targetYaw;
    } else {
      this.root.rotation.y += Math.sign(diff) * maxStep;
    }
  }

  /**
   * 镜头注视点：身体球心世界坐标。
   * 不含行走颠簸，避免镜头跟着抖。
   */
  getFocusPoint(out = new Vector3()): Vector3 {
    const s = this.root.scaling.y;
    out.set(
      this.root.position.x,
      this.root.position.y + Minion.BODY_LOCAL_Y * s,
      this.root.position.z,
    );
    return out;
  }
}

function ball(
  scene: Scene,
  name: string,
  diameter: number,
  material: StandardMaterial,
  segments = 16,
  flat = false,
): Mesh {
  const m = MeshBuilder.CreateSphere(name, { diameter, segments }, scene);
  m.material = material;
  if (flat) applyFlatShading(m);
  return m;
}

/** 平面着色：拆分平滑法线，露出棱角（对应 Three flat: true） */
function applyFlatShading(mesh: Mesh): void {
  mesh.convertToFlatShadedMesh();
}

function cast(mesh: Mesh, shadowGen?: ShadowGenerator): void {
  mesh.receiveShadows = true;
  shadowGen?.addShadowCaster(mesh);
}

/**
 * lol-3d 巫师帽：圆盘帽檐 + 外侧包边 + 深色饰带 + 饱满圆顶。
 * 相对身体球心深扣并后倾（本地 +Z 为前）。
 * 帽顶用整球略压扁、半埋进帽檐，避免空心半球从上方看到暗内侧。
 */
function attachWizardHat(
  scene: Scene,
  bodyRoot: TransformNode,
  shadowGen?: ShadowGenerator,
): void {
  const hatGroup = new TransformNode('wizardHat', scene);
  hatGroup.parent = bodyRoot;
  // 比 lol-3d 略抬高，减少“扣死”在头上的紧绷感
  hatGroup.position = new Vector3(0, Minion.BODY_LOCAL_Y + 0.2, -0.05);
  hatGroup.rotation.x = -0.36;
  hatGroup.rotation.z = -0.04;

  const hatMat = mat(scene, 'minionHatRed', Minion.HAT_RED);
  const bandMat = mat(scene, 'minionHatBand', Minion.HAT_RED_BAND);

  // 1. 帽檐底盘
  const brimRadius = 0.52;
  const brimDisk = MeshBuilder.CreateCylinder(
    'hatBrim',
    {
      diameter: brimRadius * 2,
      height: 0.05,
      tessellation: 32,
    },
    scene,
  );
  brimDisk.material = hatMat;
  brimDisk.parent = hatGroup;
  cast(brimDisk, shadowGen);

  // 2. 帽檐外侧圆润包边（Babylon Torus 默认躺在 XZ）
  const brimRim = MeshBuilder.CreateTorus(
    'hatBrimRim',
    {
      diameter: brimRadius * 2,
      thickness: 0.06,
      tessellation: 32,
    },
    scene,
  );
  brimRim.material = hatMat;
  brimRim.parent = hatGroup;
  cast(brimRim, shadowGen);

  // 3. 饰带（帽环）
  const band = MeshBuilder.CreateTorus(
    'hatBand',
    {
      diameter: 0.84,
      thickness: 0.076,
      tessellation: 32,
    },
    scene,
  );
  band.position.y = 0.03;
  band.material = bandMat;
  band.parent = hatGroup;
  cast(band, shadowGen);

  // 4. 实心圆顶：整球压扁，球心落在帽檐上，只露出上半球外表面（亮红）
  const domeRadius = 0.42;
  const dome = MeshBuilder.CreateSphere(
    'hatDome',
    {
      diameter: domeRadius * 2,
      segments: 28,
    },
    scene,
  );
  dome.scaling = new Vector3(1, 0.85, 1);
  dome.position.y = 0.02;
  dome.material = hatMat;
  dome.parent = hatGroup;
  cast(dome, shadowGen);
}

interface StaffFx {
  root: TransformNode;
  orb: Mesh;
  orbMat: StandardMaterial;
  core: Mesh;
  coreMat: StandardMaterial;
  halos: Mesh[];
  aura: Mesh;
  auraMat: StandardMaterial;
  crown: TransformNode;
  sparks: Mesh[];
  t: number;
}

/**
 * 浮夸魔法杖：巨型炫彩水晶 + 三层原子光环 + 双层星轨 + 外光晕 + 尖刺冠 + 满身金箍。
 * 挂在右手，杖身近直立、略前倾。
 */
function attachMagicStaff(
  scene: Scene,
  rightHand: Mesh,
  shadowGen?: ShadowGenerator,
): StaffFx {
  const root = new TransformNode('magicStaff', scene);
  root.parent = rightHand;
  root.position = new Vector3(0, -0.06, 0);
  root.rotation.x = -0.32;
  root.rotation.z = 0.1;
  // 整体放大一截，更压迫感
  root.scaling = new Vector3(1.15, 1.15, 1.15);

  const woodMat = mat(scene, 'staffWood', 0x1a1210);
  const metalMat = emissiveMat(scene, 'staffMetal', 0xa8b8d0, 0.4);
  const goldMat = emissiveMat(scene, 'staffGold', 0xffd24a, 0.55);
  const orbMat = emissiveMat(scene, 'staffOrb', 0xb44dff, 1.0);
  const coreMat = emissiveMat(scene, 'staffOrbCore', 0xffffff, 1.4);
  const sparkMat = emissiveMat(scene, 'staffSpark', 0xff66ee, 1.2);
  const sparkMat2 = emissiveMat(scene, 'staffSpark2', 0x66f0ff, 1.2);
  const auraMat = emissiveMat(scene, 'staffAura', 0x8844ff, 0.6);
  auraMat.alpha = 0.22;
  auraMat.transparencyMode = StandardMaterial.MATERIAL_ALPHABLEND;
  auraMat.backFaceCulling = false;
  auraMat.disableDepthWrite = true;

  // —— 超长杖身 ——
  const shaft = MeshBuilder.CreateCylinder(
    'staffShaft',
    {
      height: 1.25,
      diameterTop: 0.03,
      diameterBottom: 0.06,
      tessellation: 14,
    },
    scene,
  );
  shaft.position.y = 0.32;
  shaft.material = woodMat;
  shaft.parent = root;
  cast(shaft, shadowGen);

  // 满身螺旋金箍
  for (let i = 0; i < 7; i++) {
    const wrap = MeshBuilder.CreateTorus(
      `staffWrap_${i}`,
      { diameter: 0.055 + i * 0.004, thickness: 0.014, tessellation: 16 },
      scene,
    );
    wrap.position.y = -0.12 + i * 0.12;
    wrap.rotation.x = 0.35;
    wrap.material = i % 2 === 0 ? goldMat : metalMat;
    wrap.parent = root;
    cast(wrap, shadowGen);
  }

  // 底端巨型宝珠
  const pommel = MeshBuilder.CreateSphere(
    'staffPommel',
    { diameter: 0.12, segments: 14 },
    scene,
  );
  pommel.position.y = -0.32;
  pommel.material = goldMat;
  pommel.parent = root;
  cast(pommel, shadowGen);

  const pommelGem = MeshBuilder.CreatePolyhedron(
    'staffPommelGem',
    { type: 2, size: 0.035 },
    scene,
  );
  pommelGem.position.y = -0.32;
  pommelGem.material = emissiveMat(scene, 'staffPommelGem', 0xff44aa, 0.9);
  pommelGem.parent = root;

  // 中段大水晶簇
  for (const [i, y, size, hex] of [
    [0, 0.28, 0.04, 0x66f0ff],
    [1, 0.42, 0.05, 0xff66ee],
    [2, 0.56, 0.038, 0xffd24a],
  ] as const) {
    const gem = MeshBuilder.CreatePolyhedron(
      `staffMidGem_${i}`,
      { type: 1, size },
      scene,
    );
    gem.position.y = y;
    gem.rotation.y = i * 0.7;
    gem.material = emissiveMat(scene, `staffMidGemMat_${i}`, hex, 0.85);
    gem.parent = root;
    cast(gem, shadowGen);
  }

  // 顶端宽箍
  const collar = MeshBuilder.CreateCylinder(
    'staffCollar',
    { height: 0.06, diameter: 0.12, tessellation: 16 },
    scene,
  );
  collar.position.y = 0.88;
  collar.material = goldMat;
  collar.parent = root;
  cast(collar, shadowGen);

  // 六爪夸张托座
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const claw = MeshBuilder.CreateCylinder(
      `staffClaw_${i}`,
      {
        height: 0.2,
        diameterTop: 0.008,
        diameterBottom: 0.028,
        tessellation: 8,
      },
      scene,
    );
    claw.position.set(Math.cos(a) * 0.07, 0.98, Math.sin(a) * 0.07);
    claw.rotation.z = Math.cos(a) * 0.7;
    claw.rotation.x = -Math.sin(a) * 0.7;
    claw.material = goldMat;
    claw.parent = root;
    cast(claw, shadowGen);
  }

  // —— 巨型主水晶 ——
  const headY = 1.15;
  const orb = MeshBuilder.CreateSphere(
    'staffOrb',
    { diameter: 0.28, segments: 24 },
    scene,
  );
  orb.position.y = headY;
  orb.material = orbMat;
  orb.parent = root;
  cast(orb, shadowGen);

  // 交叉钻石
  const crystal = MeshBuilder.CreatePolyhedron(
    'staffCrystal',
    { type: 2, size: 0.09 },
    scene,
  );
  crystal.position.y = headY;
  crystal.rotation.z = Math.PI / 5;
  crystal.material = emissiveMat(scene, 'staffCrystal', 0x66f0ff, 1.0);
  crystal.parent = root;
  cast(crystal, shadowGen);

  const core = MeshBuilder.CreateSphere(
    'staffOrbCore',
    { diameter: 0.1, segments: 14 },
    scene,
  );
  core.position.y = headY;
  core.material = coreMat;
  core.parent = root;

  // 三层原子光环（青 / 粉 / 金）
  const haloSpecs: Array<{ d: number; th: number; hex: number; rx: number }> = [
    { d: 0.38, th: 0.022, hex: 0x66f0ff, rx: Math.PI / 2.2 },
    { d: 0.48, th: 0.02, hex: 0xff44cc, rx: Math.PI / 3.1 },
    { d: 0.58, th: 0.018, hex: 0xffd24a, rx: Math.PI / 4.5 },
  ];
  const halos: Mesh[] = [];
  for (const [i, spec] of haloSpecs.entries()) {
    const halo = MeshBuilder.CreateTorus(
      `staffHalo_${i}`,
      { diameter: spec.d, thickness: spec.th, tessellation: 36 },
      scene,
    );
    halo.position.y = headY;
    halo.rotation.x = spec.rx;
    halo.rotation.y = i * 1.1;
    halo.material = emissiveMat(scene, `staffHaloMat_${i}`, spec.hex, 1.0);
    halo.parent = root;
    cast(halo, shadowGen);
    halos.push(halo);
  }

  // 外层大光晕球
  const aura = MeshBuilder.CreateSphere(
    'staffAura',
    { diameter: 0.55, segments: 20 },
    scene,
  );
  aura.position.y = headY;
  aura.material = auraMat;
  aura.parent = root;

  // 尖刺冠（上方一圈刺）
  const crown = new TransformNode('staffCrown', scene);
  crown.parent = root;
  crown.position.y = headY;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const spike = MeshBuilder.CreateCylinder(
      `staffSpike_${i}`,
      {
        height: 0.18,
        diameterTop: 0,
        diameterBottom: 0.035,
        tessellation: 6,
      },
      scene,
    );
    spike.position.set(Math.cos(a) * 0.12, 0.14, Math.sin(a) * 0.12);
    // 尖刺朝外上
    spike.rotation.z = Math.cos(a) * 0.9;
    spike.rotation.x = -Math.sin(a) * 0.9;
    spike.material = goldMat;
    spike.parent = crown;
    cast(spike, shadowGen);
  }

  // 双层星轨：6 内粉 + 6 外青
  const sparks: Mesh[] = [];
  for (let i = 0; i < 12; i++) {
    const s = MeshBuilder.CreateSphere(
      `staffSpark_${i}`,
      { diameter: i < 6 ? 0.04 : 0.032, segments: 8 },
      scene,
    );
    s.material = i < 6 ? sparkMat : sparkMat2;
    s.parent = orb;
    sparks.push(s);
  }

  return {
    root,
    orb,
    orbMat,
    core,
    coreMat,
    halos,
    aura,
    auraMat,
    crown,
    sparks,
    t: 0,
  };
}

function emissiveMat(
  scene: Scene,
  name: string,
  hex: number,
  intensity: number,
): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  const c = colorFromHex(hex);
  m.diffuseColor = c;
  m.emissiveColor = new Color3(
    Math.min(1, c.r * intensity),
    Math.min(1, c.g * intensity),
    Math.min(1, c.b * intensity),
  );
  m.specularColor = Color3.Black();
  m.disableLighting = intensity >= 0.75;
  return m;
}

type FaceStyle = 'cute' | 'fierce' | 'dumb' | 'sad';

/** 脸贴图按「底色+表情+是否马赛克」缓存 */
const faceTextureCache = new Map<string, DynamicTexture>();
const FACE_TEX_VERSION = 18;

function getFaceTexture(
  scene: Scene,
  bodyColor: number,
  style: FaceStyle = 'cute',
  mosaic = false,
): DynamicTexture {
  const key = `${bodyColor.toString(16)}_${style}_m${mosaic ? 1 : 0}`;
  const cached = faceTextureCache.get(key);
  if (cached) {
    const v = (cached as DynamicTexture & { _faceVer?: number })._faceVer;
    if (v === FACE_TEX_VERSION) return cached;
    cached.dispose();
    faceTextureCache.delete(key);
  }
  let tex: DynamicTexture;
  if (style === 'fierce') {
    tex = createFierceFaceTexture(scene, bodyColor);
  } else if (style === 'dumb') {
    tex = createDumbFaceTexture(scene, bodyColor);
  } else if (style === 'sad') {
    tex = createSadFaceTexture(scene, bodyColor);
  } else {
    tex = createCuteFaceTexture(scene, bodyColor);
  }
  if (mosaic) {
    // 块大小：越大越「马赛克」
    applyMosaicFilter(tex, 12);
  }
  (tex as DynamicTexture & { _faceVer?: number })._faceVer = FACE_TEX_VERSION;
  faceTextureCache.set(key, tex);
  return tex;
}

/**
 * 通用马赛克滤镜：对已有脸贴图按 block×block 取平均色填块，
 * 与表情绘制无关，cute / fierce 均可。
 */
function applyMosaicFilter(tex: DynamicTexture, blockSize: number): void {
  const size = tex.getSize();
  const w = size.width;
  const h = size.height;
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const src = ctx.getImageData(0, 0, w, h);
  const data = src.data;
  const block = Math.max(2, Math.floor(blockSize));

  for (let y = 0; y < h; y += block) {
    const bh = Math.min(block, h - y);
    for (let x = 0; x < w; x += block) {
      const bw = Math.min(block, w - x);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let py = 0; py < bh; py++) {
        for (let px = 0; px < bw; px++) {
          const i = ((y + py) * w + (x + px)) * 4;
          r += data[i]!;
          g += data[i + 1]!;
          b += data[i + 2]!;
          a += data[i + 3]!;
          n++;
        }
      }
      if (n === 0) continue;
      r = Math.round(r / n);
      g = Math.round(g / n);
      b = Math.round(b / n);
      a = Math.round(a / n);
      for (let py = 0; py < bh; py++) {
        for (let px = 0; px < bw; px++) {
          const i = ((y + py) * w + (x + px)) * 4;
          data[i] = r;
          data[i + 1] = g;
          data[i + 2] = b;
          data[i + 3] = a;
        }
      }
    }
  }

  ctx.putImageData(src, 0, 0);
  tex.update();
  tex.updateSamplingMode(Texture.NEAREST_SAMPLINGMODE);
}

function makeFaceCanvas(
  scene: Scene,
  name: string,
  bodyColor: number,
): {
  tex: DynamicTexture;
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
} {
  const width = 1024;
  const height = 512;
  const tex = new DynamicTexture(
    name,
    { width, height },
    scene,
    false,
    undefined,
    undefined,
    false,
  );
  // 球面 UV 翻转适配 Babylon
  tex.uScale = -1;
  tex.uOffset = 1;
  tex.vScale = -1;
  tex.vOffset = 1;
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const bodyHex = `#${bodyColor.toString(16).padStart(6, '0')}`;
  ctx.fillStyle = bodyHex;
  ctx.fillRect(0, 0, width, height);
  return { tex, ctx, width, height };
}

/**
 * 可爱表情：大圆眼 + 腮红 + 微笑。
 * 球面 UV：u=0.5 对应几何 +X；身体已旋转使 +X → 角色正前方。
 */
function createCuteFaceTexture(
  scene: Scene,
  bodyColor: number,
): DynamicTexture {
  const { tex, ctx, width, height } = makeFaceCanvas(
    scene,
    'minionFaceCute',
    bodyColor,
  );
  const darkBrown = '#2b2123';

  const cx = width * 0.5;
  const eyeY = height * 0.49;
  const eyeGap = width * 0.075;
  const eyeRy = height * 0.1;
  const eyeRx = eyeRy;

  const drawBlush = (bx: number): void => {
    const g = ctx.createRadialGradient(
      bx,
      height * 0.59,
      0,
      bx,
      height * 0.59,
      height * 0.08,
    );
    g.addColorStop(0, 'rgba(255, 120, 140, 0.52)');
    g.addColorStop(0.5, 'rgba(255, 140, 160, 0.28)');
    g.addColorStop(1, 'rgba(255, 180, 190, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(
      bx,
      height * 0.59,
      eyeRx * 0.9,
      eyeRy * 0.55,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  };
  drawBlush(cx - eyeGap * 1.55);
  drawBlush(cx + eyeGap * 1.55);

  ctx.strokeStyle = darkBrown;
  ctx.lineWidth = height * 0.016;
  ctx.lineCap = 'round';

  ctx.beginPath();
  ctx.ellipse(
    cx - eyeGap - width * 0.005,
    eyeY - eyeRy * 1.15,
    eyeRx * 0.5,
    eyeRy * 0.5,
    0,
    Math.PI * 1.15,
    Math.PI * 1.75,
  );
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(
    cx + eyeGap + width * 0.005,
    eyeY - eyeRy * 1.15,
    eyeRx * 0.5,
    eyeRy * 0.5,
    0,
    Math.PI * 1.25,
    Math.PI * 1.85,
  );
  ctx.stroke();

  const drawEye = (ex: number): void => {
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, eyeRx, eyeRy, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#21181b';
    ctx.fill();

    const innerG = ctx.createLinearGradient(
      ex,
      eyeY - eyeRy,
      ex,
      eyeY + eyeRy,
    );
    innerG.addColorStop(0, '#1d1518');
    innerG.addColorStop(0.65, '#3a2b2f');
    innerG.addColorStop(1, '#664c54');
    ctx.fillStyle = innerG;
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, eyeRx * 0.96, eyeRy * 0.96, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#140c0e';
    ctx.beginPath();
    ctx.ellipse(
      ex,
      eyeY + eyeRy * 0.05,
      eyeRx * 0.7,
      eyeRy * 0.7,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(
      ex - eyeRx * 0.32,
      eyeY - eyeRy * 0.32,
      eyeRx * 0.38,
      eyeRy * 0.44,
      -Math.PI / 6,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(
      ex + eyeRx * 0.35,
      eyeY + eyeRy * 0.35,
      eyeRx * 0.2,
      eyeRy * 0.2,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(
      ex - eyeRx * 0.42,
      eyeY + eyeRy * 0.32,
      eyeRx * 0.09,
      eyeRy * 0.09,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  };

  drawEye(cx - eyeGap);
  drawEye(cx + eyeGap);

  ctx.strokeStyle = darkBrown;
  ctx.lineWidth = height * 0.016;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.ellipse(
    cx,
    height * 0.555,
    eyeRx * 0.42,
    eyeRy * 0.42,
    0,
    Math.PI * 0.15,
    Math.PI * 0.85,
  );
  ctx.stroke();

  tex.update();
  return tex;
}

/**
 * 凶狠表情：浓粗倒八字眉 + 超大怒目 + 怒目眼白少 + 龇牙/皱嘴，无腮红。
 */
function createFierceFaceTexture(
  scene: Scene,
  bodyColor: number,
): DynamicTexture {
  const { tex, ctx, width, height } = makeFaceCanvas(
    scene,
    'minionFaceFierce',
    bodyColor,
  );
  const ink = '#1a1012';
  const brow = '#0d0809';

  const cx = width * 0.5;
  const eyeY = height * 0.48;
  const eyeGap = width * 0.09;
  // 更大眼睛
  const eyeRy = height * 0.135;
  const eyeRx = eyeRy * 1.05;

  // 眉心竖纹（怒）
  ctx.strokeStyle = ink;
  ctx.lineWidth = height * 0.012;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - width * 0.012, eyeY - eyeRy * 1.55);
  ctx.lineTo(cx - width * 0.004, eyeY - eyeRy * 1.15);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + width * 0.012, eyeY - eyeRy * 1.55);
  ctx.lineTo(cx + width * 0.004, eyeY - eyeRy * 1.15);
  ctx.stroke();

  // 浓粗倒八字眉（内侧下压）
  const drawBrow = (side: -1 | 1): void => {
    const ex = cx + side * eyeGap;
    ctx.strokeStyle = brow;
    ctx.lineWidth = height * 0.055;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    // 外高内低
    ctx.moveTo(ex + side * eyeRx * 1.15, eyeY - eyeRy * 1.55);
    ctx.quadraticCurveTo(
      ex + side * eyeRx * 0.15,
      eyeY - eyeRy * 1.75,
      ex - side * eyeRx * 0.55,
      eyeY - eyeRy * 0.95,
    );
    ctx.stroke();
    // 加粗第二笔
    ctx.lineWidth = height * 0.03;
    ctx.beginPath();
    ctx.moveTo(ex + side * eyeRx * 1.05, eyeY - eyeRy * 1.4);
    ctx.quadraticCurveTo(
      ex + side * eyeRx * 0.1,
      eyeY - eyeRy * 1.55,
      ex - side * eyeRx * 0.4,
      eyeY - eyeRy * 0.85,
    );
    ctx.stroke();
  };
  drawBrow(-1);
  drawBrow(1);

  const drawFierceEye = (ex: number, side: -1 | 1): void => {
    // 外轮廓（略扁圆、带锐角感）
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, eyeRx, eyeRy, side * 0.08, 0, Math.PI * 2);
    ctx.fillStyle = '#0f0a0b';
    ctx.fill();

    // 眼白偏少，深色虹膜大
    const scleraG = ctx.createRadialGradient(
      ex,
      eyeY,
      eyeRx * 0.2,
      ex,
      eyeY,
      eyeRx,
    );
    scleraG.addColorStop(0, '#3a2228');
    scleraG.addColorStop(0.55, '#1a1014');
    scleraG.addColorStop(1, '#0a0607');
    ctx.fillStyle = scleraG;
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, eyeRx * 0.97, eyeRy * 0.97, side * 0.08, 0, Math.PI * 2);
    ctx.fill();

    // 巨大瞳孔
    ctx.fillStyle = '#050304';
    ctx.beginPath();
    ctx.ellipse(
      ex + side * eyeRx * 0.04,
      eyeY + eyeRy * 0.06,
      eyeRx * 0.62,
      eyeRy * 0.7,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    // 锐利高光（小而凶）
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.beginPath();
    ctx.ellipse(
      ex - side * eyeRx * 0.22,
      eyeY - eyeRy * 0.28,
      eyeRx * 0.18,
      eyeRy * 0.22,
      -Math.PI / 5,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(
      ex + side * eyeRx * 0.28,
      eyeY + eyeRy * 0.22,
      eyeRx * 0.08,
      eyeRy * 0.09,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    // 上眼睑厚阴影（压低视线）
    ctx.fillStyle = 'rgba(10,6,8,0.55)';
    ctx.beginPath();
    ctx.ellipse(
      ex,
      eyeY - eyeRy * 0.55,
      eyeRx * 1.02,
      eyeRy * 0.55,
      side * 0.1,
      Math.PI * 1.05,
      Math.PI * 1.95,
    );
    ctx.fill();
  };

  drawFierceEye(cx - eyeGap, -1);
  drawFierceEye(cx + eyeGap, 1);

  // 鼻梁阴影（凶相更立体）
  ctx.strokeStyle = 'rgba(30,18,20,0.35)';
  ctx.lineWidth = height * 0.01;
  ctx.beginPath();
  ctx.moveTo(cx, eyeY + eyeRy * 0.55);
  ctx.lineTo(cx, height * 0.58);
  ctx.stroke();

  // 龇牙怒嘴：扁宽 + 锯齿上牙
  const mouthY = height * 0.62;
  const mouthW = eyeRx * 1.35;
  const mouthH = eyeRy * 0.55;

  ctx.fillStyle = '#1a0c10';
  ctx.beginPath();
  ctx.ellipse(cx, mouthY, mouthW, mouthH, 0, 0, Math.PI * 2);
  ctx.fill();

  // 上排牙
  ctx.fillStyle = '#f5f0ea';
  const teeth = 5;
  for (let i = 0; i < teeth; i++) {
    const tx =
      cx - mouthW * 0.55 + (i + 0.5) * ((mouthW * 1.1) / teeth);
    const tw = mouthW * 0.16;
    ctx.beginPath();
    ctx.moveTo(tx - tw * 0.5, mouthY - mouthH * 0.15);
    ctx.lineTo(tx + tw * 0.5, mouthY - mouthH * 0.15);
    ctx.lineTo(tx + tw * 0.35, mouthY + mouthH * 0.55);
    ctx.lineTo(tx - tw * 0.35, mouthY + mouthH * 0.55);
    ctx.closePath();
    ctx.fill();
  }

  // 嘴角下撇描边
  ctx.strokeStyle = ink;
  ctx.lineWidth = height * 0.018;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.ellipse(cx, mouthY, mouthW * 1.02, mouthH * 1.05, 0, 0.05 * Math.PI, 0.95 * Math.PI);
  ctx.stroke();

  tex.update();
  return tex;
}

/**
 * 呆萌表情：参考浓连心眉（两端粗、眉心相连）+ 小小圆眼 + O 型香肠嘴。
 */
function createDumbFaceTexture(
  scene: Scene,
  bodyColor: number,
): DynamicTexture {
  const { tex, ctx, width, height } = makeFaceCanvas(
    scene,
    'minionFaceDumb',
    bodyColor,
  );
  const ink = '#1c1210';
  const browDark = '#14100e';

  const cx = width * 0.5;
  const eyeY = height * 0.49;
  const eyeGap = width * 0.072;
  // 小眼睛
  const eyeR = height * 0.022;

  // —— 浓眉：更大、更夸张；近乎连心、两端粗壮、带毛流感 ——
  const drawBushyBrow = (side: -1 | 1): void => {
    const outerX = cx + side * (eyeGap + eyeR * 6.5);
    const innerX = cx + side * (width * 0.008); // 几乎连到眉心
    const midX = cx + side * eyeGap * 1.05;
    // 眉峰更高，外梢略低
    const outerY = eyeY - eyeR * 1.6;
    const midY = eyeY - eyeR * 5.2;
    const innerY = eyeY - eyeR * 3.4;
    const thickOuter = height * 0.065;
    const thickMid = height * 0.11;
    const thickInner = height * 0.078;

    // 主体填充：上下沿贝塞尔
    ctx.beginPath();
    // 上沿 outer → inner
    ctx.moveTo(outerX, outerY);
    ctx.bezierCurveTo(
      midX + side * eyeR * 0.5,
      midY - thickMid * 0.55,
      midX - side * eyeR * 0.2,
      midY - thickMid * 0.45,
      innerX,
      innerY - thickInner * 0.35,
    );
    // 下沿 inner → outer
    ctx.bezierCurveTo(
      midX - side * eyeR * 0.1,
      midY + thickMid * 0.55,
      midX + side * eyeR * 0.8,
      outerY + thickOuter * 0.85,
      outerX,
      outerY + thickOuter * 0.15,
    );
    ctx.closePath();
    ctx.fillStyle = browDark;
    ctx.fill();

    // 毛流感：沿眉走向画一撮撮短线
    ctx.strokeStyle = ink;
    ctx.lineCap = 'round';
    for (let i = 0; i < 18; i++) {
      const t = i / 17;
      // 位置从外到内
      const x =
        outerX * (1 - t) * (1 - t) +
        2 * midX * (1 - t) * t +
        innerX * t * t;
      const yBase =
        outerY * (1 - t) * (1 - t) +
        2 * midY * (1 - t) * t +
        innerY * t * t;
      const thick =
        thickOuter * (1 - t) * (1 - t) +
        2 * thickMid * (1 - t) * t +
        thickInner * t * t;
      const ang = side > 0 ? -0.35 - t * 0.25 : Math.PI + 0.35 + t * 0.25;
      const len = thick * (0.55 + (i % 3) * 0.12);
      ctx.lineWidth = height * (0.008 + (i % 2) * 0.004);
      ctx.globalAlpha = 0.55 + (i % 3) * 0.12;
      ctx.beginPath();
      ctx.moveTo(x - Math.cos(ang) * len * 0.15, yBase - Math.sin(ang) * len * 0.1);
      ctx.lineTo(
        x + Math.cos(ang) * len * 0.7,
        yBase - thick * 0.35 + Math.sin(ang) * len * 0.15,
      );
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 眉心加厚衔接（两侧都画一点，叠成连心）
    ctx.fillStyle = browDark;
    ctx.beginPath();
    ctx.ellipse(
      cx + side * width * 0.014,
      eyeY - eyeR * 3.5,
      width * 0.028,
      height * 0.042,
      side * 0.2,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  };
  drawBushyBrow(-1);
  drawBushyBrow(1);

  // 眉心中缝再盖一笔，真正“连心”
  ctx.fillStyle = browDark;
  ctx.beginPath();
  ctx.ellipse(cx, eyeY - eyeR * 3.6, width * 0.036, height * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();
  // 眉心短竖毛
  ctx.strokeStyle = ink;
  ctx.lineWidth = height * 0.012;
  ctx.globalAlpha = 0.7;
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath();
    ctx.moveTo(cx + i * width * 0.007, eyeY - eyeR * 4.4);
    ctx.lineTo(cx + i * width * 0.005, eyeY - eyeR * 2.6);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // 眼睛：纯小黑点
  ctx.fillStyle = '#0a0808';
  for (const ex of [cx - eyeGap, cx + eyeGap]) {
    ctx.beginPath();
    ctx.arc(ex, eyeY, eyeR * 0.85, 0, Math.PI * 2);
    ctx.fill();
  }

  // O 型香肠嘴：厚描边椭圆环，中间留空（像香肠圈/惊叹 O 嘴）
  const mouthY = height * 0.64;
  const mouthRx = width * 0.095;
  const mouthRy = height * 0.12;

  // 外圈填充（细嘴唇：内孔更大 → 环更细）
  const lipInner = 0.78;
  ctx.beginPath();
  ctx.ellipse(cx, mouthY, mouthRx, mouthRy, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#2b2123';
  ctx.fill();
  // 内圈挖空（用身体色）
  const bodyHex = `#${bodyColor.toString(16).padStart(6, '0')}`;
  ctx.beginPath();
  ctx.ellipse(cx, mouthY, mouthRx * lipInner, mouthRy * lipInner, 0, 0, Math.PI * 2);
  ctx.fillStyle = bodyHex;
  ctx.fill();
  // 细描边
  ctx.strokeStyle = ink;
  ctx.lineWidth = height * 0.008;
  ctx.beginPath();
  ctx.ellipse(cx, mouthY, mouthRx, mouthRy, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(cx, mouthY, mouthRx * lipInner, mouthRy * lipInner, 0, 0, Math.PI * 2);
  ctx.stroke();

  tex.update();
  return tex;
}

/**
 * 悲伤表情：八字眉下垂 + 含泪圆眼 + 下撇小嘴 + 泪珠。
 */
function createSadFaceTexture(
  scene: Scene,
  bodyColor: number,
): DynamicTexture {
  const { tex, ctx, width, height } = makeFaceCanvas(
    scene,
    'minionFaceSad',
    bodyColor,
  );
  const ink = '#2b2123';
  const tearBlue = 'rgba(120, 180, 230, 0.85)';

  const cx = width * 0.5;
  const eyeY = height * 0.48;
  const eyeGap = width * 0.078;
  const eyeRy = height * 0.085;
  const eyeRx = eyeRy * 0.95;

  // 八字眉：内侧高、外侧低（悲伤下垂）
  const drawSadBrow = (side: -1 | 1): void => {
    const ex = cx + side * eyeGap;
    ctx.strokeStyle = ink;
    ctx.lineWidth = height * 0.022;
    ctx.lineCap = 'round';
    ctx.beginPath();
    // 内高外低
    ctx.moveTo(ex - side * eyeRx * 0.15, eyeY - eyeRy * 1.55);
    ctx.quadraticCurveTo(
      ex + side * eyeRx * 0.35,
      eyeY - eyeRy * 1.15,
      ex + side * eyeRx * 1.05,
      eyeY - eyeRy * 0.85,
    );
    ctx.stroke();
  };
  drawSadBrow(-1);
  drawSadBrow(1);

  const drawSadEye = (ex: number, side: -1 | 1): void => {
    // 眼白
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, eyeRx, eyeRy, side * 0.05, 0, Math.PI * 2);
    ctx.fillStyle = '#21181b';
    ctx.fill();

    // 虹膜偏下（含泪下垂感）
    const pupilY = eyeY + eyeRy * 0.12;
    ctx.fillStyle = '#140c0e';
    ctx.beginPath();
    ctx.ellipse(ex, pupilY, eyeRx * 0.62, eyeRy * 0.68, 0, 0, Math.PI * 2);
    ctx.fill();

    // 高光
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(
      ex - eyeRx * 0.28,
      eyeY - eyeRy * 0.22,
      eyeRx * 0.28,
      eyeRy * 0.32,
      -Math.PI / 7,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    // 下眼睑泪光
    ctx.fillStyle = 'rgba(160, 200, 230, 0.35)';
    ctx.beginPath();
    ctx.ellipse(
      ex,
      eyeY + eyeRy * 0.55,
      eyeRx * 0.75,
      eyeRy * 0.35,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  };
  drawSadEye(cx - eyeGap, -1);
  drawSadEye(cx + eyeGap, 1);

  // 泪珠（左眼下一滴）
  ctx.fillStyle = tearBlue;
  ctx.beginPath();
  const tearX = cx - eyeGap - eyeRx * 0.15;
  const tearY = eyeY + eyeRy * 1.15;
  ctx.moveTo(tearX, tearY - height * 0.012);
  ctx.quadraticCurveTo(
    tearX + width * 0.012,
    tearY + height * 0.02,
    tearX,
    tearY + height * 0.045,
  );
  ctx.quadraticCurveTo(
    tearX - width * 0.012,
    tearY + height * 0.02,
    tearX,
    tearY - height * 0.012,
  );
  ctx.fill();
  // 泪珠高光
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.ellipse(
    tearX - width * 0.003,
    tearY + height * 0.008,
    width * 0.004,
    height * 0.006,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // 右侧小泪痕
  ctx.strokeStyle = 'rgba(120, 180, 230, 0.55)';
  ctx.lineWidth = height * 0.01;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx + eyeGap + eyeRx * 0.2, eyeY + eyeRy * 0.9);
  ctx.quadraticCurveTo(
    cx + eyeGap + eyeRx * 0.35,
    eyeY + eyeRy * 1.4,
    cx + eyeGap + eyeRx * 0.15,
    eyeY + eyeRy * 1.7,
  );
  ctx.stroke();

  // 下撇悲伤小嘴
  ctx.strokeStyle = ink;
  ctx.lineWidth = height * 0.018;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.ellipse(
    cx,
    height * 0.64,
    eyeRx * 0.55,
    eyeRy * 0.42,
    0,
    Math.PI * 1.15,
    Math.PI * 1.85,
  );
  ctx.stroke();

  tex.update();
  return tex;
}

function mat(scene: Scene, name: string, hex: number): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = colorFromHex(hex);
  m.specularColor = Color3.Black();
  return m;
}

function colorFromHex(hex: number): Color3 {
  return new Color3(
    ((hex >> 16) & 0xff) / 255,
    ((hex >> 8) & 0xff) / 255,
    (hex & 0xff) / 255,
  );
}
