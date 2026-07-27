import { Container, Graphics, Text } from 'pixi.js';

import { DebugConfig } from '../utils/DebugConfig';
import { NightConfig } from '../utils/NightConfig';

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
 * 重构版关卡暂停层：
 * 1. 开关选项 (夜晚 / Debug) 横向并排，大幅节省纵向空间。
 * 2. 面板高度根据内容动态自适应，永远完美包裹无遗漏。
 * 3. 强化 UI 质感与层次分割。
 */
export class PauseMenu extends Container {
  private readonly veil: Graphics;
  private readonly panel: Graphics;
  private readonly divider: Graphics;
  private readonly title: Text;
  private readonly debugBtnLabel: Text;
  private readonly nightBtnLabel: Text;

  private readonly resumeBtn: PauseButton;
  private readonly nightBtn: PauseButton;
  private readonly debugBtn: PauseButton;
  private readonly editBtn?: PauseButton;
  private readonly backBtn: PauseButton;

  constructor(options: PauseMenuOptions) {
    super();
    this.label = 'PauseMenu';
    this.visible = false;
    this.eventMode = 'static';

    this.veil = new Graphics();
    this.addChild(this.veil);

    this.panel = new Graphics();
    this.addChild(this.panel);

    this.divider = new Graphics();
    this.addChild(this.divider);

    this.title = new Text({
      text: '游戏暂停',
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 26,
        fontWeight: '700',
        fill: 0xffffff,
      },
    });
    this.title.anchor.set(0.5);
    this.addChild(this.title);

    // 1. 继续游戏主按钮
    this.resumeBtn = this.createButton('继续游戏', 240, 48, 0x4caf50, 0x66c96a, options.onResume);

    // 2. 横向并排开关 (夜晚 / Debug)
    this.nightBtn = this.createButton(
      this.getNightBtnText(),
      115,
      42,
      0x2c4a6e,
      0x3e6594,
      () => {
        NightConfig.toggleNight();
        this.updateNightBtnText();
      },
    );
    this.nightBtnLabel = this.nightBtn.label;

    this.debugBtn = this.createButton(
      this.getDebugBtnText(),
      115,
      42,
      0x3d5c8a,
      0x527ab0,
      () => {
        DebugConfig.toggleDebug();
        this.updateDebugBtnText();
      },
    );
    this.debugBtnLabel = this.debugBtn.label;

    // 3. 继续编辑 (可选)
    if (options.onEditMap) {
      this.editBtn = this.createButton('继续编辑', 240, 46, 0x3d8a6a, 0x52b08a, options.onEditMap);
    }

    // 4. 返回主场景
    this.backBtn = this.createButton(
      options.backLabel ?? '返回主场景',
      240,
      46,
      0x5a6a8a,
      0x7a8ab0,
      options.onBack,
    );

    DebugConfig.onChange(() => {
      this.updateDebugBtnText();
    });

    NightConfig.onChange(() => {
      this.updateNightBtnText();
    });
  }

  private getDebugBtnText(): string {
    return `Debug: ${DebugConfig.isDebugEnabled() ? '开' : '关'}`;
  }

  private updateDebugBtnText(): void {
    if (this.debugBtnLabel) {
      this.debugBtnLabel.text = this.getDebugBtnText();
    }
  }

  private getNightBtnText(): string {
    return `夜晚: ${NightConfig.isNightEnabled() ? '开' : '关'}`;
  }

  private updateNightBtnText(): void {
    if (this.nightBtnLabel) {
      this.nightBtnLabel.text = this.getNightBtnText();
    }
  }

  setOpen(open: boolean): void {
    this.visible = open;
    if (open) {
      this.updateDebugBtnText();
      this.updateNightBtnText();
    }
  }

  layout(width: number, height: number): void {
    // 全屏半透明遮罩
    this.veil
      .clear()
      .rect(0, 0, width, height)
      .fill({ color: 0x000000, alpha: 0.55 });

    const panelW = 340;
    // 动态自适应面板高度：包含标题 + 顶栏 + 按钮组
    const numRows = 3 + (this.editBtn ? 1 : 0);
    const panelH = Math.max(320, 110 + numRows * 54);

    const px = (width - panelW) / 2;
    const py = (height - panelH) / 2;

    // 面板背景与描边
    this.panel
      .clear()
      .roundRect(px + 4, py + 6, panelW, panelH, 20)
      .fill({ color: 0x000000, alpha: 0.35 })
      .roundRect(px, py, panelW, panelH, 20)
      .fill({ color: 0x1b2432, alpha: 0.96 })
      .roundRect(px + 2, py + 2, panelW - 4, panelH - 4, 18)
      .stroke({ width: 2, color: 0xffffff, alpha: 0.14 });

    // 标题
    this.title.position.set(width / 2, py + 38);

    // 装饰分割线
    this.divider
      .clear()
      .rect(px + 30, py + 62, panelW - 60, 1)
      .fill({ color: 0xffffff, alpha: 0.12 });

    let currentY = py + 86;

    // 行 1：继续游戏主按钮
    this.resumeBtn.root.pivot.set(this.resumeBtn.width / 2, this.resumeBtn.height / 2);
    this.resumeBtn.root.position.set(width / 2, currentY + this.resumeBtn.height / 2);
    currentY += this.resumeBtn.height + 12;

    // 行 2：设置开关并排行 (夜晚 | Debug)
    const row2Y = currentY + this.nightBtn.height / 2;
    this.nightBtn.root.pivot.set(this.nightBtn.width / 2, this.nightBtn.height / 2);
    this.nightBtn.root.position.set(width / 2 - 65, row2Y);

    this.debugBtn.root.pivot.set(this.debugBtn.width / 2, this.debugBtn.height / 2);
    this.debugBtn.root.position.set(width / 2 + 65, row2Y);
    currentY += this.nightBtn.height + 12;

    // 行 3 (可选)：继续编辑
    if (this.editBtn) {
      this.editBtn.root.pivot.set(this.editBtn.width / 2, this.editBtn.height / 2);
      this.editBtn.root.position.set(width / 2, currentY + this.editBtn.height / 2);
      currentY += this.editBtn.height + 12;
    }

    // 行 4：返回主场景
    this.backBtn.root.pivot.set(this.backBtn.width / 2, this.backBtn.height / 2);
    this.backBtn.root.position.set(width / 2, currentY + this.backBtn.height / 2);
  }

  private createButton(
    text: string,
    width: number,
    height: number,
    baseColor: number,
    hoverColor: number,
    onClick: () => void,
  ): PauseButton {
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
        fontSize: width < 150 ? 16 : 19,
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
  g.clear()
    .roundRect(0, 0, w, h, 12)
    .fill({ color })
    .roundRect(1, 1, w - 2, Math.floor(h / 2), 10)
    .fill({ color: 0xffffff, alpha: 0.12 });
}
