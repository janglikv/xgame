import { Container, Graphics, Text } from 'pixi.js';
import { DebugConfig } from '../utils/DebugConfig';

/**
 * 屏幕右上角 Debug 状态徽章，点击切换开关。
 */
export class DebugBadge extends Container {
  private readonly bg: Graphics;
  private readonly labelText: Text;
  private readonly dot: Graphics;

  constructor() {
    super();
    this.label = 'DebugBadge';
    this.eventMode = 'static';
    this.cursor = 'pointer';

    this.bg = new Graphics();
    this.addChild(this.bg);

    this.dot = new Graphics();
    this.addChild(this.dot);

    this.labelText = new Text({
      text: 'Debug: 关',
      style: {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 12,
        fontWeight: '700',
        fill: 0xffffff,
      },
    });
    this.labelText.position.set(24, 6);
    this.addChild(this.labelText);

    this.on('pointertap', (e) => {
      e.stopPropagation();
      DebugConfig.toggleDebug();
    });

    DebugConfig.onChange(() => {
      this.refresh();
    });

    this.refresh();
  }

  refresh(): void {
    const enabled = DebugConfig.isDebugEnabled();
    const text = `Debug: ${enabled ? '开' : '关'}`;
    this.labelText.text = text;

    const width = this.labelText.width + 36;
    const height = 28;

    this.bg
      .clear()
      .roundRect(0, 0, width, height, 14)
      .fill({ color: 0x121a24, alpha: 0.85 })
      .roundRect(0, 0, width, height, 14)
      .stroke({
        width: 1.5,
        color: enabled ? 0x00ff66 : 0x5a6a8a,
        alpha: enabled ? 0.9 : 0.4,
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
  }

  layout(screenWidth: number, _screenHeight: number): void {
    const width = this.labelText.width + 36;
    // 放在右上角，避开右侧角色切换 HUD (在右中部)
    this.position.set(screenWidth - width - 16, 16);
  }
}
