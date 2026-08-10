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
  static readonly SCALE = 0.25;
  static readonly BODY = 0xf3eee6;
  static readonly LIMB = 0xf3eee6;

  readonly root: TransformNode;
  readonly bodyRoot: TransformNode;

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
    // 蓝方面朝 +X，红方面朝 -X
    this.root.rotation.y = facePositiveX ? Math.PI / 2 : -Math.PI / 2;

    this.bodyRoot = new TransformNode('bodyRoot', scene);
    this.bodyRoot.parent = this.root;

    const limbMat = mat(scene, 'minionLimb', Minion.LIMB);
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
    body.position.y = 0.66;
    body.rotation.y = Math.PI / 2;
    body.material = bodyMat;
    body.parent = this.bodyRoot;
    cast(body, shadowGen);

    // 双手
    const leftHand = ball(scene, 'leftHand', 0.2, limbMat);
    leftHand.position = new Vector3(0.47, 0.48, 0.1);
    leftHand.parent = this.bodyRoot;
    cast(leftHand, shadowGen);

    const rightHand = ball(scene, 'rightHand', 0.2, limbMat);
    rightHand.position = new Vector3(-0.52, 0.58, 0.2);
    rightHand.parent = this.bodyRoot;
    cast(rightHand, shadowGen);

    // 双脚（脚心约 y=0.1，半径 0.1 → 底贴地）
    const leftFoot = ball(scene, 'leftFoot', 0.2, limbMat);
    leftFoot.position = new Vector3(0.14, 0.1, 0.02);
    leftFoot.parent = this.bodyRoot;
    cast(leftFoot, shadowGen);

    const rightFoot = ball(scene, 'rightFoot', 0.2, limbMat);
    rightFoot.position = new Vector3(-0.14, 0.1, 0.02);
    rightFoot.parent = this.bodyRoot;
    cast(rightFoot, shadowGen);
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
