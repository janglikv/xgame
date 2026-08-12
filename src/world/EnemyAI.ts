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
 * 4. 挂载 3D 悬浮血条，支持受击扣血与倒下复活。
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
  private initialAttackRange: number;
  private retainedAttackRange: number;
  private forcedPatrolDuration: number;
  private attackCooldown: number;
  private spellStyle: StaffStyle;
  private groupState?: GroupAggroState;

  /** 踱步方向：1 表示正向，-1 表示反向 */
  private patrolDir = 1;
  private cooldownTimer = 0;
  /** 已连续攻击次数 */
  private attackCount = 0;
  /** 强制踱步休息计时器（秒） */
  private forcedPatrolTimer = 0;
  /** 单体仇恨锁定 */
  private isAggroLocked = false;

  /** 是否处于击败死亡倒下状态 */
  private isDead = false;
  /** 击败后复活倒计时（秒） */
  private respawnTimer = 0;

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
    this.initialAttackRange = options.initialAttackRange ?? 4.0;
    this.retainedAttackRange = options.retainedAttackRange ?? 5.0;
    this.forcedPatrolDuration = options.forcedPatrolDuration ?? 0.5;
    this.attackCooldown = options.attackCooldown ?? 1.8;
    this.spellStyle = options.spellStyle ?? 'flame';
    this.groupState = options.groupState;

    // 随机错开首次攻击，增强自然感
    this.cooldownTimer = 0.6 + Math.random() * 0.4;

    // 创建 3D 悬浮血条 (头顶 Y+0.62)
    this.healthBar = new HealthBar(enemy.root.getScene(), enemy.root, {
      maxHp: options.maxHp ?? 100,
      offsetY: 0.62,
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
    } else {
      this.isAggroLocked = true;
    }

    if (this.healthBar.isDead()) {
      this.die();
    }
  }

  private die(): void {
    this.isDead = true;
    this.respawnTimer = 4.5; // 4.5 秒后在 Spawn 点自动复活刷新
    this.enemy.root.setEnabled(false);
    this.healthBar.setVisible(false);
    this.enemyPhys.setHorizontalVelocity(0, 0);
  }

  private respawn(): void {
    this.isDead = false;
    this.enemy.root.position.set(this.spawnX, 0, this.spawnZ);
    this.enemyPhys.teleportToTarget();

    this.healthBar.setHp(this.healthBar.getMaxHp());
    this.enemy.root.setEnabled(true);
    this.healthBar.setVisible(true);
  }

  /** 每帧更新 AI 逻辑 */
  update(dt: number, targetPlayer: Minion, allEnemies?: Minion[]): void {
    if (this.isDead) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) {
        this.respawn();
      }
      return;
    }

    this.healthBar.update(dt);
    const ePos = this.enemy.root.position;
    const pPos = targetPlayer.root.position;

    const dx = pPos.x - ePos.x;
    const dz = pPos.z - ePos.z;
    const dist = Math.hypot(dx, dz);

    this.cooldownTimer -= dt;
    this.forcedPatrolTimer -= dt;

    // 1. 如果自己检测到玩家进入 4 米感应区，触发全组连锁仇恨！
    if (dist <= this.initialAttackRange && this.groupState) {
      this.groupState.isGroupAggroLocked = true;
    }

    // 2. 共享仇恨判断：同组内有任何人触发了锁定，则全员共享 5 米保持范围
    const isAggroActive =
      (this.groupState && this.groupState.isGroupAggroLocked) ||
      this.isAggroLocked;

    const activeRange = isAggroActive
      ? this.retainedAttackRange
      : this.initialAttackRange;

    const inRange = dist <= activeRange;
    const canAttack = this.forcedPatrolTimer <= 0 && inRange;

    if (canAttack) {
      // 成功触发/维持攻击，激活锁定状态
      this.isAggroLocked = true;
      if (this.groupState) {
        this.groupState.isGroupAggroLocked = true;
      }

      // ── 1. 攻击行为：停下踱步，站立锁定玩家开火 ──────────────
      this.enemyPhys.setHorizontalVelocity(0, 0);

      // 朝向玩家并举起法杖锁敌
      this.enemy.faceToward(dx, dz);
      this.enemy.setAimTarget(pPos);

      // 攻击冷却完毕：发射能量弹
      if (this.cooldownTimer <= 0) {
        this.shootAtPlayer(targetPlayer);
        this.cooldownTimer = this.attackCooldown;
        this.attackCount++;

        // 每攻击两下，重置攻击计数并触发 0.5 秒随机战术走位踱步
        if (this.attackCount >= 2) {
          this.attackCount = 0;
          this.forcedPatrolTimer = this.forcedPatrolDuration; // 0.5 秒强制踱步
          this.isAggroLocked = false; // 触发踱步休息

          // 随机选择战术踱步方向（50% 正向，50% 反向战术避让）
          this.patrolDir = Math.random() < 0.5 ? 1 : -1;

          // 靠近边缘时自动修正为向场内踱步
          const baseCenter = this.patrolAxis === 'x' ? this.spawnX : this.spawnZ;
          const currentPos = this.patrolAxis === 'x' ? ePos.x : ePos.z;
          const minVal = baseCenter - this.patrolRadius;
          const maxVal = baseCenter + this.patrolRadius;

          if (currentPos >= maxVal - 0.2) {
            this.patrolDir = -1;
          } else if (currentPos <= minVal + 0.2) {
            this.patrolDir = 1;
          }
        }
      }

      // 播放站立待机动画（不迈步）
      this.enemy.update(dt, false);
    } else {
      // 走出 5 米仇恨保持圈时，解除锁定
      if (!inRange) {
        this.isAggroLocked = false;
      }

      // ── 2. 来回踱步行为：在固定点两侧来回走动 ────────────────
      this.enemy.setAimTarget(null);

      // 检查前方同线友军：相向相遇提前 0.75m 掉头，彻底防止卡死硬推
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
  }

  /**
   * 检查前方是否有迎面相向踱步的同组友军，相遇时自动优雅掉头防卡死
   */
  private checkAvoidFriendCollision(otherEnemies?: Minion[]): void {
    if (!otherEnemies || otherEnemies.length === 0) return;

    const myPos = this.enemy.root.position;

    for (const other of otherEnemies) {
      if (other === this.enemy) continue; // 排除自己

      const otherPos = other.root.position;
      const dx = Math.abs(otherPos.x - myPos.x);
      const dz = Math.abs(otherPos.z - myPos.z);

      if (this.patrolAxis === 'x') {
        // X 轴巡逻：Z 轴差 < 0.45m，且 X 轴近 (< 0.75m)
        const diffX = otherPos.x - myPos.x;
        if (dz < 0.45 && dx < 0.75) {
          if ((this.patrolDir > 0 && diffX > 0) || (this.patrolDir < 0 && diffX < 0)) {
            this.patrolDir *= -1;
            break;
          }
        }
      } else {
        // Z 轴巡逻：X 轴差 < 0.45m，且 Z 轴近 (< 0.75m)
        const diffZ = otherPos.z - myPos.z;
        if (dx < 0.45 && dz < 0.75) {
          if ((this.patrolDir > 0 && diffZ > 0) || (this.patrolDir < 0 && diffZ < 0)) {
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
