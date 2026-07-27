import { Container, Graphics } from 'pixi.js';
import { NightConfig } from '../utils/NightConfig';

/**
 * 屏幕空间夜晚遮罩：始终铺满当前视口（与地图尺寸 / 镜头缩放无关）。
 * 挂在 LevelScene 上、worldRoot 之上 / HUD 之下，随窗口 resize 更新。
 */
export class NightOverlay extends Container {
  private readonly shade: Graphics;
  private viewW = 1;
  private viewH = 1;
  private unsubscribe: (() => void) | null = null;

  constructor() {
    super();
    this.label = 'NightOverlay';
    this.eventMode = 'none';

    this.shade = new Graphics();
    this.shade.label = 'NightShade';
    this.addChild(this.shade);

    this.unsubscribe = NightConfig.onChange(() => {
      this.redraw();
    });

    this.redraw();
  }

  /**
   * 按屏幕像素铺满视口（左上角原点，与 HUD 同坐标系）。
   */
  layout(width: number, height: number): void {
    this.viewW = Math.max(1, width);
    this.viewH = Math.max(1, height);
    this.position.set(0, 0);
    this.redraw();
  }

  private redraw(): void {
    const isNight = NightConfig.isNightEnabled();
    this.visible = isNight;

    if (!isNight) {
      this.shade.clear();
      return;
    }

    // 深夜黑影蒙版：固定盖住整个屏幕
    this.shade
      .clear()
      .rect(0, 0, this.viewW, this.viewH)
      .fill({ color: 0x01040a, alpha: 0.88 });
  }

  destroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    super.destroy();
  }
}

/** 关卡背景色 */
export function getNightBackground(): number {
  return 0x071b2d;
}
