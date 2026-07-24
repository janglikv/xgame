import { Container, Sprite, Texture } from 'pixi.js';
import { bodyHitsTrees, MAP_WORLD_HALF } from '../world/WorldMap';
import {
  loadOutlinedTexture,
  OUTLINE_PX_SPEAR,
} from '../utils/outlineTexture';

const SPEAR_URL = '/assets/ice-ranger/spear.png';

/** 飞行速度（世界像素/秒） */
export const SPEAR_SPEED = 640;
/**
 * 碰撞体：与墙体 / 树 / 地图边界的 solid 半径。
 * 只负责穿模与钉墙，不参与伤害判定。
 */
export const SPEAR_BODY_R = 10;
/**
 * 攻击体：对敌人的命中半径（与 BODY 独立）。
 * 实际判定 = SPEAR_HIT_R + 目标 hurtbox 半径。
 */
export const SPEAR_HIT_R = 12;
/** 命中伤害 */
export const SPEAR_DAMAGE = 24;
/** 命中击飞初速度（像素/秒） */
export const SPEAR_KNOCK_SPEED = 160;
/** 姿态反馈强度 */
export const SPEAR_POSE = 0.28;
/** 贴图缩放（相对原生成图缩小约 3 倍） */
export const SPEAR_SCALE = 0.11 / 3;
/**
 * 贴图默认矛尖朝向（相对 +X，屏幕 Y 向下）。
 * 资源为左下柄 → 右上尖，约 -45°。
 */
export const SPEAR_TEX_ANGLE = -Math.PI / 4;
/** 穿墙/命中后钉住再消失的时间（秒） */
const STUCK_LIFE = 0.2;
/** 每帧最大步进（避免高速穿模） */
const MAX_STEP = 18;

export type SpearPhase = 'flying' | 'stuck' | 'done';

export type SpearHitResult = {
  damage: number;
  knockVelX: number;
  knockVelY: number;
  dirX: number;
  dirY: number;
  poseStrength: number;
  airSpinTurns: number;
};

let sharedSpear: Texture | null = null;

export async function loadSpearTexture(): Promise<void> {
  if (sharedSpear) return;
  const outlined = await loadOutlinedTexture(SPEAR_URL, OUTLINE_PX_SPEAR);
  sharedSpear = outlined.texture;
}

/** 已加载的矛贴图（手持特效等复用）；未 load 时为 null */
export function getSpearTexture(): Texture | null {
  return sharedSpear;
}

/**
 * 直线长矛投射物：沿固定方向匀速飞行，
 * 碰到敌人 / 树墙 / 地图边界后钉住并销毁。
 */
export class SpearProjectile extends Container {
  private readonly sprite: Sprite;
  private readonly dirX: number;
  private readonly dirY: number;
  private readonly speed: number;
  private readonly originHeight: number;

  private phase: SpearPhase = 'flying';
  private stuckElapsed = 0;
  private hitResolved = false;

  /** 地面投影坐标 */
  groundX: number;
  groundY: number;
  /** 离地高度（直线飞行保持恒定；勿用 height，与 Container 冲突） */
  flightHeight: number;

  constructor(
    startX: number,
    startY: number,
    dirX: number,
    dirY: number,
    options: { originHeight?: number; speed?: number } = {},
  ) {
    super();
    this.label = 'SpearProjectile';

    if (!sharedSpear) {
      throw new Error('Spear texture not loaded — call loadSpearTexture() first');
    }

    const len = Math.hypot(dirX, dirY);
    if (len < 1e-6) {
      this.dirX = 1;
      this.dirY = 0;
    } else {
      this.dirX = dirX / len;
      this.dirY = dirY / len;
    }

    this.speed = options.speed ?? SPEAR_SPEED;
    this.originHeight = Math.max(4, options.originHeight ?? 28);
    this.groundX = startX;
    this.groundY = startY;
    this.flightHeight = this.originHeight;

    this.sprite = new Sprite(sharedSpear);
    this.sprite.anchor.set(0.5, 0.5);
    this.sprite.scale.set(SPEAR_SCALE);
    this.sprite.rotation = Math.atan2(this.dirY, this.dirX) - SPEAR_TEX_ANGLE;
    this.sprite.label = 'SpearSprite';
    this.addChild(this.sprite);
  }

  getPhase(): SpearPhase {
    return this.phase;
  }

  get flightDir(): { x: number; y: number } {
    return { x: this.dirX, y: this.dirY };
  }

  /**
   * 对圆目标做一次命中检测（飞行中）。
   * @param targetX/Y 受击圆心（含偏移），勿传 solid 脚底 unless 无偏移
   * @param targetHurtR 目标受击半径（hurtbox），勿传 solid BODY
   */
  hitsTarget(targetX: number, targetY: number, targetHurtR: number): boolean {
    if (this.phase !== 'flying') return false;
    const dx = targetX - this.groundX;
    const dy = targetY - this.groundY;
    const r = SPEAR_HIT_R + Math.max(0, targetHurtR);
    return dx * dx + dy * dy <= r * r;
  }

  /** 飞行中是否命中任意 hurt 形状（圆/矩形），由外部用 profile 判定时可用 ground 点 */
  get hitProbe(): { x: number; y: number; r: number } {
    return { x: this.groundX, y: this.groundY, r: SPEAR_HIT_R };
  }

  /** 命中敌人时的击飞 / 伤害结算 */
  buildHit(): SpearHitResult {
    return {
      damage: SPEAR_DAMAGE,
      knockVelX: this.dirX * SPEAR_KNOCK_SPEED,
      knockVelY: this.dirY * SPEAR_KNOCK_SPEED,
      dirX: this.dirX,
      dirY: this.dirY,
      poseStrength: SPEAR_POSE,
      airSpinTurns: 0,
    };
  }

  /** 本帧是否刚进入 stuck（用于结算命中） */
  consumeHitResolve(): boolean {
    if (this.phase !== 'stuck' || this.hitResolved) return false;
    this.hitResolved = true;
    return true;
  }

  /** 外部在命中敌人后调用，进入钉住消散 */
  stick(): void {
    if (this.phase !== 'flying') return;
    this.phase = 'stuck';
    this.stuckElapsed = 0;
  }

  update(deltaMS: number): SpearPhase {
    const dt = deltaMS / 1000;

    if (this.phase === 'flying') {
      let remain = this.speed * dt;
      while (remain > 1e-4 && this.phase === 'flying') {
        const step = Math.min(MAX_STEP, remain);
        remain -= step;
        const nx = this.groundX + this.dirX * step;
        const ny = this.groundY + this.dirY * step;

        if (this.isBlocked(nx, ny)) {
          // 贴到障碍前最后一格可走点
          this.phase = 'stuck';
          this.stuckElapsed = 0;
          break;
        }

        this.groundX = nx;
        this.groundY = ny;
      }
    } else if (this.phase === 'stuck') {
      this.stuckElapsed += dt;
      const p = Math.min(1, this.stuckElapsed / STUCK_LIFE);
      this.sprite.alpha = 1 - p;
      this.sprite.scale.set(SPEAR_SCALE * (1 - 0.15 * p));
      if (p >= 1) {
        this.phase = 'done';
      }
    }

    return this.phase;
  }

  syncToWorld(): void {
    this.position.set(this.groundX, this.groundY - this.flightHeight);
    this.zIndex = this.groundY + this.flightHeight * 0.01;
  }

  private isBlocked(x: number, y: number): boolean {
    const h = MAP_WORLD_HALF - 4;
    if (x < -h || x > h || y < -h || y > h) return true;
    return bodyHitsTrees(x, y, SPEAR_BODY_R);
  }
}
