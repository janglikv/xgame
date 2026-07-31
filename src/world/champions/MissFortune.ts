import * as THREE from 'three';
import type { ProjectileManager } from '../../effects/ProjectileManager';
import { CircleBody } from '../collision/CircleBody';
import type { CombatUnit, TeamId } from '../combat/CombatUnit';
import { distXZ, isValidTarget } from '../combat/combatMath';
import { HealthBar } from '../ui/HealthBar';

/**
 * 第一个英雄：厄运小姐。
 * 独立模型（起步形态参考小兵五球+巫师帽，但与小兵代码完全分离，后续可自由改型）。
 * 锁定视角：右键点地 / WASD 移动；右键敌方单位普通攻击（双枪交替、弹从枪口出）。
 */
export class MissFortune extends THREE.Group implements CombatUnit {
  static readonly DISPLAY_NAME = '厄运小姐';

  /**
   * 英雄缩放（历史：相对旧近战小兵 0.125 的三倍）。
   * 写死在此，不引用小兵常量，避免耦合。
   */
  static readonly SCALE = 0.375;
  /** 地面圆碰撞半径 */
  static readonly COLLIDER_RADIUS = 0.22;
  /** 玩家英雄：蓝方 */
  static readonly TEAM: TeamId = 'blue';
  static readonly MAX_HP = 520;
  /** 与小兵同级，防御塔优先清兵时按距离选 */
  static readonly COMBAT_PRIORITY = 0;
  /** 普攻射程（圆心距，远程 ADC） */
  static readonly ATTACK_RANGE = 2.15;
  static readonly ATTACK_DAMAGE = 52;
  /** 攻击间隔（秒，含前摇） */
  static readonly ATTACK_INTERVAL = 0.85;
  /** 出手前摇（秒） */
  static readonly WINDUP = 0.14;
  /** 粉色子弹视觉缩放（已翻 4 倍） */
  static readonly BOLT_SCALE = 9.6;
  /** 粉色弹道色 */
  static readonly BOLT_COLOR = 0xf9a8d4;
  static readonly BOLT_EMISSIVE = 0xec4899;

  // —— E：枪林弹雨 ——
  /** 施法距离（英雄圆心 → 落点圆心） */
  static readonly E_CAST_RANGE = 3.4;
  /** 落弹 / 伤害半径 */
  static readonly E_RADIUS = 1.15;
  /** 持续落弹时间（秒） */
  static readonly E_DURATION = 2.2;
  /** 视觉落弹总数 */
  static readonly E_BOLT_COUNT = 52;
  /** 圈内敌方每次 tick 伤害 */
  static readonly E_DAMAGE_PER_TICK = 14;
  /** 伤害 tick 间隔（秒） */
  static readonly E_TICK_INTERVAL = 0.28;
  /** 冷却（秒） */
  static readonly E_COOLDOWN = 7;

  /** 点地移动最大速度（世界单位/秒） */
  static readonly MOVE_SPEED = 1.35;
  /** 0→满速 / 满速→0 的目标时间（秒） */
  static readonly MOVE_RAMP_TIME = 0.1;
  /**
   * 加速度 = 最大速度 / 爬升时间 → 约 0.1s 到满速。
   */
  static readonly MOVE_ACCEL =
    MissFortune.MOVE_SPEED / MissFortune.MOVE_RAMP_TIME;
  /**
   * 减速度与加速对称 → 约 0.1s 刹停。
   */
  static readonly MOVE_DECEL =
    MissFortune.MOVE_SPEED / MissFortune.MOVE_RAMP_TIME;
  /**
   * 最坏情况（转 180°）时长（秒）。
   * 更小角度按时长 ∝ 夹角 / π 缩放；过程为 ease-in-out 非线性。
   */
  static readonly TURN_TIME = 0.3;
  /**
   * 期望朝向相对当前转身目标偏移超过此值时，从当前 yaw 重新规划转身。
   * （约 25°，避免追移动目标时每帧重置导致卡在缓动起点）
   */
  private static readonly TURN_RETARGET = (25 * Math.PI) / 180;
  /**
   * 开火朝向容差（弧度）：实际朝向与目标夹角 ≤ 此值才推进前摇/出弹。
   */
  static readonly FIRE_CONE = (12 * Math.PI) / 180;
  /** 到达目标判定距离 */
  private static readonly ARRIVE_EPS = 0.04;
  /** 速度视为静止的阈值 */
  private static readonly STOP_SPEED = 0.05;

  /** 走路周期频率（弧度/秒） */
  private static readonly WALK_FREQ = 9.5;
  /** 前后迈步幅度（本地 Z） */
  private static readonly STRIDE = 0.11;
  /** 抬脚高度 */
  private static readonly FOOT_LIFT = 0.08;
  /** 持枪手前后微摆 */
  private static readonly ARM_SWING = 0.045;
  /** 身体上下起伏 */
  private static readonly BODY_BOB = 0.03;
  /** 持枪手本地旋转幅度（弧度），带动枪晃 */
  private static readonly HAND_ROLL = 0.14;
  private static readonly HAND_PITCH = 0.1;
  private static readonly HAND_YAW = 0.08;

  /** 站立呼吸：频率（弧度/秒）与幅度 */
  private static readonly IDLE_FREQ = 2.2;
  private static readonly IDLE_BODY_BOB = 0.012;
  private static readonly IDLE_BODY_SWAY = 0.018;
  private static readonly IDLE_HAND_BOB = 0.01;
  private static readonly IDLE_HAND_ROLL = 0.04;
  private static readonly IDLE_HAND_PITCH = 0.03;

  private static readonly BODY = 0xf3eee6;
  private static readonly LIMB = 0xf3eee6;
  /** 粉色帽子 */
  private static readonly HAT_PINK = 0xec4899;
  private static readonly HAT_PINK_BAND = 0xbe185d;

  readonly team: TeamId = MissFortune.TEAM;
  readonly collider: CircleBody;
  readonly combatPriority = MissFortune.COMBAT_PRIORITY;
  readonly maxHp = MissFortune.MAX_HP;
  hp = MissFortune.MAX_HP;

  private readonly bodyRoot: THREE.Group;
  private readonly bodyMesh: THREE.Mesh;
  private readonly leftHand: THREE.Mesh;
  private readonly rightHand: THREE.Mesh;
  private readonly leftFoot: THREE.Mesh;
  private readonly rightFoot: THREE.Mesh;
  /** 左/右枪口锚点（世界坐标发弹） */
  private readonly leftMuzzle: THREE.Object3D;
  private readonly rightMuzzle: THREE.Object3D;

  private readonly baseLeftHand = new THREE.Vector3(0.48, 0.62, 0.28);
  private readonly baseRightHand = new THREE.Vector3(-0.48, 0.62, 0.28);
  private readonly baseLeftFoot = new THREE.Vector3(0.14, 0.1, 0.02);
  private readonly baseRightFoot = new THREE.Vector3(-0.14, 0.1, 0.02);

  /** 点地移动目标（XZ）；null 表示无目标（仍可能在减速滑步） */
  private moveTargetX: number | null = null;
  private moveTargetZ: number | null = null;
  /**
   * WASD 连续移动：激活时按单位方向全速走，优先于点地目标。
   * 松开后清除，速度自然刹停。
   */
  private moveInputActive = false;
  private moveInputX = 0;
  private moveInputZ = 0;
  /** 当前水平速度（世界 XZ） */
  private velX = 0;
  private velZ = 0;
  /** 走路相位（移动时推进） */
  private walkPhase = 0;
  /** 站立呼吸相位（始终推进，停下时用） */
  private idlePhase = 0;
  /**
   * 走路姿态权重 0=纯呼吸 1=满走；平滑过渡，避免站/走硬切。
   */
  private moveAnimWeight = 0;

  /** 当前普攻锁定目标 */
  private attackTarget: CombatUnit | null = null;
  /** 攻击冷却：>0 时不能开始新前摇 */
  private attackCd = 0;
  /** 前摇计时；<0 表示不在前摇 */
  private windupElapsed = -1;
  /** 双枪交替：true=下一发右手 */
  private nextShotRight = true;
  private activeShotRight = true;
  /** 子弹发射瞬间的抬手动作倒计时 */
  private shootAnimTimer = 0;
  private readonly muzzleWorld = new THREE.Vector3();
  /** E 技能剩余冷却（秒） */
  private eCd = 0;
  /**
   * 权威偏航角（弧度）。只由 applyFacing 推进；同步到 rotation.y。
   * 不回读 Three Euler，避免矩阵/四元数回写造成跳变。
   */
  private yaw = Math.PI / 2;
  /**
   * 期望偏航角（弧度）。仅 requestFacing / 移动意图写入；
   * applyFacing 只逼近、不突变赋值。
   */
  private desiredYaw = Math.PI / 2;
  /** 本段转身起点 / 终点（最短弧） */
  private turnFromYaw = Math.PI / 2;
  private turnToYaw = Math.PI / 2;
  /** 本段转身已用时间 / 总时长 */
  private turnElapsed = 0;
  private turnDuration = 0;
  private turnActive = false;

  private spawnX: number;
  private spawnZ: number;
  private respawnTimer = 0;

  private readonly healthBar: HealthBar;

  constructor(x = 0, z = 0) {
    super();
    this.name = MissFortune.DISPLAY_NAME;
    this.spawnX = x;
    this.spawnZ = z;
    this.position.set(x, 0, z);
    this.scale.setScalar(MissFortune.SCALE);
    // 面朝 +X（本地 +Z → 世界 +X）
    this.yaw = Math.PI / 2;
    this.desiredYaw = this.yaw;
    this.rotation.set(0, this.yaw, 0);

    this.collider = new CircleBody(this, MissFortune.COLLIDER_RADIUS);

    // 头顶血条：挂载于轴心正上方，进一步抬高 yOffset，通过 centerX 屏幕锚点向右平移
    const s = MissFortune.SCALE;
    this.healthBar = new HealthBar({
      width: 0.4 / s,
      height: 0.055 / s,
      yOffset: 3.1,
      team: this.team,
      hideWhenFull: false,
      centerX: 0.35,
    });
    this.add(this.healthBar);
    this.healthBar.setHp(this.hp, this.maxHp);

    this.bodyRoot = new THREE.Group();
    this.add(this.bodyRoot);

    const ball = (radius: number, color: number): THREE.Mesh =>
      new THREE.Mesh(
        new THREE.SphereGeometry(radius, 20, 16),
        new THREE.MeshStandardMaterial({
          color,
          roughness: 0.6,
          metalness: 0.04,
        }),
      );

    // —— 身体 ——
    this.bodyMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 24, 20),
      new THREE.MeshStandardMaterial({
        map: createFaceTexture(MissFortune.BODY),
        roughness: 0.6,
        metalness: 0.04,
      }),
    );
    this.bodyMesh.position.y = 0.66;
    this.bodyMesh.rotation.y = -Math.PI / 2;
    this.bodyMesh.castShadow = true;
    this.bodyMesh.receiveShadow = true;
    this.bodyRoot.add(this.bodyMesh);

    // —— 粉色巫师帽 ——
    const hatGroup = new THREE.Group();
    hatGroup.position.set(0, 0.66 + 0.14, -0.06);
    hatGroup.rotation.z = -0.05;
    hatGroup.rotation.x = -0.42;

    const hatMat = new THREE.MeshStandardMaterial({
      color: MissFortune.HAT_PINK,
      roughness: 0.35,
      metalness: 0.05,
    });
    const bandMat = new THREE.MeshStandardMaterial({
      color: MissFortune.HAT_PINK_BAND,
      roughness: 0.3,
      metalness: 0.1,
    });

    const brimRadius = 0.62;
    const brimDisk = new THREE.Mesh(
      new THREE.CylinderGeometry(brimRadius, brimRadius, 0.045, 32),
      hatMat,
    );
    brimDisk.castShadow = true;
    hatGroup.add(brimDisk);

    const brimRim = new THREE.Mesh(
      new THREE.TorusGeometry(brimRadius, 0.03, 12, 32),
      hatMat,
    );
    brimRim.rotation.x = Math.PI / 2;
    hatGroup.add(brimRim);

    const band = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.038, 12, 32),
      bandMat,
    );
    band.rotation.x = Math.PI / 2;
    band.position.y = 0.03;
    hatGroup.add(band);

    const domeRadius = 0.44;
    const domeMesh = new THREE.Mesh(
      new THREE.SphereGeometry(
        domeRadius,
        32,
        24,
        0,
        Math.PI * 2,
        0,
        Math.PI / 2,
      ),
      hatMat,
    );
    domeMesh.scale.set(1, 0.85, 1);
    domeMesh.position.y = 0.01;
    domeMesh.castShadow = true;
    hatGroup.add(domeMesh);
    this.bodyRoot.add(hatGroup);

    // —— 双手（对称举枪就绪）——
    // 手球半径 0.1；枪挂在球外侧，只贴合不穿模
    this.leftHand = ball(0.1, MissFortune.LIMB);
    this.leftHand.position.copy(this.baseLeftHand);
    this.leftHand.castShadow = true;
    this.bodyRoot.add(this.leftHand);

    this.rightHand = ball(0.1, MissFortune.LIMB);
    this.rightHand.position.copy(this.baseRightHand);
    this.rightHand.castShadow = true;
    this.bodyRoot.add(this.rightHand);

    // 粉色双枪：握把贴手球，枪身朝前；左手镜像右手姿态
    // 手半径 0.1；原点≈握把顶端接触点，整体在球外
    const gunPos = new THREE.Vector3(0.0, 0.09, 0.13);
    // 负 Rx：枪口（本地 +Z）略抬高

    const rightGun = createPinkGun();
    rightGun.name = 'PinkGun_Right';
    rightGun.position.copy(gunPos);
    rightGun.rotation.order = 'YXZ';
    rightGun.rotation.set(-0.22, 0.03, -0.15);
    this.rightHand.add(rightGun);
    this.rightMuzzle = rightGun.getObjectByName('GunMuzzle') ?? rightGun;

    const leftGun = createPinkGun();
    leftGun.name = 'PinkGun_Left';
    leftGun.position.copy(gunPos);
    leftGun.rotation.order = 'YXZ';
    // Y / Z 取反，镜像到左手
    leftGun.rotation.set(-0.22, -0.03, 0.15);
    this.leftHand.add(leftGun);
    this.leftMuzzle = leftGun.getObjectByName('GunMuzzle') ?? leftGun;

    // —— 双脚 ——
    this.leftFoot = ball(0.1, MissFortune.LIMB);
    this.leftFoot.position.copy(this.baseLeftFoot);
    this.leftFoot.castShadow = true;
    this.add(this.leftFoot);

    this.rightFoot = ball(0.1, MissFortune.LIMB);
    this.rightFoot.position.copy(this.baseRightFoot);
    this.rightFoot.castShadow = true;
    this.add(this.rightFoot);

    this.applyLocomotionPose(0);
  }

  private invincible = false;

  get isInvincible(): boolean {
    return this.invincible;
  }

  setInvincible(invincible: boolean): void {
    this.invincible = invincible;
  }

  get isAlive(): boolean {
    return this.hp > 0;
  }

  takeDamage(amount: number): void {
    if (this.invincible || !this.isAlive || amount <= 0) return;
    this.hp = Math.max(0, this.hp - amount);
    this.healthBar.setHp(this.hp, this.maxHp);
    if (!this.isAlive) {
      this.clearAttackTarget();
      this.stopMoving();
      this.respawnTimer = 5;
      this.visible = false;
      this.healthBar.visible = false;
    }
  }

  respawn(): void {
    this.hp = MissFortune.MAX_HP;
    this.healthBar.setHp(this.hp, this.maxHp);
    this.healthBar.visible = true;
    this.position.set(this.spawnX, 0, this.spawnZ);
    this.clearAttackTarget();
    this.stopMoving();
    this.velX = 0;
    this.velZ = 0;
    this.yaw = Math.PI / 2;
    this.desiredYaw = this.yaw;
    this.rotation.set(0, this.yaw, 0);
    this.visible = true;
  }

  /** 弹道落点：身体球中心 */
  getHitPoint(out: THREE.Vector3): THREE.Vector3 {
    return this.bodyMesh.getWorldPosition(out);
  }

  /**
   * 锁定敌方单位普攻：射程内站桩开火，射程外追击。
   * 点地移动会取消攻击目标。
   */
  setAttackTarget(target: CombatUnit): void {
    if (!this.isAlive || !isValidTarget(this, target)) return;
    this.attackTarget = target;
    this.windupElapsed = -1;
    // 只登记期望朝向，不改 yaw（由后续 applyFacing 限速转向）
    this.requestFacing(
      target.collider.x - this.position.x,
      target.collider.z - this.position.z,
    );
    const d = distXZ(this.collider, target.collider);
    if (d > MissFortune.ATTACK_RANGE) {
      this.chaseTo(target.collider.x, target.collider.z);
    } else {
      this.stopMoving();
    }
  }

  clearAttackTarget(): void {
    this.attackTarget = null;
    this.windupElapsed = -1;
  }

  get hasAttackTarget(): boolean {
    return this.attackTarget != null;
  }

  /** E 技能剩余冷却（秒） */
  get eCooldownRemaining(): number {
    return this.eCd;
  }

  get eCooldownTotal(): number {
    return MissFortune.E_COOLDOWN;
  }

  canCastE(): boolean {
    return this.isAlive && this.eCd <= 0;
  }

  /**
   * 施放 E「枪林弹雨」：落点超距时钳到最大施法距离边缘。
   * @returns 实际落点；不可施放时返回 null
   */
  castE(
    aimX: number,
    aimZ: number,
    projectiles: ProjectileManager,
    getEnemyUnits: () => readonly CombatUnit[],
  ): { x: number; z: number } | null {
    if (!this.canCastE()) return null;
    if (!Number.isFinite(aimX) || !Number.isFinite(aimZ)) return null;

    let x = aimX;
    let z = aimZ;
    const dx = aimX - this.position.x;
    const dz = aimZ - this.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > MissFortune.E_CAST_RANGE && dist > 1e-6) {
      const s = MissFortune.E_CAST_RANGE / dist;
      x = this.position.x + dx * s;
      z = this.position.z + dz * s;
    }

    this.eCd = MissFortune.E_COOLDOWN;
    // 朝向落点；不取消普攻，登记期望朝向
    this.requestFacing(x - this.position.x, z - this.position.z);
    this.shootAnimTimer = 0.32;
    this.activeShotRight = this.nextShotRight;
    this.nextShotRight = !this.nextShotRight;

    projectiles.spawnBulletRain({
      centerX: x,
      centerZ: z,
      radius: MissFortune.E_RADIUS,
      team: this.team,
      damagePerTick: MissFortune.E_DAMAGE_PER_TICK,
      tickInterval: MissFortune.E_TICK_INTERVAL,
      duration: MissFortune.E_DURATION,
      boltCount: MissFortune.E_BOLT_COUNT,
      color: MissFortune.BOLT_COLOR,
      emissive: MissFortune.BOLT_EMISSIVE,
      boltScale: MissFortune.BOLT_SCALE * 0.55,
      getEnemyUnits,
    });

    return { x, z };
  }

  /** 是否在移动（有目标 / WASD 输入或仍在减速） */
  get isMoving(): boolean {
    if (this.moveInputActive) return true;
    if (this.moveTargetX != null && this.moveTargetZ != null) return true;
    return this.speed() > MissFortune.STOP_SPEED;
  }

  /**
   * WASD 连续移动（世界 XZ 方向，长度任意，内部归一化）。
   * 有输入时取消普攻与点地目标；零向量表示松开。
   */
  setMoveInput(dirX: number, dirZ: number): void {
    if (!this.isAlive) {
      this.clearMoveInput();
      return;
    }
    if (!Number.isFinite(dirX) || !Number.isFinite(dirZ)) {
      this.clearMoveInput();
      return;
    }
    const len = Math.hypot(dirX, dirZ);
    if (len < 1e-6) {
      this.clearMoveInput();
      return;
    }
    this.clearAttackTarget();
    this.moveTargetX = null;
    this.moveTargetZ = null;
    this.moveInputActive = true;
    this.moveInputX = dirX / len;
    this.moveInputZ = dirZ / len;
  }

  /** 右键点地：设置地面目标（世界 XZ）；取消普攻锁定与 WASD 输入 */
  moveTo(x: number, z: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    this.clearMoveInput();
    this.clearAttackTarget();
    this.moveTargetX = x;
    this.moveTargetZ = z;
  }

  /**
   * 仅追击位移（不取消攻击目标）。
   * 普攻追敌时内部调用。
   */
  private chaseTo(x: number, z: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    // 追击时若玩家正按 WASD，不覆盖（由 setMoveInput 优先）
    if (this.moveInputActive) return;
    this.moveTargetX = x;
    this.moveTargetZ = z;
  }

  /** 取消点地目标与 WASD 输入（速度会自然刹停，不清零） */
  stopMoving(): void {
    this.clearMoveInput();
    this.moveTargetX = null;
    this.moveTargetZ = null;
  }

  private clearMoveInput(): void {
    this.moveInputActive = false;
    this.moveInputX = 0;
    this.moveInputZ = 0;
  }

  private speed(): number {
    return Math.hypot(this.velX, this.velZ);
  }

  /**
   * 每帧推进：战斗意图 → 位移 → 唯一限速转向 → 对准后开火。
   * 场景只需调这一处（避免 movement/combat 顺序导致朝向突变或漏积分）。
   */
  update(delta: number, projectiles: ProjectileManager): void {
    if (!(delta > 0) || !Number.isFinite(delta)) return;

    if (!this.isAlive) {
      if (this.respawnTimer > 0) {
        this.respawnTimer = Math.max(0, this.respawnTimer - delta);
        if (this.respawnTimer <= 0) {
          this.respawn();
        }
      }
      return;
    }

    this.healthBar.setHp(this.hp, this.maxHp);

    if (this.eCd > 0) {
      this.eCd = Math.max(0, this.eCd - delta);
    }

    this.tickCombatIntent(delta);
    this.tickMovement(delta);
    this.tickCombatFire(delta, projectiles);
  }

  /**
   * 战斗意图：索敌距离、追击/停步、请求朝向。
   * 不写 rotation.y，不发射子弹。
   */
  private tickCombatIntent(delta: number): void {
    if (!this.isAlive) return;

    if (this.attackCd > 0) {
      this.attackCd = Math.max(0, this.attackCd - delta);
    }

    if (!isValidTarget(this, this.attackTarget)) {
      this.clearAttackTarget();
      return;
    }

    const target = this.attackTarget;
    const d = distXZ(this.collider, target.collider);
    const dx = target.collider.x - this.position.x;
    const dz = target.collider.z - this.position.z;

    // 始终请求朝向目标（追击时也会转头；移动意图若同时存在，攻击优先）
    this.requestFacing(dx, dz);

    if (d > MissFortune.ATTACK_RANGE) {
      this.windupElapsed = -1;
      this.chaseTo(target.collider.x, target.collider.z);
      return;
    }

    // 射程内：停步，等待对准后再由 tickCombatFire 推进前摇
    this.stopMoving();
  }

  /**
   * 对准且在射程内：推进前摇 / 出弹。
   * 必须在 applyFacing 之后调用，使本帧转向先生效。
   */
  private tickCombatFire(
    delta: number,
    projectiles: ProjectileManager,
  ): void {
    if (!this.isAlive) return;
    if (!isValidTarget(this, this.attackTarget)) return;

    const target = this.attackTarget;
    const d = distXZ(this.collider, target.collider);
    if (d > MissFortune.ATTACK_RANGE) return;

    // 未对准：暂停前摇（不消耗、不重置），禁止侧身开火
    if (!this.isFacingWithinCone(target)) {
      return;
    }

    if (this.attackCd > 0 && this.windupElapsed < 0) {
      return;
    }

    if (this.windupElapsed < 0) {
      this.windupElapsed = 0;
    }
    this.windupElapsed += delta;

    if (this.windupElapsed >= MissFortune.WINDUP) {
      if (
        isValidTarget(this, target) &&
        distXZ(this.collider, target.collider) <= MissFortune.ATTACK_RANGE &&
        this.isFacingWithinCone(target)
      ) {
        this.fireBasicAttack(projectiles, target);
      }
      this.windupElapsed = -1;
      this.attackCd = Math.max(
        0,
        MissFortune.ATTACK_INTERVAL - MissFortune.WINDUP,
      );
    }
  }

  /**
   * 点地移动 / 站立呼吸 + 唯一限速转向。
   * 碰撞推挤由场景在本帧末 resolve。
   */
  private tickMovement(delta: number): void {
    if (!this.isAlive) return;

    // 呼吸相位始终走，切换站/走时更自然
    this.idlePhase += delta * MissFortune.IDLE_FREQ;

    let desiredVelX = 0;
    let desiredVelZ = 0;
    /** 移动提出的朝向；攻击 requestFacing 优先 */
    let moveFaceX: number | null = null;
    let moveFaceZ: number | null = null;

    if (this.moveInputActive) {
      // WASD：相对镜头的连续方向，满速
      moveFaceX = this.moveInputX;
      moveFaceZ = this.moveInputZ;
      desiredVelX = this.moveInputX * MissFortune.MOVE_SPEED;
      desiredVelZ = this.moveInputZ * MissFortune.MOVE_SPEED;
    } else if (this.moveTargetX != null && this.moveTargetZ != null) {
      const dx = this.moveTargetX - this.position.x;
      const dz = this.moveTargetZ - this.position.z;
      const dist = Math.hypot(dx, dz);

      if (dist <= MissFortune.ARRIVE_EPS) {
        // 贴到目标，进入刹车
        this.position.x = this.moveTargetX;
        this.position.z = this.moveTargetZ;
        this.stopMoving();
        desiredVelX = 0;
        desiredVelZ = 0;
      } else {
        const inv = 1 / dist;
        const dirX = dx * inv;
        const dirZ = dz * inv;
        moveFaceX = dirX;
        moveFaceZ = dirZ;

        // 默认冲满速；仅在进入刹车距离后按运动学收速（满速约 0.1s 刹停）
        let desiredSpeed = MissFortune.MOVE_SPEED;
        const spd = this.speed();
        const brakeDist =
          (spd * spd) / (2 * Math.max(MissFortune.MOVE_DECEL, 1e-4));
        if (dist <= brakeDist && brakeDist > 1e-6) {
          desiredSpeed = Math.min(
            desiredSpeed,
            Math.sqrt(
              Math.max(0, 2 * MissFortune.MOVE_DECEL * dist),
            ),
          );
        }

        desiredVelX = dirX * desiredSpeed;
        desiredVelZ = dirZ * desiredSpeed;
      }
    }

    // 加速用 ACCEL，减速/改向用 DECEL
    const curSpd = this.speed();
    const desSpd = Math.hypot(desiredVelX, desiredVelZ);
    const rate =
      desSpd >= curSpd - 1e-4
        ? MissFortune.MOVE_ACCEL
        : MissFortune.MOVE_DECEL;
    const maxDeltaV = rate * delta;
    const dvx = desiredVelX - this.velX;
    const dvz = desiredVelZ - this.velZ;
    const dLen = Math.hypot(dvx, dvz);
    if (dLen <= maxDeltaV || dLen < 1e-8) {
      this.velX = desiredVelX;
      this.velZ = desiredVelZ;
    } else {
      const s = maxDeltaV / dLen;
      this.velX += dvx * s;
      this.velZ += dvz * s;
    }

    // 积分位移，避免单帧冲过点地目标
    let moveX = this.velX * delta;
    let moveZ = this.velZ * delta;
    if (
      !this.moveInputActive &&
      this.moveTargetX != null &&
      this.moveTargetZ != null
    ) {
      const dx = this.moveTargetX - this.position.x;
      const dz = this.moveTargetZ - this.position.z;
      const dist = Math.hypot(dx, dz);
      const step = Math.hypot(moveX, moveZ);
      if (step > dist && dist > 1e-8) {
        const k = dist / step;
        moveX *= k;
        moveZ *= k;
        this.velX *= k;
        this.velZ *= k;
      }
    }

    this.position.x += moveX;
    this.position.z += moveZ;

    const spd = this.speed();

    // —— 朝向意图：攻击已在 tickCombatIntent 写过 desiredYaw 则不再覆盖 ——
    // 无攻击时：移动方向 > 速度方向；都没有则保持当前 desiredYaw（不甩头）
    if (!this.hasAttackTarget) {
      if (moveFaceX != null && moveFaceZ != null) {
        this.requestFacing(moveFaceX, moveFaceZ);
      } else if (spd > MissFortune.STOP_SPEED) {
        this.requestFacing(this.velX, this.velZ);
      }
    }
    // 唯一推进 yaw / rotation.y 的出口
    this.applyFacing(delta);

    if (
      !this.moveInputActive &&
      this.moveTargetX == null &&
      this.moveTargetZ == null &&
      spd <= MissFortune.STOP_SPEED
    ) {
      this.velX = 0;
      this.velZ = 0;
    }

    // 走路权重平滑追速度比，禁止站/走硬切
    const speedRatio = THREE.MathUtils.clamp(
      spd / MissFortune.MOVE_SPEED,
      0,
      1,
    );
    const weightTarget = speedRatio < 0.06 ? 0 : speedRatio;
    const weightRate = weightTarget >= this.moveAnimWeight ? 10 : 5.5;
    this.moveAnimWeight = stepScalarToward(
      this.moveAnimWeight,
      weightTarget,
      weightRate * delta,
    );

    if (this.moveAnimWeight > 0.001) {
      this.walkPhase +=
        delta *
        MissFortune.WALK_FREQ *
        (0.55 + 0.45 * this.moveAnimWeight);
    }

    this.applyLocomotionPose(this.moveAnimWeight, delta);
  }

  /**
   * 登记期望朝向（世界 XZ → yaw）。只改 desiredYaw，绝不写 rotation。
   */
  private requestFacing(dx: number, dz: number): void {
    if (dx * dx + dz * dz < 1e-10) return;
    this.desiredYaw = Math.atan2(dx, dz);
  }

  /**
   * 开始一段从 from → to 的转身（时长按夹角相对 180° 缩放）。
   */
  private beginTurn(from: number, to: number): void {
    this.turnFromYaw = normalizeAngle(from);
    this.turnToYaw = normalizeAngle(to);
    this.turnElapsed = 0;
    const ang = Math.abs(normalizeAngle(this.turnToYaw - this.turnFromYaw));
    this.turnDuration = Math.max(
      1e-4,
      MissFortune.TURN_TIME * (ang / Math.PI),
    );
    this.turnActive = ang > 1e-5;
    if (!this.turnActive) {
      this.yaw = this.turnToYaw;
    }
  }

  /**
   * 全角色唯一转向出口：
   * 沿最短弧做 ease-in-out 插值，180° 约 TURN_TIME，过程非线性。
   */
  private applyFacing(delta: number): void {
    if (!(delta > 0) || !Number.isFinite(delta)) return;
    const dt = Math.min(delta, 0.05);
    const target = this.desiredYaw;
    const absErr = Math.abs(normalizeAngle(target - this.yaw));

    if (absErr < 1e-5) {
      this.yaw = normalizeAngle(target);
      this.turnActive = false;
      this.turnDuration = 0;
      this.syncYawToRotation();
      return;
    }

    if (!this.turnActive || this.turnDuration <= 0) {
      this.beginTurn(this.yaw, target);
    } else {
      const shift = Math.abs(normalizeAngle(target - this.turnToYaw));
      if (shift > MissFortune.TURN_RETARGET) {
        // 大幅改向：从当前朝向重新规划
        this.beginTurn(this.yaw, target);
      } else if (shift > 1e-5) {
        // 小幅追踪（移动中的敌人）：只改终点，保持缓动进度，避免跳变
        this.turnToYaw = normalizeAngle(target);
      }
    }

    if (!this.turnActive) {
      this.syncYawToRotation();
      return;
    }

    this.turnElapsed += dt;
    const tLin = Math.min(1, this.turnElapsed / this.turnDuration);
    const t = easeInOutCubic(tLin);
    this.yaw = lerpAngle(this.turnFromYaw, this.turnToYaw, t);

    if (tLin >= 1) {
      this.yaw = this.turnToYaw;
      this.turnActive = false;
      // 若终点已偏期望，下帧 beginTurn 接上
    }

    this.syncYawToRotation();
  }

  private syncYawToRotation(): void {
    this.rotation.x = 0;
    this.rotation.y = this.yaw;
    this.rotation.z = 0;
  }

  /** 实际朝向与目标夹角是否在开火锥内（用权威 yaw，不读 Euler） */
  private isFacingWithinCone(target: CombatUnit): boolean {
    const dx = target.collider.x - this.position.x;
    const dz = target.collider.z - this.position.z;
    if (dx * dx + dz * dz < 1e-10) return true;
    const want = Math.atan2(dx, dz);
    const err = Math.abs(normalizeAngle(want - this.yaw));
    return err <= MissFortune.FIRE_CONE;
  }

  /** 双枪交替：从枪口世界坐标发出粉色追踪弹 */
  private fireBasicAttack(
    projectiles: ProjectileManager,
    target: CombatUnit,
  ): void {
    const muzzle = this.nextShotRight ? this.rightMuzzle : this.leftMuzzle;
    this.activeShotRight = this.nextShotRight;
    this.shootAnimTimer = 0.28;
    this.nextShotRight = !this.nextShotRight;
    muzzle.getWorldPosition(this.muzzleWorld);
    projectiles.fireAt(
      this.muzzleWorld,
      target,
      MissFortune.ATTACK_DAMAGE,
      this.team,
      MissFortune.BOLT_SCALE,
      {
        color: MissFortune.BOLT_COLOR,
        emissive: MissFortune.BOLT_EMISSIVE,
      },
    );
  }

  /**
   * 统一姿态：呼吸与走路按 weight 混合后一次写入。
   * weight=0 纯站立，weight=1 满走。
   */
  private applyLocomotionPose(walkWeight: number, delta = 0): void {
    const w = THREE.MathUtils.clamp(walkWeight, 0, 1);
    const breath = Math.sin(this.idlePhase);
    const breath2 = Math.sin(this.idlePhase * 0.55 + 0.8);

    // —— 站立通道 ——
    const idleBodyY = breath * MissFortune.IDLE_BODY_BOB;
    const idleBodyRz = breath2 * MissFortune.IDLE_BODY_SWAY;
    const idleBodyRx = 0.03 + breath * 0.012;

    const idleHandLY = this.baseLeftHand.y + breath * MissFortune.IDLE_HAND_BOB;
    const idleHandLZ = this.baseLeftHand.z + breath2 * 0.006;
    const idleHandRY =
      this.baseRightHand.y + breath * MissFortune.IDLE_HAND_BOB * 0.9;
    const idleHandRZ = this.baseRightHand.z - breath2 * 0.006;

    const idleHandLRx = breath * MissFortune.IDLE_HAND_PITCH;
    const idleHandLRy = breath2 * 0.02;
    const idleHandLRz = breath2 * MissFortune.IDLE_HAND_ROLL;
    const idleHandRRx = -breath * MissFortune.IDLE_HAND_PITCH * 0.85;
    const idleHandRRy = -breath2 * 0.02;
    const idleHandRRz = -breath2 * MissFortune.IDLE_HAND_ROLL;

    // —— 走路通道 ——
    const s = Math.sin(this.walkPhase);
    const c = Math.cos(this.walkPhase);
    const stepLift = Math.abs(s);
    const amp = Math.max(w, 0.001);

    const walkBodyY = stepLift * MissFortune.BODY_BOB * amp;
    const walkBodyRz = s * 0.045 * amp;
    const walkBodyRx = 0.03 + stepLift * 0.025 * amp;

    const walkFootLY =
      this.baseLeftFoot.y + Math.max(0, c) * MissFortune.FOOT_LIFT * amp;
    const walkFootLZ = this.baseLeftFoot.z + s * MissFortune.STRIDE * amp;
    const walkFootRY =
      this.baseRightFoot.y + Math.max(0, -c) * MissFortune.FOOT_LIFT * amp;
    const walkFootRZ = this.baseRightFoot.z - s * MissFortune.STRIDE * amp;

    const walkHandLY = this.baseLeftHand.y + stepLift * 0.02 * amp;
    const walkHandLZ = this.baseLeftHand.z - s * MissFortune.ARM_SWING * amp;
    const walkHandRY = this.baseRightHand.y + stepLift * 0.02 * amp;
    const walkHandRZ = this.baseRightHand.z + s * MissFortune.ARM_SWING * amp;

    const walkHandLRx = c * MissFortune.HAND_PITCH * amp;
    const walkHandLRy = -s * MissFortune.HAND_YAW * amp;
    const walkHandLRz = s * MissFortune.HAND_ROLL * amp;
    const walkHandRRx = -c * MissFortune.HAND_PITCH * amp;
    const walkHandRRy = s * MissFortune.HAND_YAW * amp;
    const walkHandRRz = -s * MissFortune.HAND_ROLL * amp;

    const iw = 1 - w;

    // 每帧绝对写入（含 z=0），急停加法才不会漂移/叠双重复位
    this.bodyRoot.position.set(
      0,
      idleBodyY * iw + walkBodyY * w,
      0,
    );
    this.bodyRoot.rotation.z = idleBodyRz * iw + walkBodyRz * w;
    this.bodyRoot.rotation.x = idleBodyRx * iw + walkBodyRx * w;

    this.leftFoot.position.set(
      this.baseLeftFoot.x,
      this.baseLeftFoot.y * iw + walkFootLY * w,
      this.baseLeftFoot.z * iw + walkFootLZ * w,
    );
    this.rightFoot.position.set(
      this.baseRightFoot.x,
      this.baseRightFoot.y * iw + walkFootRY * w,
      this.baseRightFoot.z * iw + walkFootRZ * w,
    );

    this.leftHand.position.set(
      this.baseLeftHand.x,
      idleHandLY * iw + walkHandLY * w,
      idleHandLZ * iw + walkHandLZ * w,
    );
    this.rightHand.position.set(
      this.baseRightHand.x,
      idleHandRY * iw + walkHandRY * w,
      idleHandRZ * iw + walkHandRZ * w,
    );

    this.leftHand.rotation.set(
      idleHandLRx * iw + walkHandLRx * w,
      idleHandLRy * iw + walkHandLRy * w,
      idleHandLRz * iw + walkHandLRz * w,
    );
    this.rightHand.rotation.set(
      idleHandRRx * iw + walkHandRRx * w,
      idleHandRRy * iw + walkHandRRy * w,
      idleHandRRz * iw + walkHandRRz * w,
    );

    // —— 子弹发射瞬间的手部圆心上扬姿态叠加 ——
    if (this.shootAnimTimer > 0) {
      this.shootAnimTimer = Math.max(0, this.shootAnimTimer - delta);
    }

    if (this.shootAnimTimer > 0.001) {
      // 0.25s 内的进度 p: 1 -> 0
      const p = this.shootAnimTimer / 0.25;
      // 前 35% 快速冲顶上扬，后 65% 平滑回落
      const intensity = p > 0.65 ? (1 - p) / 0.35 : p / 0.65;
      const isRight = this.activeShotRight;

      const mainHand = isRight ? this.rightHand : this.leftHand;

      // 仅调整手的旋转角度（圆心上扬），保持手的位置 position 不变
      mainHand.rotation.x -= 1.0 * intensity;
      mainHand.rotation.y += (isRight ? -0.15 : 0.15) * intensity;
    }
  }

  dispose(): void {
    this.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const material = mesh.material;
      if (!material) return;
      const list = Array.isArray(material) ? material : [material];
      for (const m of list) {
        const std = m as THREE.MeshStandardMaterial;
        std.map?.dispose();
        m.dispose();
      }
    });
  }
}

/** 标量向 target 靠近，步长不超过 maxDelta */
function stepScalarToward(
  current: number,
  target: number,
  maxDelta: number,
): number {
  if (!(maxDelta > 0)) return current;
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

/** 最短弧角度插值，t∈[0,1] */
function lerpAngle(from: number, to: number, t: number): number {
  const d = normalizeAngle(to - from);
  return normalizeAngle(from + d * t);
}

/** ease-in-out cubic：慢起 → 快中 → 慢收 */
function easeInOutCubic(t: number): number {
  const x = THREE.MathUtils.clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

function normalizeAngle(rad: number): number {
  let a = rad;
  while (a <= -Math.PI) a += Math.PI * 2;
  while (a > Math.PI) a -= Math.PI * 2;
  return a;
}

/** 身体正面可爱表情贴图（本文件私有，不共享小兵实现） */
function createFaceTexture(bodyColor: number): THREE.CanvasTexture {
  const width = 1024;
  const height = 512;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');

  const bodyHex = `#${bodyColor.toString(16).padStart(6, '0')}`;
  const darkBrown = '#2b2123';

  ctx.fillStyle = bodyHex;
  ctx.fillRect(0, 0, width, height);

  const cx = width * 0.5;
  const eyeY = height * 0.49;
  const eyeGap = width * 0.075;
  const eyeRy = height * 0.1;
  const eyeRx = eyeRy;

  const drawBlush = (bx: number) => {
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
    ctx.ellipse(bx, height * 0.59, eyeRx * 0.9, eyeRy * 0.55, 0, 0, Math.PI * 2);
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

  const drawEye = (ex: number) => {
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, eyeRx, eyeRy, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#21181b';
    ctx.fill();

    const innerG = ctx.createLinearGradient(ex, eyeY - eyeRy, ex, eyeY + eyeRy);
    innerG.addColorStop(0, '#1d1518');
    innerG.addColorStop(0.65, '#3a2b2f');
    innerG.addColorStop(1, '#664c54');
    ctx.fillStyle = innerG;
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, eyeRx * 0.96, eyeRy * 0.96, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#140c0e';
    ctx.beginPath();
    ctx.ellipse(ex, eyeY + eyeRy * 0.05, eyeRx * 0.7, eyeRy * 0.7, 0, 0, Math.PI * 2);
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

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * 粉色卡通手枪（本地坐标：原点≈握把中心，+Z 枪口，-Y 握把向下）。
 * 粉壳 + 深粉握把 + 金色镶边；枪口夸张放大的卡通喇叭口。
 */
function createPinkGun(): THREE.Group {
  const gun = new THREE.Group();
  gun.name = 'PinkGun';

  const pink = new THREE.MeshStandardMaterial({
    color: 0xec4899,
    roughness: 0.38,
    metalness: 0.18,
  });
  const pinkDeep = new THREE.MeshStandardMaterial({
    color: 0xbe185d,
    roughness: 0.42,
    metalness: 0.12,
  });
  const pinkLight = new THREE.MeshStandardMaterial({
    color: 0xf9a8d4,
    roughness: 0.32,
    metalness: 0.2,
  });
  const gold = new THREE.MeshStandardMaterial({
    color: 0xfbbf24,
    roughness: 0.3,
    metalness: 0.75,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x2a0614,
    roughness: 0.55,
    metalness: 0.15,
  });
  // 枪口内膛微光，卡通「蓄能」感
  const boreGlow = new THREE.MeshStandardMaterial({
    color: 0x831843,
    roughness: 0.35,
    metalness: 0.1,
    emissive: 0xf472b6,
    emissiveIntensity: 0.55,
  });

  const cast = (mesh: THREE.Mesh) => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };

  // 本地原点 = 握把顶端（与手球贴合的接触点）；枪身整体在 +Z / -Y，不朝手心叠
  // 1. 握把（从接触点向下）
  const grip = cast(
    new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.13, 0.07), pinkDeep),
  );
  grip.position.set(0, -0.07, 0.0);
  grip.rotation.x = 0.12;
  gun.add(grip);

  const gripCap = cast(
    new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.018, 0.075), gold),
  );
  gripCap.position.set(0, -0.14, -0.012);
  gripCap.rotation.x = 0.12;
  gun.add(gripCap);

  // 2. 枪身（整体前移，离开手球）
  const frame = cast(
    new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.07, 0.14), pink),
  );
  frame.position.set(0, -0.01, 0.1);
  gun.add(frame);

  const topRail = cast(
    new THREE.Mesh(
      new THREE.CylinderGeometry(0.032, 0.034, 0.12, 14),
      pinkLight,
    ),
  );
  topRail.rotation.x = Math.PI / 2;
  topRail.position.set(0, 0.02, 0.1);
  gun.add(topRail);

  // 3. 短粗枪管 → 大喇叭口
  const barrel = cast(
    new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.03, 0.12, 16),
      pink,
    ),
  );
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.0, 0.22);
  gun.add(barrel);

  // 4. ★ 夸张卡通大枪口
  const muzzleY = 0.0;
  const muzzleZ = 0.36;

  const muzzleBell = cast(
    new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.07, 0.1, 24),
      pinkLight,
    ),
  );
  muzzleBell.rotation.x = Math.PI / 2;
  muzzleBell.position.set(0, muzzleY, muzzleZ);
  gun.add(muzzleBell);

  const muzzleLip = cast(
    new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.028, 12, 28), gold),
  );
  muzzleLip.position.set(0, muzzleY, muzzleZ + 0.055);
  gun.add(muzzleLip);

  // 弹道出生锚点：略伸出喇叭口外沿
  const muzzleAnchor = new THREE.Object3D();
  muzzleAnchor.name = 'GunMuzzle';
  muzzleAnchor.position.set(0, muzzleY, muzzleZ + 0.07);
  gun.add(muzzleAnchor);

  const muzzleRim = cast(
    new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.016, 10, 24), pinkDeep),
  );
  muzzleRim.position.set(0, muzzleY, muzzleZ + 0.04);
  gun.add(muzzleRim);

  const muzzleFace = cast(
    new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, 0.02, 24),
      pinkDeep,
    ),
  );
  muzzleFace.rotation.x = Math.PI / 2;
  muzzleFace.position.set(0, muzzleY, muzzleZ + 0.02);
  gun.add(muzzleFace);

  const bore = cast(
    new THREE.Mesh(new THREE.SphereGeometry(0.072, 20, 16), dark),
  );
  bore.scale.set(1, 1, 0.55);
  bore.position.set(0, muzzleY, muzzleZ + 0.01);
  gun.add(bore);

  const boreCore = cast(
    new THREE.Mesh(new THREE.SphereGeometry(0.038, 14, 12), boreGlow),
  );
  boreCore.scale.set(1, 1, 0.5);
  boreCore.position.set(0, muzzleY, muzzleZ + 0.005);
  gun.add(boreCore);

  // 5. 扳机护圈 / 扳机（在握把与枪身交接处前方）
  const guard = cast(
    new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.009, 8, 16, Math.PI), gold),
  );
  guard.rotation.y = Math.PI / 2;
  guard.rotation.z = Math.PI;
  guard.position.set(0, -0.04, 0.07);
  gun.add(guard);

  const trigger = cast(
    new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.028, 0.016), dark),
  );
  trigger.position.set(0, -0.035, 0.075);
  trigger.rotation.x = 0.25;
  gun.add(trigger);

  // 6. 后机匣（略在握把上方后侧，仍在手球外）
  const hammer = cast(
    new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.04, 0.035), pinkDeep),
  );
  hammer.position.set(0, 0.015, 0.02);
  hammer.rotation.x = -0.25;
  gun.add(hammer);

  // 7. 侧板心形装饰
  const heart = cast(
    new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), pinkLight),
  );
  heart.scale.set(1, 0.85, 0.55);
  heart.position.set(0.042, 0.0, 0.1);
  gun.add(heart);

  const heart2 = heart.clone();
  heart2.position.x = -0.042;
  gun.add(heart2);

  return gun;
}
