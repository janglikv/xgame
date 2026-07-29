import { Container, Sprite } from 'pixi.js';
import {
  TREE_BODY_PROFILE_ID,
  type BodyProfileId,
} from '../data/bodyProfiles';
import type { TreeKind, TreeSize } from '../data/maps/types';
import {
  TREE_CANOPY_CULL_PAD,
  TREE_GROWTH_TIME_SEC,
  TREE_SIZE_PROFILE,
  TREE_SPREAD_TIME_SEC,
  nextTreeSize,
  treeBodyShapeScale,
  treeHurtR,
  treeSolidR,
} from '../data/treeProfiles';
import { HealthBar } from '../ui/HealthBar';
import {
  getTreeTexture,
  TREE_SPRITE_ANCHOR,
} from '../world/treeTextures';

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
  /** 是否允许自然死亡，默认 true */
  enableNaturalDeath?: boolean;
  /** 是否从透明淡入（树苗默认 true） */
  emerge?: boolean;
  /** 自定义生长倒计时（秒） */
  growthTimeSec?: number;
  /** 自定义播种扩散倒计时（秒） */
  spreadTimeSec?: number;
  /** 自定义自然衰老倒计时（秒） */
  decayTimeSec?: number;
  /** 生长进阶完成后的回调 */
  onGrown?: (tree: HarvestableTree) => void;
  /** 到点向四周播种树苗时的回调 */
  onSpread?: (tree: HarvestableTree) => void;
  /** 自然枯萎死亡时的回调 */
  onWither?: (tree: HarvestableTree) => void;
  /** 苹果熟透/震落掉到地面的回调 */
  onAppleDrop?: (worldX: number, worldY: number) => void;
};

/** 镜头可视区（世界坐标） */
export type TreeViewBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

export type TreeUpdateOptions = {
  view?: TreeViewBounds | null;
  /** 森林抱团生长加速 */
  speedup?: number;
  /** 自然死亡率倍率（树林低、绿地孤立树高） */
  deathRateMultiplier?: number;
  /** 本帧是否推进扩散 / 结苹果逻辑 */
  runLogic?: boolean;
  /** 逻辑 dt 倍率（= 分片数） */
  logicScale?: number;
};

/**
 * 关卡内可交互树：小树苗 / 中树 / 大树（松树或苹果树）。
 * 共享烘焙 Sprite；屏外跳过视觉；生长/扩散逻辑可分片。
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

  /** 当前是否挂在「参与角色深度排序」的层 */
  sortedForDepth = false;
  /** 抱团加速缓存（由 HarvestWorld 分片刷新） */
  clusterSpeedup = 1;

  private maxHp: number;
  private hp: number;
  /** 懒创建：未受伤不挂血条节点 */
  private healthBar: HealthBar | null = null;
  private readonly sprite: Sprite;
  private shakeT = 0;
  private felled = false;
  private isWithering = false;
  private witherAnimT = 0;
  private baseTint: number;

  private enableGrowth: boolean;
  private enableNaturalDeath: boolean;
  private growthTimer: number | null = null;
  private growthDuration = 0;
  private decayTimer: number | null = null;
  private spreadTimer: number | null = null;
  private emergeTimer: number | null = null;
  private emergeDuration = TREE_EMERGE_SEC;
  private onGrown?: (tree: HarvestableTree) => void;
  private onSpread?: (tree: HarvestableTree) => void;
  private onWither?: (tree: HarvestableTree) => void;
  private onAppleDrop?: (worldX: number, worldY: number) => void;

  private appleCount = 0;
  private appleFruitTimer = 0;
  /** 视觉脏：生长/淡入结束后可跳过每帧 scale/tint 写入 */
  private visualDirty = true;

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
    this.enableNaturalDeath = options.enableNaturalDeath ?? true;
    this.onGrown = options.onGrown;
    this.onSpread = options.onSpread;
    this.onWither = options.onWither;
    this.onAppleDrop = options.onAppleDrop;
    this.resetGrowthTimer(options.growthTimeSec);
    this.resetSpreadTimer(options.spreadTimeSec);
    this.resetDecayTimer(options.decayTimeSec);

    const wantEmerge = options.emerge ?? size === 'sapling';
    if (wantEmerge) {
      const jitter = 0.85 + Math.random() * 0.3;
      this.emergeDuration = TREE_EMERGE_SEC * jitter;
      this.emergeTimer = this.emergeDuration;
    }

    this.baseTint = options.tint ?? profile.tint;
    this.initAppleState();

    this.sprite = new Sprite(getTreeTexture(this.treeKind, this.appleCount));
    this.sprite.label = 'HarvestTreeSprite';
    this.sprite.anchor.set(TREE_SPRITE_ANCHOR.x, TREE_SPRITE_ANCHOR.y);
    this.sprite.scale.set(profile.scale);
    this.sprite.tint = this.baseTint;
    this.sprite.eventMode = 'none';
    this.sprite.cullable = true;
    this.addChild(this.sprite);

    this.syncToWorld();
    this.applyGrowthVisual();
  }

  private ensureHealthBar(): HealthBar {
    if (this.healthBar) return this.healthBar;
    const profile = TREE_SIZE_PROFILE[this.size];
    const bar = new HealthBar({
      maxHp: this.maxHp,
      width: profile.hpBarW,
      height: 5,
    });
    bar.setHealth(this.hp);
    bar.position.set(0, profile.hpBarY);
    bar.visible = false;
    this.addChild(bar);
    this.healthBar = bar;
    return bar;
  }

  get isAlive(): boolean {
    return !this.felled && !this.isWithering && this.hp > 0;
  }

  get isWitheringOut(): boolean {
    return this.isWithering;
  }

  get currentHp(): number {
    return this.hp;
  }

  wither(): void {
    if (this.isWithering || !this.isAlive) return;
    this.isWithering = true;
    this.witherAnimT = 1.6;
    this.visible = true;
  }

  private initAppleState(): void {
    if (this.treeKind !== 'apple') return;
    if (this.size === 'large') {
      this.appleCount = 2 + Math.floor(Math.random() * 2);
      this.appleFruitTimer = 6 + Math.random() * 6;
    } else {
      this.appleCount = 0;
      this.appleFruitTimer = 0;
    }
  }

  private refreshSpriteTexture(): void {
    this.sprite.texture = getTreeTexture(this.treeKind, this.appleCount);
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

  private resetDecayTimer(customSec?: number): void {
    if (!this.enableNaturalDeath) {
      this.decayTimer = null;
      return;
    }
    // 基础自然寿命：树苗 ~110s，中树 ~180s，大树 ~280s
    const baseSec =
      customSec ??
      (this.size === 'sapling' ? 110 : this.size === 'medium' ? 180 : 280);
    const jitter = (Math.random() - 0.5) * 0.4 * baseSec;
    const dur = Math.max(30, baseSec + jitter);
    this.decayTimer = dur;
  }

  private growthProgress01(): number {
    if (this.growthTimer === null || this.growthDuration <= 0) return 1;
    const done = 1 - this.growthTimer / this.growthDuration;
    return Math.min(1, Math.max(0, done));
  }

  private emergeProgress01(): number {
    if (this.emergeTimer === null || this.emergeDuration <= 0) return 1;
    return Math.min(
      1,
      Math.max(0, 1 - this.emergeTimer / this.emergeDuration),
    );
  }

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
    this.sprite.scale.set(baseScale);
    this.sprite.tint = tint;
    this.sprite.alpha = e;
    this.visualDirty = false;
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

    const oldMax = this.maxHp;
    this.maxHp = profile.maxHp;
    this.hp = Math.min(this.maxHp, Math.round((this.hp / oldMax) * this.maxHp));
    if (this.healthBar) {
      this.healthBar.setHealth(this.hp, this.maxHp);
      this.healthBar.position.set(0, profile.hpBarY);
    }

    this.resetGrowthTimer();
    this.resetSpreadTimer();
    this.resetDecayTimer();
    this.initAppleState();
    this.refreshSpriteTexture();
    this.visualDirty = true;
    this.applyGrowthVisual();

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

  /**
   * 屏外判定：脚底在镜头内，或冠层可能伸入镜头（脚底略在下方）。
   */
  inView(view: TreeViewBounds | null | undefined): boolean {
    if (!view) return true;
    return (
      this.worldX >= view.minX &&
      this.worldX <= view.maxX &&
      this.worldY >= view.minY &&
      this.worldY <= view.maxY + TREE_CANOPY_CULL_PAD
    );
  }

  update(deltaMS: number, opts: TreeUpdateOptions = {}): void {
    if (this.destroyed) return;
    const realDt = deltaMS / 1000;
    const speedup = Math.max(0.1, opts.speedup ?? this.clusterSpeedup);
    const dt = realDt * speedup;
    const runLogic = opts.runLogic ?? true;
    const logicScale = opts.logicScale ?? 1;
    const view = opts.view;

    if (this.shakeT > 0) {
      this.shakeT = Math.max(0, this.shakeT - realDt);
    }

    // 枯萎死亡动画
    if (this.isWithering) {
      this.visible = true;
      this.syncToWorld();
      this.witherAnimT = Math.max(0, this.witherAnimT - realDt);
      const u = Math.max(0, this.witherAnimT / 1.6);
      this.sprite.tint = lerpColor(0x5a4832, this.baseTint, u);
      this.sprite.alpha = u;
      if (this.witherAnimT <= 0 && !this.destroyed) {
        this.felled = true;
        this.onWither?.(this);
      }
      return;
    }

    // 淡入：每帧推进（保证平滑）
    if (this.emergeTimer !== null) {
      this.emergeTimer -= realDt;
      if (this.emergeTimer <= 0) {
        this.emergeTimer = null;
      }
      this.visualDirty = true;
    }

    // 自然衰老死亡计时推进
    if (
      runLogic &&
      this.isAlive &&
      !this.isWithering &&
      this.decayTimer !== null
    ) {
      const mult = opts.deathRateMultiplier ?? 1.0;
      this.decayTimer -= dt * logicScale * mult;
      if (this.decayTimer <= 0) {
        this.wither();
      }
    }

    // 生长计时每帧推进（慢速；平滑放大不依赖分片）
    if (this.isAlive && this.growthTimer !== null) {
      this.growthTimer -= dt;
      this.visualDirty = true;
      if (this.growthTimer <= 0) {
        this.grow();
      }
    }

    // 扩散 / 结苹果：可分片
    if (runLogic && this.isAlive && this.spreadTimer !== null) {
      this.spreadTimer -= dt * logicScale;
      if (this.spreadTimer <= 0) {
        this.onSpread?.(this);
        this.resetSpreadTimer();
      }
    }

    if (
      runLogic &&
      this.isAlive &&
      this.treeKind === 'apple' &&
      this.size === 'large'
    ) {
      this.appleFruitTimer -= dt * logicScale;
      if (this.appleFruitTimer <= 0) {
        this.appleFruitTimer = 7 + Math.random() * 5;
        if (this.appleCount < 3) {
          this.appleCount++;
          this.refreshSpriteTexture();
          this.visualDirty = true;
        } else {
          const drop = this.rollAppleDropPos();
          this.onAppleDrop?.(drop.x, drop.y);
        }
      }
    }

    const visible = this.inView(view);
    // 受击抖动短暂强制显示；血条常亮不阻止屏外剔除
    this.visible = visible || this.shakeT > 0;

    if (!visible && this.shakeT <= 0) {
      // 屏外：计时器已推进，跳过 transform / 视觉 / 血条
      return;
    }

    this.syncToWorld();
    if (this.visualDirty || this.growthTimer !== null || this.emergeTimer !== null) {
      this.applyGrowthVisual();
    }
    if (this.healthBar?.visible) {
      this.healthBar.update(deltaMS);
    }
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
    const bar = this.ensureHealthBar();
    bar.setHealth(this.hp);
    bar.visible = true;
    this.shakeT = 0.18;
    this.visible = true;

    if (this.treeKind === 'apple' && this.appleCount > 0) {
      this.appleCount--;
      this.refreshSpriteTexture();
      this.visualDirty = true;
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
