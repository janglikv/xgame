import type { Container } from 'pixi.js';
import type { BombProjectileOptions } from './BombProjectile';
import type { BombGirl } from './BombGirl';
import type { IceRanger } from './IceRanger';
import type { PlayerCharacterBase } from './PlayerCharacterBase';

/** 出场期间对输入 / 切换的锁定 */
export type EntranceLocks = {
  move: boolean;
  attack: boolean;
  switch: boolean;
};

export const ENTRANCE_UNLOCKED: EntranceLocks = {
  move: false,
  attack: false,
  switch: false,
};

/** 自动瞄准用的只读目标快照（场景注入，角色不依赖 Spider 类型） */
export type EntranceAimTarget = {
  worldX: number;
  worldY: number;
  isAlive: boolean;
};

/**
 * 出场可用的战斗能力（由 CombatSystem 实现）。
 * 角色只表达意图，不直接 new 投射物。
 */
export type EntranceCombatServices = {
  /** 免费自动瞄准连射（不走手持飞剑与弹药） */
  fireFreeAutoAimSpearVolley: (
    player: IceRanger,
    targets: readonly EntranceAimTarget[],
    count?: number,
  ) => void;
  /**
   * 从角色位置同时抛出多枚炸弹。
   * `onFirstBlast` 在任一枚首次爆炸结算时调用一次。
   */
  throwBombBurst: (
    player: BombGirl,
    landings: ReadonlyArray<{ endX: number; endY: number }>,
    options?: BombProjectileOptions,
    onFirstBlast?: () => void,
  ) => void;
  /** 取消该角色相关的脚本化攻击（如自动连射） */
  cancelScriptedAttacks: (player: PlayerCharacterBase) => void;
};

/**
 * 场景注入的出场上下文：挂特效、调战斗、读目标。
 * 角色不 import LevelScene。
 */
export type EntranceContext = {
  /** 把世界坐标节点挂到 Y-sort 层 */
  addWorldFx: (node: Container, zIndex: number) => void;
  combat: EntranceCombatServices;
  getTargets: () => readonly EntranceAimTarget[];
};
