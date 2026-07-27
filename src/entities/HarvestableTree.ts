import { Container, Graphics } from 'pixi.js';
import { HealthBar } from '../ui/HealthBar';
import { drawPineLocal } from '../world/PineTree';

/** 可砍树默认生命（约 3 次近战 / 数发飞剑） */
const DEFAULT_MAX_HP = 36;
/** 受击半径（脚底圆心，世界像素） */
const HURT_R = 22;
/** 近战可砍距离（玩家脚底 → 树脚底） */
export const HARVEST_RANGE = 56;
/** 近战单次伤害 */
export const HARVEST_MELEE_DAMAGE = 12;
/** 飞剑命中伤害（与 SPEAR 量级接近，略低） */
export const HARVEST_SPEAR_DAMAGE = 10;
/** 炸弹命中基础伤害 */
export const HARVEST_BOMB_DAMAGE = 18;

export type HarvestableTreeOptions = {
  maxHp?: number;
  /** 掉落木头数量 */
  woodDrop?: number;
  /** 视觉色调（夜景偏冷） */
  tint?: number;
  /** 树 id（砍伐后移除 solid） */
  treeId?: string;
};

/**
 * 关卡内可交互幼松：有血量，可被近战 / 投射物破坏，倒地掉木头。
 * 原点 = 脚底；solid 由运行时树障碍表提供。
 */
export class HarvestableTree extends Container {
  worldX: number;
  worldY: number;
  readonly hurtR = HURT_R;
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
    this.maxHp = options.maxHp ?? DEFAULT_MAX_HP;
    this.hp = this.maxHp;
    this.woodDrop = Math.max(1, options.woodDrop ?? 2);
    this.treeId = options.treeId ?? '';

    this.gfx = new Graphics();
    this.gfx.label = 'HarvestTreeGfx';
    // shade=1 稍亮，和背景密林区分「可砍」
    drawPineLocal(this.gfx, 1);
    this.gfx.scale.set(0.72);
    if (options.tint !== undefined) {
      this.gfx.tint = options.tint;
    } else {
      this.gfx.tint = 0x6a8a5a;
    }
    this.addChild(this.gfx);

    // 脚底提示环：可交互
    const ring = new Graphics();
    ring.label = 'HarvestHint';
    ring.circle(0, 2, 10).stroke({ width: 1.5, color: 0xd4e8a8, alpha: 0.55 });
    this.addChild(ring);

    this.healthBar = new HealthBar({
      maxHp: this.maxHp,
      width: 36,
      height: 5,
    });
    this.healthBar.setHealth(this.maxHp);
    this.healthBar.position.set(0, -78);
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
