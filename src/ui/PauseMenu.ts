import { Container, Graphics, Text } from 'pixi.js';

import { DebugConfig } from '../utils/DebugConfig';

export type PauseMenuOptions = {
  onResume: () => void;
  onBack: () => void;
  /** 预览模式：返回地图编辑 */
  onEditMap?: () => void;
  /** 自定义「返回」文案，如「返回编辑」 */
  backLabel?: string;
};

type PauseButton = {
  root: Container;
  bg: Graphics;
  label: Text;
  width: number;
  height: number;
  baseColor: number;
  hoverColor: number;
};

/**
 * 关卡暂停层：半透明遮罩 + 面板 + 继续 / 返回主场景。
 * 自身是 Container，由场景 addChild；visible 表示是否打开。
 */
export class PauseMenu extends Container {
  private readonly veil: Graphics;
  private readonly panel: Graphics;
  private readonly title: Text;
  private readonly debugBtnLabel: Text;
  private readonly buttons: PauseButton[] = [];

  constructor(options: PauseMenuOptions) {
    super();
    this.label = 'PauseMenu';
    this.visible = false;
    this.eventMode = 'static';

    this.veil = new Graphics();
    this.addChild(this.veil);

    this.panel = new Graphics();
    this.addChild(this.panel);

    this.title = new Text({
      text: '暂停',
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 32,
        fontWeight: '700',
        fill: 0xffffff,
      },
    });
    this.title.anchor.set(0.5);
    this.addChild(this.title);

    this.buttons.push(
      this.createButton('继续', 0x4caf50, 0x66c96a, options.onResume),
    );

    const debugBtn = this.createButton(
      this.getDebugBtnText(),
      0x3d5c8a,
      0x527ab0,
      () => {
        DebugConfig.toggleDebug();
        this.updateDebugBtnText();
      },
    );
    this.debugBtnLabel = debugBtn.label;
    this.buttons.push(debugBtn);

    if (options.onEditMap) {
      this.buttons.push(
        this.createButton('继续编辑', 0x3d8a6a, 0x52b08a, options.onEditMap),
      );
    }
    this.buttons.push(
      this.createButton(
        options.backLabel ?? '返回主场景',
        0x5a6a8a,
        0x7a8ab0,
        options.onBack,
      ),
    );

    DebugConfig.onChange(() => {
      this.updateDebugBtnText();
    });
  }

  private getDebugBtnText(): string {
    return `碰撞&受击框: ${DebugConfig.isDebugEnabled() ? '开启' : '关闭'}`;
  }

  private updateDebugBtnText(): void {
    if (this.debugBtnLabel) {
      this.debugBtnLabel.text = this.getDebugBtnText();
    }
  }

  setOpen(open: boolean): void {
    this.visible = open;
    if (open) {
      this.updateDebugBtnText();
    }
  }

  layout(width: number, height: number): void {
    this.veil
      .clear()
      .rect(0, 0, width, height)
      .fill({ color: 0x000000, alpha: 0.5 });

    const n = this.buttons.length;
    const panelW = 320;
    const panelH = n > 3 ? 360 : 310;
    const px = (width - panelW) / 2;
    const py = (height - panelH) / 2;

    this.panel
      .clear()
      .roundRect(px + 4, py + 6, panelW, panelH, 20)
      .fill({ color: 0x000000, alpha: 0.3 })
      .roundRect(px, py, panelW, panelH, 20)
      .fill({ color: 0x1e2838, alpha: 0.95 })
      .roundRect(px + 2, py + 2, panelW - 4, panelH - 4, 18)
      .stroke({ width: 2, color: 0xffffff, alpha: 0.12 });

    this.title.position.set(width / 2, py + 40);

    const gap = 14;
    const totalBtnH =
      this.buttons.reduce((s, b) => s + b.height, 0) +
      gap * (this.buttons.length - 1);
    const startY = py + (panelH - 50 - totalBtnH) / 2 + 50;
    let y = startY;

    for (const btn of this.buttons) {
      btn.root.pivot.set(btn.width / 2, btn.height / 2);
      btn.root.position.set(width / 2, y + btn.height / 2);
      y += btn.height + gap;
    }
  }

  private createButton(
    text: string,
    baseColor: number,
    hoverColor: number,
    onClick: () => void,
  ): PauseButton {
    const width = 220;
    const height = 52;
    const root = new Container();
    root.eventMode = 'static';
    root.cursor = 'pointer';

    const bg = new Graphics();
    paintButton(bg, width, height, baseColor);
    root.addChild(bg);

    const label = new Text({
      text,
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 20,
        fontWeight: '600',
        fill: 0xffffff,
      },
    });
    label.anchor.set(0.5);
    label.position.set(width / 2, height / 2);
    root.addChild(label);

    root.on('pointerover', () => {
      paintButton(bg, width, height, hoverColor);
      root.scale.set(1.04);
    });
    root.on('pointerout', () => {
      paintButton(bg, width, height, baseColor);
      root.scale.set(1);
    });
    root.on('pointertap', (e) => {
      e.stopPropagation();
      onClick();
    });

    this.addChild(root);
    return { root, bg, label, width, height, baseColor, hoverColor };
  }
}

function paintButton(
  g: Graphics,
  w: number,
  h: number,
  color: number,
): void {
  g.clear();
  g.roundRect(3, 4, w, h, 14).fill({ color: 0x000000, alpha: 0.25 });
  g.roundRect(0, 0, w, h, 14).fill({ color });
  g.roundRect(8, 6, w - 16, 10, 6).fill({ color: 0xffffff, alpha: 0.15 });
}
