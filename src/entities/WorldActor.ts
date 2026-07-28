import type { KnockArcState } from './knockArc';
import type { BodyProfileId } from '../data/bodyProfiles';

/**
 * 关卡内可站立单位：自己持有脚底坐标与击飞抛物线。
 * 玩家 / 蜘蛛统一此契约，场景与 solid / combat 只读写接口字段。
 *
 * 碰撞体（solid）/ 受击体（hurt）尺寸来自 `bodyProfileId` → BODY_PROFILES。
 */
export interface WorldActor {
  worldX: number;
  worldY: number;
  /** 碰撞配置模板 id（同模板共享编辑结果） */
  readonly bodyProfileId: BodyProfileId;
  /** solid 半径（只读视图，来自 profile） */
  readonly bodyR: number;
  /** hurt 半径近似（圆）或外接圆（矩形）；精确检测用 profile */
  readonly hurtR: number;
  readonly knock: KnockArcState;
  /** 把 world 写到 Container 位置与 zIndex */
  syncToWorld(): void;
}
