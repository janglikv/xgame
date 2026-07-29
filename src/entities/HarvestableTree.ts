import { Container, Graphics } from 'pixi.js';
import {
  TREE_BODY_PROFILE_ID,
  type BodyProfileId,
} from '../data/bodyProfiles';
import type { TreeKind, TreeSize } from '../data/maps/types';
import {
  TREE_GROWTH_TIME_SEC,
  TREE_SIZE_PROFILE,
  TREE_SPREAD_TIME_SEC,
  nextTreeSize,
  treeBodyShapeScale,
  treeHurtR,
  treeSolidR,
} from '../data/treeProfiles';
import { HealthBar } from '../ui/HealthBar';
import { drawPineLocal } from '../world/PineTree';
import { drawAppleTreeLocal } from '../world/AppleTree';

/** 树苗淡入时长（秒） */
const TREE_EMERGE_SEC = 1.4;

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

/** 近战单次伤害 */
export const HARVEST_MELEE_DAMAGE = 12;
/** 飞剑命中伤害（与 SPEAR 量级接近，略低） */
export const HARVEST_SPEAR_DAMAGE = 10;
/** 炸弹命中基础伤害 */
export const HARVEST_BOMB_DAMAGE = 18;

export { TREE_SIZE_PROFILE };

export type HarvestableTreeOptions = {
  size?: TreeSize;
  kind?: TreeKind;
  maxHp?: number;
  /** 掉落木头数量；缺省按体型 */
  woodDrop?: number;
  /** 视觉色调（夜景偏冷） */
  tint?: number;
  /** 树 id（砍伐后移除 solid） */
  treeId?: string;
  /** 是否允许自动生长 / 扩散，默认 true */
  enableGrowth?: boolean;
  /** 是否从透明淡入（树苗默认 true） */
  emerge?: boolean;
  /** 自定义生长倒计时（秒） */
  growthTimeSec?: number;
  /** 自定义播种扩散倒计时（秒） */
  spreadTimeSec?: number;
  /** 生长进阶完成后的回调 */
  onGrown?: (tree: HarvestableTree) => void;
  /** 到点向四周播种树苗时的回调 */
  onSpread?: (tree: HarvestableTree) => void;
  /** 苹果熟透/震落掉到地面的回调 */
  onAppleDrop?: (worldX: number, worldY: number) => void;
};

/**
 * 关卡内可交互树：小树苗 / 中树 / 大树（松树或苹果树）。
 * 特点：与草类似，支持平滑生长与播种扩散逻辑；大苹果树会结果，熟透后苹果掉落地面成为拾取物。
 */
export class HarvestableTree extends Container {
  worldX: number;
  worldY: number;
  size: TreeSize;
  readonly treeKind: TreeKind;
  /** 始终为 TREE_BODY_PROFILE_ID */
  readonly bodyProfileId: BodyProfileId;
  /** 相对中树的形状缩放 */
  bodyShapeScale: number;
  /** 受击近似半径（模板 × 体型缩放） */
  hurtR: number;
  /** 近战交互半径 */
  interactR: number;
  woodDrop: number;
  /** 树 id；空串表示无 solid 绑定 */
  readonly treeId: string;

  private maxHp: number;
  private hp: number;
  private readonly healthBar: HealthBar;
  private readonly gfx: Graphics;
  private readonly sparkleGfx: Graphics;
  private shakeT = 0;
  private felled = false;
  private baseTint: number;

  private enableGrowth: boolean;
  private growthTimer: number | null = null;
  private growthDuration = 0;
  private spreadTimer: number | null = null;
  private emergeTimer: number | null = null;
  private emergeDuration = TREE_EMERGE_SEC;
  private growthAnimT = 0;
  private onGrown?: (tree: HarvestableTree) => void;
  private onSpread?: (tree: HarvestableTree) => void;
  private onAppleDrop?: (worldX: number, worldY: number) => void;

  constructor(
    worldX: number,
    worldY: number,
    options: HarvestableTreeOptions = {},
  ) {
    super();
    this.label = 'HarvestableTree';
    this.eventMode = 'none';
    this.worldX = worldX;
    this.worldY = worldY;

    const size: TreeSize =
      options.size === 'sapling' ||
      options.size === 'medium' ||
      options.size === 'large'
        ? options.size
        : 'medium';
    this.size = size;
    this.treeKind = options.kind === 'apple' ? 'apple' : 'pine';
    this.bodyProfileId = TREE_BODY_PROFILE_ID;
    this.bodyShapeScale = treeBodyShapeScale(size);
    const profile = TREE_SIZE_PROFILE[size];

    this.maxHp = options.maxHp ?? profile.maxHp;
    this.hp = this.maxHp;
    this.woodDrop = Math.max(1, options.woodDrop ?? profile.woodDrop);
    this.treeId = options.treeId ?? '';
    this.hurtR = treeHurtR(size);
    this.interactR = profile.interactR;

    this.enableGrowth = options.enableGrowth ?? true;
    this.onGrown = options.onGrown;
    this.onSpread = options.onSpread;
    this.onAppleDrop = options.onAppleDrop;
    this.resetGrowthTimer(options.growthTimeSec);
    this.resetSpreadTimer(options.spreadTimeSec);

    const wantEmerge = options.emerge ?? size === 'sapling';
    if (wantEmerge) {
      const jitter = 0.85 + Math.random() * 0.3;
      this.emergeDuration = TREE_EMERGE_SEC * jitter;
      this.emergeTimer = this.emergeDuration;
    }

    this.baseTint = options.tint ?? profile.tint;
    this.gfx = new Graphics();
    this.gfx.label = 'HarvestTreeGfx';
    this.gfx.scale.set(profile.scale);
    this.gfx.tint = this.baseTint;
    this.addChild(this.gfx);

    this.sparkleGfx = new Graphics();
    this.sparkleGfx.label = 'GrowthSparkle';
    this.sparkleGfx.visible = false;
    this.addChild(this.sparkleGfx);

    this.healthBar = new HealthBar({
      maxHp: this.maxHp,
      width: profile.hpBarW,
      height: 5,
    });
    this.healthBar.setHealth(this.maxHp);
    this.healthBar.position.set(0, profile.hpBarY);
    this.healthBar.visible = false;
    this.addChild(this.healthBar);

    this.initAppleState();
    this.redrawTreeGfx();
    this.syncToWorld();
    this.applyGrowthVisual();
  }

  get isAlive(): boolean {
    return !this.felled && this.hp > 0;
  }

  get currentHp(): number {
    return this.hp;
  }

  private appleCount = 0;
  private appleFruitTimer = 0;

  private initAppleState(): void {
    if (this.treeKind !== 'apple') return;
    if (this.size === 'large') {
      // 大树初始悬挂 2~3 个鲜红大苹果
      this.appleCount = 2 + Math.floor(Math.random() * 2);
      this.appleFruitTimer = 6 + Math.random() * 6;
    } else {
      this.appleCount = 0;
      this.appleFruitTimer = 0;
    }
  }

  private redrawTreeGfx(): void {
    this.gfx.clear();
    if (this.treeKind === 'apple') {
      drawAppleTreeLocal(this.gfx, 1, this.appleCount);
    } else {
      drawPineLocal(this.gfx, 1);
    }
  }

  /**
   * 苹果落地坐标：落在树干 solid 外一圈，避免猪/玩家顶着树干抽搐。
   */
  private rollAppleDropPos(): { x: number; y: number } {
    const solid = treeSolidR(this.size);
    const dist = solid + 22 + Math.random() * 16;
    const ang = Math.random() * Math.PI * 2;
    return {
      x: this.worldX + Math.cos(ang) * dist,
      y: this.worldY + Math.sin(ang) * dist * 0.72 + 4,
    };
  }

  private resetGrowthTimer(customSec?: number): void {
    if (!this.enableGrowth) {
      this.growthTimer = null;
      this.growthDuration = 0;
      return;
    }
    const baseSec = customSec ?? TREE_GROWTH_TIME_SEC[this.size];
    if (baseSec === null) {
      this.growthTimer = null;
      this.growthDuration = 0;
    } else {
      const jitter = (Math.random() - 0.5) * 0.4 * baseSec;
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
    const baseSec = customSec ?? TREE_SPREAD_TIME_SEC[this.size];
    if (baseSec === null) {
      this.spreadTimer = null;
    } else {
      const jitter = (Math.random() - 0.5) * 0.4 * baseSec;
      this.spreadTimer = Math.max(5, baseSec + jitter);
    }
  }

  /** 生长进度 0→1 */
  private growthProgress01(): number {
    if (this.growthTimer === null || this.growthDuration <= 0) return 1;
    const done = 1 - this.growthTimer / this.growthDuration;
    return Math.min(1, Math.max(0, done));
  }

  /** 淡入进度 0→1 */
  private emergeProgress01(): number {
    if (this.emergeTimer === null || this.emergeDuration <= 0) return 1;
    return Math.min(
      1,
      Math.max(0, 1 - this.emergeTimer / this.emergeDuration),
    );
  }

  /**
   * 平滑插值生长尺寸与色彩 (Lerp Growth Visual)
   */
  private applyGrowthVisual(): void {
    if (this.destroyed || !this.isAlive) return;
    const next = nextTreeSize(this.size);
    const from = TREE_SIZE_PROFILE[this.size];
    let baseScale = from.scale;
    let tint = this.baseTint;

    if (next && this.growthTimer !== null) {
      const to = TREE_SIZE_PROFILE[next];
      const u = this.growthProgress01();
      baseScale = lerp(from.scale, to.scale, u);
      tint = lerpColor(from.tint, to.tint, u);
    }

    const e = this.emergeProgress01();
    this.gfx.scale.set(baseScale);
    this.gfx.tint = tint;
    this.gfx.alpha = e;
  }

  /** 手动或倒计时触发生长 */
  grow(): boolean {
    const next = nextTreeSize(this.size);
    if (!next || !this.isAlive) return false;

    this.size = next;
    const profile = TREE_SIZE_PROFILE[next];

    this.bodyShapeScale = treeBodyShapeScale(next);
    this.hurtR = treeHurtR(next);
    this.interactR = profile.interactR;
    this.woodDrop = profile.woodDrop;
    this.baseTint = profile.tint;

    // 按比例提升 HP
    const oldMax = this.maxHp;
    this.maxHp = profile.maxHp;
    this.hp = Math.min(this.maxHp, Math.round((this.hp / oldMax) * this.maxHp));
    this.healthBar.setHealth(this.hp);
    this.healthBar.position.set(0, profile.hpBarY);

    this.resetGrowthTimer();
    this.resetSpreadTimer();
    this.initAppleState();
    this.redrawTreeGfx();
    this.applyGrowthVisual();

    // 触发生长动画与闪光
    this.growthAnimT = 0.5;
    this.onGrown?.(this);
    return true;
  }

  /** 脚底坐标写到显示与 zIndex */
  syncToWorld(): void {
    const shake =
      this.shakeT > 0 ? Math.sin(this.shakeT * 48) * 2.2 * this.shakeT : 0;
    this.position.set(this.worldX + shake, this.worldY);
    this.zIndex = this.worldY;
  }

  update(deltaMS: number): void {
    if (this.destroyed) return;
    const dt = deltaMS / 1000;
    if (this.shakeT > 0) {
      this.shakeT = Math.max(0, this.shakeT - dt);
      this.syncToWorld();
    }

    // 树苗淡入
    if (this.emergeTimer !== null) {
      this.emergeTimer -= dt;
      if (this.emergeTimer <= 0) {
        this.emergeTimer = null;
      }
    }

    // 自动平滑生长计时
    if (this.isAlive && this.growthTimer !== null) {
      this.growthTimer -= dt;
      if (this.growthTimer <= 0) {
        this.grow();
      }
    }

    // 自动播种扩散计时
    if (this.isAlive && this.spreadTimer !== null) {
      this.spreadTimer -= dt;
      if (this.spreadTimer <= 0) {
        this.onSpread?.(this);
        this.resetSpreadTimer();
      }
    }

    // 大苹果树生长结红苹果逻辑
    if (this.isAlive && this.treeKind === 'apple' && this.size === 'large') {
      this.appleFruitTimer -= dt;
      if (this.appleFruitTimer <= 0) {
        this.appleFruitTimer = 7 + Math.random() * 5;
        if (this.appleCount < 3) {
          this.appleCount++;
          this.redrawTreeGfx();
        } else {
          const drop = this.rollAppleDropPos();
          this.onAppleDrop?.(drop.x, drop.y);
        }
      }
    }

    // 生长过渡/进阶弹跳补间动画
    const profile = TREE_SIZE_PROFILE[this.size];
    if (this.growthAnimT > 0) {
      this.growthAnimT = Math.max(0, this.growthAnimT - dt);
      const progress = 1 - this.growthAnimT / 0.5;
      const bounce = Math.sin(progress * Math.PI) * 0.28;
      const currentScale = profile.scale * (1 + bounce);
      this.gfx.scale.set(currentScale);

      this.sparkleGfx.visible = true;
      this.sparkleGfx.clear();
      const radius = (12 + progress * 24) * profile.scale;
      const alpha = Math.sin((1 - progress) * Math.PI) * 0.85;
      this.sparkleGfx
        .circle(0, profile.hpBarY * 0.4, radius)
        .stroke({ width: 3, color: 0x88ff66, alpha });
    } else {
      this.applyGrowthVisual();
      this.sparkleGfx.visible = false;
    }

    this.healthBar.update(deltaMS);
  }

  /**
   * 造成伤害。震动时若树上有苹果，震落 1 个到地上。
   * @returns 是否仍存活；false 表示本击摧毁
   */
  applyDamage(amount: number): boolean {
    if (!this.isAlive) return false;
    const dmg = Math.max(0, Math.abs(amount));
    if (dmg <= 0) return true;

    this.hp = Math.max(0, this.hp - dmg);
    this.healthBar.setHealth(this.hp);
    this.healthBar.visible = true;
    this.shakeT = 0.18;

    // 受击摇晃：震落 1 个红苹果
    if (this.treeKind === 'apple' && this.appleCount > 0) {
      this.appleCount--;
      this.redrawTreeGfx();
      const drop = this.rollAppleDropPos();
      this.onAppleDrop?.(drop.x, drop.y);
    }

    if (this.hp <= 0) {
      this.felled = true;
      return false;
    }
    return true;
  }
}

