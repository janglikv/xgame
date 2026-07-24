import type { BombProjectileOptions } from './BombProjectile';
import type { AmmoHudModel } from './CharacterResources';
import type { SpearProjectileOptions } from './SpearProjectile';

/**
 * 屏幕点击换算后的世界瞄准向量（相对角色脚底，未归一化）。
 * 过近点击在 Combat 层已过滤，角色侧不会收到零向量。
 */
export type RangedAim = {
  dx: number;
  dy: number;
};

/** 十二角剑阵：径向齐射参数（不扣弹药） */
export type RadialSpearFormationOptions = {
  /** 把数，默认 12 */
  count?: number;
  /** 飞出后悬停的距离（世界像素） */
  maxRange?: number;
  originHeight?: number;
  speed?: number;
  /** 贴图缩放 */
  scale?: number;
  /**
   * 全部飞剑矛尖朝向的世界落点（通常为指针位置）。
   * 与径向飞出方向独立；缺省时朝向各自飞出方向。
   */
  faceWorldX?: number;
  faceWorldY?: number;
};

/**
 * 远程出手可用的战斗能力（由 CombatSystem 实现）。
 * 角色决定打什么；系统只负责生成投射物与转发 HUD 模型。
 */
export type RangedCombatServices = {
  spawnBomb: (
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    options?: BombProjectileOptions,
  ) => void;
  spawnSpear: (
    originX: number,
    originY: number,
    dirX: number,
    dirY: number,
    options?: SpearProjectileOptions,
  ) => void;
  /**
   * 免费径向剑阵：减速就位 → 停顿 → 朝 faceWorld 加速齐射。
   * 不扣弹药；再次调用会顶替上一组剑阵。
   */
  spawnRadialSpearFormation: (
    originX: number,
    originY: number,
    options?: RadialSpearFormationOptions,
  ) => void;
  /** 扣弹 / 出手后刷新弹药 HUD（传入 getAmmoHud() 结果） */
  notifyAmmoHud: (model: AmmoHudModel) => void;
};
