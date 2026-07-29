import type { Sprite } from 'pixi.js';

/** 走路晃动配置 */
export type WalkBobConfig = {
  /** 完整一步周期（秒） */
  period: number;
  /** 上下抬脚像素 */
  ampY: number;
  /** 左右微摆像素 */
  ampX: number;
  /** 旋转幅度（弧度） */
  ampRot: number;
  /** 停步时回正速度 */
  settle: number;
};

export const DEFAULT_WALK_BOB: WalkBobConfig = {
  period: 0.34,
  ampY: 2.2,
  ampX: 1.0,
  ampRot: 0.022,
  settle: 10,
};

export const BLAST_CONFIG = {
  lean: 0.5,
  lift: 6,
  tumble: 0.75,
  settle: 5.2,
} as const;

export const AIR_SPIN_CONFIG = {
  duration: 0.62,
  lift: 0,
} as const;

export const ANCHOR_CENTER_Y = 0.5;

/**
 * 怪物/蜘蛛精灵姿态动画控制器：负责走路晃动、受击后仰、空中旋转与锚点微调
 */
export class MonsterPoseController {
  private walkPhase = 0;
  private walkPoseX = 0;
  private walkPoseY = 0;
  private walkPoseRot = 0;

  private blastKnock = 0;
  private spinT = 0;
  private spinTarget = 0;
  private spinSign: 1 | -1 = 1;

  public triggerBlastKnock(intensity = 1): void {
    this.blastKnock = Math.max(this.blastKnock, intensity);
  }

  public triggerSpin(turns = 1, sign: 1 | -1 = 1): void {
    this.spinTarget = Math.PI * 2 * turns;
    this.spinSign = sign;
    this.spinT = 0;
  }

  public isSpinning(): boolean {
    return this.spinTarget > 0 && this.spinT < 1;
  }

  public update(
    dt: number,
    sprite: Sprite | null,
    walking: boolean,
    footAnchorY: number,
    bob: WalkBobConfig,
    attackPose = 0,
    isAttacking = false,
    attackWindup = 0.2,
    attackT = 0,
  ): void {
    if (!sprite || sprite.destroyed || !sprite.anchor) return;

    let ox = 0;
    let oy = 0;
    let orot = 0;
    const spinning = this.isSpinning();
    const canBob = walking && !spinning && this.blastKnock < 0.15;

    if (canBob) {
      this.walkPhase += (Math.PI * 2 * dt) / bob.period;
      const step = Math.sin(this.walkPhase * 2);
      const sway = Math.cos(this.walkPhase);
      this.walkPoseY = -Math.abs(step) * bob.ampY;
      this.walkPoseX = sway * bob.ampX;
      this.walkPoseRot = sway * bob.ampRot;
    } else {
      const k = 1 - Math.exp(-bob.settle * dt);
      this.walkPoseX += (0 - this.walkPoseX) * k;
      this.walkPoseY += (0 - this.walkPoseY) * k;
      this.walkPoseRot += (0 - this.walkPoseRot) * k;
      if (Math.abs(this.walkPoseX) < 0.05) this.walkPoseX = 0;
      if (Math.abs(this.walkPoseY) < 0.05) this.walkPoseY = 0;
      if (Math.abs(this.walkPoseRot) < 0.001) this.walkPoseRot = 0;
      if (
        this.walkPoseX === 0 &&
        this.walkPoseY === 0 &&
        this.walkPoseRot === 0
      ) {
        this.walkPhase = 0;
      }
    }

    ox += this.walkPoseX;
    oy += this.walkPoseY;
    orot += this.walkPoseRot;

    if (attackPose > 0.01 && isAttacking) {
      const a = attackPose;
      if (attackT < attackWindup) {
        ox += -10 * a;
        oy += 4 * a;
        orot += -0.28 * a;
      } else {
        ox += 14 * a;
        oy += -6 * a;
        orot += 0.35 * a;
      }
    }

    if (this.blastKnock > 0) {
      const b = this.blastKnock;
      oy += -BLAST_CONFIG.lift * b;
      if (!spinning) {
        orot += -BLAST_CONFIG.lean * b - BLAST_CONFIG.tumble * b * b;
      }
      ox += -6 * b;

      this.blastKnock *= Math.exp(-BLAST_CONFIG.settle * dt);
      if (this.blastKnock < 0.03) this.blastKnock = 0;
    }

    if (spinning) {
      this.spinT = Math.min(1, this.spinT + dt / AIR_SPIN_CONFIG.duration);
      const u = this.spinT;
      const eased = 1 - (1 - u) * (1 - u);
      orot += this.spinSign * this.spinTarget * eased;
      const loft = 4 * u * (1 - u);
      oy += -AIR_SPIN_CONFIG.lift * loft;

      if (this.spinT >= 1) {
        this.spinTarget = 0;
        this.spinT = 0;
      }
    }

    if (spinning) {
      const sy = Math.abs(sprite.scale.y) || 1;
      const toCenterY =
        (ANCHOR_CENTER_Y - footAnchorY) * sprite.texture.height * sy;
      sprite.anchor.set(0.5, ANCHOR_CENTER_Y);
      sprite.x = ox;
      sprite.y = oy + toCenterY;
    } else {
      sprite.anchor.set(0.5, footAnchorY);
      sprite.x = ox;
      sprite.y = oy;
    }
    sprite.rotation = orot;
  }
}
