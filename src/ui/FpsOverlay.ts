/**
 * 左上角 FPS 显示组件（无背景，仅数字）
 */
export class FpsOverlay {
  private container: HTMLDivElement;
  private fpsValElement: HTMLSpanElement;
  private frameCount = 0;
  private lastUpdate = performance.now();
  private readonly updateInterval = 250; // 每 250ms 刷新一次数字，体验平滑

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'fps-overlay';
    this.container.style.cssText = `
      position: fixed;
      top: 12px;
      left: 12px;
      z-index: 10000;
      pointer-events: none;
      user-select: none;
      display: flex;
      align-items: baseline;
      gap: 4px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1;
    `;

    this.fpsValElement = document.createElement('span');
    this.fpsValElement.textContent = '--';
    this.fpsValElement.style.cssText = `
      font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
      font-size: 15px;
      font-weight: 700;
      color: #00e676;
      min-width: 24px;
      text-align: right;
    `;

    const fpsLabel = document.createElement('span');
    fpsLabel.textContent = 'FPS';
    fpsLabel.style.cssText = `
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.5px;
      color: rgba(255, 255, 255, 0.5);
    `;

    this.container.appendChild(this.fpsValElement);
    this.container.appendChild(fpsLabel);

    document.body.appendChild(this.container);
  }

  public update(): void {
    const now = performance.now();
    this.frameCount++;
    const elapsed = now - this.lastUpdate;

    if (elapsed >= this.updateInterval) {
      const fps = Math.round((this.frameCount * 1000) / elapsed);

      this.fpsValElement.textContent = `${fps}`;

      if (fps >= 50) {
        this.fpsValElement.style.color = '#00e676';
      } else if (fps >= 30) {
        this.fpsValElement.style.color = '#ffb300';
      } else {
        this.fpsValElement.style.color = '#ff5252';
      }

      this.frameCount = 0;
      this.lastUpdate = now;
    }
  }

  public setVisible(visible: boolean): void {
    this.container.style.display = visible ? 'flex' : 'none';
  }

  public destroy(): void {
    if (this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
  }
}
