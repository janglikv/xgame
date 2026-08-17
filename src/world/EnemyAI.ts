import { Ray, Vector3 } from '@babylonjs/core';
import { playSfx } from '../audio/Sfx';
import type { Minion } from './Minion';
import type { MinionPhysicsProxy } from './physics/MinionPhysicsProxy';
import type { SpellProjectileSystem } from './SpellProjectileSystem';
import type { StaffStyle } from './minion/staff';
import { HealthBar } from './HealthBar';
import { spawnHitSparkFx } from './MeleeSectorFx';

export interface GroupAggroState {
  isGroupAggroLocked: boolean;
}

export interface EnemyAIOptions {
  /** 巡逻固定中心点 X（默认 0） */
  spawnX?: number;
  /** 巡逻固定中心点 Z（默认 7.0） */
  spawnZ?: number;
  /** 巡逻踱步来回半径（米，默认 3.5） */
  patrolRadius?: number;
  /** 踱步移动速度（m/s，默认 1.2） */
  moveSpeed?: number;
  /** 踱步巡逻方向轴 ('x' 表示横向，'z' 表示纵向；默认 'x') */
  patrolAxis?: 'x' | 'z';
  /** 初始触发攻击感应范围（米，默认 4.0） */
  initialAttackRange?: number;
  /** 锁定后仇恨保持范围（米，默认 5.5） */
  retainedAttackRange?: number;
  /** 连续攻击后的强制踱步时间（秒，默认 0.5） */
  forcedPatrolDuration?: number;
  /** 攻击冷却时间（秒，默认 1.8，近战默认 1.0） */
  attackCooldown?: number;
  /** 施法弹道样式（默认 flame） */
  spellStyle?: StaffStyle;
  /** 同组共享仇恨状态控制 */
  groupState?: GroupAggroState;
  /** 敌军最大生命值（默认 100） */
  maxHp?: number;
  /** 近战追击移动速度（m/s，默认 2.0） */
  chaseSpeed?: number;
  /** 近战挥拳攻击触发距离（m，默认 0.72） */
  meleeRange?: number;
  /** 近战挥拳单次伤害（默认 20） */
  meleeDamage?: number;
  /** 血条相对脚底高度（默认 1.55） */
  healthBarOffsetY?: number;
  /** 远程单次攻击连发数（默认 1） */
  burstCount?: number;
  /** 连发间隔（秒，默认 0.16） */
  burstInterval?: number;
  /** 满血时隐藏血条，受击后再显示 */
  hideHealthUntilHit?: boolean;
  /** 远程子弹基准速度（最终还会按体型反比；默认 4.5） */
  projectileSpeed?: number;
  /** 击败时回调（Boss 开门等） */
  onDefeated?: () => void;
}

/**
 * 敌军 AI：
 * 1. 支持远程施法型敌军（有法杖）与近战追击型敌军（无法杖）；
 * 2. 无法杖敌军：平时在警戒区踱步，玩家靠近进入仇恨范围后主动高速追击主角，追上后触发近战挥拳定点打击；
 * 3. 有法杖敌军：保持远程瞄准前摇与弹道发射逻辑；
 * 4. 挂载 3D 悬浮血条，支持受击扣血；击败后消失，不再刷新。
 */
export class EnemyAI {
  readonly enemy: Minion;
  readonly enemyPhys: MinionPhysicsProxy;
  readonly healthBar: HealthBar;
  private readonly spellSystem: SpellProjectileSystem;

  private spawnX: number;
  private spawnZ: number;
  private patrolRadius: number;
  private moveSpeed: number;
  private chaseSpeed: number;
  private meleeRange: number;
  private meleeDamage: number;
  private patrolAxis: 'x' | 'z';
  private initialAttackRange: number;
  private retainedAttackRange: number;
  private attackCooldown: number;
  private spellStyle: StaffStyle;
  private groupState?: GroupAggroState;
  private readonly projectileSpeed: number;
  private readonly burstCount: number;
  private readonly burstInterval: number;
  private burstLeft = 0;
  private burstTimer = 0;

  /** 踱步方向：1 表示正向，-1 表示反向 */
  private patrolDir = 1;
  private cooldownTimer = 0;
  private windupTimer = 0;
  private readonly windupDuration = 0.45;
  private isAggroLocked = false;
  /** 是否处于击败死亡状态 */
  private isDead = false;
  private readonly onDefeated?: () => void;

  /** 绕行方向记忆偏置：1 表示偏右绕行，-1 表示偏左绕行，0 表示未锁定 */
  private avoidanceBias = 0;
  private avoidanceBiasTimer = 0;
  private lastPos = new Vector3();
  private stuckTimer = 0;
  private unstuckDir: Vector3 | null = null;
  private unstuckTimer = 0;

  constructor(
    enemy: Minion,
    enemyPhys: MinionPhysicsProxy,
    spellSystem: SpellProjectileSystem,
    options: EnemyAIOptions = {},
  ) {
    this.enemy = enemy;
    this.enemyPhys = enemyPhys;
    this.spellSystem = spellSystem;

    this.spawnX = options.spawnX ?? 0;
    this.spawnZ = options.spawnZ ?? 7.0;
    this.patrolRadius = options.patrolRadius ?? 3.5;
    this.moveSpeed = options.moveSpeed ?? 1.2;
    this.chaseSpeed = options.chaseSpeed ?? 2.0;
    this.meleeRange = options.meleeRange ?? 0.72;
    this.meleeDamage = options.meleeDamage ?? 20;
    this.patrolAxis = options.patrolAxis ?? 'x';
    this.initialAttackRange = options.initialAttackRange ?? 2.8;
    this.retainedAttackRange = options.retainedAttackRange ?? 4.0;
    this.attackCooldown =
      options.attackCooldown ?? (enemy.hasStaff() ? 1.8 : 1.0);
    this.spellStyle = options.spellStyle ?? 'flame';
    this.groupState = options.groupState;
    this.projectileSpeed = options.projectileSpeed ?? 4.5;
    this.onDefeated = options.onDefeated;
    this.burstCount = Math.max(1, Math.floor(options.burstCount ?? 1));
    this.burstInterval = options.burstInterval ?? 0.16;

    // 随机错开首次攻击，增强自然感
    this.cooldownTimer = 0.4 + Math.random() * 0.4;

    // 创建 3D 悬浮血条 (头顶 Y+1.55)
    const hpScale = options.healthBarOffsetY ? options.healthBarOffsetY / 1.55 : 1;
    this.healthBar = new HealthBar(enemy.root.getScene(), enemy.root, {
      maxHp: options.maxHp ?? 100,
      offsetY: options.healthBarOffsetY ?? 1.55,
      width: 0.68 * Math.max(1, hpScale),
      height: 0.11 * Math.max(1, Math.sqrt(hpScale)),
    });

    if (options.hideHealthUntilHit) {
      this.healthBar.setVisible(false);
    }

    // 绑定 Minion 受击事件
    this.enemy.onTakeDamage = (amount) => this.takeDamage(amount);
  }

  takeDamage(amount: number): void {
    if (this.isDead) return;

    this.healthBar.setVisible(true);
    this.healthBar.takeDamage(amount);

    // 受击时激怒敌人拉起仇恨
    this.isAggroLocked = true;
    if (this.groupState) {
      this.groupState.isGroupAggroLocked = true;
    }

    if (this.healthBar.isDead()) {
      this.die();
    }
  }

  private die(): void {
    this.isDead = true;
    this.enemy.setAimTarget(null);
    this.enemy.root.setEnabled(false);
    this.healthBar.setVisible(false);
    this.enemyPhys.setHorizontalVelocity(0, 0);
    // 关掉物理胶囊，避免隐形尸体继续挡路
    this.enemyPhys.dispose();
    this.onDefeated?.();
  }

  /** 是否已被击败（死后不再刷新） */
  isDefeated(): boolean {
    return this.isDead;
  }

  /** 重置 AI 状态，以便玩家重新传送进入场景时立即识别并锁定攻击 */
  resetForPlayer(): void {
    if (this.isDead) return;
    this.cooldownTimer = 0;
    this.windupTimer = 0;
    this.isAggroLocked = false;
    this.avoidanceBias = 0;
    this.avoidanceBiasTimer = 0;
    this.stuckTimer = 0;
    this.unstuckTimer = 0;
    this.unstuckDir = null;
  }

  /** 每帧更新 AI 逻辑 */
  update(dt: number, targetPlayer: Minion, allEnemies?: Minion[]): void {
    if (this.isDead) return;

    this.healthBar.update(dt);
    const ePos = this.enemy.root.position;
    const pPos = targetPlayer.root.position;

    // 玩家若已阵亡：敌军停止攻击，继续巡逻踱步
    if (targetPlayer.isDead()) {
      this.doPatrol(dt, ePos, allEnemies);
      return;
    }

    const dx = pPos.x - ePos.x;
    const dz = pPos.z - ePos.z;
    const dist = Math.hypot(dx, dz);

    if (this.cooldownTimer > 0) {
      this.cooldownTimer -= dt;
    }

    const aggroRange = this.isAggroLocked
      ? this.retainedAttackRange
      : this.initialAttackRange;

    const isGroupAggro = this.groupState?.isGroupAggroLocked === true;
    const isAggro = isGroupAggro || dist <= aggroRange;

    if (isAggro) {
      this.isAggroLocked = true;
      if (this.groupState) {
        this.groupState.isGroupAggroLocked = true;
      }
    }

    // ── 分支 1：近战敌人 (无法杖) ──────────────────────────────────
    if (!this.enemy.hasStaff()) {
      if (!this.isAggroLocked) {
        // 未感知玩家：正常巡逻踱步
        this.doPatrol(dt, ePos, allEnemies);
        return;
      }

      if (dist > this.meleeRange) {
        // 1. 智能追击玩家：支持 Raycast 探针避障 + 沿墙切线滑行 + 拐角绕行
        this.updateSmartChase(dt, ePos, pPos);
      } else {
        // 2. 进入近战范围：停下脚步，面对主角挥拳攻击！
        this.enemyPhys.setHorizontalVelocity(0, 0);
        this.enemy.faceToward(dx, dz);
        this.enemy.update(dt, false);

        if (this.cooldownTimer <= 0) {
          const triggered = this.enemy.triggerMeleePunch(() => {
            if (targetPlayer.isDead() || this.isDead) return;
            const curDist = Vector3.Distance(
              targetPlayer.root.position,
              this.enemy.root.position,
            );
            if (curDist <= 1.15) {
              const pushDir = targetPlayer.root.position
                .subtract(this.enemy.root.position);
              pushDir.y = 0;
              const dirNorm =
                pushDir.lengthSquared() > 1e-4
                  ? pushDir.normalize()
                  : new Vector3(0, 0, 1);

              const hitPoint = targetPlayer.root.position
                .clone()
                .addInPlace(new Vector3(0, 0.35, 0));
              spawnHitSparkFx(
                this.enemy.root.getScene(),
                hitPoint,
                dirNorm,
              );

              targetPlayer.takeDamage(this.meleeDamage, dirNorm);
              if (targetPlayer.physicsProxy) {
                targetPlayer.physicsProxy.applyHitKnockback(dirNorm, 1.8);
              }
            }
          });

          if (triggered) {
            this.cooldownTimer = this.attackCooldown;
          }
        }
      }
      return;
    }

    // ── 分支 2：远程施法敌军 (有法杖) ──────────────────────────────
    if (!isAggro) {
      this.windupTimer = 0;
      this.burstLeft = 0;
      this.doPatrol(dt, ePos, allEnemies);
      return;
    }

    this.isAggroLocked = true;

    if (this.cooldownTimer <= 0 && this.windupTimer <= 0 && this.burstLeft <= 0) {
      this.windupTimer = this.windupDuration;
      this.patrolDir = Math.random() < 0.5 ? 1 : -1;
    }

    if (this.burstLeft > 0) {
      this.enemyPhys.setHorizontalVelocity(0, 0);
      this.enemy.faceToward(dx, dz);
      this.enemy.setAimTarget(pPos);
      this.enemy.update(dt, false);
      this.burstTimer -= dt;
      if (this.burstTimer <= 0) {
        this.shootAtPlayer(targetPlayer);
        this.burstLeft -= 1;
        if (this.burstLeft > 0) {
          this.burstTimer = this.burstInterval;
        } else {
          this.enemy.setAimTarget(null);
          this.cooldownTimer = this.attackCooldown + Math.random() * 0.35;
        }
      }
      return;
    }

    if (this.windupTimer > 0) {
      this.windupTimer -= dt;
      this.enemyPhys.setHorizontalVelocity(0, 0);
      this.enemy.faceToward(dx, dz);
      this.enemy.setAimTarget(pPos);
      this.enemy.update(dt, false);

      if (this.windupTimer <= 0) {
        this.shootAtPlayer(targetPlayer);
        if (this.burstCount > 1) {
          this.burstLeft = this.burstCount - 1;
          this.burstTimer = this.burstInterval;
        } else {
          this.enemy.setAimTarget(null);
          this.cooldownTimer = this.attackCooldown + Math.random() * 0.35;
        }
      }
    } else {
      this.doPatrol(dt, ePos, allEnemies);
    }
  }

  private patrolTurnCooldown = 0;

  private doPatrol(dt: number, ePos: Vector3, allEnemies?: Minion[]): void {
    this.enemy.setAimTarget(null);

    if (this.patrolTurnCooldown > 0) {
      this.patrolTurnCooldown -= dt;
    }

    // 1. 撞墙自动掉头检测：向前向 0.55m 发射射线，遇到墙体/障碍物立即掉头
    this.checkWallCollisionTurnAround();

    // 2. 检查前方同线友军：面对面碰头时提前 0.95m 自动掉头，彻底防止卡死
    this.checkAvoidFriendCollision(allEnemies);

    const baseCenter = this.patrolAxis === 'x' ? this.spawnX : this.spawnZ;
    const currentPos = this.patrolAxis === 'x' ? ePos.x : ePos.z;
    const minVal = baseCenter - this.patrolRadius;
    const maxVal = baseCenter + this.patrolRadius;

    // 达到边界时反转踱步方向
    if (currentPos >= maxVal && this.patrolDir > 0) {
      this.patrolDir = -1;
    } else if (currentPos <= minVal && this.patrolDir < 0) {
      this.patrolDir = 1;
    }

    // 保持设定的固定轴坐标不变（纵向行走时锁死 X 坐标，横向行走时锁死 Z 坐标）
    if (this.patrolAxis === 'z') {
      ePos.x = this.spawnX;
    } else {
      ePos.z = this.spawnZ;
    }

    const moveSpeedVal = this.patrolDir * this.moveSpeed;
    const vx = this.patrolAxis === 'x' ? moveSpeedVal : 0;
    const vz = this.patrolAxis === 'z' ? moveSpeedVal : 0;

    this.enemy.faceToward(vx, vz);
    this.enemyPhys.setHorizontalVelocity(vx, vz);

    // 播放自然行走迈步动画
    this.enemy.update(dt, true);
  }

  /**
   * 判断 mesh 是否为墙壁或障碍物
   */
  private isObstacleMesh(mesh: unknown): boolean {
    const m = mesh as {
      isEnabled?: () => boolean;
      isPickable?: boolean;
      name?: string;
      metadata?: { minion?: unknown; isColliderMesh?: boolean };
    } | null;
    if (!m || !m.isEnabled || !m.isEnabled() || !m.isPickable) return false;
    const name = (m.name || '').toLowerCase();
    if (name.includes('bullet') || name.includes('spell') || m.metadata?.minion) {
      return false;
    }
    if (
      (name.includes('floor') && !name.includes('wall')) ||
      name.includes('ground') ||
      name.includes('grid') ||
      name.includes('axes') ||
      name.includes('pad')
    ) {
      return false;
    }
    if (name.startsWith('phys') || m.metadata?.isColliderMesh === true) {
      return false;
    }
    return (
      name.includes('renderwall') ||
      name.includes('wall') ||
      name.includes('obstacle') ||
      name.includes('pillar') ||
      name.includes('podium') ||
      name.includes('barrier')
    );
  }

  /**
   * 近战敌人智能追击：结合 Raycast 多角探针 + 沿墙切线滑行 (Wall Sliding) + 偏置记忆 + 紧急解卡
   */
  private updateSmartChase(dt: number, ePos: Vector3, pPos: Vector3): void {
    const scene = this.enemy.root.getScene();

    // 1. 记忆偏置计时衰减
    if (this.avoidanceBiasTimer > 0) {
      this.avoidanceBiasTimer -= dt;
      if (this.avoidanceBiasTimer <= 0) {
        this.avoidanceBias = 0;
      }
    }

    // 2. 解卡状态处理 (Unstuck recovery)
    if (this.unstuckTimer > 0) {
      this.unstuckTimer -= dt;
      if (this.unstuckDir) {
        const vx = this.unstuckDir.x * this.chaseSpeed;
        const vz = this.unstuckDir.z * this.chaseSpeed;
        this.enemy.faceToward(vx, vz);
        this.enemyPhys.setHorizontalVelocity(vx, vz);
        this.enemy.update(dt, true);
        return;
      }
    }

    // 检测实际移动速度（防卡在凹角/狭缝）
    const moveDist = Vector3.Distance(ePos, this.lastPos);
    this.lastPos.copyFrom(ePos);
    if (moveDist < 0.02 * (dt / 0.016)) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 0.3) {
        // 卡住了，尝试向 90° 侧向强制突破 0.4s
        const sideSign = Math.random() < 0.5 ? 1 : -1;
        const dx = pPos.x - ePos.x;
        const dz = pPos.z - ePos.z;
        this.unstuckDir = new Vector3(-dz * sideSign, 0, dx * sideSign);
        if (this.unstuckDir.lengthSquared() > 1e-4) {
          this.unstuckDir.normalize();
        } else {
          this.unstuckDir.set(1, 0, 0);
        }
        this.unstuckTimer = 0.4;
        this.stuckTimer = 0;
        this.avoidanceBias = sideSign;
        this.avoidanceBiasTimer = 0.8;
      }
    } else {
      this.stuckTimer = Math.max(0, this.stuckTimer - dt * 2);
    }

    // 3. 直奔玩家方向向量
    const dirToPlayer = new Vector3(pPos.x - ePos.x, 0, pPos.z - ePos.z);
    if (dirToPlayer.lengthSquared() > 1e-6) {
      dirToPlayer.normalize();
    } else {
      dirToPlayer.set(0, 0, 1);
    }

    const origin = ePos.clone();
    origin.y += 0.35; // 敌军胸口高度

    // 4. 多角 Context Steering 探针测试
    const baseAngle = Math.atan2(dirToPlayer.z, dirToPlayer.x);
    const candidateOffsets = [
      0,
      Math.PI / 8,
      -Math.PI / 8,
      Math.PI / 4,
      -Math.PI / 4,
      (3 * Math.PI) / 8,
      -(3 * Math.PI) / 8,
      Math.PI / 2,
      -Math.PI / 2,
      (5 * Math.PI) / 8,
      -(5 * Math.PI) / 8,
      (3 * Math.PI) / 4,
      -(3 * Math.PI) / 4,
    ];

    let bestDir = dirToPlayer.clone();
    let maxScore = -9999;
    let selectedOffset = 0;
    let hitNormalForSliding: Vector3 | null = null;

    for (const offset of candidateOffsets) {
      const testAngle = baseAngle + offset;
      const testDir = new Vector3(Math.cos(testAngle), 0, Math.sin(testAngle));

      // 根据偏角决定探针长度：前向探更远 (1.1m)，大偏角探稍短 (0.7m)
      const rayLen = 0.7 + 0.4 * Math.cos(offset);
      const ray = new Ray(origin, testDir, rayLen);

      const pickInfo = scene.pickWithRay(ray, (mesh) => this.isObstacleMesh(mesh));

      let penalty = 0;
      if (pickInfo && pickInfo.hit) {
        const hitDist = pickInfo.distance;
        penalty = Math.pow(Math.max(0, 1 - hitDist / rayLen), 1.5) * 3.0;

        // 保存正面碰墙法线，用于 Wall Sliding
        if (offset === 0) {
          const norm = pickInfo.getNormal(true);
          if (norm) {
            hitNormalForSliding = new Vector3(norm.x, 0, norm.z);
            if (hitNormalForSliding.lengthSquared() > 1e-4) {
              hitNormalForSliding.normalize();
            } else {
              hitNormalForSliding = null;
            }
          }
        }
      }

      // 目标契合度（与直指玩家方向的点积）
      const dotTarget = Vector3.Dot(testDir, dirToPlayer);

      // 偏置记忆奖励 (防止左右频繁抖动)
      let biasBonus = 0;
      if (this.avoidanceBias !== 0 && offset !== 0) {
        const isRight = offset > 0;
        if ((this.avoidanceBias > 0 && isRight) || (this.avoidanceBias < 0 && !isRight)) {
          biasBonus = 0.35;
        }
      }

      const score = dotTarget - penalty + biasBonus;

      if (score > maxScore) {
        maxScore = score;
        bestDir = testDir;
        selectedOffset = offset;
      }
    }

    // 5. 更新绕行偏置记忆
    if (Math.abs(selectedOffset) > 1e-3) {
      this.avoidanceBias = selectedOffset > 0 ? 1 : -1;
      this.avoidanceBiasTimer = 0.5;
    }

    // 6. 沿墙切线滑行 (Wall Sliding) 融合
    if (hitNormalForSliding) {
      const dotNorm = Vector3.Dot(bestDir, hitNormalForSliding);
      if (dotNorm < 0) {
        const tangent = bestDir.subtract(hitNormalForSliding.scale(dotNorm));
        tangent.y = 0;
        if (tangent.lengthSquared() > 1e-4) {
          tangent.normalize();
          bestDir = Vector3.Lerp(bestDir, tangent, 0.8).normalize();
        }
      }
    }

    // 7. 应用计算得出的绕路速度
    const vx = bestDir.x * this.chaseSpeed;
    const vz = bestDir.z * this.chaseSpeed;

    this.enemy.faceToward(vx, vz);
    this.enemyPhys.setHorizontalVelocity(vx, vz);
    this.enemy.update(dt, true);
  }

  /**
   * 前向撞墙/障碍物 Raycast 检测：若巡逻前方 0.55 米处有墙体，自动反转踱步方向并转身
   */
  private checkWallCollisionTurnAround(): void {
    if (this.patrolTurnCooldown > 0) return;

    const scene = this.enemy.root.getScene();
    const ePos = this.enemy.root.position;

    const moveSpeedVal = this.patrolDir * this.moveSpeed;
    const vx = this.patrolAxis === 'x' ? moveSpeedVal : 0;
    const vz = this.patrolAxis === 'z' ? moveSpeedVal : 0;

    const dirVec = new Vector3(vx, 0, vz);
    if (dirVec.lengthSquared() < 1e-4) return;
    dirVec.normalize();

    const origin = ePos.clone();
    origin.y += 0.35; // 敌军胸口高度

    const ray = new Ray(origin, dirVec, 0.55);
    const pickInfo = scene.pickWithRay(ray, (mesh) => this.isObstacleMesh(mesh));

    if (pickInfo && pickInfo.hit) {
      this.patrolDir *= -1;
      this.patrolTurnCooldown = 0.35;
    }
  }

  /**
   * 检查前方是否有迎面相向踱步的同组友军，相遇碰头时自动优雅掉头防卡死
   */
  private checkAvoidFriendCollision(otherEnemies?: Minion[]): void {
    if (!otherEnemies || otherEnemies.length === 0) return;

    const myPos = this.enemy.root.position;

    for (const other of otherEnemies) {
      if (other === this.enemy || other.isDead()) continue;

      const otherPos = other.root.position;
      const dx = otherPos.x - myPos.x;
      const dz = otherPos.z - myPos.z;
      const dist = Math.hypot(dx, dz);

      if (dist < 0.95) {
        if (this.patrolAxis === 'x') {
          if ((this.patrolDir > 0 && dx > 0) || (this.patrolDir < 0 && dx < 0)) {
            this.patrolDir *= -1;
            break;
          }
        } else {
          if ((this.patrolDir > 0 && dz > 0) || (this.patrolDir < 0 && dz < 0)) {
            this.patrolDir *= -1;
            break;
          }
        }
      }
    }
  }

  private shootAtPlayer(targetPlayer: Minion): void {
    const tipPos = this.enemy.getStaffTipWorldPos();
    const playerPos = targetPlayer.root.position.clone();
    playerPos.y += 0.3;

    const aimVec = playerPos.subtract(tipPos);
    aimVec.y = 0;
    const shootDir =
      aimVec.lengthSquared() > 1e-6
        ? aimVec.normalize()
        : this.enemy.getStaffForwardVector();

    playSfx('/audio/enemy_bullet_fire.mp3', 0.5, 90);
    this.spellSystem.spawnOrb(
      tipPos,
      shootDir,
      this.spellStyle,
      this.enemy,
      this.projectileSpeed,
    );
    this.enemy.triggerStaffShootFx();
  }

  dispose(): void {
    this.healthBar.dispose();
  }
}

