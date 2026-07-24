import type { Container } from 'pixi.js';
import type { BombProjectileOptions } from './BombProjectile';

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

/** 仅需脚底坐标的世界实体（多弹齐抛原点等） */
export type WorldFeetOrigin = {
  worldX: number;
  worldY: number;
};

/**
 * 可投免费自动瞄准矛的施法者能力（不绑定具体角色类）。
 */
export type AutoAimSpearCaster = WorldFeetOrigin & {
  setFacingFromMoveX(dirX: number): void;
  getThrowOrigin(
    feetX: number,
    feetY: number,
  ): { x: number; y: number; height: number };
};

/**
 * 出场可用的战斗能力（由 CombatSystem 实现）。
 * 角色只表达意图，不直接 new 投射物；类型也不点名具体角色类。
 */
export type EntranceCombatServices = {
  /** 免费自动瞄准连射（不走手持飞剑与弹药） */
  fireFreeAutoAimSpearVolley: (
    caster: AutoAimSpearCaster,
    targets: readonly EntranceAimTarget[],
    count?: number,
  ) => void;
  /**
   * 从原点同时抛向多个落点。
   * `onFirstBlast` 在任一枚首次爆炸结算时调用一次。
   */
  throwBombBurst: (
    origin: WorldFeetOrigin,
    landings: ReadonlyArray<{ endX: number; endY: number }>,
    options?: BombProjectileOptions,
    onFirstBlast?: () => void,
  ) => void;
  /** 取消该实体相关的脚本化攻击（如自动连射） */
  cancelScriptedAttacks: (owner: object) => void;
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
