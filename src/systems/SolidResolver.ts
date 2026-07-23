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

/** 可被 solid 读写的脚底坐标 */
export type FootBody = {
  worldX: number;
  worldY: number;
};

/** 蜘蛛等：额外需要 isAlive 以跳过尸体 */
export type AliveFootBody = FootBody & {
  isAlive: boolean;
};

/**
 * 一帧 solid 解析所需的世界快照。
 * 数组元素可被原地改 worldX/Y。
 */
export type SolidContext = {
  /** 操作中的玩家；无玩家时为 null */
  player: FootBody | null;
  spiders: AliveFootBody[];
};

/**
 * 关卡脚底圆 solid：树区 + 人怪互挡。
 * 场上仅一名玩家角色；不持有场景引用，每帧由 LevelScene 传入 context。
 */
export class SolidResolver {
  private readonly playerR: number;
  private readonly spiderR: number;
  private readonly iters: number;

  constructor(
    options: {
      playerBodyR?: number;
      spiderBodyR?: number;
      iters?: number;
    } = {},
  ) {
    this.playerR = options.playerBodyR ?? PLAYER_BODY_R;
    this.spiderR = options.spiderBodyR ?? SPIDER_BODY_R;
    this.iters = options.iters ?? BODY_SOLID_ITERS;
  }

  /**
   * 玩家本帧落点：树区 + vs 蜘蛛（硬）+ 边界。
   * 原地写入 `player`。
   */
  resolvePlayer(
    player: FootBody,
    fromX: number,
    fromY: number,
    ctx: SolidContext,
  ): void {
    let px = player.worldX;
    let py = player.worldY;
    let prevX = fromX;
    let prevY = fromY;

    for (let i = 0; i < this.iters; i++) {
      const tree = WorldMap.resolveSolid(prevX, prevY, px, py, this.playerR);
      px = tree.x;
      py = tree.y;

      const hard = this.collectHardBodyObstacles(ctx, {
        includePlayer: false,
        spiderSkipIndex: -1,
      });
      const body = pushCircleOutMany(px, py, this.playerR, hard, 2);

      if (body.x === px && body.y === py) {
        player.worldX = body.x;
        player.worldY = body.y;
        return;
      }

      prevX = px;
      prevY = py;
      px = body.x;
      py = body.y;
    }

    const finalTree = WorldMap.resolveSolid(
      prevX,
      prevY,
      px,
      py,
      this.playerR,
    );
    player.worldX = finalTree.x;
    player.worldY = finalTree.y;
  }

  /**
   * 蜘蛛本帧落点：树区 + vs 玩家/其他蜘蛛 + 边界。
   * 原地写入 `spider`。
   */
  resolveSpider(
    spider: FootBody,
    fromX: number,
    fromY: number,
    spiderIndex: number,
    ctx: SolidContext,
  ): void {
    let sx = spider.worldX;
    let sy = spider.worldY;
    let prevX = fromX;
    let prevY = fromY;

    for (let i = 0; i < this.iters; i++) {
      const tree = WorldMap.resolveSolid(prevX, prevY, sx, sy, this.spiderR);
      sx = tree.x;
      sy = tree.y;

      const hard = this.collectHardBodyObstacles(ctx, {
        includePlayer: true,
        spiderSkipIndex: spiderIndex,
      });
      const body = pushCircleOutMany(sx, sy, this.spiderR, hard, 2);

      if (body.x === sx && body.y === sy) {
        spider.worldX = body.x;
        spider.worldY = body.y;
        return;
      }

      prevX = sx;
      prevY = sy;
      sx = body.x;
      sy = body.y;
    }

    const finalTree = WorldMap.resolveSolid(
      prevX,
      prevY,
      sx,
      sy,
      this.spiderR,
    );
    spider.worldX = finalTree.x;
    spider.worldY = finalTree.y;
  }

  /**
   * 硬障碍脚底圆：玩家、蜘蛛。
   */
  private collectHardBodyObstacles(
    ctx: SolidContext,
    options: { includePlayer: boolean; spiderSkipIndex: number },
  ): Array<{ x: number; y: number; r: number }> {
    const out: Array<{ x: number; y: number; r: number }> = [];

    if (options.includePlayer && ctx.player) {
      out.push({
        x: ctx.player.worldX,
        y: ctx.player.worldY,
        r: this.playerR,
      });
    }

    for (let i = 0; i < ctx.spiders.length; i++) {
      if (i === options.spiderSkipIndex) continue;
      const s = ctx.spiders[i]!;
      if (!s.isAlive) continue;
      out.push({ x: s.worldX, y: s.worldY, r: this.spiderR });
    }

    return out;
  }
}
