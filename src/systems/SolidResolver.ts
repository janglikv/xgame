import {
  circlesOverlap,
  pushCircleOut,
  pushCircleOutMany,
} from '../world/circleBody';
import { WorldMap } from '../world/WorldMap';

/**
 * 碰撞体（solid）：脚底圆形占位，圆心 = worldX/Y。
 * 用于挡树、人怪互挡、推挤——不参与武器伤害判定。
 */
export const PLAYER_BODY_R = 18;
export const SPIDER_BODY_R = 20;

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
 * 数组元素可被原地改 worldX/Y（停场被挤走）。
 */
export type SolidContext = {
  /** 操作中的玩家；选角 / 无玩家时为 null */
  player: FootBody | null;
  parked: FootBody[];
  spiders: AliveFootBody[];
};

/**
 * 关卡脚底圆 solid：树区 + 人怪互挡 + 停场可挤走。
 * 不持有场景引用；每帧由 LevelScene 传入 context。
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
   * 玩家本帧落点：树区 + 挤开停场 + vs 蜘蛛（硬）+ 边界。
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

      this.shoveParkedFrom(px, py, this.playerR, ctx);

      const hard = this.collectHardBodyObstacles(ctx, {
        includePlayer: false,
        spiderSkipIndex: -1,
      });
      let body = pushCircleOutMany(px, py, this.playerR, hard, 2);
      body = this.pushOutOfParked(body.x, body.y, this.playerR, ctx);

      const settled =
        body.x === px &&
        body.y === py &&
        !this.overlapsAnyParked(body.x, body.y, this.playerR, ctx);
      if (settled) {
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
   * 蜘蛛本帧落点：树区 + 挤开停场 + vs 玩家/其他蜘蛛 + 边界。
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

      this.shoveParkedFrom(sx, sy, this.spiderR, ctx);

      const hard = this.collectHardBodyObstacles(ctx, {
        includePlayer: true,
        spiderSkipIndex: spiderIndex,
      });
      let body = pushCircleOutMany(sx, sy, this.spiderR, hard, 2);
      body = this.pushOutOfParked(body.x, body.y, this.spiderR, ctx);

      if (
        body.x === sx &&
        body.y === sy &&
        !this.overlapsAnyParked(body.x, body.y, this.spiderR, ctx)
      ) {
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
   * 停场角色被挤 / 击飞后的落点：树区 + 玩家/蜘蛛/其他停场（硬）+ 边界。
   * 不把“推动者”单独排除在外时由调用方保证；击飞路径下玩家算硬障碍。
   */
  resolveParked(
    parked: FootBody,
    fromX: number,
    fromY: number,
    parkedIndex: number,
    ctx: SolidContext,
  ): void {
    let x = parked.worldX;
    let y = parked.worldY;
    let prevX = fromX;
    let prevY = fromY;

    for (let i = 0; i < this.iters; i++) {
      const tree = WorldMap.resolveSolid(prevX, prevY, x, y, this.playerR);
      x = tree.x;
      y = tree.y;

      const hard: Array<{ x: number; y: number; r: number }> = [];
      if (ctx.player) {
        hard.push({
          x: ctx.player.worldX,
          y: ctx.player.worldY,
          r: this.playerR,
        });
      }
      for (const s of ctx.spiders) {
        if (!s.isAlive) continue;
        hard.push({ x: s.worldX, y: s.worldY, r: this.spiderR });
      }
      for (let j = 0; j < ctx.parked.length; j++) {
        if (j === parkedIndex) continue;
        const o = ctx.parked[j]!;
        hard.push({ x: o.worldX, y: o.worldY, r: this.playerR });
      }

      const body = pushCircleOutMany(x, y, this.playerR, hard, 2);
      if (body.x === x && body.y === y) {
        parked.worldX = x;
        parked.worldY = y;
        return;
      }
      prevX = x;
      prevY = y;
      x = body.x;
      y = body.y;
    }

    const finalTree = WorldMap.resolveSolid(
      prevX,
      prevY,
      x,
      y,
      this.playerR,
    );
    parked.worldX = finalTree.x;
    parked.worldY = finalTree.y;
  }

  /**
   * 以 pusher 为轴，把所有重叠的停场角色挤开，再解析他们的树/硬障碍。
   * 优先移动停场角色（可被挤走），而不是挡住推动者。
   */
  private shoveParkedFrom(
    pusherX: number,
    pusherY: number,
    pusherR: number,
    ctx: SolidContext,
  ): void {
    if (ctx.parked.length === 0) return;

    for (let n = 0; n < this.iters; n++) {
      let any = false;
      for (let i = 0; i < ctx.parked.length; i++) {
        const parked = ctx.parked[i]!;
        if (
          !circlesOverlap(
            pusherX,
            pusherY,
            pusherR,
            parked.worldX,
            parked.worldY,
            this.playerR,
          )
        ) {
          continue;
        }

        const fromX = parked.worldX;
        const fromY = parked.worldY;
        const shoved = pushCircleOut(
          parked.worldX,
          parked.worldY,
          this.playerR,
          pusherX,
          pusherY,
          pusherR,
        );
        parked.worldX = shoved.x;
        parked.worldY = shoved.y;
        this.resolveParked(parked, fromX, fromY, i, ctx);
        any = true;
      }
      if (!any) break;
    }
  }

  /** 推动者仍与某停场角色重叠时，把自己挤开（对方已贴墙推不动） */
  private pushOutOfParked(
    x: number,
    y: number,
    radius: number,
    ctx: SolidContext,
  ): { x: number; y: number } {
    const obstacles = ctx.parked.map((p) => ({
      x: p.worldX,
      y: p.worldY,
      r: this.playerR,
    }));
    return pushCircleOutMany(x, y, radius, obstacles, 2);
  }

  private overlapsAnyParked(
    x: number,
    y: number,
    radius: number,
    ctx: SolidContext,
  ): boolean {
    for (const p of ctx.parked) {
      if (
        circlesOverlap(x, y, radius, p.worldX, p.worldY, this.playerR)
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * 硬障碍脚底圆：玩家、蜘蛛（停场角色可被挤，不在此列）。
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
