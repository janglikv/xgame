import { Container, Graphics } from 'pixi.js';
import type { TreeSize } from '../data/maps/types';
import { TREE_SIZE_PROFILE } from '../data/treeProfiles';
import { HealthBar } from '../ui/HealthBar';
import { drawPineLocal } from '../world/PineTree';

/** 近战单次伤害 */
export const HARVEST_MELEE_DAMAGE = 12;
/** 飞剑命中伤害（与 SPEAR 量级接近，略低） */
export const HARVEST_SPEAR_DAMAGE = 10;
/** 炸弹命中基础伤害 */
export const HARVEST_BOMB_DAMAGE = 18;
/** 兼容旧代码：中树默认交互距离 */
export const HARVEST_RANGE = 56;

export { TREE_SIZE_PROFILE };

export type HarvestableTreeOptions = {
  size?: TreeSize;
  maxHp?: number;
  /** 掉落木头数量；缺省按体型 */
  woodDrop?: number;
  /** 视觉色调（夜景偏冷） */
  tint?: number;
  /** 树 id（砍伐后移除 solid） */
  treeId?: string;
};

/**
 * 关卡内可交互树：小树苗 / 中树 / 大树。
 * 有血量，可被近战 / 投射物破坏，倒地掉木头。
 * 原点 = 脚底；solid 由运行时树障碍表提供。
 */
export class HarvestableTree extends Container {
  worldX: number;
  worldY: number;
  readonly size: TreeSize;
  readonly hurtR: number;
  /** 近战交互半径 */
  readonly interactR: number;
  readonly woodDrop: number;
  /** 树 id；空串表示无 solid 绑定 */
  readonly treeId: string;

  private readonly maxHp: number;
  private hp: number;
  private readonly healthBar: HealthBar;
  private readonly gfx: Graphics;
  private shakeT = 0;
  private felled = false;

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
    const profile = TREE_SIZE_PROFILE[size];

    this.maxHp = options.maxHp ?? profile.maxHp;
    this.hp = this.maxHp;
    this.woodDrop = Math.max(1, options.woodDrop ?? profile.woodDrop);
    this.treeId = options.treeId ?? '';
    this.hurtR = profile.hurtR;
    this.interactR = profile.interactR;

    this.gfx = new Graphics();
    this.gfx.label = 'HarvestTreeGfx';
    // shade=1 稍亮，和背景密林区分「可砍」
    drawPineLocal(this.gfx, 1);
    this.gfx.scale.set(profile.scale);
    this.gfx.tint = options.tint ?? profile.tint;
    this.addChild(this.gfx);

    // 脚底提示环：可交互
    const ring = new Graphics();
    ring.label = 'HarvestHint';
    ring
      .circle(0, 2, profile.ringR)
      .stroke({ width: 1.5, color: 0xd4e8a8, alpha: 0.55 });
    this.addChild(ring);

    this.healthBar = new HealthBar({
      maxHp: this.maxHp,
      width: profile.hpBarW,
      height: 5,
    });
    this.healthBar.setHealth(this.maxHp);
    this.healthBar.position.set(0, profile.hpBarY);
    this.healthBar.visible = false;
    this.addChild(this.healthBar);

    this.syncToWorld();
  }

  get isAlive(): boolean {
    return !this.felled && this.hp > 0;
  }

  get currentHp(): number {
    return this.hp;
  }

  /** 脚底坐标写到显示与 zIndex */
  syncToWorld(): void {
    const shake =
      this.shakeT > 0 ? Math.sin(this.shakeT * 48) * 2.2 * this.shakeT : 0;
    this.position.set(this.worldX + shake, this.worldY);
    this.zIndex = this.worldY;
  }

  update(deltaMS: number): void {
    if (this.shakeT > 0) {
      this.shakeT = Math.max(0, this.shakeT - deltaMS / 1000);
      this.syncToWorld();
    }
    this.healthBar.update(deltaMS);
  }

  /**
   * 造成伤害。
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

    if (this.hp <= 0) {
      this.felled = true;
      return false;
    }
    return true;
  }
}
