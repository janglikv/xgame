import { Container, Graphics, Text } from 'pixi.js';

/**
 * 空场景：占位容器，后续可替换为正式关卡 / 菜单场景。
 */
export class EmptyScene extends Container {
  constructor(width: number, height: number) {
    super();
    this.label = 'EmptyScene';

    // 深色背景
    const bg = new Graphics()
      .rect(0, 0, width, height)
      .fill({ color: 0x0b0f14 });
    this.addChild(bg);

    // 居中提示，确认场景已挂载
    const hint = new Text({
      text: 'Empty Scene',
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 28,
        fill: 0x6b7280,
      },
    });
    hint.anchor.set(0.5);
    hint.position.set(width / 2, height / 2);
    this.addChild(hint);
  }

  /** 窗口尺寸变化时由外部调用 */
  resize(width: number, height: number): void {
    const bg = this.children[0] as Graphics | undefined;
    if (bg) {
      bg.clear().rect(0, 0, width, height).fill({ color: 0x0b0f14 });
    }

    const hint = this.children[1] as Text | undefined;
    if (hint) {
      hint.position.set(width / 2, height / 2);
    }
  }
}
