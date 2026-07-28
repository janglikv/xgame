import { Container, Graphics } from 'pixi.js';
import type { GrassSize } from '../data/maps/types';
import {
  GRASS_GROWTH_TIME_SEC,
  GRASS_SIZE_PROFILE,
  grassBodyShapeScale,
  nextGrassSize,
} from '../data/grassProfiles';
import { drawGrassLocal } from '../world/GrassPatch';

export type GrassEntityOptions = {
  size?: GrassSize;
  tint?: number;
  grassId?: string;
  /** 是否允许自动生长，默认 true */
  enableGrowth?: boolean;
  /** 自定义生长倒计时（秒） */
  growthTimeSec?: number;
  /** 生长进阶完成后的回调 */
  onGrown?: (grass: GrassEntity) => void;
};

/**
 * 关卡内草地：小草 / 中草 / 大草。
 * 支持生长逻辑：小草 ➔ 中草 ➔ 大草，完全无碰撞体。
 */
export class GrassEntity extends Container {
  worldX: number;
  worldY: number;
  size: GrassSize;
  bodyShapeScale: number;
  readonly grassId: string;

  private readonly gfx: Graphics;
  private readonly sparkleGfx: Graphics;
  private swayT = Math.random() * Math.PI * 2;

  private enableGrowth: boolean;
  private growthTimer: number | null = null;
  private growthAnimT = 0;
  private onGrown?: (grass: GrassEntity) => void;

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
    this.resetGrowthTimer(options.growthTimeSec);

    this.gfx = new Graphics();
    this.gfx.label = 'GrassGfx';
    drawGrassLocal(this.gfx, 0);
    this.gfx.scale.set(profile.scale);
    this.gfx.tint = options.tint ?? profile.tint;
    this.addChild(this.gfx);

    this.sparkleGfx = new Graphics();
    this.sparkleGfx.label = 'GrassSparkle';
    this.sparkleGfx.visible = false;
    this.addChild(this.sparkleGfx);

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
      const jitter = (Math.random() - 0.5) * 0.3 * baseSec;
      this.growthTimer = Math.max(2, baseSec + jitter);
    }
  }

  /** 手动或倒计时触发生长 */
  grow(): boolean {
    const next = nextGrassSize(this.size);
    if (!next) return false;

    this.size = next;
    const profile = GRASS_SIZE_PROFILE[next];
    this.bodyShapeScale = grassBodyShapeScale(next);
    this.gfx.tint = profile.tint;
    this.resetGrowthTimer();

    // 触发生长动效
    this.growthAnimT = 0.4;
    this.onGrown?.(this);
    return true;
  }

  /** 脚底坐标写到显示与 zIndex */
  syncToWorld(): void {
    const sway = Math.sin(this.swayT * 2.5) * 0.6;
    this.position.set(this.worldX + sway, this.worldY);
    this.zIndex = this.worldY;
  }

  update(deltaMS: number): void {
    const dt = deltaMS / 1000;
    this.swayT += dt;
    this.syncToWorld();

    // 自动生长计时
    if (this.growthTimer !== null) {
      this.growthTimer -= dt;
      if (this.growthTimer <= 0) {
        this.grow();
      }
    }

    // 生长过渡动画
    const profile = GRASS_SIZE_PROFILE[this.size];
    if (this.growthAnimT > 0) {
      this.growthAnimT = Math.max(0, this.growthAnimT - dt);
      const progress = 1 - this.growthAnimT / 0.4;
      const bounce = Math.sin(progress * Math.PI) * 0.32;
      const currentScale = profile.scale * (1 + bounce);
      this.gfx.scale.set(currentScale);

      this.sparkleGfx.visible = true;
      this.sparkleGfx.clear();
      const radius = (8 + progress * 16) * profile.scale;
      const alpha = Math.sin((1 - progress) * Math.PI) * 0.8;
      this.sparkleGfx
        .circle(0, -6 * profile.scale, radius)
        .stroke({ width: 2.5, color: 0x99ff66, alpha });
    } else {
      this.gfx.scale.set(profile.scale);
      this.sparkleGfx.visible = false;
    }
  }
}
