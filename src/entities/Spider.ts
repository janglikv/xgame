import { Assets, Container, Sprite, Texture } from 'pixi.js';
import {
  applyKnockImpulse,
  createKnockArcState,
  stepKnockArc,
  type KnockArcState,
} from './knockArc';
import { HealthBar } from '../ui/HealthBar';

const SPIDER_URL = '/assets/spider/spider.png';

/** 默认相对贴图缩放（与角色 0.07 同量级） */
const DEFAULT_SCALE = 0.1;
/** 默认最大生命 */
const DEFAULT_MAX_HP = 60;
/** 血条相对脚底向上的偏移（未缩放本地像素） */
const HP_BAR_OFFSET_Y = 620;
const HP_BAR_WIDTH = 42;
const HP_BAR_HEIGHT = 5;

/** 被炸飞姿态（作用在 sprite 局部；高度由 knock 抛物线负责） */
const BLAST = {
  lean: 0.5,
  lift: 6,
  tumble: 0.75,
  settle: 5.2,
} as const;

/** 大弹空中旋转两圈（额外抬升交给世界高度抛物线） */
const AIR_SPIN = {
  duration: 0.62,
  lift: 0,
} as const;

/** 脚底锚点 / 中心锚点（旋转时切到中心） */
const ANCHOR_FOOT_Y = 0.88;
const ANCHOR_CENTER_Y = 0.5;

let sharedTexture: Texture | null = null;

export async function loadSpiderTexture(): Promise<void> {
  if (sharedTexture) return;
  sharedTexture = await Assets.load(SPIDER_URL);
}

export type SpiderOptions = {
  scale?: number;
  maxHp?: number;
};

/**
 * 蜘蛛怪物：世界坐标定位，由外部按摄像机同步到屏幕。
 * 原点在身体底部中心；血条为 sibling 子节点，不随朝向翻转。
 */
export class Spider extends Container {
  private sprite: Sprite | null = null;
  private readonly baseScale: number;
  private readonly healthBar: HealthBar;
  private readonly maxHp: number;
  /** 1 = 朝右，-1 = 朝左 */
  private facing: 1 | -1 = 1;
  /** 被炸飞姿态强度 */
  private blastKnock = 0;
  /** 击飞抛物线（地面速度 + 高度） */
  private readonly knock: KnockArcState = createKnockArcState();
  /** 空中旋转进度 0→1 */
  private spinT = 0;
  private spinTarget = 0;
  private spinSign: 1 | -1 = 1;

  /** 世界坐标（与玩家 worldX/Y 同一空间） */
  worldX: number;
  worldY: number;

  constructor(worldX: number, worldY: number, options: SpiderOptions = {}) {
    super();
    this.label = 'Spider';
    this.worldX = worldX;
    this.worldY = worldY;
    this.baseScale = options.scale ?? DEFAULT_SCALE;
    this.maxHp = options.maxHp ?? DEFAULT_MAX_HP;
    this.eventMode = 'none';

    // 血条挂在根节点：只翻转 sprite，血条始终正向
    this.healthBar = new HealthBar({
      maxHp: this.maxHp,
      width: HP_BAR_WIDTH,
      height: HP_BAR_HEIGHT,
    });
    this.healthBar.setHealth(this.maxHp);
    // 屏幕像素尺寸；贴图缩放只作用在 sprite 上
    this.healthBar.position.set(0, -HP_BAR_OFFSET_Y * this.baseScale);
    this.addChild(this.healthBar);
  }

  get currentHp(): number {
    return this.healthBar.currentHp;
  }

  get maximumHp(): number {
    return this.healthBar.maximumHp;
  }

  get isAlive(): boolean {
    return this.healthBar.currentHp > 0;
  }

  async load(): Promise<void> {
    if (this.sprite) return;
    if (!sharedTexture) {
      await loadSpiderTexture();
    }
    if (!sharedTexture) {
      throw new Error('Spider texture failed to load');
    }

    const sprite = new Sprite(sharedTexture);
    // 脚底略偏下：蜘蛛图主体在中部，腿向下伸
    sprite.anchor.set(0.5, ANCHOR_FOOT_Y);
    sprite.label = 'SpiderSprite';
    this.sprite = sprite;
    this.applyFacingToSprite();
    // 先画蜘蛛，血条在上
    this.addChildAt(sprite, 0);
  }

  /**
   * 按摄像机把世界坐标写到屏幕位置。
   * 玩家固定屏幕中心，摄像机原点 = 玩家世界坐标。
   */
  syncToScreen(
    cameraWorldX: number,
    cameraWorldY: number,
    screenCenterX: number,
    screenCenterY: number,
  ): void {
    // 高度抛物线：屏幕向上抬
    this.position.set(
      this.worldX - cameraWorldX + screenCenterX,
      this.worldY - cameraWorldY + screenCenterY - this.knock.height,
    );
  }

  /** 面向某世界点（只翻转贴图，血条不镜像） */
  faceToward(wx: number, _wy: number): void {
    const dx = wx - this.worldX;
    if (dx === 0) return;
    this.facing = dx < 0 ? -1 : 1;
    this.applyFacingToSprite();
  }

  private applyFacingToSprite(): void {
    const sprite = this.sprite;
    if (!sprite) return;
    sprite.scale.x = this.baseScale * this.facing;
    sprite.scale.y = this.baseScale;
  }

  /**
   * 应用炸弹结算结果：扣血 + 世界击退速度 + 姿态 / 空中转圈。
   * 击飞数值由炸弹属性算出，目标侧只负责接收（可再乘抗性）。
   * @param knockScale 击飞抗性，1 = 全吃，0.85 = 略抗
   */
  applyBlastHit(
    hit: {
      damage: number;
      knockVelX: number;
      knockVelY: number;
      dirX: number;
      poseStrength: number;
      airSpinTurns?: number;
    },
    knockScale = 1,
  ): boolean {
    if (!this.isAlive) return false;

    this.healthBar.applyDelta(-Math.abs(hit.damage));

    applyKnockImpulse(this.knock, hit.knockVelX, hit.knockVelY, knockScale);

    this.blastKnock = Math.max(
      this.blastKnock,
      Math.min(1.25, hit.poseStrength),
    );
    if (hit.dirX !== 0) {
      this.facing = hit.dirX < 0 ? -1 : 1;
      this.applyFacingToSprite();
    }

    const turns = hit.airSpinTurns ?? 0;
    if (turns > 0) {
      this.spinT = 0;
      this.spinTarget = turns * Math.PI * 2;
      this.spinSign = hit.dirX < 0 ? -1 : 1;
    }

    return this.isAlive;
  }

  /**
   * 每帧：击退位移 + 姿态 / 空中转圈 + 血条动画。
   * @returns 世界坐标是否变化（需要刷新屏幕位置）
   */
  update(deltaMS: number): boolean {
    const dt = deltaMS / 1000;
    this.healthBar.update(deltaMS);

    let moved = false;
    const knockStep = stepKnockArc(this.knock, dt);
    if (knockStep.moved) {
      this.worldX += knockStep.dx;
      this.worldY += knockStep.dy;
      moved = true;
    }

    const sprite = this.sprite;
    if (sprite) {
      let ox = 0;
      let oy = 0;
      let orot = 0;
      const spinning = this.spinTarget > 0 && this.spinT < 1;

      if (this.blastKnock > 0) {
        const b = this.blastKnock;
        oy += -BLAST.lift * b;
        if (!spinning) {
          orot += -BLAST.lean * b - BLAST.tumble * b * b;
        }
        ox += -6 * b;

        this.blastKnock *= Math.exp(-BLAST.settle * dt);
        if (this.blastKnock < 0.03) this.blastKnock = 0;
      }

      if (this.spinTarget > 0 && this.spinT < 1) {
        this.spinT = Math.min(1, this.spinT + dt / AIR_SPIN.duration);
        const u = this.spinT;
        const eased = 1 - (1 - u) * (1 - u);
        orot += this.spinSign * this.spinTarget * eased;
        const loft = 4 * u * (1 - u);
        oy += -AIR_SPIN.lift * loft;

        if (this.spinT >= 1) {
          this.spinTarget = 0;
          this.spinT = 0;
        }
      }

      // 转圈时绕身体中心转：锚点切到中心，补偿脚底→中心偏移
      // scale 在 sprite 上，父空间偏移 = 锚点差 * 贴图高 * |scale|
      if (spinning) {
        const sy = Math.abs(sprite.scale.y) || 1;
        const toCenterY =
          (ANCHOR_CENTER_Y - ANCHOR_FOOT_Y) * sprite.texture.height * sy;
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

    return moved;
  }
}
