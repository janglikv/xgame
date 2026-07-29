import type { LevelMapDef } from '../data/maps';
import type { Spider } from './Spider';

/** 生态可食草丛（牛马等）；结构与 GrassEntity 对齐，避免生物基类依赖草实体类 */
export type EcologyGrass = {
  worldX: number;
  worldY: number;
  size: 'small' | 'medium' | 'large';
  grassId: string;
};

/** 场上可识别的树（猪找苹果树睡觉等） */
export type EcologyTree = {
  worldX: number;
  worldY: number;
  kind: 'pine' | 'apple';
  isAlive: boolean;
};

/**
 * 生物生态上下文（猪觅食、牛马吃草等）：由场景每帧注入。
 * 不强制所有单位使用。
 */
export type CreatureEcologyContext = {
  /** 地上未收集掉落 */
  pickups: ReadonlyArray<{
    itemId: string;
    worldX: number;
    worldY: number;
    isCollected: boolean;
  }>;
  /** 场上草地（牛马觅食） */
  grasses: ReadonlyArray<EcologyGrass>;
  /** 场上可砍树（猪认苹果树） */
  trees: ReadonlyArray<EcologyTree>;
  /** 场上其它生物（含自己，调用方过滤） */
  creatures: ReadonlyArray<Spider>;
  /** 地图定义（用于动物避开海岸与海面） */
  mapDef?: LevelMapDef;
  /** 吃掉地上的苹果等 */
  consumePickup: (pickup: {
    itemId: string;
    worldX: number;
    worldY: number;
    isCollected: boolean;
  }) => void;
  /**
   * 啃一丛草（变小不消失）。
   * 返回啃之前的体型；不可啃时 null。
   */
  consumeGrass: (
    grass: EcologyGrass,
  ) => 'small' | 'medium' | 'large' | null;
  /**
   * 网格加速：最近可啃大草（牛马优先用，避免扫全表）
   */
  findNearestLargeGrass?: (
    x: number,
    y: number,
  ) => { grass: EcologyGrass; dist: number } | null;
  /** 移除死亡生物（猪吃鸡 / 饿死等） */
  removeCreature: (creature: Spider) => void;
};
