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
import { attachWizardHat, HAT_RED, HAT_RED_BAND } from './minion/hat';
import { ball, cast, mat } from './minion/materials';
import {
  attachMagicStaff,
  type StaffFx,
  updateStaffFx,
} from './minion/staff';

export type { FaceStyle } from './minion/faces';

/** 小兵创建/外观选项 */
export interface MinionOptions {
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
  /** 表情 */
  face?: FaceStyle;
  /** 对当前表情贴图做马赛克像素化 */
  mosaicFace?: boolean;
  /** 低面数 + 平面着色 */
  lowPolyFlat?: boolean;
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

  private walkPhase = 0;
  private walkWeight = 0;
  private targetYaw = 0;
  private staffFx: StaffFx | null = null;

  constructor(scene: Scene, x = 0, z = 0, options: MinionOptions = {}) {
    const facePositiveX = options.facePositiveX ?? true;
    const shadowGen = options.shadowGenerator;
    const allBlack = options.allBlack ?? false;
    const redHat = options.redHat ?? false;
    const magicStaff = options.magicStaff ?? false;
    const faceStyle: FaceStyle = options.face ?? 'cute';
    const mosaicFace = options.mosaicFace ?? false;
    const lowPolyFlat = options.lowPolyFlat ?? false;
    const sphereSegments = lowPolyFlat ? 10 : 24;
    const limbSegments = lowPolyFlat ? 3 : 16;
    const scale = Minion.SCALE * (options.scaleMultiplier ?? 1);

    this.root = new TransformNode(`Minion_${x}_${z}`, scene);
    this.root.position = new Vector3(x, 0, z);
    this.root.scaling = new Vector3(scale, scale, scale);
    this.root.rotation.y = facePositiveX ? Math.PI / 2 : -Math.PI / 2;
    this.targetYaw = this.root.rotation.y;

    this.bodyRoot = new TransformNode('bodyRoot', scene);
    this.bodyRoot.parent = this.root;

    const limbColor = allBlack ? Minion.CHARCOAL : Minion.LIMB;
    const limbMat = mat(scene, 'minionLimb', limbColor);

    const bodyMat = new StandardMaterial('minionBody', scene);
    bodyMat.specularColor = Color3.Black();
    bodyMat.diffuseTexture = getFaceTexture(
      scene,
      allBlack ? Minion.CHARCOAL : Minion.BODY,
      faceStyle,
      mosaicFace,
    );

    const body = MeshBuilder.CreateSphere(
      'body',
      { diameter: 0.84, segments: sphereSegments },
      scene,
    );
    body.position.y = Minion.BODY_LOCAL_Y;
    body.rotation.y = Math.PI / 2;
    body.material = bodyMat;
    body.parent = this.bodyRoot;
    if (lowPolyFlat) {
      body.convertToFlatShadedMesh();
    }
    cast(body, shadowGen);

    this.leftHandRest = new Vector3(0.5, 0.5, 0.05);
    this.rightHandRest = magicStaff
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

    if (redHat) {
      attachWizardHat(scene, this.bodyRoot, Minion.BODY_LOCAL_Y, shadowGen);
    }
    if (magicStaff) {
      this.staffFx = attachMagicStaff(scene, this.rightHand, shadowGen);
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

    const w = this.walkWeight;
    if (w < 1e-4) {
      this.leftHand.position.copyFrom(this.leftHandRest);
      this.rightHand.position.copyFrom(this.rightHandRest);
      this.leftFoot.position.copyFrom(this.leftFootRest);
      this.rightFoot.position.copyFrom(this.rightFootRest);
      this.bodyRoot.position.y = 0;
      return;
    }

    const swing = Math.sin(this.walkPhase) * w;
    const liftPhase = Math.cos(this.walkPhase);
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
      Math.abs(Math.sin(this.walkPhase)) * Minion.BODY_BOB * w;
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
