import type { KnockArcState } from './knockArc';

/**
 * 碰撞体（solid）：脚底圆形，圆心 = worldX/Y。
 * 挡树 / 互推，不参与武器伤害。
 */
export const PLAYER_BODY_R = 18;
export const SPIDER_BODY_R = 20;

/**
 * 受击体（hurtbox）：矛 / 爆炸 / 扑咬命中。
 * 略大于 BODY，手感更宽容。
 */
export const PLAYER_HURT_R = 22;
export const SPIDER_HURT_R = 24;

/**
 * 关卡内可站立单位：自己持有脚底坐标与击飞抛物线。
 * 玩家 / 蜘蛛统一此契约，场景与 solid / combat 只读写接口字段。
 */
export interface WorldActor {
  worldX: number;
  worldY: number;
  readonly bodyR: number;
  readonly hurtR: number;
  readonly knock: KnockArcState;
  /** 把 world 写到 Container 位置与 zIndex */
  syncToWorld(): void;
}
