import { PlayerCharacterBase } from './PlayerCharacterBase';

/**
 * 扔炸弹后仰（sprite 局部）。
 * textureFlipX=-1 时 scale.x 为负，正 X / 正旋转 才是“朝向反方向”后仰。
 */
const THROW = {
  /** 后仰角度（弧度） */
  lean: 0.32,
  /** 身体向后挪的像素 */
  push: 22,
  /** 略蹲一点 */
  crouch: 6,
  /** 回正速度 */
  settle: 9,
} as const;

/**
 * 扔弹出手点：相对脚底锚点的贴图像素偏移（贴图未镜像时）。
 * 炸弹妹持弹手在贴图左侧；改 x/y 可微调到手心。
 * - x：贴图坐标，左负右正
 * - y：贴图坐标，上负下正（脚底锚点附近 y≈0）
 */
const THROW_HAND_TEX = {
  x: -180,
  y: -230,
} as const;

/**
 * 玩家角色：橙发炸弹妹（整图预览）
 * 原点在脚底中心附近；可扔炸弹。
 */
export class BombGirl extends PlayerCharacterBase {
  /**
   * 扔炸弹后仰强度 0→1；1 为最大后仰，每帧衰减。
   * 作用在 sprite 局部，翻转后仍相对朝向“向后”。
   */
  private throwRecoil = 0;

  constructor(scale = 1) {
    super(
      {
        characterId: 'bomb-girl',
        label: 'BombGirl',
        spriteLabel: 'BombGirlSprite',
        previewUrl: '/assets/bomb-girl/preview.png',
        textureFlipX: -1,
        canThrowBomb: true,
      },
      scale,
    );
  }

  /**
   * 扔弹出手点（世界坐标，与角色同层）。
   * 地面投影 + 离地高度，已含朝向翻转与角色缩放。
   * @param feetX 脚底世界 X
   * @param feetY 脚底世界 Y（不含击飞高度）
   */
  getThrowOrigin(feetX: number, feetY: number): {
    x: number;
    y: number;
    height: number;
  } {
    // scale.x 已含 facing × textureFlipX，贴图左侧出手点会随朝向镜像
    const dx = THROW_HAND_TEX.x * this.scale.x;
    const lift = -THROW_HAND_TEX.y * this.scale.y;
    return {
      x: feetX + dx,
      y: feetY,
      height: Math.max(4, lift),
    };
  }

  /** 扔炸弹瞬间触发：身体后仰一下再回正 */
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
    // 与 textureFlipX 配套：正号 = 视觉上朝投掷反方向后仰
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
