import * as THREE from 'three';
import { getGameAudio } from '../audio/GameAudio';
import { HomingBolt } from '../effects/HomingBolt';
import type { ProjectileManager } from '../effects/ProjectileManager';
import { CircleBody } from './collision/CircleBody';
import type { CombatUnit, TeamId } from './combat/CombatUnit';
import {
  distXZ,
  isValidTarget,
  pickEnemyTarget,
} from './combat/combatMath';
import { HealthBar } from './ui/HealthBar';

type MinionAIState = 'move' | 'chase' | 'attack';

/** 近战 / 远程小兵 */
export type MinionKind = 'melee' | 'ranged';

interface MinionStats {
  /** 模型整体缩放 */
  scale: number;
  /** 地面圆碰撞半径（世界单位） */
  colliderRadius: number;
  maxHp: number;
  attackDamage: number;
  /** 圆心距：可出手 */
  attackRange: number;
  /** 无目标时索敌 */
  aggroRange: number;
  /** 已锁定后脱战 */
  leashRange: number;
  windup: number;
  attackInterval: number;
  moveSpeed: number;
  /** 弹道视觉缩放 */
  boltScale: number;
}

/** 前/后排统一体型；整体相对旧近战再 ×2 */
const MINION_SCALE = 0.25;
const MINION_COLLIDER_RADIUS = 0.16;

const MELEE_STATS: MinionStats = {
  scale: MINION_SCALE,
  colliderRadius: MINION_COLLIDER_RADIUS,
  maxHp: 80,
  attackDamage: 12,
  attackRange: 0.55,
  aggroRange: 1.4,
  leashRange: 3.2,
  windup: 0.35,
  attackInterval: 1.15,
  moveSpeed: 0.675,
  boltScale: 1,
};

/** 远程：与前排同体型；射程更远、伤害更高 */
const RANGED_STATS: MinionStats = {
  scale: MINION_SCALE,
  colliderRadius: MINION_COLLIDER_RADIUS,
  maxHp: 80,
  attackDamage: 22,
  attackRange: 1.45,
  aggroRange: 2.1,
  leashRange: 3.8,
  windup: 0.38,
  attackInterval: 1.25,
  moveSpeed: 0.675,
  boltScale: 1.6,
};

/**
 * 极简五球小兵：身体 + 左手 + 右手 + 左脚 + 右脚。
 * AI：推进 Move / 追击 Chase / 站桩攻击 Attack（LoL 风格简化）。
 * kind=melee 近战前排；kind=ranged 远程后排（同体型、射程远、伤害高）。
 */
export class Minion extends THREE.Group implements CombatUnit {
  /** 目标标签：低于防御塔，小兵优先打塔 */
  static readonly COMBAT_PRIORITY = 0;
  /** 近战默认碰撞半径（兼容外部引用） */
  static readonly COLLIDER_RADIUS = MELEE_STATS.colliderRadius;
  static readonly MAX_HP = MELEE_STATS.maxHp;

  private static readonly BODY = 0xf3eee6;
  private static readonly LIMB = 0xf3eee6;
  private static readonly HAT_BLUE = 0x3b82f6;
  private static readonly HAT_BLUE_BAND = 0x1d4ed8;
  private static readonly HAT_RED = 0xef4444;
  private static readonly HAT_RED_BAND = 0xb91c1c;

  /** 走步周期频率（弧度/秒） */
  private static readonly WALK_FREQ = 7.5;
  /** 前后迈步幅度（本地 Z） */
  private static readonly STRIDE = 0.1;
  /** 抬脚高度 */
  private static readonly FOOT_LIFT = 0.07;
  /** 左手前后摆臂幅度 */
  private static readonly ARM_SWING = 0.08;
  /** 身体上下起伏 */
  private static readonly BODY_BOB = 0.025;
  /** 死亡动画总时长（秒）：包含倒下、停留与渐隐 */
  private static readonly DEATH_DURATION = 1.6;

  /** 身体网格根节点（描边用，不含血条/碰撞圈） */
  readonly bodyRoot: THREE.Group;
  private readonly body: THREE.Mesh;
  private readonly leftHand: THREE.Mesh;
  private readonly rightHand: THREE.Mesh;
  private readonly leftFoot: THREE.Mesh;
  private readonly rightFoot: THREE.Mesh;
  private readonly staff: THREE.Group;
  /** 法杖顶端能量球，弹道从此处发出 */
  private readonly staffOrb: THREE.Object3D;
  private readonly healthBar: HealthBar;
  private readonly stats: MinionStats;

  private readonly baseLeftHand = new THREE.Vector3(0.47, 0.48, 0.1);
  private readonly baseRightHand = new THREE.Vector3(-0.52, 0.58, 0.2);
  private readonly baseLeftFoot = new THREE.Vector3(0.14, 0.1, 0.02);
  private readonly baseRightFoot = new THREE.Vector3(-0.14, 0.1, 0.02);

  private elapsed = 0;
  /** 相位偏移，避免阵列齐步完全同步 */
  private readonly phaseOffset: number;
  private static aliveFaceTexture: THREE.CanvasTexture | null = null;
  private static deadFaceTexture: THREE.CanvasTexture | null = null;

  private isDead = false;
  private deathElapsed = 0;
  private staffDetached = false;
  private readonly staffStartPos = new THREE.Vector3();
  private readonly staffStartRot = new THREE.Euler();
  /** 死亡渐隐专用材质（克隆，避免共享材质/深度写入导致手脚突然消失） */
  private deathFadeMats: THREE.Material[] = [];

  readonly kind: MinionKind;
  readonly team: TeamId;
  readonly collider: CircleBody;
  readonly combatPriority = Minion.COMBAT_PRIORITY;
  readonly maxHp: number;
  hp: number;

  private aiState: MinionAIState = 'move';
  private target: CombatUnit | null = null;
  /** 攻击冷却：>0 时不能开始新的前摇 */
  private attackCd = 0;
  /** 前摇计时；<0 表示当前不在前摇 */
  private windupElapsed = -1;
  private readonly muzzleWorld = new THREE.Vector3();

  /**
   * @param team 蓝方蓝帽面朝 +X，红方红帽面朝 -X
   * @param kind melee 近战 / ranged 远程
   */
  constructor(
    x: number,
    z = 0,
    team: TeamId = x >= 0 ? 'red' : 'blue',
    kind: MinionKind = 'melee',
  ) {
    super();
    this.team = team;
    this.kind = kind;
    this.stats = kind === 'ranged' ? RANGED_STATS : MELEE_STATS;
    this.maxHp = this.stats.maxHp;
    this.hp = this.stats.maxHp;
    this.name = `Minion_${kind}_${team}_${x}_${z}`;
    this.position.set(x, 0, z);
    this.scale.setScalar(this.stats.scale);
    // 蓝方面朝 +X，红方面朝 -X（相向）
    this.rotation.y = team === 'red' ? -Math.PI / 2 : Math.PI / 2;
    this.phaseOffset = (x * 2.7 + z * 5.3 + Math.random()) * Math.PI;
    // scale 定好后再挂碰撞体，白圈半径才能正确补偿
    this.collider = new CircleBody(this, this.stats.colliderRadius);

    const hatColor = team === 'red' ? Minion.HAT_RED : Minion.HAT_BLUE;
    const hatBandColor =
      team === 'red' ? Minion.HAT_RED_BAND : Minion.HAT_BLUE_BAND;

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

    // 1. 身体（略抬高，与脚保持小间距；正面画可爱表情）
    if (!Minion.aliveFaceTexture) {
      Minion.aliveFaceTexture = createBodyFaceTexture(Minion.BODY);
    }
    this.body = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 24, 20),
      new THREE.MeshStandardMaterial({
        map: Minion.aliveFaceTexture,
        roughness: 0.6,
        metalness: 0.04,
      }),
    );
    this.body.position.y = 0.66;
    // 球面 UV 在 +X 最完整；转到局部 +Z，再随角色朝向转到世界 +X
    this.body.rotation.y = -Math.PI / 2;
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    this.bodyRoot.add(this.body);

    // 魔法巫师帽（按参考图优雅重新设计：圆润帽檐 + 贴合帽环 + 锥形帽身 + 帽顶圆球）
    const hatGroup = new THREE.Group();
    // 帽子进一步下移，深扣在头上
    hatGroup.position.set(0, 0.66 + 0.14, -0.06);
    hatGroup.rotation.z = -0.05;
    hatGroup.rotation.x = -0.42; // 大角度向后倾斜

    const hatMat = new THREE.MeshStandardMaterial({
      color: hatColor,
      roughness: 0.35,
      metalness: 0.05,
    });
    const bandMat = new THREE.MeshStandardMaterial({
      color: hatBandColor,
      roughness: 0.3,
      metalness: 0.1,
    });

    // 1. 帽檐底盘
    const brimRadius = 0.52;
    const brimDisk = new THREE.Mesh(
      new THREE.CylinderGeometry(brimRadius, brimRadius, 0.045, 32),
      hatMat,
    );
    brimDisk.castShadow = true;
    hatGroup.add(brimDisk);

    // 2. 帽檐外侧圆润包边 (Torus 边缘包边)
    const brimRim = new THREE.Mesh(
      new THREE.TorusGeometry(brimRadius, 0.03, 12, 32),
      hatMat,
    );
    brimRim.rotation.x = Math.PI / 2;
    hatGroup.add(brimRim);

    // 3. 饰带 (帽环)
    const band = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.038, 12, 32),
      bandMat,
    );
    band.rotation.x = Math.PI / 2;
    band.position.y = 0.03;
    hatGroup.add(band);

    // 4. 纯正光滑半球帽顶（加大半球半径，突出丰满大半圆球帽顶）
    const domeRadius = 0.44;
    const domeMesh = new THREE.Mesh(
      new THREE.SphereGeometry(
        domeRadius,
        32,
        24,
        0,
        Math.PI * 2,
        0,
        Math.PI / 2, // 只取上半球
      ),
      hatMat,
    );
    // 纵向比例 0.85，呈现更大更饱满的大圆球帽顶
    domeMesh.scale.set(1, 0.85, 1);
    domeMesh.position.y = 0.01;
    domeMesh.castShadow = true;
    hatGroup.add(domeMesh);

    this.bodyRoot.add(hatGroup);

    // 2 / 3. 双手（小兵自身面向 +Z：左手为 +X，右手为 -X）
    this.leftHand = ball(0.1, Minion.LIMB);
    this.leftHand.position.copy(this.baseLeftHand);
    this.leftHand.castShadow = true;
    this.bodyRoot.add(this.leftHand);

    // 持杖右手：略抬高并前伸，呈举杖准备姿势
    this.rightHand = ball(0.1, Minion.LIMB);
    this.rightHand.position.copy(this.baseRightHand);
    this.rightHand.castShadow = true;
    this.bodyRoot.add(this.rightHand);

    // 魔法杖：握在中下段，杖身近直立、宝珠略朝前上
    const { group: staff, orb } = createMagicStaff();
    this.staff = staff;
    if (this.kind === 'ranged') {
      staff.scale.setScalar(2.0);
    }
    staff.position.set(0, -0.06, 0);
    staff.rotation.order = 'YXZ';
    staff.rotation.set(
      0.45, // 向前微倾
      0.15, // 轻微扭转
      0.35, // 向身体外侧打开
    );
    this.rightHand.add(staff);
    this.staffOrb = orb;

    // 4 / 5. 双脚（脚底精确贴合 Y = 0 地面，左脚为 +X，右脚为 -X）
    this.leftFoot = ball(0.1, Minion.LIMB);
    this.leftFoot.position.copy(this.baseLeftFoot);
    this.leftFoot.castShadow = true;
    this.bodyRoot.add(this.leftFoot);

    this.rightFoot = ball(0.1, Minion.LIMB);
    this.rightFoot.position.copy(this.baseRightFoot);
    this.rightFoot.castShadow = true;
    this.bodyRoot.add(this.rightFoot);

    // 头顶血条：按视觉缩放补偿，世界尺寸约 0.15×0.014
    const s = this.stats.scale;
    this.healthBar = new HealthBar({
      width: 0.15 / s,
      height: 0.014 / s,
      yOffset: 1.55,
      team,
    });
    this.add(this.healthBar);
    this.healthBar.setHp(this.hp, this.maxHp);
  }

  get isAlive(): boolean {
    return this.hp > 0 && !this.isDead;
  }

  get isDeathComplete(): boolean {
    return this.isDead && this.deathElapsed >= Minion.DEATH_DURATION;
  }

  takeDamage(amount: number): void {
    if (!this.isAlive || amount <= 0) return;
    this.hp = Math.max(0, this.hp - amount);
    this.healthBar.setHp(this.hp, this.maxHp);
    if (this.hp <= 0) {
      this.triggerDeath();
    }
  }

  private triggerDeath(): void {
    if (this.isDead) return;
    this.isDead = true;
    this.healthBar.visible = false;
    this.collider.setMarkerVisible(false);
    this.clearCombat();

    // 播放小兵死亡倒地与消散音效
    getGameAudio().playMinionDeath((this.position.x - 0) * 0.05);

    // 切换为死亡 KO 晕眩可爱表情贴图（倒八字眉 + 黑叉眼 + 吐粉红舌）
    if (!Minion.deadFaceTexture) {
      Minion.deadFaceTexture = createDeadBodyFaceTexture(Minion.BODY);
    }
    const bodyMat = this.body.material as THREE.MeshStandardMaterial;
    bodyMat.map = Minion.deadFaceTexture;
    bodyMat.needsUpdate = true;

    // 彻底解耦父子关系：将魔法杖从右手转移到 Minion 根组，物理位置在角色坐标系下自由坠落
    if (!this.staffDetached) {
      const worldPos = new THREE.Vector3();
      const worldQuat = new THREE.Quaternion();
      this.staff.getWorldPosition(worldPos);
      this.staff.getWorldQuaternion(worldQuat);

      this.rightHand.remove(this.staff);
      this.add(this.staff);

      this.worldToLocal(worldPos);
      this.staff.position.copy(worldPos);
      this.staff.rotation.setFromQuaternion(worldQuat);

      this.staffStartPos.copy(this.staff.position);
      this.staffStartRot.copy(this.staff.rotation);
      this.staffDetached = true;
    }

    // 克隆全部网格材质做渐隐：关闭 depthWrite，避免倒地后手脚被地面/身体深度测试「瞬间吃掉」
    this.prepareDeathFadeMaterials();
  }

  /** 为死亡渐隐克隆材质，身体/帽/手/脚/杖统一可控透明度 */
  private prepareDeathFadeMaterials(): void {
    this.deathFadeMats = [];
    // 同一材质可能挂在多个网格（如帽子），只克隆一次
    const cloneMap = new Map<THREE.Material, THREE.Material>();
    const originals: THREE.Material[] = [];

    this.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;

      const sourceList = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      const clonedList = sourceList.map((src) => {
        let mat = cloneMap.get(src);
        if (!mat) {
          mat = src.clone();
          mat.transparent = true;
          mat.depthWrite = false;
          mat.opacity = 1;
          mat.needsUpdate = true;
          cloneMap.set(src, mat);
          originals.push(src);
          this.deathFadeMats.push(mat);
        }
        return mat;
      });
      mesh.material =
        clonedList.length === 1 ? clonedList[0]! : clonedList;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
    });

    // 释放本兵独有原材质（不 dispose 共享脸贴图）
    for (const src of originals) {
      src.dispose();
    }
  }

  private updateDeath(delta: number): void {
    this.deathElapsed += delta;
    const duration = Minion.DEATH_DURATION;
    const fallTime = 0.45;
    /** 倒下接近完成即开始渐隐，整身（含手脚）一起淡出 */
    const fadeStart = 0.55;

    // 1. 倒下动作（0 ~ 0.45s，整套模型包含身体/帽/手/脚整体平滑倒地）
    const tFall = Math.min(1, this.deathElapsed / fallTime);
    const fallEase = 1 - Math.pow(1 - tFall, 2.5);

    // 略减小倾角，减少手脚穿地
    const angle = Math.PI * 0.42 * fallEase;
    this.bodyRoot.rotation.x = -angle;

    // 抬升 + 略后移，让倒地姿态贴地但不埋进地板
    this.bodyRoot.position.y = 0.12 + 0.42 * (1 - Math.cos(angle));
    this.bodyRoot.position.z = -0.12 * fallEase;

    // 手脚收向躯干、略抬高，倒地后仍露在身体轮廓外以便渐隐可见
    this.leftHand.position.set(
      this.baseLeftHand.x + 0.04 * fallEase,
      this.baseLeftHand.y + 0.06 * fallEase,
      this.baseLeftHand.z - 0.04 * fallEase,
    );
    this.rightHand.position.set(
      this.baseRightHand.x - 0.04 * fallEase,
      this.baseRightHand.y + 0.06 * fallEase,
      this.baseRightHand.z - 0.04 * fallEase,
    );
    this.leftFoot.position.set(
      this.baseLeftFoot.x + 0.02 * fallEase,
      this.baseLeftFoot.y + 0.1 * fallEase,
      this.baseLeftFoot.z + 0.06 * fallEase,
    );
    this.rightFoot.position.set(
      this.baseRightFoot.x - 0.02 * fallEase,
      this.baseRightFoot.y + 0.1 * fallEase,
      this.baseRightFoot.z + 0.06 * fallEase,
    );

    // 武器在独立坐标系下从右手高度自然坠落地表并平躺
    if (this.staffDetached) {
      const startX = this.staffStartPos.x;
      const startY = this.staffStartPos.y;
      const startZ = this.staffStartPos.z;

      // 目标平躺点：在右手脱落位置旁侧，略抬离地面避免 z-fight
      const targetX = startX - 0.22;
      const targetZ = startZ + 0.35;
      const targetY = 0.05;

      this.staff.position.x = THREE.MathUtils.lerp(startX, targetX, fallEase);
      this.staff.position.y = THREE.MathUtils.lerp(startY, targetY, fallEase);
      this.staff.position.z = THREE.MathUtils.lerp(startZ, targetZ, fallEase);

      // 旋转平躺贴地
      this.staff.rotation.x = THREE.MathUtils.lerp(
        this.staffStartRot.x,
        Math.PI / 2,
        fallEase,
      );
      this.staff.rotation.y = THREE.MathUtils.lerp(
        this.staffStartRot.y,
        -0.4,
        fallEase,
      );
      this.staff.rotation.z = THREE.MathUtils.lerp(
        this.staffStartRot.z,
        0.75,
        fallEase,
      );
    }

    // 2. 全身渐隐（身体 / 帽 / 手 / 脚 / 杖同一 opacity）
    if (this.deathElapsed >= fadeStart) {
      const tFade = (this.deathElapsed - fadeStart) / (duration - fadeStart);
      const opacity = THREE.MathUtils.clamp(1.0 - tFade, 0, 1);
      for (const mat of this.deathFadeMats) {
        mat.opacity = opacity;
      }
    }
  }

  /** 弹道落点：身体球中心 */
  getHitPoint(out: THREE.Vector3): THREE.Vector3 {
    return this.body.getWorldPosition(out);
  }

  /**
   * 战斗 AI + 动画。
   * Move 推线；Chase 追目标；Attack 停步前摇后发射锁定弹，命中才结算伤害。
   */
  update(
    delta: number,
    units: readonly CombatUnit[],
    projectiles: ProjectileManager,
  ): void {
    if (this.isDead) {
      this.updateDeath(delta);
      return;
    }
    if (this.hp <= 0) {
      this.triggerDeath();
      this.updateDeath(delta);
      return;
    }

    this.elapsed += delta;
    if (this.attackCd > 0) {
      this.attackCd = Math.max(0, this.attackCd - delta);
    }

    // 目标失效则清空
    if (!isValidTarget(this, this.target)) {
      this.clearCombat();
    } else {
      const leash = distXZ(this.collider, this.target.collider);
      if (leash > this.stats.leashRange) {
        this.clearCombat();
      }
    }

    switch (this.aiState) {
      case 'move':
        this.tickMove(delta, units, projectiles);
        break;
      case 'chase':
        this.tickChase(delta, units, projectiles);
        break;
      case 'attack':
        this.tickAttack(delta, units, projectiles);
        break;
    }
  }

  /**
   * 是否已走出战场（越过对侧基地外侧），可供发兵器回收。
   * 边界略大于八边形平台外沿（约 ±20），保证可抵达基地水晶。
   */
  get isOffField(): boolean {
    return this.team === 'blue' ? this.position.x > 21 : this.position.x < -21;
  }

  private clearCombat(): void {
    this.target = null;
    this.windupElapsed = -1;
    this.aiState = 'move';
  }

  private enterChase(target: CombatUnit): void {
    this.target = target;
    this.windupElapsed = -1;
    this.aiState = 'chase';
  }

  private enterAttack(target: CombatUnit): void {
    this.target = target;
    this.windupElapsed = -1;
    this.aiState = 'attack';
    this.resetPose();
  }

  private tickMove(
    delta: number,
    units: readonly CombatUnit[],
    projectiles: ProjectileManager,
  ): void {
    // 索敌：aggro 内优先防御塔，再敌方小兵
    const found = pickEnemyTarget(this, units, this.stats.aggroRange, {
      preferHigherPriority: true,
    });
    if (found) {
      const d = distXZ(this.collider, found.collider);
      if (d <= this.stats.attackRange) {
        this.enterAttack(found);
        this.tickAttack(delta, units, projectiles);
        return;
      }
      this.enterChase(found);
      this.tickChase(delta, units, projectiles);
      return;
    }

    this.animateWalk(delta);
    this.advanceLane(delta);
  }

  private tickChase(
    delta: number,
    units: readonly CombatUnit[],
    projectiles: ProjectileManager,
  ): void {
    // 追击中也可切更高优先级近处目标（塔 > 小兵）
    const better = pickEnemyTarget(this, units, this.stats.aggroRange, {
      preferHigherPriority: true,
    });
    if (better && better !== this.target) {
      // 仅当新目标优先级更高（数值更大），或同级更近时切换
      if (
        !this.target ||
        better.combatPriority > this.target.combatPriority ||
        (better.combatPriority === this.target.combatPriority &&
          distXZ(this.collider, better.collider) + 0.05 <
            distXZ(this.collider, this.target.collider))
      ) {
        this.target = better;
      }
    }

    if (!isValidTarget(this, this.target)) {
      this.clearCombat();
      this.tickMove(delta, units, projectiles);
      return;
    }

    const d = distXZ(this.collider, this.target.collider);
    if (d > this.stats.leashRange) {
      this.clearCombat();
      this.tickMove(delta, units, projectiles);
      return;
    }
    if (d <= this.stats.attackRange) {
      this.enterAttack(this.target);
      this.tickAttack(delta, units, projectiles);
      return;
    }

    this.faceToward(this.target);
    this.animateWalk(delta);
    this.moveToward(this.target, delta);
  }

  private tickAttack(
    delta: number,
    units: readonly CombatUnit[],
    projectiles: ProjectileManager,
  ): void {
    if (!isValidTarget(this, this.target)) {
      this.clearCombat();
      this.tickMove(delta, units, projectiles);
      return;
    }

    const d = distXZ(this.collider, this.target.collider);
    if (d > this.stats.leashRange) {
      this.clearCombat();
      this.tickMove(delta, units, projectiles);
      return;
    }
    // 走出攻击距离：取消前摇，改追击（攻击态不位移）
    if (d > this.stats.attackRange) {
      this.windupElapsed = -1;
      this.enterChase(this.target);
      this.tickChase(delta, units, projectiles);
      return;
    }

    // 站桩攻击：始终面朝目标（含冷却等待）
    this.faceToward(this.target);
    this.resetPose();

    // 冷却中干等
    if (this.attackCd > 0 && this.windupElapsed < 0) {
      return;
    }

    // 开始或继续前摇
    if (this.windupElapsed < 0) {
      this.windupElapsed = 0;
    }
    this.windupElapsed += delta;

    // 挥舞法杖前摇姿态：高举蓄力 -> 猛力下甩前击
    const progress = Math.min(1, this.windupElapsed / this.stats.windup);
    this.applyAttackWindupPose(progress);

    if (this.windupElapsed >= this.stats.windup) {
      // 前摇结束：发射锁定弹，伤害在命中时结算
      if (
        isValidTarget(this, this.target) &&
        distXZ(this.collider, this.target.collider) <= this.stats.attackRange
      ) {
        this.fireBolt(projectiles, this.target);
      }
      this.windupElapsed = -1;
      this.attackCd = Math.max(
        0,
        this.stats.attackInterval - this.stats.windup,
      );
    }
  }

  /** 攻击前摇姿态：仅挥舞手臂（右手抬起蓄力 -> 向前下挥出击） */
  private applyAttackWindupPose(progress: number): void {
    if (progress < 0.65) {
      // 0~0.65 阶段：右手手臂向上向后抬起
      const t = progress / 0.65;
      this.rightHand.position.y = this.baseRightHand.y + 0.12 * t;
      this.rightHand.position.z = this.baseRightHand.z - 0.08 * t;
    } else {
      // 0.65~1.0 阶段：手臂向前下方猛力下挥
      const t = (progress - 0.65) / 0.35;
      this.rightHand.position.y = (this.baseRightHand.y + 0.12) - 0.16 * t;
      this.rightHand.position.z = (this.baseRightHand.z - 0.08) + 0.18 * t;
    }
  }

  /** 从法杖能量球世界坐标发出追踪弹 */
  private fireBolt(
    projectiles: ProjectileManager,
    target: CombatUnit,
  ): void {
    this.staffOrb.getWorldPosition(this.muzzleWorld);
    projectiles.fireAt(
      this.muzzleWorld,
      target,
      this.stats.attackDamage,
      this.team,
      this.stats.boltScale,
      { speed: HomingBolt.SPEED * 0.3, hitSfx: 'minion' },
    );
    getGameAudio().playMinionAttack(this.kind === 'ranged', (this.position.x - 0) * 0.05);
  }

  /** 默认沿兵线推进（蓝 +X / 红 -X） */
  private advanceLane(delta: number): void {
    const dir = this.team === 'blue' ? 1 : -1;
    this.position.x += dir * this.stats.moveSpeed * delta;
    // 推线时恢复默认朝向（本地 +Z → 行军方向）
    this.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  }

  /**
   * 面朝目标地面位置。
   * 模型正面为本地 +Z：rotation.y = atan2(dx, dz)。
   */
  private faceToward(target: CombatUnit): void {
    const dx = target.collider.x - this.position.x;
    const dz = target.collider.z - this.position.z;
    if (dx * dx + dz * dz < 1e-10) return;
    this.rotation.y = Math.atan2(dx, dz);
  }

  /** 朝目标地面位置移动 */
  private moveToward(target: CombatUnit, delta: number): void {
    const dx = target.collider.x - this.position.x;
    const dz = target.collider.z - this.position.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return;
    const step = this.stats.moveSpeed * delta;
    this.position.x += (dx / len) * step;
    this.position.z += (dz / len) * step;
  }

  private resetPose(): void {
    this.bodyRoot.position.y = 0;
    this.bodyRoot.rotation.z = 0;
    this.bodyRoot.rotation.x = 0.04;
    this.leftFoot.position.copy(this.baseLeftFoot);
    this.rightFoot.position.copy(this.baseRightFoot);
    this.leftHand.position.copy(this.baseLeftHand);
    this.rightHand.position.copy(this.baseRightHand);

    // 若法杖处于死亡脱离状态，重新挂回右手
    if (this.staffDetached) {
      this.remove(this.staff);
      this.rightHand.add(this.staff);
      this.staffDetached = false;
    }
    this.staff.position.set(0, -0.06, 0);
    this.staff.rotation.order = 'YXZ';
    this.staff.rotation.set(0.45, 0.15, 0.35);
  }

  private animateWalk(_delta: number): void {
    const phase = this.elapsed * Minion.WALK_FREQ + this.phaseOffset;
    const s = Math.sin(phase);
    const c = Math.cos(phase);
    const step = Math.abs(Math.sin(phase));

    this.bodyRoot.position.y = step * Minion.BODY_BOB;
    this.bodyRoot.rotation.z = s * 0.05;
    this.bodyRoot.rotation.x = 0.04 + step * 0.02;

    this.leftFoot.position.set(
      this.baseLeftFoot.x,
      this.baseLeftFoot.y + Math.max(0, c) * Minion.FOOT_LIFT,
      this.baseLeftFoot.z + s * Minion.STRIDE,
    );
    this.rightFoot.position.set(
      this.baseRightFoot.x,
      this.baseRightFoot.y + Math.max(0, -c) * Minion.FOOT_LIFT,
      this.baseRightFoot.z - s * Minion.STRIDE,
    );

    this.leftHand.position.set(
      this.baseLeftHand.x,
      this.baseLeftHand.y + step * 0.02,
      this.baseLeftHand.z - s * Minion.ARM_SWING,
    );

    this.rightHand.position.set(
      this.baseRightHand.x + s * 0.015,
      this.baseRightHand.y + step * 0.018,
      this.baseRightHand.z + s * 0.035,
    );
  }

  dispose(): void {
    this.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (mesh.geometry) mesh.geometry.dispose();
      const material = mesh.material;
      if (!material) return;
      const list = Array.isArray(material) ? material : [material];
      for (const m of list) {
        // 脸贴图为类静态共享，禁止随单个小兵 dispose
        const std = m as THREE.MeshStandardMaterial;
        if (
          std.map &&
          std.map !== Minion.aliveFaceTexture &&
          std.map !== Minion.deadFaceTexture
        ) {
          std.map.dispose();
        }
        m.dispose();
      }
    });
    this.deathFadeMats = [];
    this.healthBar.dispose();
  }
}

/**
 * 身体贴图：底色 + 正面可爱表情（参考：大圆眼 + 腮红 + 微笑）
 * 球面 UV：u=0.5 对应几何 +X；身体已旋转使 +X → 角色正前方
 */
function createBodyFaceTexture(
  bodyColor: number,
): THREE.CanvasTexture {
  // 球面等距矩形(Equirectangular)映射的标准宽高比为 2:1 (例如 1024 x 512)
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

  // 正面中心在 u = 0.5 (即 width * 0.5)
  const cx = width * 0.5;
  // 将眼睛高度下移（从 0.44 下移到 0.49，让额头展示空间更丰富，面部更Q萌）
  const eyeY = height * 0.49;
  
  // 比例调整为 1.0 (正圆)，使在 3D 视角正面呈现饱满的大圆眼
  const eyeGap = width * 0.075;
  const eyeRy = height * 0.1;        // 纵向半径
  const eyeRx = eyeRy;               // 1:1 正圆比例

  // —— 腮红 ——
  const drawBlush = (bx: number) => {
    const g = ctx.createRadialGradient(bx, height * 0.59, 0, bx, height * 0.59, height * 0.08);
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

  // —— 短小弧形小眉毛（贴近眼睛，微微降低）——
  ctx.strokeStyle = darkBrown;
  ctx.lineWidth = height * 0.016;
  ctx.lineCap = 'round';

  // 左眉
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

  // 右眉
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

  // —— 效果图风格大眼（在 2:1 画布上抗拉伸）——
  const drawEye = (ex: number) => {
    // 眼睛基本大眼框
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, eyeRx, eyeRy, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#21181b';
    ctx.fill();

    // 眼睛底部渐变亮影
    const innerG = ctx.createLinearGradient(ex, eyeY - eyeRy, ex, eyeY + eyeRy);
    innerG.addColorStop(0, '#1d1518');
    innerG.addColorStop(0.65, '#3a2b2f');
    innerG.addColorStop(1, '#664c54');
    ctx.fillStyle = innerG;
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, eyeRx * 0.96, eyeRy * 0.96, 0, 0, Math.PI * 2);
    ctx.fill();

    // 内部深色瞳孔
    ctx.fillStyle = '#140c0e';
    ctx.beginPath();
    ctx.ellipse(ex, eyeY + eyeRy * 0.05, eyeRx * 0.7, eyeRy * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();

    // 1. 左上角特大主高光
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

    // 2. 右下角副高光
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

    // 3. 左下辅助微高光
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

  // —— 微笑嘴 ——
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
 * 极简魔法杖：木杆 + 金属箍 + 顶部发光宝珠。
 * 沿本地 +Y 伸出（握持段在中下、宝珠在上），适配手球半径 ~0.1。
 */
function createMagicStaff(): { group: THREE.Group; orb: THREE.Mesh } {
  const staff = new THREE.Group();

  const wood = new THREE.MeshStandardMaterial({
    color: 0x6b4423,
    roughness: 0.85,
    metalness: 0.05,
  });
  const bandMat = new THREE.MeshStandardMaterial({
    color: 0xd4a017,
    roughness: 0.35,
    metalness: 0.7,
  });
  const orbMat = new THREE.MeshStandardMaterial({
    color: 0xa78bfa,
    roughness: 0.15,
    metalness: 0.2,
    emissive: 0x7c3aed,
    emissiveIntensity: 0.85,
  });

  // 1. 木杆（下端略粗，手握中下段）
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.016, 0.022, 0.42, 10),
    wood,
  );
  shaft.position.y = 0.12;
  shaft.castShadow = true;
  staff.add(shaft);

  // 2. 顶端金属箍
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(0.024, 0.024, 0.028, 12),
    bandMat,
  );
  band.position.y = 0.32;
  band.castShadow = true;
  staff.add(band);

  // 3. 魔法宝珠（弹道发射点）
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 12), orbMat);
  orb.name = 'StaffOrb';
  orb.position.y = 0.38;
  orb.castShadow = true;
  staff.add(orb);

  return { group: staff, orb };
}

/**
 * 死亡表情贴图（极简 KO 风格）：
 * - 纯净粗线条大黑叉叉眼 (X X)
 * - 腮红
 */
function createDeadBodyFaceTexture(bodyColor: number): THREE.CanvasTexture {
  const width = 1024;
  const height = 512;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');

  const bodyHex = `#${bodyColor.toString(16).padStart(6, '0')}`;
  const darkColor = '#21181b';

  ctx.fillStyle = bodyHex;
  ctx.fillRect(0, 0, width, height);

  const cx = width * 0.5;
  const eyeY = height * 0.49;
  const eyeGap = width * 0.075;
  const eyeRy = height * 0.1;
  const eyeRx = eyeRy;

  // —— 1. 腮红 ——
  const drawBlush = (bx: number) => {
    const g = ctx.createRadialGradient(
      bx,
      height * 0.59,
      0,
      bx,
      height * 0.59,
      height * 0.08,
    );
    g.addColorStop(0, 'rgba(255, 120, 140, 0.55)');
    g.addColorStop(0.5, 'rgba(255, 140, 160, 0.28)');
    g.addColorStop(1, 'rgba(255, 180, 190, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(bx, height * 0.59, eyeRx * 0.9, eyeRy * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
  };
  drawBlush(cx - eyeGap * 1.55);
  drawBlush(cx + eyeGap * 1.55);

  // —— 2. 纯净大黑叉叉眼 (X X) ——
  const drawCrossEye = (ex: number) => {
    const arm = eyeRx * 0.68;
    ctx.strokeStyle = darkColor;
    ctx.lineWidth = height * 0.052;
    ctx.lineCap = 'round';

    ctx.beginPath();
    ctx.moveTo(ex - arm, eyeY - arm);
    ctx.lineTo(ex + arm, eyeY + arm);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(ex - arm, eyeY + arm);
    ctx.lineTo(ex + arm, eyeY - arm);
    ctx.stroke();
  };

  drawCrossEye(cx - eyeGap);
  drawCrossEye(cx + eyeGap);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}
