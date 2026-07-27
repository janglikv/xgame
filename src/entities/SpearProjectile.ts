import { Container, Sprite, Texture } from 'pixi.js';
import { getActiveMapDef } from '../data/maps';
import { bodyHitsTrees } from '../world/WorldMap';
import {
  loadOutlinedTexture,
  OUTLINE_PX_SPEAR,
} from '../utils/outlineTexture';

const SPEAR_URL = '/assets/ice-ranger/spear.png';

/** 飞行速度（世界像素/秒） */
export const SPEAR_SPEED = 640;
/**
 * 普攻 / 剑阵发射 / 出场自动瞄准：最远飞行与索敌距离（世界像素）。
 * 到距后钉住消散；地图边界不挡，但有效射程统一由此常量收束。
 */
export const SPEAR_MAX_RANGE = 620;
/**
 * 碰撞体：与树等障碍的 solid 半径。
 * 只负责钉树，不参与伤害判定；地图边界不再阻挡飞剑。
 */
export const SPEAR_BODY_R = 10;
/** 飞出地图半幅再额外此距离后回收（兜底，正常由 maxRange 收束） */
const OFF_MAP_CULL_PAD = 120;
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

/** 剑阵：径向减速就位时长（秒） */
const FORMATION_DEPLOY_DURATION = 0.32;
/** 剑阵：就位后停顿再发射（秒） */
const FORMATION_HOLD_DURATION = 0.1;
/** 剑阵：加速发射初速（像素/秒） */
const FORMATION_LAUNCH_START_SPEED = 60;
/** 剑阵：加速发射最大速度（像素/秒） */
const FORMATION_LAUNCH_MAX_SPEED = 900;
/** 剑阵：发射加速度（像素/秒²） */
const FORMATION_LAUNCH_ACCEL = 3200;
/** 剑阵飞剑静止时的最大视觉倍率 */
const FORMATION_MAX_SCALE_MULTIPLIER = 2;

export type SpearPhase = 'flying' | 'holding' | 'stuck' | 'done';

/** 内部运动模式：普攻直线 / 剑阵就位 / 剑阵发射 */
type SpearMotion = 'linear' | 'deploy' | 'launch';

export type SpearHitResult = {
  damage: number;
  knockVelX: number;
  knockVelY: number;
  dirX: number;
  dirY: number;
  poseStrength: number;
  airSpinTurns: number;
};

/** 生成直线矛时的可选参数 */
export type SpearProjectileOptions = {
  originHeight?: number;
  speed?: number;
  /**
   * 最远飞行距离（世界像素）。
   * - 普攻 / 发射段：默认 SPEAR_MAX_RANGE，到距后钉住消散
   * - holdAtRange 剑阵就位：阵位半径；发射时会重置为 SPEAR_MAX_RANGE
   */
  maxRange?: number;
  /** 到达 maxRange 后进入 holding（悬停成阵），默认 false */
  holdAtRange?: boolean;
  /** 贴图缩放，默认 SPEAR_SCALE */
  scale?: number;
  /** 剑阵矛：切角色时可批量清掉；启用减速就位→加速发射 */
  formation?: boolean;
  /**
   * 贴图朝向 / 发射目标的世界落点。
   * 剑阵就位时矛尖指向该点；发射时飞向该点。
   */
  faceWorldX?: number;
  faceWorldY?: number;
  /** 就位时长（秒），仅 formation */
  deployDuration?: number;
  /** 就位后停顿（秒），仅 formation */
  holdDuration?: number;
  /** 发射最大速度，仅 formation */
  launchSpeed?: number;
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
 * 直线长矛投射物。
 * - 普攻：沿固定方向匀速飞行，撞敌/墙钉住。
 * - 剑阵：减速就位 → 短暂停顿 → 朝目标加速发射。
 */
export class SpearProjectile extends Container {
  private readonly sprite: Sprite;
  private dirX: number;
  private dirY: number;
  private readonly speed: number;
  private readonly originHeight: number;
  /** 当前段最远距离（就位半径或普攻/发射射程；发射时会改写） */
  private maxRange: number;
  private readonly holdAtRange: boolean;
  private readonly visualScale: number;
  /** 剑阵矛标记（供战斗系统批量清理） */
  readonly isFormation: boolean;
  /** 贴图朝向 / 发射落点；null = 跟飞行方向 */
  private faceWorld: { x: number; y: number } | null;

  private motion: SpearMotion;
  private readonly spawnX: number;
  private readonly spawnY: number;
  private readonly deployDuration: number;
  private readonly holdDuration: number;
  private readonly launchMaxSpeed: number;
  private deployElapsed = 0;
  private holdElapsed = 0;
  private currentSpeed = 0;

  private phase: SpearPhase = 'flying';
  private stuckElapsed = 0;
  private hitResolved = false;
  /** 已飞行路程（世界像素）；linear / launch 用 */
  private traveled = 0;

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
    options: SpearProjectileOptions = {},
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
    this.holdAtRange = options.holdAtRange === true;
    // 剑阵就位必须用传入半径；普攻默认 SPEAR_MAX_RANGE
    this.maxRange =
      options.maxRange !== undefined && options.maxRange > 0
        ? options.maxRange
        : SPEAR_MAX_RANGE;
    this.visualScale = options.scale ?? SPEAR_SCALE;
    this.isFormation = options.formation === true;
    this.faceWorld =
      options.faceWorldX !== undefined && options.faceWorldY !== undefined
        ? { x: options.faceWorldX, y: options.faceWorldY }
        : null;

    this.spawnX = startX;
    this.spawnY = startY;
    this.groundX = startX;
    this.groundY = startY;
    this.flightHeight = this.originHeight;

    // 剑阵 + 就位：减速展开；否则普攻匀速
    if (this.isFormation && this.holdAtRange && this.maxRange < Number.POSITIVE_INFINITY) {
      this.motion = 'deploy';
      this.deployDuration = Math.max(
        0.05,
        options.deployDuration ?? FORMATION_DEPLOY_DURATION,
      );
      this.holdDuration = Math.max(
        0,
        options.holdDuration ?? FORMATION_HOLD_DURATION,
      );
      this.launchMaxSpeed = Math.max(
        80,
        options.launchSpeed ?? FORMATION_LAUNCH_MAX_SPEED,
      );
    } else {
      this.motion = 'linear';
      this.deployDuration = FORMATION_DEPLOY_DURATION;
      this.holdDuration = FORMATION_HOLD_DURATION;
      this.launchMaxSpeed = this.speed;
      this.currentSpeed = this.speed;
    }

    this.sprite = new Sprite(sharedSpear);
    this.sprite.anchor.set(0.5, 0.5);
    this.sprite.label = 'SpearSprite';
    this.addChild(this.sprite);
    this.applySpeedScale();
    this.applyFacingRotation();
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
    // 飞行与悬停阵型均可命中
    if (this.phase !== 'flying' && this.phase !== 'holding') return false;
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
    if (this.phase !== 'flying' && this.phase !== 'holding') return;
    this.phase = 'stuck';
    this.stuckElapsed = 0;
  }

  /** 强制结束（切角色时清理剑阵） */
  forceDone(): void {
    this.phase = 'done';
  }

  update(deltaMS: number): SpearPhase {
    const dt = deltaMS / 1000;

    if (this.phase === 'flying') {
      if (this.motion === 'deploy') {
        this.updateDeploy(dt);
      } else if (this.motion === 'launch') {
        this.updateLaunch(dt);
      } else {
        this.updateLinear(dt);
      }
    } else if (this.phase === 'holding') {
      this.updateHolding(dt);
    } else if (this.phase === 'stuck') {
      this.stuckElapsed += dt;
      const p = Math.min(1, this.stuckElapsed / STUCK_LIFE);
      this.sprite.alpha = 1 - p;
      this.sprite.scale.set(this.visualScale * (1 - 0.15 * p));
      if (p >= 1) {
        this.phase = 'done';
      }
    }

    // 飞行/悬停：刷新矛尖朝向
    if (this.phase === 'flying' || this.phase === 'holding') {
      this.applySpeedScale();
      this.applyFacingRotation();
    }

    return this.phase;
  }

  syncToWorld(): void {
    this.position.set(this.groundX, this.groundY - this.flightHeight);
    this.zIndex = this.groundY + this.flightHeight * 0.01;
  }

  /**
   * 剑阵就位：ease-out 减速落到阵位（快出慢停）。
   */
  private updateDeploy(dt: number): void {
    this.deployElapsed += dt;
    const u = Math.min(1, this.deployElapsed / this.deployDuration);
    // ease-out cubic：初速快、到位时接近 0
    const eased = 1 - (1 - u) * (1 - u) * (1 - u);
    const dist = this.maxRange * eased;
    // ease-out cubic 的瞬时速度，用于同步飞剑视觉缩放
    this.currentSpeed =
      (this.maxRange * 3 * (1 - u) * (1 - u)) / this.deployDuration;
    const nx = this.spawnX + this.dirX * dist;
    const ny = this.spawnY + this.dirY * dist;

    if (this.isBlocked(nx, ny)) {
      this.phase = 'stuck';
      this.stuckElapsed = 0;
      return;
    }

    this.groundX = nx;
    this.groundY = ny;
    this.traveled = dist;

    if (u >= 1) {
      // 精确钉在阵位
      this.groundX = this.spawnX + this.dirX * this.maxRange;
      this.groundY = this.spawnY + this.dirY * this.maxRange;
      this.traveled = this.maxRange;
      this.phase = 'holding';
      this.holdElapsed = 0;
    }
  }

  /** 阵位停顿，结束后朝目标加速发射 */
  private updateHolding(dt: number): void {
    this.holdElapsed += dt;
    if (this.holdElapsed < this.holdDuration) return;
    this.beginLaunch();
  }

  /** 从阵位转向目标，进入加速飞行 */
  private beginLaunch(): void {
    let lx = this.dirX;
    let ly = this.dirY;
    if (this.faceWorld) {
      const dx = this.faceWorld.x - this.groundX;
      const dy = this.faceWorld.y - this.groundY;
      const len = Math.hypot(dx, dy);
      if (len > 1e-4) {
        lx = dx / len;
        ly = dy / len;
      }
    }
    this.dirX = lx;
    this.dirY = ly;
    // 发射后沿飞行方向朝向（不再每帧锁死施法时指针点，避免飞过目标后倒转）
    this.faceWorld = null;
    this.motion = 'launch';
    this.phase = 'flying';
    this.traveled = 0;
    // 就位半径用完后，发射段改用普攻射程上限
    this.maxRange = SPEAR_MAX_RANGE;
    this.currentSpeed = FORMATION_LAUNCH_START_SPEED;
  }

  /** 加速直线飞行（发射段） */
  private updateLaunch(dt: number): void {
    this.currentSpeed = Math.min(
      this.launchMaxSpeed,
      this.currentSpeed + FORMATION_LAUNCH_ACCEL * dt,
    );
    this.advanceAlongDir(this.currentSpeed * dt, false);
  }

  /** 普攻：匀速直线，可 holdAtRange 悬停 */
  private updateLinear(dt: number): void {
    this.advanceAlongDir(this.speed * dt, this.holdAtRange);
  }

  /**
   * 沿 dir 推进距离 remain。
   * @param canHold 到 maxRange 时悬停成阵；否则到距钉住消散
   */
  private advanceAlongDir(remain: number, canHold: boolean): void {
    while (remain > 1e-4 && this.phase === 'flying') {
      const step = Math.min(MAX_STEP, remain);
      remain -= step;

      if (this.traveled + step >= this.maxRange) {
        const left = this.maxRange - this.traveled;
        if (left > 1e-4) {
          const nx = this.groundX + this.dirX * left;
          const ny = this.groundY + this.dirY * left;
          if (this.isBlocked(nx, ny)) {
            this.phase = 'stuck';
            this.stuckElapsed = 0;
            break;
          }
          this.groundX = nx;
          this.groundY = ny;
        }
        this.traveled = this.maxRange;
        if (canHold) {
          this.phase = 'holding';
        } else {
          // 最远射程：钉住消散（可飞出陆地，但不无限飞）
          this.phase = 'stuck';
          this.stuckElapsed = 0;
        }
        break;
      }

      const nx = this.groundX + this.dirX * step;
      const ny = this.groundY + this.dirY * step;

      if (this.isBlocked(nx, ny)) {
        this.phase = 'stuck';
        this.stuckElapsed = 0;
        break;
      }

      this.groundX = nx;
      this.groundY = ny;
      this.traveled += step;

      // 兜底：飞出地图外缘过远时回收
      if (this.isFarOffMap(this.groundX, this.groundY)) {
        this.phase = 'done';
        break;
      }
    }
  }

  /** 矛尖旋转：优先指向 faceWorld，否则沿飞行方向 */
  private applyFacingRotation(): void {
    let fx = this.dirX;
    let fy = this.dirY;
    if (this.faceWorld) {
      const dx = this.faceWorld.x - this.groundX;
      const dy = this.faceWorld.y - this.groundY;
      const len = Math.hypot(dx, dy);
      if (len > 1e-4) {
        fx = dx / len;
        fy = dy / len;
      }
    }
    this.sprite.rotation = Math.atan2(fy, fx) - SPEAR_TEX_ANGLE;
  }

  /** 剑阵飞剑越慢越大：静止为 2 倍，达到发射上限时恢复基础尺寸 */
  private applySpeedScale(): void {
    if (!this.isFormation) {
      this.sprite.scale.set(this.visualScale);
      return;
    }
    const speedRatio = Math.min(1, this.currentSpeed / this.launchMaxSpeed);
    const multiplier =
      FORMATION_MAX_SCALE_MULTIPLIER -
      (FORMATION_MAX_SCALE_MULTIPLIER - 1) * speedRatio;
    this.sprite.scale.set(this.visualScale * multiplier);
  }

  /** 仅树等障碍钉住；地图边界不挡飞剑 */
  private isBlocked(x: number, y: number): boolean {
    return bodyHitsTrees(x, y, SPEAR_BODY_R);
  }

  /** 超出地图半幅 + pad 后视为飞出视野，回收实体 */
  private isFarOffMap(x: number, y: number): boolean {
    const h = getActiveMapDef().mapSize / 2 + OFF_MAP_CULL_PAD;
    return x < -h || x > h || y < -h || y > h;
  }
}
