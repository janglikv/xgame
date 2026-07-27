import { Container, Graphics } from 'pixi.js';
import { NightConfig } from '../utils/NightConfig';

/**
 * 环境夜晚效果遮罩（全局无硬边月夜幽蓝蒙版）：
 * 当【夜晚模式】开关开启时全屏通透压暗，关闭时完全隐藏恢复白天明亮。
 */
export class NightOverlay extends Container {
  private readonly shade: Graphics;
  private extentW = 4000;
  private extentH = 4000;
  private unsubscribe: (() => void) | null = null;

  constructor() {
    super();
    this.label = 'NightOverlay';
    this.eventMode = 'none';

    this.shade = new Graphics();
    this.shade.label = 'NightShade';
    this.addChild(this.shade);

    // 订阅夜晚模式全局状态变动
    this.unsubscribe = NightConfig.onChange(() => {
      this.updateState();
    });

    this.updateState();
  }

  /**
   * 扩展布局范围（覆盖整片视野与海域）
   */
  layout(width: number, height: number): void {
    this.extentW = Math.max(width * 2, 4000);
    this.extentH = Math.max(height * 2, 4000);
    this.updateState();
  }

  /**
   * 刷新夜晚遮罩显示与调色
   */
  private updateState(): void {
    const isNight = NightConfig.isNightEnabled();
    this.visible = isNight;

    if (!isNight) {
      this.shade.clear();
      return;
    }

    const hw = this.extentW / 2;
    const hh = this.extentH / 2;

    // 极其漆黑浓重的深夜黑影蒙版 (Pitch Black Midnight)
    this.shade
      .clear()
      .rect(-hw, -hh, this.extentW, this.extentH)
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
