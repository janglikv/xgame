import type { BombProjectileOptions } from './BombProjectile';
import type { PlayerCharacterBase } from './PlayerCharacterBase';

/**
 * 屏幕点击换算后的世界瞄准向量（相对角色脚底，未归一化）。
 * 过近点击在 Combat 层已过滤，角色侧不会收到零向量。
 */
export type RangedAim = {
  dx: number;
  dy: number;
};

/**
 * 远程出手可用的战斗能力（由 CombatSystem 实现）。
 * 角色决定打什么；系统只负责生成投射物与刷新 HUD。
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
    options?: { originHeight?: number },
  ) => void;
  /** 扣弹 / 出手后按 getAmmoHud 刷新场景弹药 HUD */
  notifyAmmoHud: (player: PlayerCharacterBase) => void;
};
