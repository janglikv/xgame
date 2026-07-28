import {
  primarySolidCircle,
  solidCirclesAtFeet,
  type BodyProfileId,
} from '../data/bodyProfiles';
import { getRuntimeTreeObstacles } from '../data/maps/walkMask';
import {
  PLAYER_BODY_R,
  SPIDER_BODY_R,
} from '../entities/WorldActor';
import {
  pushCircleOutMany,
  slideCircle,
  type CircleObstacle,
} from '../world/circleBody';
import { WorldMap } from '../world/WorldMap';

/** 再导出，方便场景 / 旧引用 */
export { PLAYER_BODY_R, SPIDER_BODY_R };

/** 树 + 实体耦合时的收尾迭代 */
const SOLID_CLEANUP_ITERS = 2;

/**
 * 可被 solid 读写的脚底坐标。
 * 半径 / 偏移来自 bodyProfileId → 主 solid 圆。
 */
export type FootBody = {
  worldX: number;
  worldY: number;
  bodyProfileId: BodyProfileId;
};

/** 蜘蛛等：额外需要 isAlive 以跳过尸体；immovable 不被挤走但仍挡别人 */
export type AliveFootBody = FootBody & {
  isAlive: boolean;
  /** true：跳过 resolveSpider，位置钉死 */
  immovable?: boolean;
};

export type SolidContext = {
  player: FootBody | null;
  spiders: AliveFootBody[];
};

/**
 * 关卡 solid：树区 + 人怪互挡。
 * 移动用主 solid 圆（含 ox/oy）；障碍收集全部 solid 圆（矩形→外接圆）。
 * 圆-圆切线滑动，斜向贴树 / 贴怪可绕开，不再轴分离卡死。
 */
export class SolidResolver {
  resolvePlayer(
    player: FootBody,
    fromX: number,
    fromY: number,
    ctx: SolidContext,
  ): void {
    this.resolveFoot(player, fromX, fromY, {
      includePlayer: false,
      spiderSkipIndex: -1,
    }, ctx);
  }

  resolveSpider(
    spider: FootBody & { immovable?: boolean },
    fromX: number,
    fromY: number,
    spiderIndex: number,
    ctx: SolidContext,
  ): void {
    // 训练木桩等：绝不被 solid 推出，只作为障碍存在
    if (spider.immovable) return;

    this.resolveFoot(spider, fromX, fromY, {
      includePlayer: true,
      spiderSkipIndex: spiderIndex,
    }, ctx);
  }

  private resolveFoot(
    body: FootBody,
    fromX: number,
    fromY: number,
    options: { includePlayer: boolean; spiderSkipIndex: number },
    ctx: SolidContext,
  ): void {
    const primary = primarySolidCircle(body.bodyProfileId);
    const r = Math.max(1, primary.r);
    const fromCx = fromX + primary.ox;
    const fromCy = fromY + primary.oy;
    const toCx = body.worldX + primary.ox;
    const toCy = body.worldY + primary.oy;

    const hard = this.collectHardBodyObstacles(ctx, options);
    const trees = getRuntimeTreeObstacles();
    // TreeObstacle 结构兼容 {x,y,r}；合并为只读障碍列表
    const all: ReadonlyArray<CircleObstacle> =
      hard.length === 0
        ? trees
        : trees.length === 0
          ? hard
          : [...hard, ...trees];

    let cx: number;
    let cy: number;
    if (all.length === 0) {
      cx = toCx;
      cy = toCy;
    } else {
      const slid = slideCircle(fromCx, fromCy, toCx, toCy, r, all);
      cx = slid.x;
      cy = slid.y;
    }

    // 海岸法线钳制 + 再清一次圆重叠（clamp 可能把圆心推进树）
    for (let i = 0; i < SOLID_CLEANUP_ITERS; i++) {
      const clamped = WorldMap.clampWorld(cx, cy, r);
      cx = clamped.x;
      cy = clamped.y;
      if (all.length === 0) break;
      const cleaned = pushCircleOutMany(cx, cy, r, all, 3);
      if (cleaned.x === cx && cleaned.y === cy) break;
      cx = cleaned.x;
      cy = cleaned.y;
    }

    body.worldX = cx - primary.ox;
    body.worldY = cy - primary.oy;
  }

  private collectHardBodyObstacles(
    ctx: SolidContext,
    options: { includePlayer: boolean; spiderSkipIndex: number },
  ): CircleObstacle[] {
    const out: CircleObstacle[] = [];

    if (options.includePlayer && ctx.player) {
      out.push(
        ...solidCirclesAtFeet(
          ctx.player.worldX,
          ctx.player.worldY,
          ctx.player.bodyProfileId,
        ),
      );
    }

    for (let i = 0; i < ctx.spiders.length; i++) {
      if (i === options.spiderSkipIndex) continue;
      const s = ctx.spiders[i]!;
      if (!s.isAlive) continue;
      out.push(
        ...solidCirclesAtFeet(s.worldX, s.worldY, s.bodyProfileId),
      );
    }

    return out;
  }
}
