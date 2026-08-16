import type { Scene } from '@babylonjs/core';
import {
  AdvancedDynamicTexture,
  Checkbox,
  Control,
  Grid,
  Rectangle,
  StackPanel,
  TextBlock,
} from '@babylonjs/gui';
import { type GraphicsQuality } from '../storage/graphicsQuality';
import type { CameraMode } from '../storage/settingsState';

/**
 * ESC 全屏半透明设置面板（Babylon GUI 全屏 ADT，非 HTML DOM）。
 * 绑定到当前渲染 Scene；场景切换时调用 rebind 挂到新 Scene。
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
  getCameraInfo: () => SettingsCameraInfo;
  onOpenChange?: (open: boolean) => void;
}

const UI_FONT = 'PingFang SC, Microsoft YaHei, Noto Sans SC, Segoe UI, sans-serif';
const MONO_FONT = 'Consolas, Monaco, monospace';

function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

function fmt(n: number, digits = 2): string {
  return n.toFixed(digits);
}

export class SettingsPanel {
  private tex!: AdvancedDynamicTexture;
  private panel!: Rectangle;
  private fpsCheck!: Checkbox;
  private bgmCheck!: Checkbox;
  private invincibleCheck!: Checkbox;
  private gfxLowCheck!: Checkbox;
  private gfxMidCheck!: Checkbox;
  private gfxHighCheck!: Checkbox;
  private gfxHint!: TextBlock;
  private freeCheck!: Checkbox;
  private fixedCheck!: Checkbox;
  private camAlpha!: TextBlock;
  private camBeta!: TextBlock;
  private camRadius!: TextBlock;
  private camTarget!: TextBlock;
  private camModeHint!: TextBlock;
  private opened = false;
  /** 避免互斥勾选时递归触发 */
  private syncingModeUi = false;
  private syncingGfxUi = false;
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
    this.tex.dispose();
    this.opened = false;
    this.buildUi(scene);
    if (wasOpen) {
      // 只恢复视觉，不重复通知（相机/输入已由调用方按目标场景处理）
      this.applyOpenVisual(true);
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

    const stack = new StackPanel('settingsStack');
    stack.width = '480px';
    stack.isVertical = true;
    stack.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    stack.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    stack.paddingTop = '48px';
    stack.paddingBottom = '16px';
    stack.paddingLeft = '20px';
    stack.paddingRight = '20px';
    this.panel.addControl(stack);

    stack.addControl(
      this.makeText('title', '设置  ·  Esc 关闭', {
        fontSize: 18,
        fontWeight: '700',
        height: 24,
        color: 'rgba(255,255,255,0.94)',
      }),
    );

    this.addSection(stack, 'secGameplay', '功能');
    const invincible = this.makeMiniToggle(
      'invincibleRow',
      '无敌',
      this.deps.getIsInvincible(),
      (checked) => this.deps.setIsInvincible(checked),
    );
    this.invincibleCheck = invincible.check;
    const bgm = this.makeMiniToggle(
      'bgmRow',
      '背景音乐',
      this.deps.getBgmEnabled(),
      (checked) => this.deps.setBgmEnabled(checked),
    );
    this.bgmCheck = bgm.check;
    stack.addControl(this.gridRow('fnRow', [invincible.row, bgm.row]));

    this.addSection(stack, 'secGfx', '画质');
    const gfxLow = this.makeMiniToggle(
      'gfxLow',
      '低',
      this.deps.getGraphicsQuality() === 'low',
      (checked) => {
        if (this.syncingGfxUi) return;
        if (checked) this.applyGfxFromUi('low');
        else this.syncGfxChecks(this.deps.getGraphicsQuality());
      },
    );
    this.gfxLowCheck = gfxLow.check;
    const gfxMid = this.makeMiniToggle(
      'gfxMid',
      '中',
      this.deps.getGraphicsQuality() === 'medium',
      (checked) => {
        if (this.syncingGfxUi) return;
        if (checked) this.applyGfxFromUi('medium');
        else this.syncGfxChecks(this.deps.getGraphicsQuality());
      },
    );
    this.gfxMidCheck = gfxMid.check;
    const gfxHigh = this.makeMiniToggle(
      'gfxHigh',
      '高',
      this.deps.getGraphicsQuality() === 'high',
      (checked) => {
        if (this.syncingGfxUi) return;
        if (checked) this.applyGfxFromUi('high');
        else this.syncGfxChecks(this.deps.getGraphicsQuality());
      },
    );
    this.gfxHighCheck = gfxHigh.check;
    stack.addControl(this.gridRow('gfxRow', [gfxLow.row, gfxMid.row, gfxHigh.row]));
    this.gfxHint = this.makeText(
      'gfxHint',
      '阴影/分辨率即时；模型下次进场景更新',
      {
        fontSize: 11,
        height: 16,
        color: 'rgba(255,255,255,0.36)',
      },
    );
    stack.addControl(this.gfxHint);

    this.addSection(stack, 'secDisplay', '显示');
    const fps = this.makeMiniToggle(
      'fpsRow',
      'FPS',
      this.deps.getShowFps(),
      (checked) => this.deps.setShowFps(checked),
    );
    this.fpsCheck = fps.check;
    const grid = this.makeMiniToggle(
      'gridRow',
      '坐标网格',
      this.deps.getShowGrid(),
      (checked) => this.deps.setShowGrid(checked),
    );
    const colliders = this.makeMiniToggle(
      'collidersRow',
      '碰撞盒',
      this.deps.getShowColliders(),
      (checked) => this.deps.setShowColliders(checked),
    );
    stack.addControl(this.gridRow('visRow', [fps.row, grid.row, colliders.row]));

    this.addSection(stack, 'secMode', '镜头');
    const fixed = this.makeMiniToggle(
      'fixedCamRow',
      '俯视',
      this.deps.getCameraMode() === 'fixed',
      (checked) => {
        if (this.syncingModeUi) return;
        if (checked) this.applyModeFromUi('fixed');
        else this.applyModeFromUi('free');
      },
    );
    this.fixedCheck = fixed.check;
    const free = this.makeMiniToggle(
      'freeCamRow',
      '自由',
      this.deps.getCameraMode() === 'free',
      (checked) => {
        if (this.syncingModeUi) return;
        if (checked) this.applyModeFromUi('free');
        else this.applyModeFromUi('fixed');
      },
    );
    this.freeCheck = free.check;
    stack.addControl(this.gridRow('camRow', [fixed.row, free.row]));
    this.camModeHint = this.makeText(
      'modeHint',
      this.modeHintText(this.deps.getCameraMode()),
      {
        fontSize: 11,
        height: 16,
        color: 'rgba(255,255,255,0.36)',
      },
    );
    stack.addControl(this.camModeHint);

    this.addSection(stack, 'secCam', '镜头参数');
    const camPair1 = this.gridRow('camPair1', []);
    this.camAlpha = this.makeMonoCell(camPair1, 'camAlpha', 'α', 0);
    this.camBeta = this.makeMonoCell(camPair1, 'camBeta', 'β', 1);
    stack.addControl(camPair1);
    const camPair2 = this.gridRow('camPair2', []);
    this.camRadius = this.makeMonoCell(camPair2, 'camRadius', '距', 0);
    this.camTarget = this.makeMonoCell(camPair2, 'camTarget', '点', 1);
    stack.addControl(camPair2);
  }

  private modeHintText(mode: CameraMode): string {
    return mode === 'fixed'
      ? '俯视锁定，WASD 相对镜头'
      : '可拖拽旋转 / 滚轮缩放';
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
    this.camModeHint.text = this.modeHintText(mode);
  }

  private syncModeChecks(mode: CameraMode): void {
    this.syncingModeUi = true;
    this.freeCheck.isChecked = mode === 'free';
    this.fixedCheck.isChecked = mode === 'fixed';
    this.syncingModeUi = false;
  }

  private addSection(parent: StackPanel, name: string, title: string): void {
    parent.addControl(this.spacer(10));
    parent.addControl(
      this.makeText(name, title, {
        fontSize: 11,
        height: 16,
        color: 'rgba(255,255,255,0.42)',
        fontWeight: '600',
      }),
    );
  }

  private gridRow(name: string, cells: Control[]): Grid {
    const cols = Math.max(cells.length, 2);
    const g = new Grid(name);
    g.width = '100%';
    g.height = '28px';
    for (let i = 0; i < cols; i++) g.addColumnDefinition(1 / cols);
    g.addRowDefinition(1);
    cells.forEach((cell, i) => {
      cell.width = '100%';
      g.addControl(cell, 0, i);
    });
    return g;
  }

  private makeMiniToggle(
    name: string,
    label: string,
    checked: boolean,
    onChange: (checked: boolean) => void,
  ): { row: Rectangle; check: Checkbox } {
    const row = new Rectangle(name);
    row.width = '100%';
    row.height = '26px';
    row.thickness = 0;
    row.background = 'transparent';

    const tb = this.makeText(`${name}_label`, label, {
      fontSize: 13,
      height: 26,
      color: 'rgba(255,255,255,0.92)',
    });
    tb.width = '72%';
    tb.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    row.addControl(tb);

    const check = new Checkbox(`${name}_check`);
    check.width = '16px';
    check.height = '16px';
    check.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
    check.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    check.paddingRight = '4px';
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

  private makeMonoCell(
    parent: Grid,
    name: string,
    key: string,
    col: number,
  ): TextBlock {
    const cell = new Rectangle(`${name}Row`);
    cell.width = '100%';
    cell.height = '20px';
    cell.thickness = 0;
    cell.background = 'transparent';
    parent.addControl(cell, 0, col);

    const keyTb = new TextBlock(`${name}Key`);
    keyTb.text = key;
    keyTb.color = 'rgba(255,255,255,0.4)';
    keyTb.fontSize = 11;
    keyTb.width = '22px';
    keyTb.height = '20px';
    keyTb.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    keyTb.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    keyTb.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    keyTb.fontFamily = UI_FONT;
    cell.addControl(keyTb);

    const val = new TextBlock(`${name}Val`);
    val.text = '-';
    val.color = 'rgba(255,255,255,0.88)';
    val.fontSize = 11;
    val.height = '20px';
    val.left = '22px';
    val.width = '80%';
    val.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    val.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    val.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    val.fontFamily = MONO_FONT;
    val.textWrapping = true;
    cell.addControl(val);
    return val;
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
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
      this.fpsCheck.isChecked = this.deps.getShowFps();
      this.bgmCheck.isChecked = this.deps.getBgmEnabled();
      this.invincibleCheck.isChecked = this.deps.getIsInvincible();
      this.syncGfxChecks(this.deps.getGraphicsQuality());
      this.syncModeChecks(this.deps.getCameraMode());
      this.camModeHint.text = this.modeHintText(this.deps.getCameraMode());
      this.refreshCamera();
    }
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
    if (!this.opened) return;
    this.refreshCamera();
  }

  private refreshCamera(): void {
    const c = this.deps.getCameraInfo();
    this.camAlpha.text = `${fmt(radToDeg(c.alpha), 1)}\u00b0`;
    this.camBeta.text = `${fmt(radToDeg(c.beta), 1)}\u00b0`;
    this.camRadius.text = fmt(c.radius, 2);
    this.camTarget.text = `${fmt(c.targetX, 1)},${fmt(c.targetY, 1)},${fmt(c.targetZ, 1)}`;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('keydown', this.onKeyDown);
    this.tex.dispose();
  }
}
