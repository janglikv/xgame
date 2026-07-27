import {
  primarySolidCircle,
  solidCirclesAtFeet,
  type BodyProfileId,
} from '../data/bodyProfiles';
import {
  PLAYER_BODY_R,
  SPIDER_BODY_R,
} from '../entities/WorldActor';
import { pushCircleOutMany } from '../world/circleBody';
import { WorldMap } from '../world/WorldMap';

/** 再导出，方便场景 / 旧引用 */
export { PLAYER_BODY_R, SPIDER_BODY_R };

/** 实体圆互推后与树区再解析的次数 */
const BODY_SOLID_ITERS = 2;

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
 */
export class SolidResolver {
  private readonly iters: number;

  constructor(options: { iters?: number } = {}) {
    this.iters = options.iters ?? BODY_SOLID_ITERS;
  }

  resolvePlayer(
    player: FootBody,
    fromX: number,
    fromY: number,
    ctx: SolidContext,
  ): void {
    const primary = primarySolidCircle(player.bodyProfileId);
    const r = Math.max(1, primary.r);
    // 在 solid 圆心上解析，再写回脚底
    let cx = player.worldX + primary.ox;
    let cy = player.worldY + primary.oy;
    let prevCx = fromX + primary.ox;
    let prevCy = fromY + primary.oy;

    for (let i = 0; i < this.iters; i++) {
      const tree = WorldMap.resolveSolid(prevCx, prevCy, cx, cy, r);
      cx = tree.x;
      cy = tree.y;

      const hard = this.collectHardBodyObstacles(ctx, {
        includePlayer: false,
        spiderSkipIndex: -1,
      });
      const body = pushCircleOutMany(cx, cy, r, hard, 2);

      if (body.x === cx && body.y === cy) {
        player.worldX = body.x - primary.ox;
        player.worldY = body.y - primary.oy;
        return;
      }

      prevCx = cx;
      prevCy = cy;
      cx = body.x;
      cy = body.y;
    }

    const finalTree = WorldMap.resolveSolid(prevCx, prevCy, cx, cy, r);
    player.worldX = finalTree.x - primary.ox;
    player.worldY = finalTree.y - primary.oy;
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

    const primary = primarySolidCircle(spider.bodyProfileId);
    const r = Math.max(1, primary.r);
    let cx = spider.worldX + primary.ox;
    let cy = spider.worldY + primary.oy;
    let prevCx = fromX + primary.ox;
    let prevCy = fromY + primary.oy;

    for (let i = 0; i < this.iters; i++) {
      const tree = WorldMap.resolveSolid(prevCx, prevCy, cx, cy, r);
      cx = tree.x;
      cy = tree.y;

      const hard = this.collectHardBodyObstacles(ctx, {
        includePlayer: true,
        spiderSkipIndex: spiderIndex,
      });
      const body = pushCircleOutMany(cx, cy, r, hard, 2);

      if (body.x === cx && body.y === cy) {
        spider.worldX = body.x - primary.ox;
        spider.worldY = body.y - primary.oy;
        return;
      }

      prevCx = cx;
      prevCy = cy;
      cx = body.x;
      cy = body.y;
    }

    const finalTree = WorldMap.resolveSolid(prevCx, prevCy, cx, cy, r);
    spider.worldX = finalTree.x - primary.ox;
    spider.worldY = finalTree.y - primary.oy;
  }

  private collectHardBodyObstacles(
    ctx: SolidContext,
    options: { includePlayer: boolean; spiderSkipIndex: number },
  ): Array<{ x: number; y: number; r: number }> {
    const out: Array<{ x: number; y: number; r: number }> = [];

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
