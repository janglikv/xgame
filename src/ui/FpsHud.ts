import { Container, Graphics, Text } from 'pixi.js';

/**
 * 屏幕左上角 FPS 显示。
 * 约每 200ms 刷新一次文字，避免每帧改 Text 造成抖动。
 */
export class FpsHud extends Container {
  private readonly bg: Graphics;
  private readonly fpsText: Text;

  private frameCount = 0;
  private elapsedMs = 0;
  private displayFps = 0;
  private readonly refreshIntervalMs = 200;

  constructor() {
    super();
    this.label = 'FpsHud';
    this.eventMode = 'none';

    this.bg = new Graphics();
    this.addChild(this.bg);

    this.fpsText = new Text({
      text: 'FPS: --',
      style: {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 12,
        fontWeight: '700',
        fill: 0xb0e0ff,
      },
    });
    this.fpsText.position.set(10, 6);
    this.addChild(this.fpsText);

    this.paint(0);
    this.position.set(16, 16);
  }

  /**
   * @param deltaMS 真实帧间隔（毫秒），不受游戏时间倍率影响
   * @param tickerFps 可选：Pixi Ticker.FPS，优先用其瞬时值做平均
   */
  update(deltaMS: number, tickerFps?: number): void {
    this.frameCount += 1;
    this.elapsedMs += Math.max(0, deltaMS);

    if (this.elapsedMs < this.refreshIntervalMs) {
      return;
    }

    const measured =
      tickerFps != null && Number.isFinite(tickerFps) && tickerFps > 0
        ? tickerFps
        : this.frameCount / (this.elapsedMs / 1000);

    this.displayFps = Math.round(measured);
    this.frameCount = 0;
    this.elapsedMs = 0;
    this.paint(this.displayFps);
  }

  private paint(fps: number): void {
    this.fpsText.text = fps > 0 ? `FPS: ${fps}` : 'FPS: --';

    // 颜色：≥55 绿，30–54 黄，<30 红
    if (fps >= 55) {
      this.fpsText.style.fill = 0x69f0ae;
    } else if (fps >= 30) {
      this.fpsText.style.fill = 0xffe08a;
    } else if (fps > 0) {
      this.fpsText.style.fill = 0xff6b6b;
    } else {
      this.fpsText.style.fill = 0xb0e0ff;
    }

    const w = Math.ceil(this.fpsText.width) + 20;
    const h = 28;

    this.bg
      .clear()
      .roundRect(0, 0, w, h, 14)
      .fill({ color: 0x121a24, alpha: 0.88 })
      .roundRect(0, 0, w, h, 14)
      .stroke({ width: 1.5, color: 0x5a6a8a, alpha: 0.8 });
  }

  layout(_screenWidth: number, _screenHeight: number): void {
    this.position.set(16, 16);
  }
}
