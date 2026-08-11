import {
  Color3,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  type Scene,
  ShadowGenerator,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { getFaceTexture, type FaceStyle } from './minion/faces';
import {
  attachHat,
  HAT_RED,
  HAT_RED_BAND,
  type HatStyle,
} from './minion/hat';
import { ball, cast, mat } from './minion/materials';
import {
  attachStaff,
  type StaffFx,
  type StaffStyle,
  updateStaffFx,
} from './minion/staff';

export type { FaceStyle } from './minion/faces';
export type { StaffStyle } from './minion/staff';
export type { HatStyle } from './minion/hat';

/** 小兵创建/外观选项 */
export interface MinionOptions {
  /** 面朝 +X（蓝）或 -X（红） */
  facePositiveX?: boolean;
  shadowGenerator?: ShadowGenerator;
  /**
   * 全身肤色（0xRRGGBB）：身体脸贴图底色 + 手脚同色。
   * 未设时：allBlack → 灰黑，否则纯白。
   */
  bodyColor?: number;
  /** 全身灰黑（等价 bodyColor = CHARCOAL；若同时设 bodyColor 以 bodyColor 为准） */
  allBlack?: boolean;
  /** 相对默认 SCALE 的倍率（1 = 正常，0.5 = 缩小一半） */
  scaleMultiplier?: number;
  /**
   * 帽子款式。
   * 若同时设 redHat=true 且未指定 hat，则用 'wizard'。
   */
  hat?: HatStyle;
  /** 戴红色巫师帽（等价 hat: 'wizard'） */
  redHat?: boolean;
  /**
   * 右手持法杖款式。
   * 若同时设 magicStaff=true 且未指定 staff，则用 'arcane'。
   */
  staff?: StaffStyle;
  /** 右手持炫彩魔法杖（等价 staff: 'arcane'） */
  magicStaff?: boolean;
  /** 表情 */
  face?: FaceStyle;
  /** 对当前表情贴图做马赛克像素化 */
  mosaicFace?: boolean;
  /** 低面数 + 平面着色 */
  lowPolyFlat?: boolean;
  /** 是否播放眨眼待机（默认 true） */
  blinkIdle?: boolean;
  /** 是否播放微弱呼吸（默认 true） */
  breathIdle?: boolean;
}

/**
 * 极简五球小兵：身体 + 双手 + 双脚（可选小帽 / 魔法杖）。
 * 外观配件与脸贴图拆到 minion/ 子模块。
 */
export class Minion {
  static readonly SCALE = 0.5;
  /** 身体球心本地 Y（用于镜头注视点） */
  static readonly BODY_LOCAL_Y = 0.63;
  static readonly BODY = 0xffffff;
  static readonly LIMB = 0xffffff;
  static readonly CHARCOAL = 0x3a3a42;
  static readonly HAT_RED = HAT_RED;
  static readonly HAT_RED_BAND = HAT_RED_BAND;

  static readonly WALK_HZ = 2.4;
  static readonly HAND_SWING = 0.16;
  static readonly HAND_BOB = 0.04;
  static readonly FOOT_STRIDE = 0.14;
  static readonly FOOT_LIFT = 0.1;
  static readonly BODY_BOB = 0.035;
  static readonly TURN_SPEED = 14;
  /** 呼吸频率（Hz，约 3s 一次） */
  static readonly BREATH_HZ = 0.32;
  /** 身体上下起伏幅度（本地单位） */
  static readonly BREATH_BOB = 0.01;
  /** 躯干 Y 缩放幅度（±） */
  static readonly BREATH_SCALE_Y = 0.022;
  /** 躯干 XZ 缩放幅度（吸气略鼓） */
  static readonly BREATH_SCALE_XZ = 0.014;
  /** 手部随呼吸轻抬 */
  static readonly BREATH_HAND = 0.006;
  /** 两次眨眼间隔（秒） */
  static readonly BLINK_GAP_MIN = 2.4;
  static readonly BLINK_GAP_MAX = 5.2;
  /** 闭眼持续（秒） */
  static readonly BLINK_CLOSED = 0.11;
  static readonly BLINK_CLOSED_DOUBLE = 0.08;

  readonly root: TransformNode;
  readonly bodyRoot: TransformNode;
  /**
   * 躯干锚点：身体球 + 帽子挂在此节点。
   * 呼吸缩放/位移只打在 torso 上，帽子与身体同步，避免相对滑动穿模。
   */
  private readonly torso: TransformNode;

  private readonly leftHand: Mesh;
  private readonly rightHand: Mesh;
  private readonly leftFoot: Mesh;
  private readonly rightFoot: Mesh;

  private readonly leftHandRest: Vector3;
  private readonly rightHandRest: Vector3;
  private readonly leftFootRest: Vector3;
  private readonly rightFootRest: Vector3;

  private readonly scene: Scene;
  private readonly bodyMat: StandardMaterial;
  private readonly skinColor: number;
  private readonly faceStyle: FaceStyle;
  private readonly mosaicFace: boolean;
  private readonly blinkEnabled: boolean;
  private readonly breathEnabled: boolean;

  private walkPhase = 0;
  private walkWeight = 0;
  private targetYaw = 0;
  private staffFx: StaffFx | null = null;
  /** 呼吸相位（弧度），各实例随机错开 */
  private breathPhase = 0;

  /** 距下次眨眼的倒计时（仅睁眼时有效） */
  private blinkTimer = 0;
  /** 闭眼剩余时间 */
  private blinkClosedT = 0;
  private eyesClosed = false;
  /** 睁眼后是否再眨一次（连眨） */
  private pendingDoubleBlink = false;
  /** 下一次闭眼是连眨的第二下 */
  private blinkFollowUp = false;

  constructor(scene: Scene, x = 0, z = 0, options: MinionOptions = {}) {
    const facePositiveX = options.facePositiveX ?? true;
    const shadowGen = options.shadowGenerator;
    const skinColor =
      options.bodyColor ??
      (options.allBlack ? Minion.CHARCOAL : Minion.BODY);
    const hatStyle: HatStyle | null =
      options.hat ?? (options.redHat ? 'wizard' : null);
    const staffStyle: StaffStyle | null =
      options.staff ?? (options.magicStaff ? 'arcane' : null);
    const faceStyle: FaceStyle = options.face ?? 'cute';
    const mosaicFace = options.mosaicFace ?? false;
    const lowPolyFlat = options.lowPolyFlat ?? false;
    const sphereSegments = lowPolyFlat ? 10 : 24;
    const limbSegments = lowPolyFlat ? 3 : 16;
    const scale = Minion.SCALE * (options.scaleMultiplier ?? 1);

    this.scene = scene;
    this.skinColor = skinColor;
    this.faceStyle = faceStyle;
    this.mosaicFace = mosaicFace;
    this.blinkEnabled = options.blinkIdle ?? true;
    this.breathEnabled = options.breathIdle ?? true;
    this.breathPhase = Math.random() * Math.PI * 2;
    // 错开各实例首次眨眼，避免阵列齐眨眼
    this.blinkTimer =
      Minion.BLINK_GAP_MIN * 0.35 +
      Math.random() * (Minion.BLINK_GAP_MAX - Minion.BLINK_GAP_MIN * 0.35);

    this.root = new TransformNode(`Minion_${x}_${z}`, scene);
    this.root.position = new Vector3(x, 0, z);
    this.root.scaling = new Vector3(scale, scale, scale);
    this.root.rotation.y = facePositiveX ? Math.PI / 2 : -Math.PI / 2;
    this.targetYaw = this.root.rotation.y;

    this.bodyRoot = new TransformNode('bodyRoot', scene);
    this.bodyRoot.parent = this.root;

    // 躯干：球心高度；呼吸时缩放此节点，身体与帽子同变
    this.torso = new TransformNode('torso', scene);
    this.torso.parent = this.bodyRoot;
    this.torso.position.y = Minion.BODY_LOCAL_Y;

    const limbMat = mat(scene, 'minionLimb', skinColor);

    const bodyMat = new StandardMaterial('minionBody', scene);
    bodyMat.specularColor = Color3.Black();
    bodyMat.diffuseTexture = getFaceTexture(
      scene,
      skinColor,
      faceStyle,
      mosaicFace,
      false,
    );
    this.bodyMat = bodyMat;

    const body = MeshBuilder.CreateSphere(
      'body',
      { diameter: 0.84, segments: sphereSegments },
      scene,
    );
    // 相对 torso 球心
    body.position.set(0, 0, 0);
    body.rotation.y = Math.PI / 2;
    body.material = bodyMat;
    body.parent = this.torso;
    if (lowPolyFlat) {
      body.convertToFlatShadedMesh();
    }
    cast(body, shadowGen);

    this.leftHandRest = new Vector3(0.5, 0.5, 0.05);
    this.rightHandRest = staffStyle
      ? new Vector3(-0.52, 0.68, 0.28)
      : new Vector3(-0.5, 0.5, 0.05);

    this.leftHand = ball(scene, 'leftHand', 0.2, limbMat, limbSegments, lowPolyFlat);
    this.leftHand.position.copyFrom(this.leftHandRest);
    this.leftHand.parent = this.bodyRoot;
    cast(this.leftHand, shadowGen);

    this.rightHand = ball(scene, 'rightHand', 0.2, limbMat, limbSegments, lowPolyFlat);
    this.rightHand.position.copyFrom(this.rightHandRest);
    this.rightHand.parent = this.bodyRoot;
    cast(this.rightHand, shadowGen);

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

    if (hatStyle) {
      // 与身体同挂 torso，呼吸时一起缩放
      attachHat(scene, this.torso, hatStyle, shadowGen);
    }
    if (staffStyle) {
      this.staffFx = attachStaff(scene, this.rightHand, staffStyle, shadowGen);
    }
  }

  moveBy(dx: number, dz: number): void {
    this.root.position.x += dx;
    this.root.position.z += dz;
  }

  faceToward(dx: number, dz: number): void {
    if (dx * dx + dz * dz < 1e-12) return;
    this.targetYaw = Math.atan2(dx, dz);
  }

  update(dt: number, moving: boolean): void {
    this.applyTurn(dt);
    if (this.staffFx) updateStaffFx(this.staffFx, dt);
    // 待机眨眼（行走时也保留，更自然）
    this.updateBlink(dt);

    const blend = 10;
    if (moving) {
      this.walkWeight = Math.min(1, this.walkWeight + dt * blend);
      this.walkPhase += dt * Math.PI * 2 * Minion.WALK_HZ;
    } else {
      this.walkWeight = Math.max(0, this.walkWeight - dt * blend);
      if (this.walkWeight > 0.01) {
        this.walkPhase += dt * Math.PI * 2 * Minion.WALK_HZ * this.walkWeight;
      }
    }

    // 微弱呼吸：行走时减弱，避免盖过步态
    if (this.breathEnabled) {
      this.breathPhase += dt * Math.PI * 2 * Minion.BREATH_HZ;
    }
    const breath =
      this.breathEnabled ? Math.sin(this.breathPhase) : 0;
    const breathAmt = 1 - this.walkWeight * 0.65;
    const breathBob = breath * Minion.BREATH_BOB * breathAmt;
    const breathHand = breath * Minion.BREATH_HAND * breathAmt;
    // 躯干（身体+帽子）统一：吸气略鼓；脚/手不在此节点，贴地不受缩放
    const sy = 1 + breath * Minion.BREATH_SCALE_Y * breathAmt;
    const sxz = 1 + breath * Minion.BREATH_SCALE_XZ * breathAmt;
    this.torso.scaling.set(sxz, sy, sxz);
    // 球心随 Y 缩放上移，底缘大致稳定（与旧 body 呼吸位移同一公式）
    const bodyR = 0.42;
    this.torso.position.y =
      Minion.BODY_LOCAL_Y + bodyR * (sy - 1) * 0.55;

    const w = this.walkWeight;
    if (w < 1e-4) {
      this.leftHand.position.set(
        this.leftHandRest.x,
        this.leftHandRest.y + breathHand,
        this.leftHandRest.z,
      );
      this.rightHand.position.set(
        this.rightHandRest.x,
        this.rightHandRest.y + breathHand * 0.85,
        this.rightHandRest.z,
      );
      this.leftFoot.position.copyFrom(this.leftFootRest);
      this.rightFoot.position.copyFrom(this.rightFootRest);
      this.bodyRoot.position.y = breathBob;
      return;
    }

    const swing = Math.sin(this.walkPhase) * w;
    const liftPhase = Math.cos(this.walkPhase);
    const handSwing = this.staffFx ? Minion.HAND_SWING * 0.45 : Minion.HAND_SWING;

    this.leftHand.position.set(
      this.leftHandRest.x,
      this.leftHandRest.y + Minion.HAND_BOB * swing + breathHand,
      this.leftHandRest.z + Minion.HAND_SWING * swing,
    );
    this.rightHand.position.set(
      this.rightHandRest.x,
      this.rightHandRest.y - Minion.HAND_BOB * swing * 0.6 + breathHand * 0.85,
      this.rightHandRest.z - handSwing * swing,
    );

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

    this.bodyRoot.position.y =
      Math.abs(Math.sin(this.walkPhase)) * Minion.BODY_BOB * w + breathBob;
  }

  private applyTurn(dt: number): void {
    let diff = this.targetYaw - this.root.rotation.y;
    diff = ((diff + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    const maxStep = Minion.TURN_SPEED * dt;
    if (Math.abs(diff) <= maxStep) {
      this.root.rotation.y = this.targetYaw;
    } else {
      this.root.rotation.y += Math.sign(diff) * maxStep;
    }
  }

  /**
   * 眨眼待机：约 2.4–5.2s 眨一次，闭眼 ~0.11s；
   * 约 28% 概率连眨（中间睁 ~0.07s，再闭 ~0.08s）。
   */
  private updateBlink(dt: number): void {
    if (!this.blinkEnabled) return;

    // 闭眼阶段
    if (this.blinkClosedT > 0) {
      this.blinkClosedT -= dt;
      if (this.blinkClosedT > 0) return;

      this.setEyesClosed(false);
      if (this.pendingDoubleBlink) {
        this.pendingDoubleBlink = false;
        this.blinkFollowUp = true;
        this.blinkTimer = 0.07; // 极短睁眼后立刻再眨
      } else {
        this.blinkTimer =
          Minion.BLINK_GAP_MIN +
          Math.random() * (Minion.BLINK_GAP_MAX - Minion.BLINK_GAP_MIN);
      }
      return;
    }

    // 睁眼等待
    this.blinkTimer -= dt;
    if (this.blinkTimer > 0) return;

    this.setEyesClosed(true);
    if (this.blinkFollowUp) {
      this.blinkFollowUp = false;
      this.blinkClosedT = Minion.BLINK_CLOSED_DOUBLE;
      this.pendingDoubleBlink = false;
    } else {
      this.blinkClosedT = Minion.BLINK_CLOSED;
      this.pendingDoubleBlink = Math.random() < 0.28;
    }
  }

  private setEyesClosed(closed: boolean): void {
    if (this.eyesClosed === closed) return;
    this.eyesClosed = closed;
    this.bodyMat.diffuseTexture = getFaceTexture(
      this.scene,
      this.skinColor,
      this.faceStyle,
      this.mosaicFace,
      closed,
    );
  }

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
