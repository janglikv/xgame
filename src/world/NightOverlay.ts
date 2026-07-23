import { Container, Graphics } from 'pixi.js';

/**
 * 叠在白天场景上的黑夜效果（仅环境地面）：
 * 1) multiply 冷色层 — 草地/花整体压暗并偏蓝
 * 2) 半透明遮罩 — 再压一层环境暗度
 *
 * 应夹在「草坪」与「角色/怪/特效」之间，或只盖 worldMap。
 * 松树用 tint 单独压暗，勿用本层盖住 sortLayer。
 */
export class NightOverlay extends Container {
  private readonly multiply: Graphics;
  private readonly shade: Graphics;
  private viewW = 0;
  private viewH = 0;

  constructor() {
    super();
    this.label = 'NightOverlay';
    this.eventMode = 'none';

    this.multiply = new Graphics();
    this.multiply.label = 'NightMultiply';
    this.multiply.blendMode = 'multiply';
    this.addChild(this.multiply);

    this.shade = new Graphics();
    this.shade.label = 'NightShade';
    this.addChild(this.shade);
  }

  layout(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    if (width === this.viewW && height === this.viewH) return;
    this.viewW = width;
    this.viewH = height;

    // 冷蓝乘色：把白天的绿草/花压成夜色
    this.multiply
      .clear()
      .rect(0, 0, width, height)
      .fill({ color: 0x263a60 });

    // 额外压暗，避免 multiply 后仍偏亮
    this.shade
      .clear()
      .rect(0, 0, width, height)
      .fill({ color: 0x03070e, alpha: 0.62 });
  }
}

/** 关卡背景色（默认黑夜） */
export function getNightBackground(): number {
  // 偏暗底，避免 letterbox 露亮绿
  return 0x0b1524;
}

/** @deprecated 使用 getNightBackground */
export function getThemeBackground(theme: 'day' | 'night' = 'night'): number {
  return theme === 'night' ? getNightBackground() : 0x5a8f3c;
}
