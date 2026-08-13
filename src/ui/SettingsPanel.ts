import type { Scene } from '@babylonjs/core';
import {
  AdvancedDynamicTexture,
  Checkbox,
  Control,
  Rectangle,
  StackPanel,
  TextBlock,
} from '@babylonjs/gui';
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
    stack.width = '520px';
    stack.isVertical = true;
    stack.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    stack.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    stack.paddingTop = '28px';
    stack.paddingBottom = '28px';
    stack.paddingLeft = '40px';
    stack.paddingRight = '40px';
    this.panel.addControl(stack);

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

    // —— 显示 ——
    stack.addControl(this.spacer(16));
    stack.addControl(
      this.makeText('secDisplay', '显示', {
        fontSize: 13,
        height: 24,
        color: 'rgba(255,255,255,0.45)',
        fontWeight: '600',
      }),
    );
    stack.addControl(this.spacer(4));

    const fpsRow = this.makeToggleRow(
      'fpsRow',
      '显示 FPS',
      this.deps.getShowFps(),
      (checked) => this.deps.setShowFps(checked),
    );
    this.fpsCheck = fpsRow.check;
    stack.addControl(fpsRow.row);

    const gridRow = this.makeToggleRow(
      'gridRow',
      '显示坐标系网格',
      this.deps.getShowGrid(),
      (checked) => this.deps.setShowGrid(checked),
    );
    stack.addControl(gridRow.row);

    const collidersRow = this.makeToggleRow(
      'collidersRow',
      '显示隐形盒体（调试）',
      this.deps.getShowColliders(),
      (checked) => this.deps.setShowColliders(checked),
    );
    stack.addControl(collidersRow.row);

    // —— 镜头模式 ——
    stack.addControl(this.spacer(16));
    stack.addControl(
      this.makeText('secMode', '镜头模式', {
        fontSize: 13,
        height: 24,
        color: 'rgba(255,255,255,0.45)',
        fontWeight: '600',
      }),
    );
    stack.addControl(this.spacer(4));

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

    // —— 镜头读数 ——
    stack.addControl(this.spacer(16));
    stack.addControl(
      this.makeText('secCam', '镜头参数', {
        fontSize: 13,
        height: 24,
        color: 'rgba(255,255,255,0.45)',
        fontWeight: '600',
      }),
    );
    stack.addControl(this.spacer(4));

    this.camAlpha = this.makeMonoLine(stack, 'camAlpha', '方位角 α');
    this.camBeta = this.makeMonoLine(stack, 'camBeta', '仰角 β');
    this.camRadius = this.makeMonoLine(stack, 'camRadius', '距离');
    this.camTarget = this.makeMonoLine(stack, 'camTarget', '注视点');

    stack.addControl(this.spacer(16));
    stack.addControl(
      this.makeText(
        'foot',
        '俯视：角色居中，WASD 相对镜头移动；自由：轨道拖拽；Esc 键关闭',
        {
          fontSize: 12,
          height: 28,
          color: 'rgba(255,255,255,0.4)',
        },
      ),
    );
  }

  private modeHintText(mode: CameraMode): string {
    return mode === 'fixed'
      ? '略倾俯视锁定：角色居中，可看侧身，不可拖拽'
      : '调试用轨道相机：可拖拽旋转与滚轮缩放';
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

    const fpsLabel = this.makeText(`${name}_label`, label, {
      fontSize: 15,
      height: 32,
      color: 'rgba(255,255,255,0.92)',
    });
    fpsLabel.width = '70%';
    fpsLabel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    row.addControl(fpsLabel);

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
