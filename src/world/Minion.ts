import {
  Color3,
  Mesh,
  MeshBuilder,
  Quaternion,
  StandardMaterial,
  type Scene,
  Ray,
  ShadowGenerator,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import {
  FootRingBuff,
  type FormationStyle,
} from './FootRingBuff';
import { getFaceTexture, type FaceStyle } from './minion/faces';
import {
  attachHat,
  HAT_RED,
  HAT_RED_BAND,
  type HatStyle,
} from './minion/hat';
import { ball, cast, colorFromHex, mat } from './minion/materials';
import {
  attachStaff,
  type StaffFx,
  type StaffStyle,
  updateStaffFx,
} from './minion/staff';

import type { MinionPhysicsProxy } from './physics/MinionPhysicsProxy';

export type { FaceStyle } from './minion/faces';
export type { StaffStyle } from './minion/staff';
export type { HatStyle } from './minion/hat';
export type { FormationStyle } from './FootRingBuff';

/**
 * 可独立替换的外观槽位。
 * E 键按目标的 partialSlots 只拷这些；R 键拷全量。
 */
export type AppearanceSlot =
  | 'face'
  | 'mosaicFace'
  | 'bodyColor'
  | 'hat'
  | 'staff'
  | 'scaleMultiplier'
  | 'lowPolyFlat'
  | 'formation';

/** 小兵完整外观快照（含「无帽 / 无阵」等显式 null） */
export interface MinionAppearance {
  face: FaceStyle;
  mosaicFace: boolean;
  bodyColor: number;
  hat: HatStyle | null;
  staff: StaffStyle | null;
  scaleMultiplier: number;
  lowPolyFlat: boolean;
  formation: FormationStyle | null;
}

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
  /** 脚底阵法；不设则无 */
  formation?: FormationStyle | null;
  /**
   * E 键部分替换时只应用这些槽位（展示阵列按行设置）。
   * 未设则 E 不生效（仅 R 全量）。
   */
  partialSlots?: readonly AppearanceSlot[];
  /** 是否播放眨眼待机（默认 true） */
  blinkIdle?: boolean;
  /** 是否播放微弱呼吸（默认 true） */
  breathIdle?: boolean;
  /**
   * 战斗阵营。同阵营子弹互不造成伤害（穿过）。
   * 未设则不参与友伤过滤。
   */
  combatTeam?: string;
}

/** 从创建选项解析完整外观 */
export function resolveAppearance(
  options: MinionOptions = {},
): MinionAppearance {
  return {
    face: options.face ?? 'cute',
    mosaicFace: options.mosaicFace ?? false,
    bodyColor:
      options.bodyColor ??
      (options.allBlack ? Minion.CHARCOAL : Minion.BODY),
    hat: options.hat ?? (options.redHat ? 'wizard' : null),
    staff: options.staff ?? (options.magicStaff ? 'arcane' : null),
    scaleMultiplier: options.scaleMultiplier ?? 1,
    lowPolyFlat: options.lowPolyFlat ?? false,
    formation: options.formation ?? null,
  };
}

/**
 * 极简五球小兵：身体 + 双手 + 双脚（可选小帽 / 魔法杖 / 阵法）。
 * 支持从另一单位 E 部分替换 / R 全量替换外观。
 */
export class Minion {
  static readonly SCALE = 0.5;
  /** 身体球心本地 Y（用于镜头注视点） */
  static readonly BODY_LOCAL_Y = 0.63;
  /** 默认白色肤色：使用柔和高质感冷白 (0xdde2e8)，避免 0xffffff 在强光下光线加法叠加爆白刺眼 */
  static readonly BODY = 0xdde2e8;
  static readonly LIMB = 0xdde2e8;
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

  static readonly HAND_REST_EMPTY = new Vector3(-0.5, 0.5, 0.05);
  static readonly HAND_REST_STAFF = new Vector3(-0.52, 0.68, 0.28);
  static readonly BODY_RADIUS = 0.42;
  static readonly HAND_RADIUS = 0.1;
  /** 拳心与躯干球心的最小间距，略大于两球半径之和 */
  static readonly HAND_BODY_CLEAR =
    Minion.BODY_RADIUS + Minion.HAND_RADIUS + 0.02;

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
  private readonly shadowGen: ShadowGenerator | undefined;
  private readonly bodyMat: StandardMaterial;
  private readonly limbMat: StandardMaterial;
  private readonly blinkEnabled: boolean;
  private readonly breathEnabled: boolean;

  /** 外观发生变更时的监听回调 */
  public onAppearanceChanged?: (appearance: MinionAppearance) => void;

  /** 绑定的物理代理 */
  public physicsProxy?: MinionPhysicsProxy;

  /** 战斗阵营，同阵营子弹互不造成伤害 */
  readonly combatTeam?: string;

  /** 当前完整外观 */
  private appearance: MinionAppearance;
  /**
   * E 键部分替换时，源单位只贡献这些槽。
   * null = 该单位不是展示槽位单位（E 对其不生效）。
   */
  private partialSlots: readonly AppearanceSlot[] | null;

  private hatRoot: TransformNode | null = null;
  private staffFx: StaffFx | null = null;
  private formationBuff: FootRingBuff | null = null;

  /** 鼠标按住时的 3D 瞄准目标点（用于法杖实时指向） */
  private aimTarget: Vector3 | null = null;
  private lastAimTarget: Vector3 | null = null;
  /** 瞄准动画过渡权重（0 = 待机/走路姿态，1 = 完全指向目标） */
  private aimWeight = 0;
  /** 贴墙防穿模法杖向上抬高避让角度 */
  private staffRetractPitch = 0;
  private isDeadState = false;
  private deathAnimWeight = 0;
  private readonly defaultStaffQuat = Quaternion.RotationYawPitchRoll(
    0,
    -0.32,
    0.1,
  );

  private walkPhase = 0;
  private walkWeight = 0;
  private targetYaw = 0;
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

  private isPunching = false;
  private punchProgress = 0;
  /** 略长于冷却，连击时下一拳会盖住回收尾段 */
  private readonly punchDuration = 0.36;
  private punchCombo = 0;
  private punchHitTriggered = false;
  private punchHitStop = 0;
  private punchLungeZ = 0;
  private onPunchHitCallback?: () => void;
  private hitReactT = 0;
  private readonly hitReactDir = new Vector3();

  constructor(scene: Scene, x = 0, z = 0, options: MinionOptions = {}) {
    const facePositiveX = options.facePositiveX ?? true;
    const shadowGen = options.shadowGenerator;
    const appearance = resolveAppearance(options);
    const sphereSegments = appearance.lowPolyFlat ? 10 : 24;
    const limbSegments = appearance.lowPolyFlat ? 3 : 16;
    const scale = Minion.SCALE * appearance.scaleMultiplier;

    this.scene = scene;
    this.shadowGen = shadowGen;
    this.combatTeam = options.combatTeam;
    this.appearance = { ...appearance };
    this.partialSlots = options.partialSlots ? [...options.partialSlots] : null;
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
    this.root.rotation.y = facePositiveX ? Math.PI / 2 : Math.PI;
    this.targetYaw = this.root.rotation.y;

    this.bodyRoot = new TransformNode('bodyRoot', scene);
    this.bodyRoot.parent = this.root;

    // 躯干：球心高度；呼吸时缩放此节点，身体与帽子同变
    this.torso = new TransformNode('torso', scene);
    this.torso.parent = this.bodyRoot;
    this.torso.position.y = Minion.BODY_LOCAL_Y;

    this.limbMat = mat(scene, 'minionLimb', appearance.bodyColor);

    const bodyMat = new StandardMaterial('minionBody', scene);
    bodyMat.specularColor = Color3.Black();
    bodyMat.ambientColor = new Color3(0.25, 0.25, 0.28);
    bodyMat.diffuseTexture = getFaceTexture(
      scene,
      appearance.bodyColor,
      appearance.face,
      appearance.mosaicFace,
      false,
    );
    this.bodyMat = bodyMat;

    const body = MeshBuilder.CreateSphere(
      'body',
      { diameter: 0.84, segments: sphereSegments },
      scene,
    );
    // 相对 torso 球心
    body.metadata = { minion: this };
    body.position.set(0, 0, 0);
    body.rotation.y = Math.PI / 2;
    body.material = bodyMat;
    body.parent = this.torso;
    if (appearance.lowPolyFlat) {
      body.convertToFlatShadedMesh();
    }
    cast(body, shadowGen);

    this.leftHandRest = new Vector3(0.5, 0.5, 0.05);
    this.rightHandRest = (
      appearance.staff ? Minion.HAND_REST_STAFF : Minion.HAND_REST_EMPTY
    ).clone();

    this.leftHand = ball(
      scene,
      'leftHand',
      0.2,
      this.limbMat,
      limbSegments,
      appearance.lowPolyFlat,
    );
    this.leftHand.metadata = { minion: this };
    this.leftHand.position.copyFrom(this.leftHandRest);
    this.leftHand.parent = this.bodyRoot;
    cast(this.leftHand, shadowGen);

    this.rightHand = ball(
      scene,
      'rightHand',
      0.2,
      this.limbMat,
      limbSegments,
      appearance.lowPolyFlat,
    );
    this.rightHand.metadata = { minion: this };
    this.rightHand.position.copyFrom(this.rightHandRest);
    this.rightHand.parent = this.bodyRoot;
    cast(this.rightHand, shadowGen);

    this.leftFootRest = new Vector3(0.14, 0.1, 0.02);
    this.rightFootRest = new Vector3(-0.14, 0.1, 0.02);
    this.leftFoot = ball(
      scene,
      'leftFoot',
      0.2,
      this.limbMat,
      limbSegments,
      appearance.lowPolyFlat,
    );
    this.leftFoot.position.copyFrom(this.leftFootRest);
    this.leftFoot.parent = this.bodyRoot;
    cast(this.leftFoot, shadowGen);

    this.rightFoot = ball(
      scene,
      'rightFoot',
      0.2,
      this.limbMat,
      limbSegments,
      appearance.lowPolyFlat,
    );
    this.rightFoot.position.copyFrom(this.rightFootRest);
    this.rightFoot.parent = this.bodyRoot;
    cast(this.rightFoot, shadowGen);

    if (appearance.hat) {
      this.hatRoot = attachHat(scene, this.torso, appearance.hat, shadowGen);
    }
    if (appearance.staff) {
      this.staffFx = attachStaff(
        scene,
        this.rightHand,
        appearance.staff,
        shadowGen,
      );
    }
    if (appearance.formation) {
      this.formationBuff = new FootRingBuff(
        scene,
        this.root,
        appearance.formation,
      );
    }
  }

  /** 设置/清除 3D 瞄准目标点 */
  setAimTarget(target: Vector3 | null): void {
    if (this.isDeadState) {
      this.aimTarget = null;
      return;
    }
    if (target) {
      this.lastAimTarget = target.clone();
    }
    this.aimTarget = target ? target.clone() : null;
  }

  /** 设置角色死亡倒地造型/状态 */
  setDead(dead: boolean): void {
    this.isDeadState = dead;
    if (dead) {
      this.setAimTarget(null);
      this.setEyesClosed(true);
    } else if (this.blinkClosedT <= 0) {
      this.setEyesClosed(false);
    }
  }

  /** 是否处于死亡倒地状态 */
  isDead(): boolean {
    return this.isDeadState;
  }

  /** 是否手持法杖 */
  hasStaff(): boolean {
    return this.appearance.staff !== null;
  }

  /** 获取当前法杖款式 */
  getStaffStyle(): StaffStyle | null {
    return this.appearance.staff;
  }

  /** 获取法杖宝珠/顶端世界坐标 */
  getStaffTipWorldPos(): Vector3 {
    if (this.staffFx) {
      return this.staffFx.orb.absolutePosition.clone();
    }
    return this.rightHand.absolutePosition.clone().addInPlace(new Vector3(0, 0.65, 0));
  }

  /** 发射能量光球时的顶端宝珠瞬间脉动放大 */
  triggerStaffShootFx(): void {
    if (this.staffFx) {
      this.staffFx.orb.scaling.set(1.65, 1.65, 1.65);
    }
  }

  /** 受到伤害时的事件回调 */
  onTakeDamage?: (damage: number, dir?: Vector3) => void;

  /** 对角色施加伤害 */
  takeDamage(amount: number, dir?: Vector3): void {
    this.playHitReact(dir);
    this.onTakeDamage?.(amount, dir);
  }

  /** 受击短反馈：压扁、闪光、沿打击方向一顿 */
  playHitReact(dir?: Vector3): void {
    this.hitReactT = 1;
    if (dir && dir.lengthSquared() > 1e-6) {
      this.hitReactDir.copyFrom(dir);
      this.hitReactDir.y = 0;
      if (this.hitReactDir.lengthSquared() > 1e-6) this.hitReactDir.normalize();
      else this.hitReactDir.set(0, 0, 0);
    } else {
      this.hitReactDir.set(0, 0, 0);
    }
  }

  /** 拳头打实后短暂停住，做出击中顿挫 */
  punchConnected(): void {
    if (this.isPunching) this.punchHitStop = 0.05;
  }

  /** 获取角色当前 Yaw 旋转角（弧度） */
  getRotationY(): number {
    return this.root.rotation.y;
  }

  /** 触发空手近战挥拳击打 */
  triggerMeleePunch(onHit?: () => void): boolean {
    if (this.hasStaff()) return false;
    if (this.isPunching && this.punchProgress < 0.2) {
      return false;
    }
    this.punchCombo = (this.punchCombo + 1) % 2;
    this.punchProgress = 0;
    this.punchHitTriggered = false;
    this.punchHitStop = 0;
    this.leftHand.scaling.set(1, 1, 1);
    this.rightHand.scaling.set(1, 1, 1);
    this.onPunchHitCallback = onHit;
    this.isPunching = true;
    return true;
  }

  isMeleePunching(): boolean {
    return this.isPunching;
  }

  /**
   * 空手钩拳：外侧小弧 + 蓄力后甩击定格。
   * theta=0 为本地 +Z 前方，正值朝 +X（角色左侧）。
   */
  private updateMeleePunch(dt: number): void {
    if (!this.isPunching) {
      this.punchLungeZ = 0;
      return;
    }

    if (this.punchHitStop > 0) {
      this.punchHitStop = Math.max(0, this.punchHitStop - dt);
    } else {
      this.punchProgress += dt;
    }
    const p = Math.min(1, this.punchProgress / this.punchDuration);

    // 甩到身前定格时触发落点判定
    if (p >= 0.46 && !this.punchHitTriggered) {
      this.punchHitTriggered = true;
      this.onPunchHitCallback?.();
    }

    const isRight = this.punchCombo === 0;
    const punchHand = isRight ? this.rightHand : this.leftHand;
    const otherHand = isRight ? this.leftHand : this.rightHand;
    const punchRest = isRight ? this.rightHandRest : this.leftHandRest;
    const otherRest = isRight ? this.leftHandRest : this.rightHandRest;
    const sideSign = isRight ? 1 : -1;

    // 落点停在出拳一侧的身前，不穿到对侧，回收才不会切进身体
    const thetaChamber = -1.45 * sideSign;
    const thetaImpact = -0.28 * sideSign;
    const thetaFollow = -0.12 * sideSign;
    const restTheta = Math.atan2(punchRest.x, punchRest.z);
    const restRadius = Math.hypot(punchRest.x, punchRest.z);
    const rChamber = 0.58;
    const rApex = 0.7;
    const rImpact = 0.72;
    const yChamber = punchRest.y - 0.03;
    const yApex = 0.58;
    const yImpact = 0.54;
    const punchRestClear = Math.hypot(
      punchRest.x,
      punchRest.y - Minion.BODY_LOCAL_Y,
      punchRest.z,
    );
    const otherRestClear = Math.hypot(
      otherRest.x,
      otherRest.y - Minion.BODY_LOCAL_Y,
      otherRest.z,
    );

    const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
    const snapEase = (t: number) => t * t * t;
    const smooth = (t: number) => t * t * (3 - 2 * t);
    const quad = (a: number, b: number, c: number, t: number) => {
      const u = 1 - t;
      return u * u * a + 2 * u * t * b + t * t * c;
    };
    const placePunch = (
      x: number,
      y: number,
      z: number,
      minDist = Minion.HAND_BODY_CLEAR,
    ): void => {
      this.setHandOutsideBody(punchHand, x, y, z, minDist);
    };
    const placeGuard = (t: number, minDist = Minion.HAND_BODY_CLEAR): void => {
      this.setHandOutsideBody(
        otherHand,
        otherRest.x * (1 + 0.05 * t),
        otherRest.y + 0.08 * t,
        otherRest.z - 0.12 * t,
        minDist,
      );
    };

    let squash = 0;
    if (p < 0.26) {
      // 蓄力：略拉长前摇，身体后坐
      const t = easeOut(p / 0.26);
      const cx = rChamber * Math.sin(thetaChamber);
      const cz = rChamber * Math.cos(thetaChamber);
      placePunch(
        punchRest.x + (cx - punchRest.x) * t,
        punchRest.y + (yChamber - punchRest.y) * t,
        punchRest.z + (cz - punchRest.z) * t,
      );
      placeGuard(t);
      this.torso.rotation.y = -0.26 * sideSign * t;
      this.torso.rotation.x = -0.06 * t;
      this.punchLungeZ = -0.025 * t;
      punchHand.scaling.set(0.96, 0.96, 0.96);
    } else if (p < 0.46) {
      // 甩击：三次方加速，后半段才真正打出
      const t = snapEase((p - 0.26) / 0.2);
      const theta = thetaChamber + (thetaImpact - thetaChamber) * t;
      const radius = quad(rChamber, rApex, rImpact, t);
      const y = quad(yChamber, yApex, yImpact, t);
      placePunch(radius * Math.sin(theta), y, radius * Math.cos(theta));
      placeGuard(0.55 + 0.45 * t);
      this.torso.rotation.y =
        -0.26 * sideSign * (1 - t) + 0.3 * sideSign * t;
      this.torso.rotation.x = -0.06 * (1 - t) + 0.12 * t;
      this.punchLungeZ = -0.025 + 0.09 * t;
      const stretch = t * t;
      punchHand.scaling.set(1 - 0.08 * stretch, 1 - 0.08 * stretch, 1 + 0.18 * stretch);
    } else if (p < 0.6) {
      // 命中定格：拳头压扁，身体顶出去
      const t = (p - 0.46) / 0.14;
      const theta = thetaImpact + (thetaFollow - thetaImpact) * t * 0.35;
      const radius = rImpact * (1 - 0.03 * t);
      const y = yImpact - 0.02 * t;
      placePunch(radius * Math.sin(theta), y, radius * Math.cos(theta));
      placeGuard(1);
      this.torso.rotation.y = 0.3 * sideSign + 0.04 * sideSign * t;
      this.torso.rotation.x = 0.12 - 0.03 * t;
      this.punchLungeZ = 0.065 * (1 - t * 0.25);
      squash = 1 - t * 0.45;
      punchHand.scaling.set(1 + 0.26 * squash, 1 + 0.18 * squash, 1 - 0.22 * squash);
    } else {
      // 沿出拳同侧外侧弧收回
      const t = smooth((p - 0.6) / 0.4);
      const followR = rImpact * 0.94;
      const theta = thetaFollow + (restTheta - thetaFollow) * t;
      const radius = followR + (restRadius - followR) * t;
      const y = yImpact - 0.02 + (punchRest.y - (yImpact - 0.02)) * t;
      const clear =
        Minion.HAND_BODY_CLEAR +
        (punchRestClear - Minion.HAND_BODY_CLEAR) * t;
      placePunch(radius * Math.sin(theta), y, radius * Math.cos(theta), clear);
      placeGuard(
        1 - t,
        Minion.HAND_BODY_CLEAR + (otherRestClear - Minion.HAND_BODY_CLEAR) * t,
      );
      this.torso.rotation.y = 0.34 * sideSign * (1 - t);
      this.torso.rotation.x = 0.09 * (1 - t);
      this.punchLungeZ = 0.05 * (1 - t);
      punchHand.scaling.set(1, 1, 1);
    }

    if (p >= 1) {
      this.isPunching = false;
      this.punchLungeZ = 0;
      this.torso.rotation.x = 0;
      this.torso.rotation.y = 0;
      punchHand.scaling.set(1, 1, 1);
    }
  }

  /** 把拳头从躯干球内顶到最小安全间距，避免穿模 */
  private setHandOutsideBody(
    hand: Mesh,
    x: number,
    y: number,
    z: number,
    minDist: number,
  ): void {
    const cy = Minion.BODY_LOCAL_Y;
    const dx = x;
    const dy = y - cy;
    const dz = z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < minDist * minDist) {
      const d = Math.sqrt(d2);
      if (d < 1e-6) {
        hand.position.set(0, cy, minDist);
        return;
      }
      const s = minDist / d;
      hand.position.set(dx * s, cy + dy * s, dz * s);
      return;
    }
    hand.position.set(x, y, z);
  }

  /** 当前这一拳是否为右手（连击偶数拳为右） */
  isRightHandPunch(): boolean {
    return this.punchCombo === 0;
  }

  /** 获取当前出拳手（拳头落点）的世界坐标 */
  getAttackingHandWorldPos(): Vector3 {
    const isRight = this.isRightHandPunch();
    const hand = isRight ? this.rightHand : this.leftHand;
    hand.computeWorldMatrix(true);
    return hand.absolutePosition.clone();
  }

  /** 获取角色当前在 XZ 平面上的标准正前方单位向量 */
  getForwardVector(): Vector3 {
    const yaw = this.root.rotation.y;
    return new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  }

  /** 强制设置角色 Yaw 旋转角（弧度），同时重置 targetYaw */
  setRotationY(yaw: number): void {
    this.root.rotation.y = yaw;
    this.targetYaw = yaw;
  }

  /** 获取法杖当前在世界空间中的真实水平前向向量 */
  getStaffForwardVector(): Vector3 {
    if (this.staffFx) {
      const tip = this.staffFx.orb.absolutePosition;
      const root = this.staffFx.root.absolutePosition;
      const dir = tip.subtract(root);
      dir.y = 0;
      if (dir.lengthSquared() > 1e-4) {
        return dir.normalize();
      }
    }
    const yaw = this.root.rotation.y;
    return new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  }

  /** 判断法杖是否与地面平行（动作前摇完成） */
  isStaffHorizontal(): boolean {
    if (!this.staffFx) return false;
    const tip = this.staffFx.orb.absolutePosition;
    const root = this.staffFx.root.absolutePosition;
    const dir = tip.subtract(root);
    const len = dir.length();
    if (len < 1e-4) return false;
    // |dir.y| / len <= 0.25 (相当于倾角小于约 14.5 度)，代表法杖已平举与地面平行
    return Math.abs(dir.y) / len <= 0.25;
  }

  /** 判断法杖指向是否已经就绪（完成转向并对齐目标方向） */
  isStaffAimReady(): boolean {
    if (!this.hasStaff()) return false;
    if (this.aimWeight < 0.75) return false;
    let diff = this.targetYaw - this.root.rotation.y;
    diff =
      ((diff + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) -
      Math.PI;
    // 角度差小于 ~12 度（0.21 弧度）视为指向就绪
    return Math.abs(diff) <= 0.21;
  }

  /** 当前完整外观（拷贝） */
  getAppearance(): MinionAppearance {
    return { ...this.appearance };
  }

  /** E 键部分替换槽位；null 表示该单位不支持部分替换 */
  getPartialSlots(): readonly AppearanceSlot[] | null {
    return this.partialSlots;
  }

  /**
   * 从源单位替换外观。
   * - partial（E）：只拷源的 partialSlots 对应字段；源无槽位则不改
   * - full（R）：拷源全部外观
   */
  applyFrom(source: Minion, mode: 'partial' | 'full'): void {
    if (source === this) return;

    if (mode === 'partial') {
      const slots = source.getPartialSlots();
      if (!slots || slots.length === 0) return;
      const src = source.getAppearance();
      const patch: Partial<MinionAppearance> = {};
      for (const slot of slots) {
        // 显式 null（无帽/无阵/空手）也要写入
        (patch as Record<string, unknown>)[slot] = src[slot];
      }
      this.applyPatch(patch);
      return;
    }

    this.applyPatch(source.getAppearance());
  }

  /** 按字段补丁应用外观（只改给定键） */
  applyPatch(patch: Partial<MinionAppearance>): void {
    if (patch.face !== undefined || patch.mosaicFace !== undefined) {
      if (patch.face !== undefined) this.appearance.face = patch.face;
      if (patch.mosaicFace !== undefined) {
        this.appearance.mosaicFace = patch.mosaicFace;
      }
      this.refreshFaceTexture();
    }

    if (patch.bodyColor !== undefined) {
      this.appearance.bodyColor = patch.bodyColor;
      this.limbMat.diffuseColor = colorFromHex(patch.bodyColor);
      this.refreshFaceTexture();
    }

    if (patch.hat !== undefined) {
      this.setHat(patch.hat);
    }

    if (patch.staff !== undefined) {
      this.setStaff(patch.staff);
    }

    if (patch.scaleMultiplier !== undefined) {
      this.setScaleMultiplier(patch.scaleMultiplier);
    }

    if (patch.formation !== undefined) {
      this.setFormation(patch.formation);
    }

    // lowPolyFlat 需重建网格，运行时忽略（创建时已定）
    if (patch.lowPolyFlat !== undefined) {
      this.appearance.lowPolyFlat = patch.lowPolyFlat;
    }

    this.onAppearanceChanged?.(this.getAppearance());
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
    // 死亡倒地姿态平滑过渡 (0 = 站立，1 = 倒地趴下)
    const targetDeathWeight = this.isDeadState ? 1 : 0;
    this.deathAnimWeight +=
      (targetDeathWeight - this.deathAnimWeight) * Math.min(1, dt * 7);

    if (this.deathAnimWeight > 0.001) {
      // 身体向侧后方翻倒趴下（Pitch 侧翻 -85° = -1.48 弧度）
      this.bodyRoot.rotation.z = -1.48 * this.deathAnimWeight;
      this.bodyRoot.rotation.x = 0.35 * this.deathAnimWeight;
      // 贴紧地面下沉，避免悬空
      this.bodyRoot.position.y = -0.16 * this.deathAnimWeight;
    } else {
      this.bodyRoot.rotation.z = 0;
      this.bodyRoot.rotation.x = 0;
      this.bodyRoot.position.y = 0;
    }

    // 瞄准动画过渡权重（手持法杖且设置了 aimTarget 时渐增；收起时按 5.5 平滑放低）
    const isAiming = this.aimTarget !== null && this.appearance.staff !== null;
    const aimTargetWeight = isAiming ? 1 : 0;
    const aimBlendSpeed = isAiming ? 14 : 5.5;
    this.aimWeight +=
      (aimTargetWeight - this.aimWeight) * Math.min(1, dt * aimBlendSpeed);

    if (isAiming && this.aimTarget) {
      const dx = this.aimTarget.x - this.root.position.x;
      const dz = this.aimTarget.z - this.root.position.z;
      if (dx * dx + dz * dz > 1e-6) {
        const yaw = Math.atan2(dx, dz);
        this.targetYaw = yaw;
      }
    }

    this.applyTurn(dt);

    if (this.staffFx) updateStaffFx(this.staffFx, dt);
    this.formationBuff?.update(dt);
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
    const breath = this.breathEnabled ? Math.sin(this.breathPhase) : 0;
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
    const swing = Math.sin(this.walkPhase) * w;
    const liftPhase = Math.cos(this.walkPhase);
    const handSwing = this.staffFx
      ? Minion.HAND_SWING * 0.45
      : Minion.HAND_SWING;

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
    } else {
      this.leftHand.position.set(
        this.leftHandRest.x,
        this.leftHandRest.y + Minion.HAND_BOB * swing + breathHand,
        this.leftHandRest.z + Minion.HAND_SWING * swing,
      );
      this.rightHand.position.set(
        this.rightHandRest.x,
        this.rightHandRest.y -
          Minion.HAND_BOB * swing * 0.6 +
          breathHand * 0.85,
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

    this.updateMeleePunch(dt);

    // 瞄准姿态调整：右手臂位姿插值 & 法杖实时旋转指向目标点
    if (this.aimWeight > 0.001) {
      const aimHandPos = new Vector3(-0.42, 0.72, 0.42);
      this.rightHand.position.x =
        this.rightHand.position.x * (1 - this.aimWeight) +
        aimHandPos.x * this.aimWeight;
      this.rightHand.position.y =
        this.rightHand.position.y * (1 - this.aimWeight) +
        aimHandPos.y * this.aimWeight;
      this.rightHand.position.z =
        this.rightHand.position.z * (1 - this.aimWeight) +
        aimHandPos.z * this.aimWeight;
    }

    if (this.staffFx) {
      // 1. 先平滑更新贴墙抬高倾角 (staffRetractPitch)
      this.updateStaffWallRetraction(dt);

      const qRetract =
        this.staffRetractPitch > 0.001
          ? Quaternion.RotationAxis(Vector3.Right(), -this.staffRetractPitch)
          : null;

      const activeAimTarget = this.aimTarget ?? this.lastAimTarget;
      if (this.aimWeight > 0.001 && activeAimTarget) {
        const dx = activeAimTarget.x - this.root.position.x;
        const dz = activeAimTarget.z - this.root.position.z;
        if (dx * dx + dz * dz > 1e-6) {
          const dirWorld = new Vector3(dx, 0, dz).normalize();
          // 强制刷新当前帧右手最新的世界矩阵，防止父节点旋转更新延迟导致法杖角度跳变闪烁
          this.rightHand.computeWorldMatrix(true);
          const rightHandWorldMat = this.rightHand.getWorldMatrix();
          const invHandMat = rightHandWorldMat.clone().invert();
          const dirInHand = Vector3.TransformNormal(
            dirWorld,
            invHandMat,
          ).normalize();

          const vUp = Vector3.Up();
          const cross = Vector3.Cross(vUp, dirInHand);
          const dot = Vector3.Dot(vUp, dirInHand);
          let qAim: Quaternion;
          if (cross.lengthSquared() > 1e-8) {
            const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
            qAim = Quaternion.RotationAxis(cross.normalize(), angle);
          } else {
            qAim =
              dot > 0
                ? Quaternion.Identity()
                : Quaternion.RotationAxis(Vector3.Right(), Math.PI);
          }

          if (qRetract) {
            qAim = qAim.multiply(qRetract);
          }

          const qFinal = Quaternion.Slerp(
            this.defaultStaffQuat,
            qAim,
            this.aimWeight,
          );
          if (!this.staffFx.root.rotationQuaternion) {
            this.staffFx.root.rotationQuaternion = qFinal.clone();
          } else {
            Quaternion.SlerpToRef(
              this.staffFx.root.rotationQuaternion,
              qFinal,
              Math.min(1, dt * 25),
              this.staffFx.root.rotationQuaternion,
            );
          }
        }

        // 瞄准脉动强化
        const pulse =
          1 + Math.sin(this.breathPhase * 8) * 0.12 * this.aimWeight;
        this.staffFx.orb.scaling.set(pulse, pulse, pulse);
      } else {
        let qDefault = this.defaultStaffQuat;
        if (qRetract) {
          qDefault = this.defaultStaffQuat.multiply(qRetract);
        }
        if (!this.staffFx.root.rotationQuaternion) {
          this.staffFx.root.rotationQuaternion = qDefault.clone();
        } else {
          Quaternion.SlerpToRef(
            this.staffFx.root.rotationQuaternion,
            qDefault,
            Math.min(1, dt * 25),
            this.staffFx.root.rotationQuaternion,
          );
        }
      }
    }

    this.applyHitJuice(dt);
  }

  /**
   * 贴墙防穿模法杖向上抬高避让 (Staff Obstacle Avoidance / Elevation)
   * 采用固定的角色身体前向向量 (bodyForward) 探路，彻底消除射线检测与法杖旋转反馈死循环导致的抽搐抖动。
   */
  private updateStaffWallRetraction(dt: number): void {
    if (!this.staffFx) return;

    const scene = this.root.getScene();
    const yaw = this.root.rotation.y;

    // 从胸口中心 (Y+0.45) 沿固定的身体前向向量探路，不受法杖旋转影响！
    const chestPos = this.root.position.clone();
    chestPos.y += 0.45;
    const bodyForward = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));

    const probeDist = 0.65; // 胸口向前探路 0.65m
    const ray = new Ray(chestPos, bodyForward, probeDist);
    const picks = scene.multiPickWithRay(ray, (mesh) => {
      if (!mesh.isEnabled() || !mesh.isPickable) return false;
      const name = mesh.name.toLowerCase();
      if (name.includes('bullet') || name.includes('spell') || mesh.metadata?.minion) return false;
      if (name.includes('floor') || name.includes('ground') || name.includes('grid')) return false;
      return name.includes('wall') || name.includes('obstacle') || name.includes('phys') || mesh.metadata?.isColliderMesh;
    });

    let minDist = Infinity;
    if (picks) {
      for (const p of picks) {
        if (p.hit && p.distance < minDist) {
          minDist = p.distance;
        }
      }
    }

    const safeMargin = 0.58; // 安全防贴墙临界点 0.58m
    let targetRetractPitch = 0;
    if (minDist < safeMargin) {
      const penetrateAmt = safeMargin - minDist;
      // 产生平滑向上抬高的避让倾角（最大 55 度）
      targetRetractPitch = Math.min(Math.PI * 0.3, penetrateAmt * 2.8);
    }

    // 平滑一阶低通滤波，消除临界点跳变
    const lerpSpeed = dt * 12;
    this.staffRetractPitch =
      this.staffRetractPitch * (1 - Math.min(1, lerpSpeed)) +
      targetRetractPitch * Math.min(1, lerpSpeed);
  }

  /** 受击压扁/闪光，并叠加上出拳时的身体前顶 */
  private applyHitJuice(dt: number): void {
    if (this.hitReactT > 0) {
      this.hitReactT = Math.max(0, this.hitReactT - dt * 8);
    }
    const k = this.hitReactT * this.hitReactT;
    let lx = 0;
    let lz = this.punchLungeZ;
    if (k > 1e-4) {
      const yaw = this.root.rotation.y;
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      lx = (this.hitReactDir.x * c - this.hitReactDir.z * s) * 0.055 * k;
      lz += (this.hitReactDir.x * s + this.hitReactDir.z * c) * 0.055 * k;
      this.bodyRoot.scaling.set(1 + 0.09 * k, 1 - 0.14 * k, 1 + 0.09 * k);
      this.bodyMat.emissiveColor.set(0.5 * k, 0.14 * k, 0.05 * k);
    } else {
      this.bodyRoot.scaling.set(1, 1, 1);
      this.bodyMat.emissiveColor.set(0, 0, 0);
    }
    this.bodyRoot.position.x = lx;
    this.bodyRoot.position.z = lz;
  }

  private setHat(style: HatStyle | null): void {
    // 同款且已挂载 / 同为无帽：跳过
    if (this.appearance.hat === style) {
      if (style === null || this.hatRoot) return;
    }
    this.appearance.hat = style;
    if (this.hatRoot) {
      this.hatRoot.dispose();
      this.hatRoot = null;
    }
    if (style) {
      this.hatRoot = attachHat(this.scene, this.torso, style, this.shadowGen);
    }
  }

  private setStaff(style: StaffStyle | null): void {
    if (this.appearance.staff === style) {
      if (style === null || this.staffFx) return;
    }
    this.appearance.staff = style;
    if (this.staffFx) {
      this.staffFx.root.dispose();
      this.staffFx = null;
    }
    if (style) {
      this.staffFx = attachStaff(
        this.scene,
        this.rightHand,
        style,
        this.shadowGen,
      );
      this.rightHandRest.copyFrom(Minion.HAND_REST_STAFF);
    } else {
      this.rightHandRest.copyFrom(Minion.HAND_REST_EMPTY);
    }
  }

  private setScaleMultiplier(mul: number): void {
    const m = Math.max(0.05, mul);
    if (Math.abs(this.appearance.scaleMultiplier - m) < 1e-6) return;
    this.appearance.scaleMultiplier = m;
    const s = Minion.SCALE * m;
    this.root.scaling.set(s, s, s);
    this.formationBuff?.refreshHostScale();
  }

  private setFormation(style: FormationStyle | null): void {
    if (this.appearance.formation === style) {
      if (style === null || this.formationBuff) return;
    }
    this.appearance.formation = style;
    if (this.formationBuff) {
      this.formationBuff.dispose();
      this.formationBuff = null;
    }
    if (style) {
      this.formationBuff = new FootRingBuff(this.scene, this.root, style);
    }
  }

  private refreshFaceTexture(): void {
    this.bodyMat.diffuseTexture = getFaceTexture(
      this.scene,
      this.appearance.bodyColor,
      this.appearance.face,
      this.appearance.mosaicFace,
      this.eyesClosed,
    );
  }

  private applyTurn(dt: number): void {
    let diff = this.targetYaw - this.root.rotation.y;
    diff =
      ((diff + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) -
      Math.PI;
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
    this.refreshFaceTexture();
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
