import type { Vector3 } from '@babylonjs/core';
import type { Minion } from './Minion';
import type { MinionPhysicsProxy } from './physics/MinionPhysicsProxy';
import type { SpellProjectileSystem } from './SpellProjectileSystem';
import type { StaffStyle } from './minion/staff';
import { HealthBar } from './HealthBar';

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
  /** 锁定后仇恨保持范围（米，默认 5.0） */
  retainedAttackRange?: number;
  /** 连续攻击 2 次后的强制踱步时间（秒，默认 0.5） */
  forcedPatrolDuration?: number;
  /** 攻击冷却时间（秒，默认 1.8） */
  attackCooldown?: number;
  /** 施法弹道样式（默认 flame） */
  spellStyle?: StaffStyle;
  /** 同组共享仇恨状态控制 */
  groupState?: GroupAggroState;
  /** 敌军最大生命值（默认 100） */
  maxHp?: number;
}

/**
 * 极简敌军 AI：
 * 1. 在固定点 (spawnX, spawnZ) 两侧 (±patrolRadius) 来回踱步巡逻（支持 X 轴横向 / Z 轴纵向）；
 * 2. 同组中任意 1 人发现玩家，全组共享仇恨拉开 5 米锁定；
 * 3. 连续发射 2 次法术后各自强制随机选向踱步 0.5 秒避让；
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
  private patrolAxis: 'x' | 'z';
  private attackCooldown: number;
  private spellStyle: StaffStyle;
  private groupState?: GroupAggroState;

  /** 踱步方向：1 表示正向，-1 表示反向 */
  private patrolDir = 1;
  private cooldownTimer = 0;
  private windupTimer = 0;
  private readonly windupDuration = 0.5;
  /** 是否处于击败死亡状态 */
  private isDead = false;

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
    this.patrolAxis = options.patrolAxis ?? 'x';
    this.attackCooldown = options.attackCooldown ?? 1.8;
    this.spellStyle = options.spellStyle ?? 'flame';
    this.groupState = options.groupState;

    // 随机错开首次攻击，增强自然感
    this.cooldownTimer = 0.6 + Math.random() * 0.4;

    // 创建 3D 悬浮血条 (头顶 Y+1.55，高悬离头顶远)
    this.healthBar = new HealthBar(enemy.root.getScene(), enemy.root, {
      maxHp: options.maxHp ?? 100,
      offsetY: 1.55,
    });

    // 绑定 Minion 受击事件
    this.enemy.onTakeDamage = (amount) => this.takeDamage(amount);
  }

  takeDamage(amount: number): void {
    if (this.isDead) return;

    this.healthBar.takeDamage(amount);

    // 受击时激怒敌人拉起仇恨
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
  }

  /** 每帧更新 AI 逻辑 */
  update(dt: number, targetPlayer: Minion, allEnemies?: Minion[]): void {
    if (this.isDead) return;

    this.healthBar.update(dt);
    const ePos = this.enemy.root.position;
    const pPos = targetPlayer.root.position;

    // 玩家若已阵亡：敌军停止攻击鞭尸，收起法杖继续巡逻踱步
    if (targetPlayer.isDead()) {
      this.doPatrol(dt, ePos, allEnemies);
      return;
    }

    const dx = pPos.x - ePos.x;
    const dz = pPos.z - ePos.z;
    // 每帧更新冷却
    if (this.cooldownTimer > 0) {
      this.cooldownTimer -= dt;
    }

    // ── 1. 处于抬杖前摇阶段 (Windup, 0.5s) ──────────────────────
    if (this.cooldownTimer <= 0 && this.windupTimer <= 0) {
      // 冷却结束：开启 0.5s 抬杖前摇，并随机决定下一次开火后的走位方向
      this.windupTimer = this.windupDuration;
      this.patrolDir = Math.random() < 0.5 ? 1 : -1;
    }

    if (this.windupTimer > 0) {
      this.windupTimer -= dt;
      // 1. 抬杖前摇与发射阶段：停下脚步，转过来死死盯着主角
      this.enemyPhys.setHorizontalVelocity(0, 0);
      this.enemy.faceToward(dx, dz);
      this.enemy.setAimTarget(pPos);
      this.enemy.update(dt, false);

      if (this.windupTimer <= 0) {
        // 前摇结束：正式发射子弹！
        this.shootAtPlayer(targetPlayer);
        this.enemy.setAimTarget(null);
        // 进入 1.8 秒冷却间隙
        this.cooldownTimer = this.attackCooldown;
      }
    } else {
      // 2. 发射间隙阶段 (Cooldown, 1.8s)：收起法杖，面向走位方向自然踱步（包含碰头掉头避让）
      this.doPatrol(dt, ePos, allEnemies);
    }
  }

  private doPatrol(dt: number, ePos: Vector3, allEnemies?: Minion[]): void {
    this.enemy.setAimTarget(null);

    // 检查前方同线友军：面对面碰头时提前 0.95m 自动掉头，彻底防止卡死
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

    const moveSpeedVal = this.patrolDir * this.moveSpeed;
    const vx = this.patrolAxis === 'x' ? moveSpeedVal : 0;
    const vz = this.patrolAxis === 'z' ? moveSpeedVal : 0;

    this.enemy.faceToward(vx, vz);
    this.enemyPhys.setHorizontalVelocity(vx, vz);

    // 播放自然行走迈步动画
    this.enemy.update(dt, true);
  }

  /**
   * 检查前方是否有迎面相向踱步的同组友军，相遇碰头时自动优雅掉头防卡死
   */
  private checkAvoidFriendCollision(otherEnemies?: Minion[]): void {
    if (!otherEnemies || otherEnemies.length === 0) return;

    const myPos = this.enemy.root.position;

    for (const other of otherEnemies) {
      if (other === this.enemy || other.isDead()) continue; // 排除自己与已阵亡友军

      const otherPos = other.root.position;
      const dx = otherPos.x - myPos.x;
      const dz = otherPos.z - myPos.z;
      const dist = Math.hypot(dx, dz);

      // 两小兵面对面相距小于 0.95m 时触发掉头
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
    playerPos.y += 0.3; // 指向角色躯干中心

    const aimVec = playerPos.subtract(tipPos);
    aimVec.y = 0;
    const shootDir =
      aimVec.lengthSquared() > 1e-6
        ? aimVec.normalize()
        : this.enemy.getStaffForwardVector();

    // 发射能量弹并触发法杖火焰脉冲特效（敌军子弹速度降低一倍：4.5 m/s）
    this.spellSystem.spawnOrb(tipPos, shootDir, this.spellStyle, this.enemy, 4.5);
    this.enemy.triggerStaffShootFx();
  }

  dispose(): void {
    this.healthBar.dispose();
  }
}
