import { Assets, Container, Sprite } from 'pixi.js';

const PREVIEW_URL = '/assets/frost-archer/preview.png';

/** 走路晃动参数（作用在 sprite 局部，不改世界坐标） */
const BOB = {
  /** 完整一步的周期（秒） */
  period: 0.28,
  /** 上下弹跳像素（相对原图像素） */
  ampY: 14,
  /** 左右微摆像素 */
  ampX: 4,
  /** 旋转幅度（弧度） */
  ampRot: 0.06,
  /** 停步时回正速度 */
  settle: 12,
} as const;

/** 扔炸弹后仰（局部空间：负 X / 负旋转 = 朝向反方向仰） */
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
 * 寒冰射手（整图预览）
 * 原点在脚底中心附近。
 */
export class FrostArcher extends Container {
  private sprite: Sprite | null = null;
  private readonly baseScale: number;
  /** 1 = 朝右，-1 = 朝左 */
  private facing: 1 | -1 = 1;
  /** 走路相位 */
  private bobPhase = 0;
  /** 不含扔弹后仰的姿态（走路晃 / 回正） */
  private poseX = 0;
  private poseY = 0;
  private poseRot = 0;
  /**
   * 扔炸弹后仰强度 0→1；1 为最大后仰，每帧衰减。
   * 作用在 sprite 局部，翻转后仍相对朝向“向后”。
   */
  private throwRecoil = 0;

  constructor(scale = 1) {
    super();
    this.label = 'FrostArcher';
    this.baseScale = scale;
    this.scale.set(scale);
  }

  async load(): Promise<void> {
    if (this.sprite) return;

    const texture = await Assets.load(PREVIEW_URL);
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 0.92);
    sprite.label = 'FrostArcherSprite';
    this.sprite = sprite;
    this.addChild(sprite);
  }

  /**
   * 根据水平移动方向左右翻转。
   * @param dirX 负值朝左，正值朝右；0 保持不变
   */
  setFacingFromMoveX(dirX: number): void {
    if (dirX === 0) return;
    const next: 1 | -1 = dirX < 0 ? -1 : 1;
    if (next === this.facing) return;
    this.facing = next;
    this.scale.x = this.baseScale * next;
    this.scale.y = this.baseScale;
  }

  /** 扔炸弹瞬间触发：身体后仰一下再回正 */
  playThrowRecoil(): void {
    this.throwRecoil = 1;
  }

  /**
   * 每帧更新。移动时图片上下晃 + 轻微摇摆，停下回正；可叠加扔弹后仰。
   * @param deltaMS 帧间隔毫秒
   * @param moving 是否在移动
   */
  update(deltaMS: number, moving: boolean): void {
    const sprite = this.sprite;
    if (!sprite) return;

    const dt = deltaMS / 1000;

    if (moving) {
      this.bobPhase += (Math.PI * 2 * dt) / BOB.period;
      // 双频：一步两拍弹跳
      const step = Math.sin(this.bobPhase * 2);
      const sway = Math.sin(this.bobPhase);

      this.poseY = -Math.abs(step) * BOB.ampY;
      this.poseX = sway * BOB.ampX;
      this.poseRot = sway * BOB.ampRot;
    } else {
      // 走路姿态指数回正（与后仰分开存，避免叠算）
      const k = 1 - Math.exp(-BOB.settle * dt);
      this.poseX += (0 - this.poseX) * k;
      this.poseY += (0 - this.poseY) * k;
      this.poseRot += (0 - this.poseRot) * k;

      if (Math.abs(this.poseX) < 0.05) this.poseX = 0;
      if (Math.abs(this.poseY) < 0.05) this.poseY = 0;
      if (Math.abs(this.poseRot) < 0.001) this.poseRot = 0;

      if (this.poseX === 0 && this.poseY === 0 && this.throwRecoil <= 0) {
        this.bobPhase = 0;
      }
    }

    // 后仰叠在走路姿态上：出手拉满，再指数衰减
    let ox = this.poseX;
    let oy = this.poseY;
    let orot = this.poseRot;

    if (this.throwRecoil > 0) {
      const r = this.throwRecoil;
      ox += -THROW.push * r;
      oy += THROW.crouch * r;
      orot += -THROW.lean * r;

      this.throwRecoil *= Math.exp(-THROW.settle * dt);
      if (this.throwRecoil < 0.02) this.throwRecoil = 0;
    }

    sprite.x = ox;
    sprite.y = oy;
    sprite.rotation = orot;
  }
}
