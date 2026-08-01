/**
 * 左上角 FPS 显示组件
 */
export class FpsOverlay {
  private container: HTMLDivElement;
  private fpsValElement: HTMLSpanElement;
  private msValElement: HTMLSpanElement;
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
      align-items: center;
      gap: 10px;
      padding: 6px 12px;
      background: rgba(11, 15, 20, 0.75);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1;
    `;

    const fpsBlock = document.createElement('div');
    fpsBlock.style.cssText = `
      display: flex;
      align-items: baseline;
      gap: 4px;
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

    fpsBlock.appendChild(this.fpsValElement);
    fpsBlock.appendChild(fpsLabel);

    const divider = document.createElement('div');
    divider.style.cssText = `
      width: 1px;
      height: 12px;
      background: rgba(255, 255, 255, 0.15);
    `;

    const msBlock = document.createElement('div');
    msBlock.style.cssText = `
      display: flex;
      align-items: baseline;
      gap: 2px;
    `;

    this.msValElement = document.createElement('span');
    this.msValElement.textContent = '--';
    this.msValElement.style.cssText = `
      font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
      font-size: 12px;
      font-weight: 600;
      color: rgba(255, 255, 255, 0.7);
      min-width: 28px;
    `;

    const msLabel = document.createElement('span');
    msLabel.textContent = 'ms';
    msLabel.style.cssText = `
      font-size: 10px;
      color: rgba(255, 255, 255, 0.4);
    `;

    msBlock.appendChild(this.msValElement);
    msBlock.appendChild(msLabel);

    this.container.appendChild(fpsBlock);
    this.container.appendChild(divider);
    this.container.appendChild(msBlock);

    document.body.appendChild(this.container);
  }

  public update(): void {
    const now = performance.now();
    this.frameCount++;
    const elapsed = now - this.lastUpdate;

    if (elapsed >= this.updateInterval) {
      const fps = Math.round((this.frameCount * 1000) / elapsed);
      const frameTimeMs = (elapsed / this.frameCount).toFixed(1);

      this.fpsValElement.textContent = `${fps}`;
      this.msValElement.textContent = `${frameTimeMs}`;

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
