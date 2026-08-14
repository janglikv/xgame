import type { Scene } from '@babylonjs/core';
import {
  AdvancedDynamicTexture,
  Button,
  Control,
  Rectangle,
  StackPanel,
  TextBlock,
} from '@babylonjs/gui';

const UI_FONT = 'PingFang SC, Microsoft YaHei, Noto Sans SC, Segoe UI, sans-serif';

/**
 * 极简死亡半透明黑场与复活转场 UI（Babylon GUI 全屏 ADT）。
 *
 * 死亡流程：
 * 1. 死亡淡入：从 0 平滑过渡到 0.72 半透明黑场，显示「已 阵 亡」与【重 生】按钮。
 * 2. 点击【重 生】：UI 面板消失，背景在 0.15s 内转为纯黑屏；
 * 3. 完全纯黑时刻：触发 onRespawnClick（完成传送阵瞬移、满血与起立）；
 * 4. 逐渐明亮：纯黑遮罩在 0.5s 内平滑淡出（1 -> 0），呈现明亮的传送阵复活画面。
 */
export class DeathOverlay {
  private tex!: AdvancedDynamicTexture;
  private veil!: Rectangle;
  private panel!: StackPanel;
  private titleText!: TextBlock;
  private respawnBtn!: Button;

  private fadeState: 'idle' | 'in' | 'to_black' | 'from_black' = 'idle';
  private fadeAlpha = 0;
  private disposed = false;
  /** 仅 show() 后允许触发 onRespawnClick，避免 activate/hide 误重生 */
  private awaitingRespawn = false;

  public onRespawnClick?: () => void;

  constructor(scene: Scene) {
    this.buildUi(scene);
  }

  show(): void {
    if (this.disposed) return;
    this.awaitingRespawn = true;
    this.fadeState = 'in';
    this.panel.isVisible = true;
    this.veil.background = 'rgba(0, 0, 0, 0.72)';
    this.veil.isVisible = true;
    this.veil.isPointerBlocker = true;
    this.tex.rootContainer.isHitTestVisible = true;
  }

  /** 点击复活：先变完全纯黑屏，再逐渐明亮 */
  startRespawnTransition(): void {
    if (this.disposed) return;
    this.panel.isVisible = false;
    this.veil.background = '#000000';
    this.fadeState = 'to_black';
  }

  /** 立即关闭死亡 UI，不触发重生回调（进关 / 切场景重置用） */
  hide(): void {
    if (this.disposed) return;
    this.awaitingRespawn = false;
    this.fadeState = 'idle';
    this.fadeAlpha = 0;
    this.veil.alpha = 0;
    this.veil.background = 'rgba(0, 0, 0, 0.72)';
    this.veil.isVisible = false;
    this.veil.isPointerBlocker = false;
    this.tex.rootContainer.isHitTestVisible = false;
    this.panel.isVisible = true;
  }

  getIsVisible(): boolean {
    return this.fadeAlpha > 0.01 || this.fadeState !== 'idle';
  }

  update(dt: number): void {
    if (this.disposed) return;

    if (this.fadeState === 'in') {
      this.fadeAlpha = Math.min(1, this.fadeAlpha + dt * 2.5);
      this.veil.alpha = this.fadeAlpha;
      if (this.fadeAlpha >= 1) {
        this.fadeState = 'idle';
      }
    } else if (this.fadeState === 'to_black') {
      // 1. 快速变纯黑屏 (约 0.15s)
      this.fadeAlpha = Math.min(1, this.fadeAlpha + dt * 6.5);
      this.veil.alpha = this.fadeAlpha;
      if (this.fadeAlpha >= 1) {
        // 2. 完全纯黑时刻：仅在阵亡 show() 后触发重生
        if (this.awaitingRespawn) {
          this.awaitingRespawn = false;
          this.onRespawnClick?.();
        }
        // 3. 转入从纯黑逐渐明亮过程
        this.fadeState = 'from_black';
      }
    } else if (this.fadeState === 'from_black') {
      // 4. 逐渐明亮 (约 0.5s)
      this.fadeAlpha = Math.max(0, this.fadeAlpha - dt * 2.0);
      this.veil.alpha = this.fadeAlpha;
      if (this.fadeAlpha <= 0) {
        this.fadeState = 'idle';
        this.veil.isVisible = false;
        this.veil.isPointerBlocker = false;
        this.tex.rootContainer.isHitTestVisible = false;
        this.veil.background = 'rgba(0, 0, 0, 0.72)';
        this.panel.isVisible = true;
      }
    }
  }

  rebind(scene: Scene): void {
    if (this.disposed) return;
    const keptAlpha = this.fadeAlpha;
    const keptState = this.fadeState;
    const keptAwaiting = this.awaitingRespawn;
    this.tex.dispose();
    this.buildUi(scene);
    this.fadeAlpha = keptAlpha;
    this.fadeState = keptState;
    this.awaitingRespawn = keptAwaiting;
    this.veil.alpha = keptAlpha;
    const on = keptAlpha > 0.01 || keptState !== 'idle';
    this.veil.isVisible = on;
    this.veil.isPointerBlocker = on;
    this.tex.rootContainer.isHitTestVisible = on;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.tex.dispose();
  }

  private buildUi(scene: Scene): void {
    this.tex = AdvancedDynamicTexture.CreateFullscreenUI(
      'DeathOverlayUI',
      true,
      scene,
    );
    this.tex.idealWidth = 1280;
    this.tex.rootContainer.isHitTestVisible = false;

    // 1. 全屏半透明黑色遮罩背景 (0.72 半透明度)
    this.veil = new Rectangle('deathVeil');
    this.veil.width = '100%';
    this.veil.height = '100%';
    this.veil.thickness = 0;
    this.veil.background = 'rgba(0, 0, 0, 0.72)';
    this.veil.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    this.veil.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    this.veil.isVisible = false;
    this.veil.isPointerBlocker = false;
    this.veil.alpha = 0;

    // 2. 居中面板 StackPanel
    this.panel = new StackPanel('deathPanel');
    this.panel.width = '360px';
    this.panel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    this.panel.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    this.veil.addControl(this.panel);

    // 3. 按钮上方的「已 阵 亡」提示文案
    this.titleText = new TextBlock('deathTitle', '已 阵 亡');
    this.titleText.height = '48px';
    this.titleText.color = '#ff4455';
    this.titleText.fontSize = 28;
    this.titleText.fontFamily = UI_FONT;
    this.titleText.fontWeight = 'bold';
    this.titleText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    this.panel.addControl(this.titleText);

    // 间距留白 (20px)
    const spacer = new Rectangle('spacer');
    spacer.height = '20px';
    spacer.thickness = 0;
    this.panel.addControl(spacer);

    // 4. 极简【重 生】胶囊磨砂按钮
    this.respawnBtn = Button.CreateSimpleButton(
      'respawnBtn',
      '重 生',
    );
    this.respawnBtn.width = '160px';
    this.respawnBtn.height = '46px';
    this.respawnBtn.color = 'rgba(255, 255, 255, 0.95)';
    this.respawnBtn.fontSize = 17;
    this.respawnBtn.fontFamily = UI_FONT;
    this.respawnBtn.fontWeight = 'bold';
    this.respawnBtn.background = 'rgba(255, 255, 255, 0.10)';
    this.respawnBtn.cornerRadius = 23;
    this.respawnBtn.thickness = 1.2;
    this.respawnBtn.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;

    // 悬停动效
    this.respawnBtn.onPointerEnterObservable.add(() => {
      this.respawnBtn.background = 'rgba(255, 255, 255, 0.25)';
      this.respawnBtn.color = '#ffffff';
    });
    this.respawnBtn.onPointerOutObservable.add(() => {
      this.respawnBtn.background = 'rgba(255, 255, 255, 0.10)';
      this.respawnBtn.color = 'rgba(255, 255, 255, 0.95)';
    });

    // 点击事件
    this.respawnBtn.onPointerClickObservable.add(() => {
      this.startRespawnTransition();
    });

    this.panel.addControl(this.respawnBtn);
    this.tex.addControl(this.veil);
  }
}
