import {
  Color3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  type Scene,
  ShadowGenerator,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core';

/**
 * 极简五球小兵模型（无帽子、无法杖）：身体 + 双手 + 双脚。
 * 仅视觉；缩放 / 朝向参考 lol-3d。
 */
export class Minion {
  static readonly SCALE = 0.5;
  /** 身体球心本地 Y（用于镜头注视点） */
  static readonly BODY_LOCAL_Y = 0.63;
  static readonly BODY = 0xf3eee6;
  static readonly LIMB = 0xf3eee6;
  /** 右手高亮色 */
  static readonly RIGHT_HAND = 0xe53935;

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

  constructor(
    scene: Scene,
    x = 0,
    z = 0,
    options: {
      /** 面朝 +X（蓝）或 -X（红） */
      facePositiveX?: boolean;
      shadowGenerator?: ShadowGenerator;
    } = {},
  ) {
    const facePositiveX = options.facePositiveX ?? true;
    const shadowGen = options.shadowGenerator;

    this.root = new TransformNode(`Minion_${x}_${z}`, scene);
    this.root.position = new Vector3(x, 0, z);
    this.root.scaling = new Vector3(
      Minion.SCALE,
      Minion.SCALE,
      Minion.SCALE,
    );
    // 蓝方面朝 +X，红方面朝 -X（本地 +Z → 世界 (sin yaw, cos yaw)）
    this.root.rotation.y = facePositiveX ? Math.PI / 2 : -Math.PI / 2;
    this.targetYaw = this.root.rotation.y;

    this.bodyRoot = new TransformNode('bodyRoot', scene);
    this.bodyRoot.parent = this.root;

    const limbMat = mat(scene, 'minionLimb', Minion.LIMB);
    const rightHandMat = mat(scene, 'minionRightHand', Minion.RIGHT_HAND);
    const faceTex = getFaceTexture(scene);
    const bodyMat = new StandardMaterial('minionBody', scene);
    bodyMat.diffuseTexture = faceTex;
    bodyMat.specularColor = Color3.Black();

    // 身体：贴图脸在 u≈0.5；Babylon 球面与 Three 经度起点相反，+Y 旋转把脸转到本地 +Z
    const body = MeshBuilder.CreateSphere(
      'body',
      { diameter: 0.84, segments: 24 },
      scene,
    );
    // 身体底 y≈0.21、脚顶 y=0.2 → 与脚间隔 0.01；脚仍贴地
    body.position.y = Minion.BODY_LOCAL_Y;
    body.rotation.y = Math.PI / 2;
    body.material = bodyMat;
    body.parent = this.bodyRoot;
    cast(body, shadowGen);

    // 双手（左右镜像对称；略靠后）
    this.leftHandRest = new Vector3(0.5, 0.5, 0.05);
    this.rightHandRest = new Vector3(-0.5, 0.5, 0.05);
    this.leftHand = ball(scene, 'leftHand', 0.2, limbMat);
    this.leftHand.position.copyFrom(this.leftHandRest);
    this.leftHand.parent = this.bodyRoot;
    cast(this.leftHand, shadowGen);

    this.rightHand = ball(scene, 'rightHand', 0.2, rightHandMat);
    this.rightHand.position.copyFrom(this.rightHandRest);
    this.rightHand.parent = this.bodyRoot;
    cast(this.rightHand, shadowGen);

    // 双脚（脚心约 y=0.1，半径 0.1 → 底贴地）
    this.leftFootRest = new Vector3(0.14, 0.1, 0.02);
    this.rightFootRest = new Vector3(-0.14, 0.1, 0.02);
    this.leftFoot = ball(scene, 'leftFoot', 0.2, limbMat);
    this.leftFoot.position.copyFrom(this.leftFootRest);
    this.leftFoot.parent = this.bodyRoot;
    cast(this.leftFoot, shadowGen);

    this.rightFoot = ball(scene, 'rightFoot', 0.2, limbMat);
    this.rightFoot.position.copyFrom(this.rightFootRest);
    this.rightFoot.parent = this.bodyRoot;
    cast(this.rightFoot, shadowGen);
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

    // 双手：前后摆 + 轻微上下
    this.leftHand.position.set(
      this.leftHandRest.x,
      this.leftHandRest.y + Minion.HAND_BOB * swing,
      this.leftHandRest.z + Minion.HAND_SWING * swing,
    );
    this.rightHand.position.set(
      this.rightHandRest.x,
      this.rightHandRest.y - Minion.HAND_BOB * swing,
      this.rightHandRest.z - Minion.HAND_SWING * swing,
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
): Mesh {
  const m = MeshBuilder.CreateSphere(name, { diameter, segments: 16 }, scene);
  m.material = material;
  return m;
}

function cast(mesh: Mesh, shadowGen?: ShadowGenerator): void {
  mesh.receiveShadows = true;
  shadowGen?.addShadowCaster(mesh);
}

/** 脸贴图全场景共享一份（改 UV/绘制后 bump 版本号可强制重建） */
let sharedFaceTexture: DynamicTexture | null = null;
const FACE_TEX_VERSION = 3;

function getFaceTexture(scene: Scene): DynamicTexture {
  if (sharedFaceTexture) {
    const v = (sharedFaceTexture as DynamicTexture & { _faceVer?: number })
      ._faceVer;
    if (v === FACE_TEX_VERSION) return sharedFaceTexture;
    sharedFaceTexture.dispose();
    sharedFaceTexture = null;
  }
  sharedFaceTexture = createBodyFaceTexture(scene, Minion.BODY);
  (sharedFaceTexture as DynamicTexture & { _faceVer?: number })._faceVer =
    FACE_TEX_VERSION;
  return sharedFaceTexture;
}

/**
 * 身体贴图：底色 + 正面可爱表情（大圆眼 + 腮红 + 微笑）。
 * 球面 UV：u=0.5 对应几何 +X；身体已旋转使 +X → 角色正前方。
 */
function createBodyFaceTexture(
  scene: Scene,
  bodyColor: number,
): DynamicTexture {
  const width = 1024;
  const height = 512;
  // 画布正向绘制；再用 UV 翻转适配 Babylon 球面（否则会出现眉嘴颠倒）
  const tex = new DynamicTexture(
    'minionFace',
    { width, height },
    scene,
    false,
    undefined,
    undefined,
    false,
  );
  // 左右：球面经度方向与画布相反
  tex.uScale = -1;
  tex.uOffset = 1;
  // 上下：球面 V 与画布 Y 相反（修好「嘴在上、眉在下」）
  tex.vScale = -1;
  tex.vOffset = 1;
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;

  const bodyHex = `#${bodyColor.toString(16).padStart(6, '0')}`;
  const darkBrown = '#2b2123';

  ctx.fillStyle = bodyHex;
  ctx.fillRect(0, 0, width, height);

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
