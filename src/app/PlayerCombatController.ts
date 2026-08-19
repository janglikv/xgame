import { Matrix, Vector3, type ArcRotateCamera, type Scene } from '@babylonjs/core';
import { playSfx } from '../audio/Sfx';
import type { Minion } from '../world/Minion';
import { isGunStyle } from '../world/minion/staff';
import { spawnHitSparkFx } from '../world/MeleeSectorFx';
import type { SpellProjectileSystem } from '../world/SpellProjectileSystem';
import type { CameraFollow } from './CameraFollow';

/**
 * 玩家战斗控制器：
 * 1. 有法杖：瞄准 + 当法杖方向与【角色中心点 -> 指针位置】逻辑线平行时，沿法杖前向发射子弹；
 * 2. 空手（无法杖）：按住/点击鼠标触发近战空手挥拳动画与拳头落点打击。
 */
/** 手枪连续射击水平最大偏角（弧度，约 16°） */
const PISTOL_SPREAD_MAX = 0.28;
/** 手枪每次连续射击增加的散布偏角（弧度，约 4°，打 4~5 发达到最大散布） */
const PISTOL_SPREAD_GROWTH = 0.07;
/** 手枪停火精度完全恢复所需间隔时间（秒） */
const PISTOL_RECOVERY_TIME = 1.0;
/** 散弹枪一次射出的弹丸数 */
const SHOTGUN_PELLET_COUNT = 6;
/** 散弹枪扇形半角（弧度，约 15°） */
const SHOTGUN_CONE = 0.26;
/** 相对默认射击间隔的泵动冷却倍率 */
const SHOTGUN_COOLDOWN_MUL = 4.0;

function rotateYaw(dir: Vector3, angle: number): Vector3 {
  if (Math.abs(angle) <= 1e-4) return dir.clone();
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const x = dir.x * c - dir.z * s;
  const z = dir.x * s + dir.z * c;
  const out = new Vector3(x, 0, z);
  if (out.lengthSquared() < 1e-8) return dir.clone();
  return out.normalize();
}

function applySpread(dir: Vector3, spreadRad: number): Vector3 {
  return rotateYaw(dir, (Math.random() * 2 - 1) * spreadRad);
}

export class PlayerCombatController {
  private shootCooldown = 0;
  private meleeCooldown = 0;
  private isPointerDown = false;
  private pointerOverCanvas = false;
  /** 开火待决状态：点击或按住时激活，即使鼠标提前松开，也会在平滑转身到位后坚决开火 */
  private pendingFire = false;
  /** 待决开火的目标世界坐标点 */
  private pendingAimPoint: Vector3 | null = null;
  /** 待决开火超时保护（秒，最多等待 1.2 秒旋转，防止卡死） */
  private pendingFireTimeout = 0;
  /** 本次鼠标按下期间已击发子弹的次数（0 代表一发都还没打出） */
  private shotsFiredInCurrentPress = 0;
  /** 手枪当前散布角（弧度，0 = 最大精度） */
  private pistolSpread = 0;
  /** 手枪停止开火恢复倒计时（达到 1s 恢复最大精度） */
  private pistolRecoveryTimer = 0;

  constructor(
    private readonly shootInterval = 0.2,
    private readonly meleeInterval = 0.32,
  ) {}

  get isOverCanvas(): boolean {
    return this.pointerOverCanvas;
  }

  get isDown(): boolean {
    return this.isPointerDown;
  }

  bindCanvas(canvas: HTMLCanvasElement): () => void {
    const onDown = (e: PointerEvent): void => {
      if (e.button === 0 || e.button === 2) {
        this.isPointerDown = true;
        this.pendingFire = true;
        this.pendingFireTimeout = 1.2;
        this.shotsFiredInCurrentPress = 0;
      }
    };
    const onUp = (): void => {
      this.isPointerDown = false;
      // 若在本次按下期间已经打出过至少一枪，则松手立即停火；
      // 若一枪都还没开出来（如单次点击或在开枪前松开），保留 pendingFire 让转身到位后只打这 1 枪！
      if (this.shotsFiredInCurrentPress > 0) {
        this.pendingFire = false;
        this.pendingAimPoint = null;
      }
    };
    const onEnter = (): void => {
      this.pointerOverCanvas = true;
    };
    const onMove = (): void => {
      this.pointerOverCanvas = true;
    };
    const onLeave = (): void => {
      this.pointerOverCanvas = false;
      this.isPointerDown = false;
      if (this.shotsFiredInCurrentPress > 0) {
        this.pendingFire = false;
        this.pendingAimPoint = null;
      }
    };

    canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerenter', onEnter);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);

    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerenter', onEnter);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
    };
  }

  update(
    dt: number,
    opts: {
      scene: Scene;
      camera: ArcRotateCamera;
      player: Minion;
      spellSystem: SpellProjectileSystem;
      menuOpen: boolean;
      cameraFollow?: CameraFollow;
    },
  ): void {
    this.shootCooldown = Math.max(0, this.shootCooldown - dt);
    this.meleeCooldown = Math.max(0, this.meleeCooldown - dt);

    // 超时计时
    if (this.pendingFireTimeout > 0) {
      this.pendingFireTimeout = Math.max(0, this.pendingFireTimeout - dt);
      if (this.pendingFireTimeout <= 0 && !this.isPointerDown) {
        this.pendingFire = false;
        this.pendingAimPoint = null;
      }
    }

    // 精度恢复机制：停止开火满 1s 后恢复最大精度（散布归零）
    if (this.pistolRecoveryTimer > 0) {
      this.pistolRecoveryTimer = Math.max(0, this.pistolRecoveryTimer - dt);
      if (this.pistolRecoveryTimer <= 0) {
        this.pistolSpread = 0;
      }
    }

    const { scene, camera, player, spellSystem, menuOpen } = opts;

    // 当鼠标按下时，实时通过射线拾取更新最新的瞄准目标点
    if (this.isPointerDown && this.pointerOverCanvas && !menuOpen && !player.isDead()) {
      const ray = scene.createPickingRay(
        scene.pointerX,
        scene.pointerY,
        Matrix.Identity(),
        camera,
      );
      const planeY = player.root.position.y;
      if (Math.abs(ray.direction.y) > 1e-5) {
        const t = (planeY - ray.origin.y) / ray.direction.y;
        if (t > 0) {
          this.pendingAimPoint = ray.origin.add(ray.direction.scale(t));
          this.pendingFire = true;
          this.pendingFireTimeout = 1.2;
        }
      }
    }

    // 若无待决开火意图，或菜单开启/角色死亡，收起瞄准并退出
    if (!this.pendingFire || !this.pendingAimPoint || menuOpen || player.isDead()) {
      player.setAimTarget(null);
      return;
    }

    const aimPoint = this.pendingAimPoint;
    const aimDx = aimPoint.x - player.root.position.x;
    const aimDz = aimPoint.z - player.root.position.z;
    const lineVec = new Vector3(aimDx, 0, aimDz);
    let lineDir = player.getForwardVector();
    if (lineVec.lengthSquared() > 1e-6) {
      lineDir = lineVec.normalize();
    }

    // 1. 有法杖 / 枪械：
    if (player.hasStaff()) {
      // 保持瞄准并平滑旋转朝向目标点（先旋转）
      player.setAimTarget(aimPoint);
      if (aimDx * aimDx + aimDz * aimDz > 1e-6) {
        player.faceToward(aimDx, aimDz);
      }

      const style = player.getStaffStyle() ?? 'arcane';
      const isPistol = isGunStyle(style);

      // 1.1 枪械分支：必须平滑转向对齐（夹角 <= 20°），且冷却完毕后开枪（后开枪）
      if (isPistol) {
        const playerForward = player.getForwardVector();
        const isFacingTarget = Vector3.Dot(playerForward, lineDir) >= 0.94;

        if (!isFacingTarget || this.shootCooldown > 0) {
          // 还在旋转中或冷却中，等待对齐
          return;
        }

        // 转到位了，立即开火！
        this.shotsFiredInCurrentPress++;
        const tipPos = player.getStaffTipWorldPos();

        if (style === 'shotgun') {
          this.shootCooldown = this.shootInterval * SHOTGUN_COOLDOWN_MUL;
          playSfx('/audio/bullet_fire.mp3', 0.72);
          const n = SHOTGUN_PELLET_COUNT;
          for (let i = 0; i < n; i++) {
            const t = n <= 1 ? 0 : i / (n - 1);
            const fan = (t * 2 - 1) * SHOTGUN_CONE;
            const jitter = (Math.random() * 2 - 1) * 0.03;
            spellSystem.spawnOrb(
              tipPos,
              rotateYaw(lineDir, fan + jitter),
              style,
              player,
            );
          }
        } else {
          this.shootCooldown = this.shootInterval * 1.5;
          // 精度机制：根据当前累积散布计算发射方向（第1发绝对精准，连发精度逐渐降低）
          const shootDir = applySpread(lineDir, this.pistolSpread);
          this.pistolSpread = Math.min(
            PISTOL_SPREAD_MAX,
            this.pistolSpread + PISTOL_SPREAD_GROWTH,
          );
          this.pistolRecoveryTimer = PISTOL_RECOVERY_TIME;
          playSfx('/audio/bullet_fire.mp3', 0.5);
          spellSystem.spawnOrb(tipPos, shootDir, style, player);
        }
        player.triggerStaffShootFx();

        // 消费掉本次开火意图
        this.pendingFire = false;

        // 如果用户在开枪前就已经松开了鼠标，或者此时鼠标未按住，彻底清除瞄准点
        if (!this.isPointerDown) {
          this.pendingAimPoint = null;
          player.setAimTarget(null);
        }
        return;
      }

      // 1.2 传统法杖分支：必须法杖方向与逻辑线平行且举平，冷却完毕后发射
      const staffDir = player.getStaffForwardVector();
      const isParallel = Vector3.Dot(staffDir, lineDir) >= 0.985;

      if (this.shootCooldown > 0 || !player.isStaffHorizontal() || !isParallel) {
        return;
      }

      this.shootCooldown = this.shootInterval;
      this.shotsFiredInCurrentPress++;
      const tipPos = player.getStaffTipWorldPos();
      const shootDir = staffDir;
      playSfx(
        style === 'storm'
          ? '/audio/staff_storm_fire.mp3'
          : '/audio/bullet_fire.mp3',
        0.5,
      );
      spellSystem.spawnOrb(tipPos, shootDir, style, player);
      player.triggerStaffShootFx();

      // 消费掉本次开火意图
      this.pendingFire = false;

      if (!this.isPointerDown) {
        this.pendingAimPoint = null;
        player.setAimTarget(null);
      }
      return;
    }

    // 2. 空手（无法杖）：平滑转向目标点，转到位后执行近战挥拳
    player.setAimTarget(null);
    if (aimDx * aimDx + aimDz * aimDz > 1e-6) {
      player.faceToward(aimDx, aimDz);
    }

    const playerForward = player.getForwardVector();
    const isFacingTarget = Vector3.Dot(playerForward, lineDir) >= 0.90;

    if (!isFacingTarget || this.meleeCooldown > 0) return;

    const triggered = player.triggerMeleePunch(() => {
      this.performMeleePunchAttack(scene, player, opts.cameraFollow);
    });

    if (triggered) {
      this.meleeCooldown = this.meleeInterval;
      this.shotsFiredInCurrentPress++;
      this.pendingFire = false;
      if (!this.isPointerDown) {
        this.pendingAimPoint = null;
      }
    }
  }

  /**
   * 执行拳头落点精确定点打击
   */
  private performMeleePunchAttack(
    scene: Scene,
    player: Minion,
    cameraFollow?: CameraFollow,
  ): void {
    // 1. 获取拳头绝对世界坐标（拳头落点）
    const impactPos = player.getAttackingHandWorldPos();
    const forwardDir = player.getForwardVector();

    // 拳面向前微调延伸，代表触达真实受击点
    const punchReachPos = impactPos.add(forwardDir.scale(0.12));

    // 2. 拳头落点接触半径 (0.5m)
    const impactRadius = 0.5;

    // 3. 检索场景中的被击目标
    const targetMinions = new Set<Minion>();
    for (const mesh of scene.meshes) {
      if (!mesh.isEnabled()) continue;
      const m = mesh.metadata?.minion as Minion | undefined;
      if (m && m !== player && m.root.isEnabled()) {
        targetMinions.add(m);
      }
    }

    let closestHitTarget: Minion | null = null;
    let closestDist = Infinity;

    for (const target of targetMinions) {
      const targetPos = target.root.position;
      const targetCenter = targetPos.clone().addInPlace(new Vector3(0, 0.3, 0));

      const dist = Vector3.Distance(punchReachPos, targetCenter);

      if (dist <= impactRadius && dist < closestDist) {
        closestDist = dist;
        closestHitTarget = target;
      }
    }

    // 击中拳头落点接触范围内的最近目标
    if (closestHitTarget) {
      const hitDir = closestHitTarget.root.position.subtract(player.root.position);
      hitDir.y = 0;
      const pushDir =
        hitDir.lengthSquared() > 1e-4 ? hitDir.normalize() : forwardDir;

      const targetCenter = closestHitTarget.root.position
        .clone()
        .addInPlace(new Vector3(0, 0.32, 0));
      spawnHitSparkFx(scene, targetCenter, pushDir);

      // 造成 40 点单点拳击伤害
      closestHitTarget.takeDamage(40, pushDir);

      // 物理后退击退 (Knockback)
      if (closestHitTarget.physicsProxy) {
        closestHitTarget.physicsProxy.applyHitKnockback(pushDir, 4.6);
      }

      player.punchConnected();
      cameraFollow?.impulse(1);
    }
  }
}



