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

/** 被炸飞时的姿态反馈（高度由场景 knock 抛物线负责，这里只留轻微余量） */
const BLAST = {
  lean: 0.55,
  lift: 8,
  tumble: 0.9,
  settle: 5.5,
} as const;

/** 大弹空中旋转两圈（额外抬升交给世界高度抛物线） */
const AIR_SPIN = {
  /** 转完两圈的时长（秒） */
  duration: 0.62,
  /** 旋转期间额外局部抬升（主高度已在轨迹里） */
  lift: 0,
} as const;

/** 脚底锚点 / 中心锚点（旋转时切到中心） */
const ANCHOR_FOOT_Y = 0.92;
const ANCHOR_CENTER_Y = 0.5;

/**
 * 寒冰射手（整图预览）
 * 原点在脚底中心附近。
 */
export class FrostArcher extends Container {
  private sprite: Sprite | null = null;
  private readonly baseScale: number;
  /** 镜头缩放倍率（与地图 zoom 同步） */
  private viewScale = 1;
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
  /** 被炸飞姿态强度 0→1+ */
  private blastKnock = 0;
  /** 空中旋转进度 0→1；>0 时播放多圈旋转 */
  private spinT = 0;
  /** 目标旋转弧度（如 2 圈 = 4π） */
  private spinTarget = 0;
  /** 旋转方向（与击飞水平方向一致） */
  private spinSign: 1 | -1 = 1;

  constructor(scale = 1) {
    super();
    this.label = 'FrostArcher';
    this.baseScale = scale;
    this.applyContainerScale();
  }

  async load(): Promise<void> {
    if (this.sprite) return;

    const texture = await Assets.load(PREVIEW_URL);
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, ANCHOR_FOOT_Y);
    sprite.label = 'FrostArcherSprite';
    this.sprite = sprite;
    this.addChild(sprite);
  }

  /** 与镜头 zoom 同步，保证缩全景时角色相对地图正确 */
  setViewScale(zoom: number): void {
    const z = Math.max(1e-4, zoom);
    if (Math.abs(z - this.viewScale) < 1e-6) return;
    this.viewScale = z;
    this.applyContainerScale();
  }

  private applyContainerScale(): void {
    const s = this.baseScale * this.viewScale;
    this.scale.x = s * this.facing;
    this.scale.y = s;
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
    this.applyContainerScale();
  }

  /** 扔炸弹瞬间触发：身体后仰一下再回正 */
  playThrowRecoil(): void {
    this.throwRecoil = 1;
  }

  /**
   * 被爆炸崩飞时的姿态：抬起 + 翻仰；大弹可空中转多圈。
   * @param strength 0~1，距爆心越近越大
   * @param dirX 击退水平方向（世界），用于转身 / 旋转方向
   * @param airSpinTurns 空中旋转圈数（大弹为 2）
   */
  playBlastKnock(strength: number, dirX = 0, airSpinTurns = 0): void {
    this.throwRecoil = 0;
    this.blastKnock = Math.max(this.blastKnock, Math.min(1.25, strength));
    if (dirX !== 0) this.setFacingFromMoveX(dirX);

    if (airSpinTurns > 0) {
      this.spinT = 0;
      this.spinTarget = airSpinTurns * Math.PI * 2;
      this.spinSign = dirX < 0 ? -1 : 1;
    }
  }

  /** 是否在空中翻滚（走路晃动应关闭） */
  get isAirSpinning(): boolean {
    return this.spinT > 0 && this.spinT < 1;
  }

  /**
   * 每帧更新。移动时图片上下晃 + 轻微摇摆，停下回正；可叠加扔弹后仰 / 被炸。
   * @param deltaMS 帧间隔毫秒
   * @param moving 是否在移动
   */
  update(deltaMS: number, moving: boolean): void {
    const sprite = this.sprite;
    if (!sprite) return;

    const dt = deltaMS / 1000;
    const spinning = this.spinTarget > 0 && this.spinT < 1;
    const tumbling = this.blastKnock > 0.15 || spinning;

    if (moving && !tumbling) {
      this.bobPhase += (Math.PI * 2 * dt) / BOB.period;
      // 双频：一步两拍弹跳
      const step = Math.sin(this.bobPhase * 2);
      const sway = Math.sin(this.bobPhase);

      this.poseY = -Math.abs(step) * BOB.ampY;
      this.poseX = sway * BOB.ampX;
      this.poseRot = sway * BOB.ampRot;
    } else if (!tumbling) {
      // 走路姿态指数回正（与后仰分开存，避免叠算）
      const k = 1 - Math.exp(-BOB.settle * dt);
      this.poseX += (0 - this.poseX) * k;
      this.poseY += (0 - this.poseY) * k;
      this.poseRot += (0 - this.poseRot) * k;

      if (Math.abs(this.poseX) < 0.05) this.poseX = 0;
      if (Math.abs(this.poseY) < 0.05) this.poseY = 0;
      if (Math.abs(this.poseRot) < 0.001) this.poseRot = 0;

      if (
        this.poseX === 0 &&
        this.poseY === 0 &&
        this.throwRecoil <= 0 &&
        this.blastKnock <= 0 &&
        !spinning
      ) {
        this.bobPhase = 0;
      }
    }

    // 后仰 / 被炸叠在走路姿态上
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

    if (this.blastKnock > 0) {
      const b = this.blastKnock;
      // 普通被炸：抬起、后仰；大弹转圈时主要用 spin 旋转，这里只保留抬升
      oy += -BLAST.lift * b;
      if (!spinning) {
        orot += -BLAST.lean * b - BLAST.tumble * b * b;
      }
      ox += -8 * b;

      this.blastKnock *= Math.exp(-BLAST.settle * dt);
      if (this.blastKnock < 0.03) this.blastKnock = 0;
    }

    // 大弹：约 0.62s 内转满 spinTarget（默认两圈），绕身体中心旋转
    if (this.spinTarget > 0 && this.spinT < 1) {
      this.spinT = Math.min(1, this.spinT + dt / AIR_SPIN.duration);
      // ease-out：先快后慢
      const u = this.spinT;
      const eased = 1 - (1 - u) * (1 - u);
      orot += this.spinSign * this.spinTarget * eased;
      // 抛物线抬升：中间最高
      const loft = 4 * u * (1 - u);
      oy += -AIR_SPIN.lift * loft;

      if (this.spinT >= 1) {
        this.spinTarget = 0;
        this.spinT = 0;
      }
    }

    // 转圈时锚点切到中心，脚底原点改算到身体中心，避免绕脚甩
    if (spinning || (this.spinTarget > 0 && this.spinT > 0)) {
      const h = sprite.texture.height;
      // 脚底 → 中心的本地偏移（贴图像素；父级 scale 统一缩放）
      const toCenterY = (ANCHOR_CENTER_Y - ANCHOR_FOOT_Y) * h;
      sprite.anchor.set(0.5, ANCHOR_CENTER_Y);
      sprite.x = ox;
      sprite.y = oy + toCenterY;
    } else {
      sprite.anchor.set(0.5, ANCHOR_FOOT_Y);
      sprite.x = ox;
      sprite.y = oy;
    }
    sprite.rotation = orot;
  }
}
