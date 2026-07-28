import { Container, Graphics } from 'pixi.js';
import type { GrassSize } from '../data/maps/types';
import {
  GRASS_GROWTH_TIME_SEC,
  GRASS_LIFESPAN_BASE_SEC,
  GRASS_SIZE_PROFILE,
  GRASS_SPREAD_TIME_SEC,
  grassBodyShapeScale,
  nextGrassSize,
  prevGrassSize,
} from '../data/grassProfiles';
import { drawGrassLocal } from '../world/GrassPatch';

export type GrassEntityOptions = {
  size?: GrassSize;
  tint?: number;
  grassId?: string;
  /** 是否允许自动生长 / 扩散 / 自然老化，默认 true */
  enableGrowth?: boolean;
  /** 自定义生长倒计时（秒） */
  growthTimeSec?: number;
  /** 自定义扩散倒计时（秒） */
  spreadTimeSec?: number;
  /** 生长进阶完成后的回调 */
  onGrown?: (grass: GrassEntity) => void;
  /** 到点向四周播种时的回调（由场景决定落点与是否可种） */
  onSpread?: (grass: GrassEntity) => void;
  /** 自然老死或过密枯萎时的回调 */
  onWither?: (grass: GrassEntity) => void;
};

/**
 * 关卡内草地：小草 / 中草 / 大草。
 * 支持生长：小草 ➔ 中草 ➔ 大草；周期性播种；带有自然寿命与过密枯萎倒计时。
 * 完全无碰撞体。
 */
export class GrassEntity extends Container {
  worldX: number;
  worldY: number;
  size: GrassSize;
  bodyShapeScale: number;
  readonly grassId: string;

  private readonly gfx: Graphics;
  private swayT = Math.random() * Math.PI * 2;

  private enableGrowth: boolean;
  private growthTimer: number | null = null;
  private spreadTimer: number | null = null;
  private lifeTimer = 100;
  private isWithering = false;
  private witherAnimT = 0;
  private growthAnimT = 0;
  /** 被啃后的冷却（秒），期间不可再啃 */
  private grazeLockT = 0;
  private onGrown?: (grass: GrassEntity) => void;
  private onSpread?: (grass: GrassEntity) => void;
  private onWither?: (grass: GrassEntity) => void;

  constructor(
    worldX: number,
    worldY: number,
    options: GrassEntityOptions = {},
  ) {
    super();
    this.label = 'GrassEntity';
    this.eventMode = 'none';
    this.worldX = worldX;
    this.worldY = worldY;

    const size: GrassSize =
      options.size === 'small' ||
      options.size === 'medium' ||
      options.size === 'large'
        ? options.size
        : 'medium';
    this.size = size;
    this.bodyShapeScale = grassBodyShapeScale(size);
    const profile = GRASS_SIZE_PROFILE[size];

    this.grassId = options.grassId ?? '';
    this.enableGrowth = options.enableGrowth ?? true;
    this.onGrown = options.onGrown;
    this.onSpread = options.onSpread;
    this.onWither = options.onWither;
    this.resetGrowthTimer(options.growthTimeSec);
    this.resetSpreadTimer(options.spreadTimeSec);

    // 大幅拉大随机寿命离散度 (0.4 ~ 1.6 倍基础寿命，打破批量同生同灭)
    const baseLife = GRASS_LIFESPAN_BASE_SEC[size] ?? 100;
    this.lifeTimer = baseLife * (0.4 + Math.random() * 1.2);

    this.gfx = new Graphics();
    this.gfx.label = 'GrassGfx';
    drawGrassLocal(this.gfx, 0);
    this.gfx.scale.set(profile.scale);
    this.gfx.tint = options.tint ?? profile.tint;
    this.addChild(this.gfx);

    this.syncToWorld();
  }

  private resetGrowthTimer(customSec?: number): void {
    if (!this.enableGrowth) {
      this.growthTimer = null;
      return;
    }
    const baseSec = customSec ?? GRASS_GROWTH_TIME_SEC[this.size];
    if (baseSec === null) {
      this.growthTimer = null;
    } else {
      // 扩大生长抖动至 ±60%，使同一批草的生长时间完全交错
      const jitter = (Math.random() - 0.5) * 1.2 * baseSec;
      this.growthTimer = Math.max(3, baseSec + jitter);
    }
  }

  private resetSpreadTimer(customSec?: number): void {
    if (!this.enableGrowth) {
      this.spreadTimer = null;
      return;
    }
    const baseSec = customSec ?? GRASS_SPREAD_TIME_SEC[this.size];
    if (baseSec === null) {
      this.spreadTimer = null;
    } else {
      // 扩大播种抖动至 ±60%，错开播种节奏
      const jitter = (Math.random() - 0.5) * 1.2 * baseSec;
      this.spreadTimer = Math.max(4, baseSec + jitter);
    }
  }

  /** 是否可被牛马啃食（冷却中不可） */
  get isGrazable(): boolean {
    return this.grazeLockT <= 0;
  }

  private applySize(size: GrassSize): void {
    this.size = size;
    const profile = GRASS_SIZE_PROFILE[size];
    this.bodyShapeScale = grassBodyShapeScale(size);
    this.gfx.tint = profile.tint;
    this.gfx.scale.set(profile.scale);
  }

  /** 手动或倒计时触发生长 */
  grow(): boolean {
    const next = nextGrassSize(this.size);
    if (!next) return false;

    this.applySize(next);
    this.resetGrowthTimer();
    this.resetSpreadTimer();

    // 触发生长动效
    this.growthAnimT = 0.4;
    this.onGrown?.(this);
    return true;
  }

  /**
   * 被啃食：体型大→中→小，小草只抖一下不消失。
   * @returns 啃之前的体型（用于回饱量）
   */
  graze(): GrassSize | null {
    if (this.grazeLockT > 0) return null;
    const before = this.size;
    const smaller = prevGrassSize(this.size);
    if (smaller) {
      this.applySize(smaller);
    }
    // 冷却 + 回弹动画；小草也会被「轻啃」后慢慢再长
    this.grazeLockT = 5.5 + Math.random() * 1.5;
    this.growthAnimT = 0.35;
    this.resetGrowthTimer();
    // 保留播种倒计时，不因被啃食而打断扩展进程
    this.onGrown?.(this);
    return before;
  }

  /** 脚底坐标写到显示与 zIndex */
  syncToWorld(): void {
    const sway = Math.sin(this.swayT * 2.5) * 0.6;
    this.position.set(this.worldX + sway, this.worldY);
    this.zIndex = this.worldY;
  }

  /** 触发枯萎老死流程 */
  wither(): void {
    if (this.isWithering) return;
    this.isWithering = true;
    this.witherAnimT = 0.8;
  }

  /**
   * 当处在过密环境时，加速消耗寿命（带空间离散耐受系数，避免同一区域过密草集体蒸发）
   * @param factor 消耗速率倍率（如 3.5）
   */
  applyOvercrowded(factor: number, dt: number): void {
    if (this.isWithering || !this.enableGrowth) return;
    // 加入 0.5 ~ 1.5 随机离散耐受系数
    const randomTolerance = 0.5 + Math.sin(this.worldX * 0.08 + this.worldY * 0.08 + this.swayT) * 0.5 + 0.5;
    this.lifeTimer -= dt * (factor - 1) * randomTolerance;
  }

  update(deltaMS: number): void {
    const dt = deltaMS / 1000;
    this.swayT += dt;
    this.syncToWorld();

    if (this.grazeLockT > 0) {
      this.grazeLockT = Math.max(0, this.grazeLockT - dt);
    }

    // 枯萎中淡出动画
    if (this.isWithering) {
      this.witherAnimT = Math.max(0, this.witherAnimT - dt);
      const ratio = this.witherAnimT / 0.8; // 1 -> 0
      this.gfx.alpha = ratio;
      // 发黄干枯变色
      this.gfx.tint = 0x8a7238;
      if (this.witherAnimT <= 0) {
        this.onWither?.(this);
      }
      return;
    }

    // 自然寿命衰减
    if (this.enableGrowth) {
      this.lifeTimer -= dt;
      if (this.lifeTimer <= 0) {
        this.wither();
        return;
      }
    }

    // 自动生长计时
    if (this.growthTimer !== null) {
      this.growthTimer -= dt;
      if (this.growthTimer <= 0) {
        this.grow();
      }
    }

    // 向四周扩散播种
    if (this.spreadTimer !== null) {
      this.spreadTimer -= dt;
      if (this.spreadTimer <= 0) {
        this.onSpread?.(this);
        this.resetSpreadTimer();
      }
    }

    // 生长过渡动画（自然缩放弹跳）
    const profile = GRASS_SIZE_PROFILE[this.size];
    if (this.growthAnimT > 0) {
      this.growthAnimT = Math.max(0, this.growthAnimT - dt);
      const progress = 1 - this.growthAnimT / 0.4;
      const bounce = Math.sin(progress * Math.PI) * 0.32;
      const currentScale = profile.scale * (1 + bounce);
      this.gfx.scale.set(currentScale);
    } else {
      this.gfx.scale.set(profile.scale);
    }
  }
}
