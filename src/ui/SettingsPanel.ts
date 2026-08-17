import type { Scene } from '@babylonjs/core';
import {
  AdvancedDynamicTexture,
  Button,
  Checkbox,
  Control,
  Grid,
  Rectangle,
  StackPanel,
  TextBlock,
} from '@babylonjs/gui';
import {
  HIT_SFX_OPTIONS,
  previewHitSfx,
  type HitSfxId,
} from '../audio/hitSfx';
import {
  GRAPHICS_LABELS,
  type GraphicsQuality,
} from '../storage/graphicsQuality';
import type { CameraMode } from '../storage/settingsState';

/**
 * ESC 全屏半透明设置面板（Babylon GUI 全屏 ADT，非 HTML DOM）。
 * 主页只放玩家选项；开发者调试页仅本地 dev 显示入口，build 不带按钮。
 */

export interface SettingsCameraInfo {
  alpha: number;
  beta: number;
  radius: number;
  targetX: number;
  targetY: number;
  targetZ: number;
}

export interface SettingsPanelDeps {
  getShowFps: () => boolean;
  setShowFps: (show: boolean) => void;
  getShowGrid: () => boolean;
  setShowGrid: (show: boolean) => void;
  getShowColliders: () => boolean;
  setShowColliders: (show: boolean) => void;
  getIsInvincible: () => boolean;
  setIsInvincible: (invincible: boolean) => void;
  getBgmEnabled: () => boolean;
  setBgmEnabled: (enabled: boolean) => void;
  getGraphicsQuality: () => GraphicsQuality;
  setGraphicsQuality: (quality: GraphicsQuality) => void;
  getCameraMode: () => CameraMode;
  setCameraMode: (mode: CameraMode) => void;
  getHitSfxId: () => HitSfxId;
  setHitSfxId: (id: HitSfxId) => void;
  getCameraInfo: () => SettingsCameraInfo;
  onOpenChange?: (open: boolean) => void;
}

const UI_FONT = 'PingFang SC, Microsoft YaHei, Noto Sans SC, Segoe UI, sans-serif';
const MONO_FONT = 'Consolas, Monaco, monospace';
const IS_DEV = import.meta.env.DEV;

function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

function fmt(n: number, digits = 2): string {
  return n.toFixed(digits);
}

export class SettingsPanel {
  private tex!: AdvancedDynamicTexture;
  private panel!: Rectangle;
  private mainStack!: StackPanel;
  private debugStack?: StackPanel;
  private page: 'main' | 'debug' = 'main';

  private bgmCheck!: Checkbox;
  private fpsCheck!: Checkbox;
  private gfxLowCheck!: Checkbox;
  private gfxMidCheck!: Checkbox;
  private gfxHighCheck!: Checkbox;

  private gridCheck?: Checkbox;
  private collidersCheck?: Checkbox;
  private invincibleCheck?: Checkbox;
  private freeCheck?: Checkbox;
  private fixedCheck?: Checkbox;
  private camAlpha?: TextBlock;
  private camBeta?: TextBlock;
  private camRadius?: TextBlock;
  private camTarget?: TextBlock;
  private camModeHint?: TextBlock;
  private readonly hitSfxChecks = new Map<HitSfxId, Checkbox>();

  private opened = false;
  /** 避免互斥勾选时递归触发 */
  private syncingModeUi = false;
  private syncingGfxUi = false;
  private syncingHitSfxUi = false;
  private disposed = false;

  constructor(
    scene: Scene,
    private readonly deps: SettingsPanelDeps,
  ) {
    this.buildUi(scene);
    window.addEventListener('keydown', this.onKeyDown);
  }

  /**
   * 切换绑定 Scene（枢纽 ↔ 空白）。保留打开状态与键盘监听。
   * Babylon GUI 的 ADT 绑定在 Scene 上，只渲染当前 Scene 时必须 rebind。
   */
  rebind(scene: Scene): void {
    if (this.disposed) return;
    const wasOpen = this.opened;
    const page = this.page;
    this.tex.dispose();
    this.opened = false;
    this.buildUi(scene);
    if (wasOpen) {
      this.applyOpenVisual(true);
      this.showPage(page);
    }
  }

  private buildUi(scene: Scene): void {
    this.tex = AdvancedDynamicTexture.CreateFullscreenUI(
      'SettingsPanelUI',
      true,
      scene,
    );
    this.tex.idealWidth = 1280;
    this.tex.rootContainer.isHitTestVisible = false;

    this.panel = new Rectangle('settingsFullscreen');
    this.panel.width = '100%';
    this.panel.height = '100%';
    this.panel.thickness = 0;
    this.panel.background = 'rgba(0, 0, 0, 0.92)';
    this.panel.isVisible = false;
    this.panel.isPointerBlocker = true;
    this.tex.addControl(this.panel);

    this.mainStack = this.makePageStack('settingsMain');
    this.panel.addControl(this.mainStack);
    this.buildMainPage(this.mainStack);

    if (IS_DEV) {
      this.debugStack = this.makePageStack('settingsDebug');
      this.debugStack.isVisible = false;
      this.panel.addControl(this.debugStack);
      this.buildDebugPage(this.debugStack);
    } else {
      this.debugStack = undefined;
    }

    this.page = 'main';
  }

  private buildMainPage(stack: StackPanel): void {
    stack.addControl(
      this.makeText('title', '设置', {
        fontSize: 26,
        fontWeight: '700',
        height: 36,
        color: 'rgba(255,255,255,0.94)',
      }),
    );
    stack.addControl(
      this.makeText('hint', '按 Esc 关闭', {
        fontSize: 13,
        height: 20,
        color: 'rgba(255,255,255,0.45)',
      }),
    );

    this.addSection(stack, 'secAudio', '音频');
    const bgmRow = this.makeToggleRow(
      'bgmRow',
      '背景音乐',
      this.deps.getBgmEnabled(),
      (checked) => this.deps.setBgmEnabled(checked),
    );
    this.bgmCheck = bgmRow.check;
    stack.addControl(bgmRow.row);

    this.addSection(stack, 'secDisplay', '显示');
    const fpsRow = this.makeToggleRow(
      'fpsRow',
      '显示 FPS',
      this.deps.getShowFps(),
      (checked) => this.deps.setShowFps(checked),
    );
    this.fpsCheck = fpsRow.check;
    stack.addControl(fpsRow.row);

    this.addSection(stack, 'secGfx', '画质');
    const gfxLow = this.makeToggleRow(
      'gfxLow',
      GRAPHICS_LABELS.low,
      this.deps.getGraphicsQuality() === 'low',
      (checked) => {
        if (this.syncingGfxUi) return;
        if (checked) this.applyGfxFromUi('low');
        else this.syncGfxChecks(this.deps.getGraphicsQuality());
      },
    );
    this.gfxLowCheck = gfxLow.check;
    stack.addControl(gfxLow.row);

    const gfxMid = this.makeToggleRow(
      'gfxMid',
      GRAPHICS_LABELS.medium,
      this.deps.getGraphicsQuality() === 'medium',
      (checked) => {
        if (this.syncingGfxUi) return;
        if (checked) this.applyGfxFromUi('medium');
        else this.syncGfxChecks(this.deps.getGraphicsQuality());
      },
    );
    this.gfxMidCheck = gfxMid.check;
    stack.addControl(gfxMid.row);

    const gfxHigh = this.makeToggleRow(
      'gfxHigh',
      GRAPHICS_LABELS.high,
      this.deps.getGraphicsQuality() === 'high',
      (checked) => {
        if (this.syncingGfxUi) return;
        if (checked) this.applyGfxFromUi('high');
        else this.syncGfxChecks(this.deps.getGraphicsQuality());
      },
    );
    this.gfxHighCheck = gfxHigh.check;
    stack.addControl(gfxHigh.row);

    stack.addControl(this.spacer(2));
    stack.addControl(
      this.makeText(
        'gfxHint',
        '阴影与分辨率即时生效；模型精度下次进入场景后更新',
        {
          fontSize: 12,
          height: 24,
          color: 'rgba(255,255,255,0.38)',
        },
      ),
    );

    if (IS_DEV) {
      stack.addControl(this.spacer(24));
      stack.addControl(
        this.makeNavButton('openDebug', '开发者调试设置', () =>
          this.showPage('debug'),
        ),
      );
      stack.addControl(this.spacer(6));
      stack.addControl(
        this.makeText('debugHint', '仅本地开发可见，打包后不会出现', {
          fontSize: 12,
          height: 20,
          color: 'rgba(255,255,255,0.32)',
        }),
      );
    }
  }

  private buildDebugPage(stack: StackPanel): void {
    stack.addControl(
      this.makeText('debugTitle', '开发者调试', {
        fontSize: 26,
        fontWeight: '700',
        height: 36,
        color: 'rgba(255,255,255,0.94)',
      }),
    );
    stack.addControl(
      this.makeText('debugEscHint', '按 Esc 返回设置', {
        fontSize: 13,
        height: 20,
        color: 'rgba(255,255,255,0.45)',
      }),
    );

    stack.addControl(this.spacer(12));
    stack.addControl(
      this.makeNavButton('backMain', '返回设置', () => this.showPage('main')),
    );

    this.addSection(stack, 'secGameplay', '战斗与功能');
    const invincibleRow = this.makeToggleRow(
      'invincibleRow',
      '角色无敌（不受伤害）',
      this.deps.getIsInvincible(),
      (checked) => this.deps.setIsInvincible(checked),
    );
    this.invincibleCheck = invincibleRow.check;
    stack.addControl(invincibleRow.row);

    this.addSection(stack, 'secHitSfx', '掉血音效');
    this.hitSfxChecks.clear();
    const original = HIT_SFX_OPTIONS[0]!;
    const originalRow = this.makeToggleRow(
      'hitSfx_original',
      original.label,
      this.deps.getHitSfxId() === original.id,
      (checked) => {
        if (this.syncingHitSfxUi) return;
        if (checked) this.applyHitSfxFromUi(original.id);
        else this.syncHitSfxChecks(this.deps.getHitSfxId());
      },
    );
    this.hitSfxChecks.set(original.id, originalRow.check);
    stack.addControl(originalRow.row);

    const packOpts = HIT_SFX_OPTIONS.slice(1);
    const packCells: Control[] = [];
    for (const opt of packOpts) {
      const row = this.makeToggleRow(
        `hitSfx_${opt.id}`,
        opt.label,
        this.deps.getHitSfxId() === opt.id,
        (checked) => {
          if (this.syncingHitSfxUi) return;
          if (checked) this.applyHitSfxFromUi(opt.id);
          else this.syncHitSfxChecks(this.deps.getHitSfxId());
        },
      );
      this.hitSfxChecks.set(opt.id, row.check);
      packCells.push(row.row);
    }
    stack.addControl(this.gridRow('hitSfxPack1', packCells.slice(0, 5), 5));
    stack.addControl(this.gridRow('hitSfxPack2', packCells.slice(5, 10), 5));
    stack.addControl(this.spacer(2));
    stack.addControl(
      this.makeText('hitSfxHint', '点选即试听，掉血时播放当前项', {
        fontSize: 12,
        height: 20,
        color: 'rgba(255,255,255,0.38)',
      }),
    );

    this.addSection(stack, 'secDisplay', '显示');
    const gridRow = this.makeToggleRow(
      'gridRow',
      '显示坐标系网格',
      this.deps.getShowGrid(),
      (checked) => this.deps.setShowGrid(checked),
    );
    this.gridCheck = gridRow.check;
    stack.addControl(gridRow.row);

    const collidersRow = this.makeToggleRow(
      'collidersRow',
      '显示隐形盒体（调试）',
      this.deps.getShowColliders(),
      (checked) => this.deps.setShowColliders(checked),
    );
    this.collidersCheck = collidersRow.check;
    stack.addControl(collidersRow.row);

    this.addSection(stack, 'secMode', '镜头模式');
    const fixedRow = this.makeToggleRow(
      'fixedCamRow',
      '俯视镜头',
      this.deps.getCameraMode() === 'fixed',
      (checked) => {
        if (this.syncingModeUi) return;
        if (checked) this.applyModeFromUi('fixed');
        else this.applyModeFromUi('free');
      },
    );
    this.fixedCheck = fixedRow.check;
    stack.addControl(fixedRow.row);

    const freeRow = this.makeToggleRow(
      'freeCamRow',
      '自由镜头（调试）',
      this.deps.getCameraMode() === 'free',
      (checked) => {
        if (this.syncingModeUi) return;
        if (checked) this.applyModeFromUi('free');
        else this.applyModeFromUi('fixed');
      },
    );
    this.freeCheck = freeRow.check;
    stack.addControl(freeRow.row);

    this.camModeHint = this.makeText(
      'modeHint',
      this.modeHintText(this.deps.getCameraMode()),
      {
        fontSize: 12,
        height: 24,
        color: 'rgba(255,255,255,0.38)',
      },
    );
    stack.addControl(this.spacer(2));
    stack.addControl(this.camModeHint);

    this.addSection(stack, 'secCam', '镜头参数');
    this.camAlpha = this.makeMonoLine(stack, 'camAlpha', '方位角 α');
    this.camBeta = this.makeMonoLine(stack, 'camBeta', '仰角 β');
    this.camRadius = this.makeMonoLine(stack, 'camRadius', '距离');
    this.camTarget = this.makeMonoLine(stack, 'camTarget', '注视点');
  }

  private showPage(page: 'main' | 'debug'): void {
    if (page === 'debug' && !IS_DEV) page = 'main';
    this.page = page;
    this.mainStack.isVisible = page === 'main';
    if (this.debugStack) this.debugStack.isVisible = page === 'debug';
    if (page === 'debug') this.syncDebugPage();
  }

  private modeHintText(mode: CameraMode): string {
    return mode === 'fixed'
      ? '略倾俯视锁定：角色居中，可看侧身，不可拖拽'
      : '调试用轨道相机：可拖拽旋转与滚轮缩放';
  }

  private applyHitSfxFromUi(id: HitSfxId): void {
    this.deps.setHitSfxId(id);
    this.syncHitSfxChecks(id);
    previewHitSfx(id);
  }

  private syncHitSfxChecks(id: HitSfxId): void {
    this.syncingHitSfxUi = true;
    for (const [optId, check] of this.hitSfxChecks) {
      check.isChecked = optId === id;
    }
    this.syncingHitSfxUi = false;
  }

  private applyGfxFromUi(quality: GraphicsQuality): void {
    this.deps.setGraphicsQuality(quality);
    this.syncGfxChecks(quality);
  }

  private syncGfxChecks(quality: GraphicsQuality): void {
    this.syncingGfxUi = true;
    this.gfxLowCheck.isChecked = quality === 'low';
    this.gfxMidCheck.isChecked = quality === 'medium';
    this.gfxHighCheck.isChecked = quality === 'high';
    this.syncingGfxUi = false;
  }

  private applyModeFromUi(mode: CameraMode): void {
    this.deps.setCameraMode(mode);
    this.syncModeChecks(mode);
    if (this.camModeHint) this.camModeHint.text = this.modeHintText(mode);
  }

  private syncModeChecks(mode: CameraMode): void {
    if (!this.freeCheck || !this.fixedCheck) return;
    this.syncingModeUi = true;
    this.freeCheck.isChecked = mode === 'free';
    this.fixedCheck.isChecked = mode === 'fixed';
    this.syncingModeUi = false;
  }

  private makePageStack(name: string): StackPanel {
    const stack = new StackPanel(name);
    stack.width = '520px';
    stack.isVertical = true;
    stack.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    stack.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    stack.paddingTop = '28px';
    stack.paddingBottom = '28px';
    stack.paddingLeft = '40px';
    stack.paddingRight = '40px';
    return stack;
  }

  private addSection(parent: StackPanel, name: string, title: string): void {
    parent.addControl(this.spacer(16));
    parent.addControl(
      this.makeText(name, title, {
        fontSize: 13,
        height: 24,
        color: 'rgba(255,255,255,0.45)',
        fontWeight: '600',
      }),
    );
    parent.addControl(this.spacer(4));
  }

  private gridRow(name: string, cells: Control[], cols: number): Grid {
    const g = new Grid(name);
    g.width = '100%';
    g.height = '32px';
    for (let i = 0; i < cols; i++) g.addColumnDefinition(1 / cols);
    g.addRowDefinition(1);
    cells.forEach((cell, i) => {
      cell.width = '100%';
      g.addControl(cell, 0, i);
    });
    return g;
  }

  private makeNavButton(
    name: string,
    label: string,
    onClick: () => void,
  ): Button {
    const btn = Button.CreateSimpleButton(name, label);
    btn.width = '100%';
    btn.height = '40px';
    btn.color = 'rgba(255,255,255,0.92)';
    btn.fontSize = 15;
    btn.fontFamily = UI_FONT;
    btn.background = 'rgba(255,255,255,0.10)';
    btn.cornerRadius = 8;
    btn.thickness = 1;
    btn.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    btn.onPointerEnterObservable.add(() => {
      btn.background = 'rgba(255,255,255,0.20)';
    });
    btn.onPointerOutObservable.add(() => {
      btn.background = 'rgba(255,255,255,0.10)';
    });
    btn.onPointerClickObservable.add(() => onClick());
    return btn;
  }

  private makeToggleRow(
    name: string,
    label: string,
    checked: boolean,
    onChange: (checked: boolean) => void,
  ): { row: Rectangle; check: Checkbox } {
    const row = new Rectangle(name);
    row.width = '100%';
    row.height = '32px';
    row.thickness = 0;
    row.background = 'transparent';

    const tb = this.makeText(`${name}_label`, label, {
      fontSize: 15,
      height: 32,
      color: 'rgba(255,255,255,0.92)',
    });
    tb.width = '70%';
    tb.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    row.addControl(tb);

    const check = new Checkbox(`${name}_check`);
    check.width = '20px';
    check.height = '20px';
    check.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
    check.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    check.color = '#34d399';
    check.background = 'rgba(255,255,255,0.12)';
    check.isChecked = checked;
    check.onIsCheckedChangedObservable.add((v) => onChange(v));
    row.addControl(check);

    return { row, check };
  }

  private spacer(px: number): Rectangle {
    const s = new Rectangle(
      `spacer_${px}_${Math.random().toString(36).slice(2, 6)}`,
    );
    s.width = '100%';
    s.height = `${px}px`;
    s.thickness = 0;
    s.background = 'transparent';
    s.isHitTestVisible = false;
    return s;
  }

  private makeText(
    name: string,
    text: string,
    opts: {
      fontSize: number;
      height: number;
      color: string;
      fontWeight?: string;
    },
  ): TextBlock {
    const t = new TextBlock(name);
    t.text = text;
    t.color = opts.color;
    t.fontSize = opts.fontSize;
    t.height = `${opts.height}px`;
    t.width = '100%';
    t.resizeToFit = false;
    t.textWrapping = true;
    t.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    t.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    t.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    t.fontFamily = UI_FONT;
    if (opts.fontWeight) t.fontWeight = opts.fontWeight;
    return t;
  }

  private makeMonoLine(
    parent: StackPanel,
    name: string,
    key: string,
  ): TextBlock {
    const row = new Rectangle(`${name}Row`);
    row.width = '100%';
    row.height = '24px';
    row.thickness = 0;
    row.background = 'transparent';
    parent.addControl(row);

    const keyTb = new TextBlock(`${name}Key`);
    keyTb.text = key;
    keyTb.color = 'rgba(255,255,255,0.45)';
    keyTb.fontSize = 13;
    keyTb.width = '120px';
    keyTb.height = '24px';
    keyTb.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    keyTb.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    keyTb.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    keyTb.fontFamily = UI_FONT;
    row.addControl(keyTb);

    const val = new TextBlock(`${name}Val`);
    val.text = '-';
    val.color = 'rgba(255,255,255,0.92)';
    val.fontSize = 13;
    val.height = '24px';
    val.left = '120px';
    val.width = '70%';
    val.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    val.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    val.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    val.fontFamily = MONO_FONT;
    val.textWrapping = true;
    row.addControl(val);
    return val;
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    if (this.opened && this.page === 'debug') {
      this.showPage('main');
      return;
    }
    this.toggle();
  };

  isOpen(): boolean {
    return this.opened;
  }

  /** 仅改 UI 可见性，不触发 onOpenChange */
  private applyOpenVisual(open: boolean): void {
    this.opened = open;
    this.panel.isVisible = open;
    this.tex.rootContainer.isHitTestVisible = open;
    if (open) {
      this.bgmCheck.isChecked = this.deps.getBgmEnabled();
      this.fpsCheck.isChecked = this.deps.getShowFps();
      this.syncGfxChecks(this.deps.getGraphicsQuality());
      if (this.page === 'debug') this.syncDebugPage();
    } else {
      this.showPage('main');
    }
  }

  private syncDebugPage(): void {
    if (this.gridCheck) this.gridCheck.isChecked = this.deps.getShowGrid();
    if (this.collidersCheck) {
      this.collidersCheck.isChecked = this.deps.getShowColliders();
    }
    if (this.invincibleCheck) {
      this.invincibleCheck.isChecked = this.deps.getIsInvincible();
    }
    this.syncHitSfxChecks(this.deps.getHitSfxId());
    this.syncModeChecks(this.deps.getCameraMode());
    if (this.camModeHint) {
      this.camModeHint.text = this.modeHintText(this.deps.getCameraMode());
    }
    this.refreshCamera();
  }

  open(): void {
    if (this.opened) return;
    this.applyOpenVisual(true);
    this.deps.onOpenChange?.(true);
  }

  close(): void {
    if (!this.opened) return;
    this.applyOpenVisual(false);
    this.deps.onOpenChange?.(false);
  }

  toggle(): void {
    if (this.opened) this.close();
    else this.open();
  }

  update(): void {
    if (!this.opened || this.page !== 'debug') return;
    this.refreshCamera();
  }

  private refreshCamera(): void {
    if (!this.camAlpha || !this.camBeta || !this.camRadius || !this.camTarget) {
      return;
    }
    const c = this.deps.getCameraInfo();
    this.camAlpha.text = `${fmt(radToDeg(c.alpha), 1)}\u00b0  (${fmt(c.alpha, 3)} rad)`;
    this.camBeta.text = `${fmt(radToDeg(c.beta), 1)}\u00b0  (${fmt(c.beta, 3)} rad)`;
    this.camRadius.text = fmt(c.radius, 2);
    this.camTarget.text = `(${fmt(c.targetX)}, ${fmt(c.targetY)}, ${fmt(c.targetZ)})`;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('keydown', this.onKeyDown);
    this.tex.dispose();
  }
}
