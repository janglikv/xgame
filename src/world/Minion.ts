import {
  Color3,
  Mesh,
  MeshBuilder,
  Quaternion,
  StandardMaterial,
  type Scene,
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
  /** 瞄准动画过渡权重（0 = 待机/走路姿态，1 = 完全指向目标） */
  private aimWeight = 0;
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

  constructor(scene: Scene, x = 0, z = 0, options: MinionOptions = {}) {
    const facePositiveX = options.facePositiveX ?? true;
    const shadowGen = options.shadowGenerator;
    const appearance = resolveAppearance(options);
    const sphereSegments = appearance.lowPolyFlat ? 10 : 24;
    const limbSegments = appearance.lowPolyFlat ? 3 : 16;
    const scale = Minion.SCALE * appearance.scaleMultiplier;

    this.scene = scene;
    this.shadowGen = shadowGen;
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
    this.root.rotation.y = facePositiveX ? Math.PI / 2 : -Math.PI / 2;
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

  /** 设置/清除鼠标 3D 瞄准目标点（手持法杖按下鼠标时实时传入） */
  setAimTarget(target: Vector3 | null): void {
    this.aimTarget = target ? target.clone() : null;
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

    // 瞄准动画过渡权重（手持法杖且设置了 aimTarget 时渐增）
    const isAiming = this.aimTarget !== null && this.appearance.staff !== null;
    const aimTargetWeight = isAiming ? 1 : 0;
    const aimBlendSpeed = isAiming ? 14 : 8;
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
      if (this.aimWeight > 0.001 && this.aimTarget) {
        const dx = this.aimTarget.x - this.root.position.x;
        const dz = this.aimTarget.z - this.root.position.z;
        if (dx * dx + dz * dz > 1e-6) {
          const dirWorld = new Vector3(dx, 0, dz).normalize();
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

          const qFinal = Quaternion.Slerp(
            this.defaultStaffQuat,
            qAim,
            this.aimWeight,
          );
          this.staffFx.root.rotationQuaternion = qFinal;
        }

        // 瞄准脉动强化
        const pulse =
          1 + Math.sin(this.breathPhase * 8) * 0.12 * this.aimWeight;
        this.staffFx.orb.scaling.set(pulse, pulse, pulse);
      } else {
        this.staffFx.root.rotationQuaternion = this.defaultStaffQuat.clone();
      }
    }
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
