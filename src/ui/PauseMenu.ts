import { Container, Graphics, Text } from 'pixi.js';

import { DebugConfig } from '../utils/DebugConfig';
import { NightConfig } from '../utils/NightConfig';
import { TimeScaleConfig } from '../utils/TimeScaleConfig';
import { confirmAndResetGameData } from '../utils/resetGameData';

export type PauseMenuOptions = {
  onResume: () => void;
  onBack: () => void;
  onResetData?: () => void;
  /** 自定义「返回」文案 */
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
  private readonly speedBtnLabel: Text;

  private readonly resumeBtn: PauseButton;
  private readonly nightBtn: PauseButton;
  private readonly debugBtn: PauseButton;
  private readonly speedDecBtn: PauseButton;
  private readonly speedMainBtn: PauseButton;
  private readonly speedIncBtn: PauseButton;
  private readonly backBtn: PauseButton;
  private readonly resetBtn: PauseButton;

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

    // 3. 时间倍率调节组 (- | 速度: 1.0x | +)
    this.speedDecBtn = this.createButton('-', 42, 42, 0x4a3a6e, 0x665294, () => {
      const current = TimeScaleConfig.getScale();
      const step = current >= 20.0 ? 10.0 : current > 5.0 ? 1.0 : 0.5;
      TimeScaleConfig.decrease(step);
      this.updateSpeedBtnText();
    });

    this.speedMainBtn = this.createButton(
      this.getSpeedBtnText(),
      144,
      42,
      0x6e4a2c,
      0x94653e,
      () => {
        TimeScaleConfig.toggleNextPreset();
        this.updateSpeedBtnText();
      },
    );
    this.speedBtnLabel = this.speedMainBtn.label;

    this.speedIncBtn = this.createButton('+', 42, 42, 0x4a3a6e, 0x665294, () => {
      const current = TimeScaleConfig.getScale();
      const step = current >= 20.0 ? 10.0 : current >= 5.0 ? 1.0 : 0.5;
      TimeScaleConfig.increase(step);
      this.updateSpeedBtnText();
    });

    // 4. 返回主场景
    this.backBtn = this.createButton(
      options.backLabel ?? '返回主场景',
      240,
      44,
      0x5a6a8a,
      0x7a8ab0,
      options.onBack,
    );

    // 5. 重置数据
    this.resetBtn = this.createButton(
      '重置数据',
      240,
      44,
      0x8a3a3a,
      0xaa5a5a,
      () => {
        if (options.onResetData) {
          options.onResetData();
        } else {
          confirmAndResetGameData();
        }
      },
    );

    DebugConfig.onChange(() => {
      this.updateDebugBtnText();
    });

    NightConfig.onChange(() => {
      this.updateNightBtnText();
    });

    TimeScaleConfig.onChange(() => {
      this.updateSpeedBtnText();
    });
  }

  private getSpeedBtnText(): string {
    const s = TimeScaleConfig.getScale();
    return `速度: ${s % 1 === 0 ? s.toFixed(0) : s.toFixed(1)}x`;
  }

  private updateSpeedBtnText(): void {
    if (this.speedBtnLabel) {
      this.speedBtnLabel.text = this.getSpeedBtnText();
    }
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
      this.updateSpeedBtnText();
    }
  }

  layout(width: number, height: number): void {
    // 全屏半透明遮罩
    this.veil
      .clear()
      .rect(0, 0, width, height)
      .fill({ color: 0x000000, alpha: 0.55 });

    const panelW = 340;
    // 动态自适应面板高度：包含标题 + 顶栏 + 5 行按钮组
    const numRows = 5;
    const panelH = Math.max(390, 110 + numRows * 52);

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

    let currentY = py + 82;

    // 行 1：继续游戏主按钮
    this.resumeBtn.root.pivot.set(this.resumeBtn.width / 2, this.resumeBtn.height / 2);
    this.resumeBtn.root.position.set(width / 2, currentY + this.resumeBtn.height / 2);
    currentY += this.resumeBtn.height + 10;

    // 行 2：设置开关并排行 (夜晚 | Debug)
    const row2Y = currentY + this.nightBtn.height / 2;
    this.nightBtn.root.pivot.set(this.nightBtn.width / 2, this.nightBtn.height / 2);
    this.nightBtn.root.position.set(width / 2 - 65, row2Y);

    this.debugBtn.root.pivot.set(this.debugBtn.width / 2, this.debugBtn.height / 2);
    this.debugBtn.root.position.set(width / 2 + 65, row2Y);
    currentY += this.nightBtn.height + 10;

    // 行 3：时间倍率调节 (- | 速度: 1.0x | +)
    const row3Y = currentY + this.speedMainBtn.height / 2;
    this.speedDecBtn.root.pivot.set(this.speedDecBtn.width / 2, this.speedDecBtn.height / 2);
    this.speedDecBtn.root.position.set(width / 2 - 99, row3Y);

    this.speedMainBtn.root.pivot.set(this.speedMainBtn.width / 2, this.speedMainBtn.height / 2);
    this.speedMainBtn.root.position.set(width / 2, row3Y);

    this.speedIncBtn.root.pivot.set(this.speedIncBtn.width / 2, this.speedIncBtn.height / 2);
    this.speedIncBtn.root.position.set(width / 2 + 99, row3Y);
    currentY += this.speedMainBtn.height + 10;

    // 行 4：返回主场景
    this.backBtn.root.pivot.set(this.backBtn.width / 2, this.backBtn.height / 2);
    this.backBtn.root.position.set(width / 2, currentY + this.backBtn.height / 2);
    currentY += this.backBtn.height + 10;

    // 行 5：重置数据
    this.resetBtn.root.pivot.set(this.resetBtn.width / 2, this.resetBtn.height / 2);
    this.resetBtn.root.position.set(width / 2, currentY + this.resetBtn.height / 2);
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
