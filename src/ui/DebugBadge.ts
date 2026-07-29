import { Container, Graphics, Text } from 'pixi.js';
import { DebugConfig } from '../utils/DebugConfig';
import { TimeScaleConfig } from '../utils/TimeScaleConfig';

/**
 * 屏幕右上角 Debug 状态与时间倍率徽章。
 * - 点击左侧区域：切换 Debug 开关
 * - 点击右侧 ⚡ 区域：循环切换时间倍速 (1x -> 2x -> 5x -> 10x)
 */
export class DebugBadge extends Container {
  private readonly bg: Graphics;
  private readonly debugText: Text;
  private readonly speedText: Text;
  private readonly divider: Graphics;
  private readonly dot: Graphics;

  private currentWidth = 140;

  constructor() {
    super();
    this.label = 'DebugBadge';
    this.eventMode = 'static';
    this.cursor = 'pointer';

    this.bg = new Graphics();
    this.addChild(this.bg);

    this.dot = new Graphics();
    this.addChild(this.dot);

    this.debugText = new Text({
      text: 'Debug: 关',
      style: {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 12,
        fontWeight: '700',
        fill: 0xffffff,
      },
    });
    this.debugText.position.set(24, 6);
    this.addChild(this.debugText);

    this.divider = new Graphics();
    this.addChild(this.divider);

    this.speedText = new Text({
      text: '⚡1x',
      style: {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 12,
        fontWeight: '700',
        fill: 0xffe08a,
      },
    });
    this.addChild(this.speedText);

    this.on('pointertap', (e) => {
      e.stopPropagation();
      const localX = e.getLocalPosition(this).x;
      // 如果点击后半半部分（速度标识），切换速度倍率
      if (localX > this.debugText.width + 30) {
        TimeScaleConfig.toggleNextPreset();
      } else {
        DebugConfig.toggleDebug();
      }
    });

    DebugConfig.onChange(() => {
      this.refresh();
    });

    TimeScaleConfig.onChange(() => {
      this.refresh();
    });

    this.refresh();
  }

  refresh(): void {
    const enabled = DebugConfig.isDebugEnabled();
    const scale = TimeScaleConfig.getScale();

    this.debugText.text = `Debug: ${enabled ? '开' : '关'}`;
    const speedStr = `⚡${scale % 1 === 0 ? scale.toFixed(0) : scale.toFixed(1)}x`;
    this.speedText.text = speedStr;

    // 动态速度高亮颜色 (1x 偏淡, 10x 橙, 50x 红, 100x 紫红亮金)
    if (scale > 1.0) {
      this.speedText.style.fill =
        scale >= 100.0
          ? 0xff0055
          : scale >= 50.0
            ? 0xff3300
            : scale >= 20.0
              ? 0xff6600
              : scale >= 10.0
                ? 0xff9900
                : scale >= 5.0
                  ? 0xffc700
                  : 0xffe08a;
    } else {
      this.speedText.style.fill = 0xb0c4de;
    }

    const debugW = this.debugText.width + 30;
    const dividerX = debugW + 4;
    this.speedText.position.set(dividerX + 10, 6);

    const totalW = dividerX + 10 + this.speedText.width + 12;
    this.currentWidth = totalW;

    const height = 28;

    this.bg
      .clear()
      .roundRect(0, 0, totalW, height, 14)
      .fill({ color: 0x121a24, alpha: 0.88 })
      .roundRect(0, 0, totalW, height, 14)
      .stroke({
        width: 1.5,
        color: scale > 1.0 ? 0xffb74d : enabled ? 0x00ff66 : 0x5a6a8a,
        alpha: 0.8,
      });

    this.dot.clear();
    if (enabled) {
      this.dot
        .circle(13, 14, 4)
        .fill({ color: 0x00ff66, alpha: 1.0 })
        .circle(13, 14, 7)
        .stroke({ width: 1.5, color: 0x00ff66, alpha: 0.5 });
    } else {
      this.dot.circle(13, 14, 4).fill({ color: 0x7a8ab0, alpha: 0.6 });
    }

    this.divider
      .clear()
      .rect(dividerX, 5, 1, 18)
      .fill({ color: 0xffffff, alpha: 0.2 });
  }

  layout(screenWidth: number, _screenHeight: number): void {
    this.position.set(screenWidth - this.currentWidth - 16, 16);
  }
}
