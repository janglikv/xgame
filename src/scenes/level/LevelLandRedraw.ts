import type { HarvestWorld } from '../../systems/HarvestWorld';
import type { WorldMap } from '../../world/WorldMap';

/**
 * 树林黄泥土 / 泥点重绘防抖。
 * drawForestSoilTerrain 随树数变重，树生长/播种会频繁触发；
 * 泥土只是装饰，可大幅降频（秒级合并所有变更）。
 */
export class LevelLandRedraw {
  /** 两次泥土重绘最小间隔（秒） */
  private static readonly INTERVAL_SEC = 12;

  private cooldown = 0;
  private pending = false;

  constructor(
    private readonly worldMap: WorldMap,
    private readonly harvest: HarvestWorld,
  ) {}

  /** 标记泥土待刷新（合并多次树变更，不立刻画） */
  schedule(): void {
    this.pending = true;
  }

  /**
   * 低频落盘泥土重绘：间隔内多次 schedule 只画一次。
   * 首次进入冷却为 0 时会较快响应一次，之后按 INTERVAL 拉长。
   */
  flush(dt: number): void {
    if (this.cooldown > 0) {
      this.cooldown = Math.max(0, this.cooldown - dt);
    }
    if (!this.pending || this.cooldown > 0) return;
    this.pending = false;
    this.cooldown = LevelLandRedraw.INTERVAL_SEC;
    this.redraw(this.harvest.mudSpots);
  }

  /** 立即重绘（清空场景等路径） */
  redrawNow(mudSpots: HarvestWorld['mudSpots'] = this.harvest.mudSpots): void {
    this.pending = false;
    this.redraw(mudSpots);
  }

  private redraw(mudSpots: HarvestWorld['mudSpots']): void {
    this.worldMap.redrawForestSoil();
    this.worldMap.redrawMudSoil(mudSpots);
  }
}
