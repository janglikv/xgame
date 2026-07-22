import { PlayerCharacterBase } from './PlayerCharacterBase';

/**
 * 投矛后仰（sprite 局部）。
 * textureFlipX=-1 时正 X / 正旋转 = 朝投掷反方向后仰。
 */
const THROW = {
  lean: 0.28,
  push: 18,
  crouch: 5,
  settle: 10,
} as const;

/**
 * 出手点：相对脚底锚点的贴图像素偏移（贴图未镜像时）。
 * 冰霜游侠偏正面；持矛手取身体左侧略高处，随朝向镜像。
 */
const THROW_HAND_TEX = {
  x: -160,
  y: -210,
} as const;

/**
 * 冰霜游侠：直线投矛。
 * 原点在脚底中心附近。
 */
export class IceRanger extends PlayerCharacterBase {
  private throwRecoil = 0;

  constructor(scale = 1) {
    super(
      {
        characterId: 'ice-ranger',
        label: 'IceRanger',
        spriteLabel: 'IceRangerSprite',
        previewUrl: '/assets/ice-ranger/preview.png',
        textureFlipX: -1,
        canThrowBomb: false,
        canThrowSpear: true,
      },
      scale,
    );
  }

  /**
   * 投矛出手点（世界坐标）。
   * @param feetX 脚底世界 X
   * @param feetY 脚底世界 Y（不含击飞高度）
   */
  getThrowOrigin(feetX: number, feetY: number): {
    x: number;
    y: number;
    height: number;
  } {
    const dx = THROW_HAND_TEX.x * this.scale.x;
    const lift = -THROW_HAND_TEX.y * this.scale.y;
    return {
      x: feetX + dx,
      y: feetY,
      height: Math.max(4, lift),
    };
  }

  /** 投矛瞬间：身体后仰一下再回正 */
  playThrowRecoil(): void {
    this.throwRecoil = 1;
  }

  protected override applyExtraPose(dt: number): {
    x: number;
    y: number;
    rot: number;
  } {
    if (this.throwRecoil <= 0) {
      return { x: 0, y: 0, rot: 0 };
    }

    const r = this.throwRecoil;
    const delta = {
      x: THROW.push * r,
      y: THROW.crouch * r,
      rot: THROW.lean * r,
    };

    this.throwRecoil *= Math.exp(-THROW.settle * dt);
    if (this.throwRecoil < 0.02) this.throwRecoil = 0;

    return delta;
  }

  protected override canResetBobPhase(): boolean {
    return this.throwRecoil <= 0;
  }

  protected override onBlastKnock(): void {
    this.throwRecoil = 0;
  }
}
