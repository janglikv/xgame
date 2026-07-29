import { Container, Sprite } from 'pixi.js';
import type { GrassSize } from '../data/maps/types';
import {
  GRASS_GROWTH_TIME_SEC,
  GRASS_SIZE_PROFILE,
  GRASS_SPREAD_TIME_SEC,
  grassBodyShapeScale,
  nextGrassSize,
} from '../data/grassProfiles';
import {
  getGrassTexture,
  GRASS_SPRITE_ANCHOR,
} from '../world/grassTextures';

/** 小草淡入时长（秒）：从小透明到正常，不明显放大 */
const GRASS_EMERGE_SEC = 1.4;

export type GrassEntityOptions = {
  size?: GrassSize;
  tint?: number;
  grassId?: string;
  /** 是否允许自动生长 / 扩散，默认 true */
  enableGrowth?: boolean;
  /**
   * 体型上限（泥地稀草 = small；草地可 null 表示不限）。
   * 到上限后停止进阶。
   */
  maxSize?: GrassSize | null;
  /**
   * 是否从小透明淡入（避免突然闪现；不明显放大）。
   * 默认：小草 true，中/大草 false。
   */
  emerge?: boolean;
  /** 自定义生长倒计时（秒） */
  growthTimeSec?: number;
  /** 自定义扩散倒计时（秒） */
  spreadTimeSec?: number;
  /** 生长进阶完成后的回调 */
  onGrown?: (grass: GrassEntity) => void;
  /** 到点向四周播种时的回调（由场景决定落点与是否可种） */
  onSpread?: (grass: GrassEntity) => void;
  /** 被吃掉离场时的回调 */
  onWither?: (grass: GrassEntity) => void;
};

const GRASS_SIZE_RANK: Record<GrassSize, number> = {
  small: 0,
  medium: 1,
  large: 2,
};

/** 镜头可视区（世界坐标） */
export type GrassViewBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

export type GrassUpdateOptions = {
  view?: GrassViewBounds | null;
  /** 全景 LOD：不摇摆、始终显示 */
  lodFar?: boolean;
  /** 本帧是否推进扩散（分片轮转）；生长每帧推进以保证平滑放大 */
  runLogic?: boolean;
  /** 逻辑 dt 倍率（分片数，仅用于扩散） */
  logicScale?: number;
  /** 土地减速/加速倍率（如泥地休耕下草生长减速） */
  speedup?: number;
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(lerp(ar, br, t));
  const g = Math.round(lerp(ag, bg, t));
  const bl = Math.round(lerp(ab, bb, t));
  return (r << 16) | (g << 8) | bl;
}

/**
 * 关卡内草地：共享烘焙 Sprite。
 * 生长：在阶段时间内从当前体型 scale/tint 平滑过渡到下一阶段，不再突变。
 */
export class GrassEntity extends Container {
  worldX: number;
  worldY: number;
  size: GrassSize;
  bodyShapeScale: number;
  readonly grassId: string;

  private readonly sprite: Sprite;
  private swayT = Math.random() * Math.PI * 2;
  private baseTint: number;

  private enableGrowth: boolean;
  /** 体型上限；null = 不限 */
  private maxSize: GrassSize | null = null;
  /** 本阶段剩余生长时间（秒） */
  private growthTimer: number | null = null;
  /** 本阶段总时长（秒），用于进度 0→1 */
  private growthDuration = 0;
  private spreadTimer: number | null = null;
  private isWithering = false;
  private witherAnimT = 0;
  private grazeLockT = 0;
  /** 破土冒出：剩余时间；null 表示不在冒出 */
  private emergeTimer: number | null = null;
  private emergeDuration = GRASS_EMERGE_SEC;
  private onGrown?: (grass: GrassEntity) => void;
  private onSpread?: (grass: GrassEntity) => void;
  private onWither?: (grass: GrassEntity) => void;

  /** 当前是否挂在「参与角色深度排序」的层 */
  sortedForDepth = false;

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
    this.maxSize = options.maxSize ?? null;
    this.onGrown = options.onGrown;
    this.onSpread = options.onSpread;
    this.onWither = options.onWither;
    this.resetGrowthTimer(options.growthTimeSec);
    this.resetSpreadTimer(options.spreadTimeSec);

    // 小草默认淡入；中/大草读档不重播
    const wantEmerge = options.emerge ?? size === 'small';
    if (wantEmerge) {
      const jitter = 0.9 + Math.random() * 0.35;
      this.emergeDuration = GRASS_EMERGE_SEC * jitter;
      this.emergeTimer = this.emergeDuration;
    }

    this.baseTint = options.tint ?? profile.tint;
    this.sprite = new Sprite(getGrassTexture());
    this.sprite.label = 'GrassSprite';
    this.sprite.anchor.set(GRASS_SPRITE_ANCHOR.x, GRASS_SPRITE_ANCHOR.y);
    this.sprite.scale.set(profile.scale);
    this.sprite.tint = this.baseTint;
    this.sprite.eventMode = 'none';
    this.sprite.cullable = true;
    this.addChild(this.sprite);

    this.syncToWorld(false);
    this.applyGrowthVisual();
  }

  /** 是否已达体型上限（不能再长大） */
  get isAtMaxSize(): boolean {
    if (!this.maxSize) return false;
    return GRASS_SIZE_RANK[this.size] >= GRASS_SIZE_RANK[this.maxSize];
  }

  /**
   * 设置体型上限（泥地稀草 → small；离开泥地 → null）。
   * 已超过上限的体型不会自动缩小，只阻止继续长大。
   */
  setMaxSize(max: GrassSize | null): void {
    this.maxSize = max;
    if (this.isAtMaxSize) {
      this.growthTimer = null;
      this.growthDuration = 0;
    } else if (this.enableGrowth && this.growthTimer === null) {
      this.resetGrowthTimer();
    }
  }

  private canGrowTo(next: GrassSize): boolean {
    if (!this.maxSize) return true;
    return GRASS_SIZE_RANK[next] <= GRASS_SIZE_RANK[this.maxSize];
  }

  private resetGrowthTimer(customSec?: number): void {
    if (!this.enableGrowth || this.isAtMaxSize) {
      this.growthTimer = null;
      this.growthDuration = 0;
      return;
    }
    const next = nextGrassSize(this.size);
    if (next && !this.canGrowTo(next)) {
      this.growthTimer = null;
      this.growthDuration = 0;
      return;
    }
    const baseSec = customSec ?? GRASS_GROWTH_TIME_SEC[this.size];
    if (baseSec === null) {
      this.growthTimer = null;
      this.growthDuration = 0;
    } else {
      const jitter = (Math.random() - 0.5) * 1.2 * baseSec;
      const dur = Math.max(3, baseSec + jitter);
      this.growthDuration = dur;
      this.growthTimer = dur;
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
      const jitter = (Math.random() - 0.5) * 1.2 * baseSec;
      this.spreadTimer = Math.max(4, baseSec + jitter);
    }
  }

  get isGrazable(): boolean {
    return this.grazeLockT <= 0 && !this.isWithering;
  }

  get isWitheringOut(): boolean {
    return this.isWithering;
  }

  /** 本阶段生长进度 0→1（已完成或无需生长则为 1） */
  private growthProgress01(): number {
    if (this.growthTimer === null || this.growthDuration <= 0) return 1;
    const done = 1 - this.growthTimer / this.growthDuration;
    return Math.min(1, Math.max(0, done));
  }

  private applySize(size: GrassSize): void {
    this.size = size;
    const profile = GRASS_SIZE_PROFILE[size];
    this.bodyShapeScale = grassBodyShapeScale(size);
    this.baseTint = profile.tint;
    this.sprite.tint = this.baseTint;
    this.sprite.scale.set(profile.scale);
  }

  /** 淡入进度 0→1（未在淡入则为 1） */
  private emergeProgress01(): number {
    if (this.emergeTimer === null || this.emergeDuration <= 0) return 1;
    return Math.min(
      1,
      Math.max(0, 1 - this.emergeTimer / this.emergeDuration),
    );
  }

  /**
   * 按生长进度插值 scale / tint；新小草仅淡入（保持小体型，不明显放大）。
   */
  private applyGrowthVisual(): void {
    if (this.destroyed || this.isWithering) return;
    const next = nextGrassSize(this.size);
    const from = GRASS_SIZE_PROFILE[this.size];
    let baseScale = from.scale;
    let tint = this.baseTint;
    if (next && this.canGrowTo(next) && this.growthTimer !== null) {
      const to = GRASS_SIZE_PROFILE[next];
      // 阶段生长：缓慢放大到下一档（长周期，观感是「一点一点长」）
      const u = this.growthProgress01();
      baseScale = lerp(from.scale, to.scale, u);
      tint = lerpColor(from.tint, to.tint, u);
    }

    // 出现：只做小透明 → 不透明，体型保持小草尺度
    const e = this.emergeProgress01();
    this.sprite.scale.set(baseScale);
    this.sprite.tint = tint;
    this.sprite.alpha = e;
  }

  /** 完成一阶段：体型进阶 + 开始下一阶段生长计时 */
  grow(): boolean {
    const next = nextGrassSize(this.size);
    if (!next || !this.canGrowTo(next)) {
      this.growthTimer = null;
      this.growthDuration = 0;
      return false;
    }

    this.applySize(next);
    this.resetGrowthTimer();
    this.resetSpreadTimer();
    this.applyGrowthVisual();
    this.onGrown?.(this);
    return true;
  }

  graze(): GrassSize | null {
    if (this.grazeLockT > 0 || this.isWithering) return null;
    const before = this.size;
    this.wither();
    return before;
  }

  syncToWorld(withSway = true): void {
    if (this.destroyed) return;
    if (withSway) {
      const sway = Math.sin(this.swayT * 2.5) * 0.6;
      this.position.set(this.worldX + sway, this.worldY);
    } else {
      this.position.set(this.worldX, this.worldY);
    }
    this.zIndex = this.worldY;
  }

  wither(): void {
    if (this.isWithering) return;
    this.isWithering = true;
    this.witherAnimT = 0.8;
    this.visible = true;
  }

  inView(view: GrassViewBounds | null | undefined): boolean {
    if (!view) return true;
    return (
      this.worldX >= view.minX &&
      this.worldX <= view.maxX &&
      this.worldY >= view.minY &&
      this.worldY <= view.maxY
    );
  }

  /**
   * @param opts.lodFar 全景：全显示、无摇摆
   * @param opts.runLogic 本帧是否跑扩散
   * @param opts.logicScale 扩散时间倍率（= 分片数）
   */
  update(deltaMS: number, opts: GrassUpdateOptions = {}): void {
    if (this.destroyed) return;
    const speedup = Math.max(0.1, opts.speedup ?? 1.0);
    const dt = (deltaMS / 1000) * speedup;
    const lodFar = opts.lodFar ?? false;
    const runLogic = opts.runLogic ?? true;
    const logicScale = opts.logicScale ?? 1;
    const view = opts.view;

    if (this.grazeLockT > 0) {
      this.grazeLockT = Math.max(0, this.grazeLockT - dt);
    }

    if (this.isWithering) {
      this.visible = true;
      this.swayT += dt;
      this.syncToWorld(!lodFar);
      this.witherAnimT = Math.max(0, this.witherAnimT - dt);
      if (!this.destroyed) {
        const ratio = this.witherAnimT / 0.8;
        this.sprite.alpha = ratio;
        this.sprite.tint = 0x8a7238;
      }
      if (this.witherAnimT <= 0) {
        this.onWither?.(this);
      }
      return;
    }

    // 淡入：每帧推进
    if (this.emergeTimer !== null) {
      this.emergeTimer -= dt;
      if (this.emergeTimer <= 0) {
        this.emergeTimer = null;
      }
    }

    // 生长：每帧推进，保证 scale 连续放大（不依赖分片）
    if (this.growthTimer !== null) {
      this.growthTimer -= dt;
      if (this.growthTimer <= 0) {
        this.grow();
      }
    }

    // 扩散仍可分片
    if (runLogic && this.spreadTimer !== null) {
      this.spreadTimer -= dt * logicScale;
      if (this.spreadTimer <= 0) {
        this.onSpread?.(this);
        this.resetSpreadTimer();
      }
    }

    if (lodFar) {
      this.visible = true;
      this.syncToWorld(false);
      this.applyGrowthVisual();
      return;
    }

    const visible = this.inView(view);
    this.visible = visible;
    if (!visible) {
      // 屏外仍推进淡入/生长逻辑，进视野再同步显示
      return;
    }

    this.swayT += dt;
    this.syncToWorld(true);
    this.applyGrowthVisual();
  }
}
