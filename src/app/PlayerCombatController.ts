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
/** 手枪连发水平最大偏角（弧度，约 16°） */
const PISTOL_SPREAD_MAX = 0.28;
/** 连发至少偏这么多，避免看起来仍像精准弹 */
const PISTOL_SPREAD_MIN = 0.09;

function yawJitter(dir: Vector3, minRad: number, maxRad: number): Vector3 {
  const sign = Math.random() < 0.5 ? -1 : 1;
  const angle = sign * (minRad + Math.random() * (maxRad - minRad));
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
  /** 本次按下是否已经打出第一发精准弹 */
  private pistolBurstShot = false;

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
        this.shootCooldown = 0;
        this.meleeCooldown = 0;
        this.pistolBurstShot = false;
      }
    };
    const onUp = (): void => {
      this.isPointerDown = false;
      this.pistolBurstShot = false;
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
      this.pistolBurstShot = false;
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

    const { scene, camera, player, spellSystem, menuOpen } = opts;

    if (!this.isPointerDown || !this.pointerOverCanvas || menuOpen || player.isDead()) {
      this.pistolBurstShot = false;
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

    // 有法杖：计算法杖方向与【角色中心点 -> 指针位置】逻辑线是否平行
    if (player.hasStaff()) {
      player.setAimTarget(aimPoint);

      // 计算角色中心点到指针位置的向量与法杖朝向向量
      const lineVec = aimPoint.subtract(player.root.position);
      lineVec.y = 0;
      let isParallel = false;
      if (lineVec.lengthSquared() > 1e-6) {
        const lineDir = lineVec.normalize();
        const staffDir = player.getStaffForwardVector();
        const dot = Vector3.Dot(staffDir, lineDir);
        // 点积 >= 0.992 （夹角约 <= 7.2°），判定为法杖朝向与【中心->指针】逻辑线平行
        isParallel = dot >= 0.992;
      }

      // 法杖方向必须与逻辑线平行，且法杖举平，且冷却完毕方可发射
      if (this.shootCooldown > 0 || !player.isStaffHorizontal() || !isParallel) {
        return;
      }

      const style = player.getStaffStyle() ?? 'arcane';
      this.shootCooldown = isGunStyle(style)
        ? this.shootInterval * 1.9
        : this.shootInterval;
      const tipPos = player.getStaffTipWorldPos();
      // 子弹方向沿用法杖前向向量向前发射；手枪仅首发精准，连发水平随机偏移
      let shootDir = player.getStaffForwardVector();
      if (isGunStyle(style)) {
        if (this.pistolBurstShot) {
          shootDir = yawJitter(shootDir, PISTOL_SPREAD_MIN, PISTOL_SPREAD_MAX);
        }
        this.pistolBurstShot = true;
      }
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



