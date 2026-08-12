import { Matrix, type ArcRotateCamera, type Scene } from '@babylonjs/core';
import type { Minion } from '../world/Minion';
import type { SpellProjectileSystem } from '../world/SpellProjectileSystem';

/**
 * 玩家瞄准与射击：按住左/右键，法杖水平后按间隔发射。
 * 与枢纽/关卡解耦，只依赖当前活动世界的 scene/camera/player/spellSystem。
 */
export class PlayerCombatController {
  private shootCooldown = 0;
  private isPointerDown = false;
  private pointerOverCanvas = false;

  constructor(private readonly shootInterval = 0.2) {}

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
    },
  ): void {
    this.shootCooldown = Math.max(0, this.shootCooldown - dt);
    const { scene, camera, player, spellSystem, menuOpen } = opts;

    if (
      !this.isPointerDown ||
      !this.pointerOverCanvas ||
      menuOpen ||
      !player.hasStaff()
    ) {
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
    player.setAimTarget(aimPoint);

    if (this.shootCooldown > 0 || !player.isStaffHorizontal()) return;

    this.shootCooldown = this.shootInterval;
    const tipPos = player.getStaffTipWorldPos();
    const aimVec = aimPoint.subtract(tipPos);
    aimVec.y = 0;
    const shootDir =
      aimVec.lengthSquared() > 1e-6
        ? aimVec.normalize()
        : player.getStaffForwardVector();

    const style = player.getStaffStyle() ?? 'arcane';
    spellSystem.spawnOrb(tipPos, shootDir, style, player);
    player.triggerStaffShootFx();
  }
}
