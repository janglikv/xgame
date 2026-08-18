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

function applySpread(dir: Vector3, spreadRad: number): Vector3 {
  if (spreadRad <= 1e-4) return dir.clone();
  const angle = (Math.random() * 2 - 1) * spreadRad;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const x = dir.x * c - dir.z * s;
  const z = dir.x * s + dir.z * c;
  const out = new Vector3(x, 0, z);
  if (out.lengthSquared() < 1e-8) return dir.clone();
  return out.normalize();
}

export class PlayerCombatController {
  private shootCooldown = 0;
  private meleeCooldown = 0;
  private isPointerDown = false;
  private pointerOverCanvas = false;
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
      }
    };
    const onUp = (): void => {
      this.isPointerDown = false;
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

    // 精度恢复机制：停止开火满 1s 后恢复最大精度（散布归零）
    if (this.pistolRecoveryTimer > 0) {
      this.pistolRecoveryTimer = Math.max(0, this.pistolRecoveryTimer - dt);
      if (this.pistolRecoveryTimer <= 0) {
        this.pistolSpread = 0;
      }
    }

    const { scene, camera, player, spellSystem, menuOpen } = opts;

    if (!this.isPointerDown || !this.pointerOverCanvas || menuOpen || player.isDead()) {
      player.setAimTarget(null);
      return;
    }

    const ray = scene.createPickingRay(
      scene.pointerX,
      scene.pointerY,
      Matrix.Identity(),
      camera,
    );
    const planeY = player.root.position.y;
    if (Math.abs(ray.direction.y) <= 1e-5) {
      player.setAimTarget(null);
      return;
    }

    const t = (planeY - ray.origin.y) / ray.direction.y;
    if (t <= 0) {
      player.setAimTarget(null);
      return;
    }

    const aimPoint = ray.origin.add(ray.direction.scale(t));

    // 有法杖 / 枪械：
    if (player.hasStaff()) {
      player.setAimTarget(aimPoint);

      const style = player.getStaffStyle() ?? 'arcane';
      const isPistol = isGunStyle(style);

      // 计算角色中心点到指针位置的向量与法杖朝向向量
      const lineVec = aimPoint.subtract(player.root.position);
      lineVec.y = 0;
      let lineDir = player.getForwardVector();
      let isParallel = false;
      if (lineVec.lengthSquared() > 1e-6) {
        lineDir = lineVec.normalize();
        const staffDir = player.getStaffForwardVector();
        const dot = Vector3.Dot(staffDir, lineDir);
        // 点积 >= 0.992 （夹角约 <= 7.2°），判定为法杖朝向与【中心->指针】逻辑线平行
        isParallel = dot >= 0.992;
      }

      // 开火时先向目标方向转向
      const aimDx = aimPoint.x - player.root.position.x;
      const aimDz = aimPoint.z - player.root.position.z;
      if (aimDx * aimDx + aimDz * aimDz > 1e-6) {
        player.faceToward(aimDx, aimDz);
      }

      // 计算角色身体当前朝向与目标开火方向的对齐程度（点积 >= 0.94 代表夹角约 <= 20°）
      const playerForward = player.getForwardVector();
      const isFacingTarget = Vector3.Dot(playerForward, lineDir) >= 0.94;

      // 1. 手枪分支：若方向不一致先转向，转向正确对齐且冷却完毕后再开火
      if (isPistol) {
        if (!isFacingTarget || this.shootCooldown > 0) {
          return;
        }

        this.shootCooldown = this.shootInterval * 1.5;
        const tipPos = player.getStaffTipWorldPos();

        // 精度机制：根据当前累积散布计算发射方向（第1发绝对精准，连发精度逐渐降低）
        const shootDir = applySpread(lineDir, this.pistolSpread);

        // 连续发射散布逐渐扩大，最多到 PISTOL_SPREAD_MAX
        this.pistolSpread = Math.min(
          PISTOL_SPREAD_MAX,
          this.pistolSpread + PISTOL_SPREAD_GROWTH,
        );
        // 重置 1s 精度恢复倒计时
        this.pistolRecoveryTimer = PISTOL_RECOVERY_TIME;

        playSfx('/audio/bullet_fire.mp3', 0.5);
        spellSystem.spawnOrb(tipPos, shootDir, style, player);
        player.triggerStaffShootFx();
        return;
      }

      // 2. 传统法杖分支：法杖方向必须与逻辑线平行，且法杖举平，且冷却完毕方可发射
      if (this.shootCooldown > 0 || !player.isStaffHorizontal() || !isParallel) {
        return;
      }

      this.shootCooldown = this.shootInterval;
      const tipPos = player.getStaffTipWorldPos();
      const shootDir = player.getStaffForwardVector();
      playSfx(
        style === 'storm'
          ? '/audio/staff_storm_fire.mp3'
          : '/audio/bullet_fire.mp3',
        0.5,
      );
      spellSystem.spawnOrb(tipPos, shootDir, style, player);
      player.triggerStaffShootFx();
      return;
    }

    // 空手（无法杖）：转向鼠标点并执行近战挥拳与拳头落点打击
    player.setAimTarget(null);
    const aimDx = aimPoint.x - player.root.position.x;
    const aimDz = aimPoint.z - player.root.position.z;
    if (aimDx * aimDx + aimDz * aimDz > 1e-6) {
      player.faceToward(aimDx, aimDz);
    }

    if (this.meleeCooldown > 0) return;

    const triggered = player.triggerMeleePunch(() => {
      this.performMeleePunchAttack(scene, player, opts.cameraFollow);
    });

    if (triggered) {
      this.meleeCooldown = this.meleeInterval;
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



