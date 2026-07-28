import { Container, Graphics } from 'pixi.js';
import {
  TREE_BODY_PROFILE_ID,
  type BodyProfileId,
} from '../data/bodyProfiles';
import type { TreeSize } from '../data/maps/types';
import {
  TREE_SIZE_PROFILE,
  treeBodyShapeScale,
  treeHurtR,
} from '../data/treeProfiles';
import { HealthBar } from '../ui/HealthBar';
import { drawPineLocal } from '../world/PineTree';

/** 近战单次伤害 */
export const HARVEST_MELEE_DAMAGE = 12;
/** 飞剑命中伤害（与 SPEAR 量级接近，略低） */
export const HARVEST_SPEAR_DAMAGE = 10;
/** 炸弹命中基础伤害 */
export const HARVEST_BOMB_DAMAGE = 18;

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
 * 碰撞模板统一为 `tree`（编辑器编中树）；小/大只乘 bodyShapeScale。
 */
export class HarvestableTree extends Container {
  worldX: number;
  worldY: number;
  readonly size: TreeSize;
  /** 始终为 TREE_BODY_PROFILE_ID */
  readonly bodyProfileId: BodyProfileId;
  /** 相对中树的形状缩放 */
  readonly bodyShapeScale: number;
  /** 受击近似半径（模板 × 体型缩放） */
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
    this.bodyProfileId = TREE_BODY_PROFILE_ID;
    this.bodyShapeScale = treeBodyShapeScale(size);
    const profile = TREE_SIZE_PROFILE[size];

    this.maxHp = options.maxHp ?? profile.maxHp;
    this.hp = this.maxHp;
    this.woodDrop = Math.max(1, options.woodDrop ?? profile.woodDrop);
    this.treeId = options.treeId ?? '';
    this.hurtR = treeHurtR(size);
    this.interactR = profile.interactR;

    this.gfx = new Graphics();
    this.gfx.label = 'HarvestTreeGfx';
    // shade=1 稍亮，和背景密林区分「可砍」
    drawPineLocal(this.gfx, 1);
    this.gfx.scale.set(profile.scale);
    this.gfx.tint = options.tint ?? profile.tint;
    this.addChild(this.gfx);

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
