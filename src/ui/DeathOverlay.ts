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
 * 极简死亡半透明黑场与复活按钮 UI（Babylon GUI 全屏 ADT）。
 * 保持 0.72 半透明黑场遮罩，中央包含「已 阵 亡」提示与【重 生】胶囊磨砂按钮。
 */
export class DeathOverlay {
  private tex!: AdvancedDynamicTexture;
  private veil!: Rectangle;
  private panel!: StackPanel;
  private titleText!: TextBlock;
  private respawnBtn!: Button;

  private fadeState: 'idle' | 'in' | 'out' = 'idle';
  private fadeAlpha = 0;
  private disposed = false;

  public onRespawnClick?: () => void;

  constructor(scene: Scene) {
    this.buildUi(scene);
  }

  show(): void {
    if (this.disposed) return;
    this.fadeState = 'in';
    this.veil.isVisible = true;
    this.veil.isPointerBlocker = true;
    this.tex.rootContainer.isHitTestVisible = true;
  }

  hide(): void {
    if (this.disposed) return;
    this.fadeState = 'out';
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
    } else if (this.fadeState === 'out') {
      this.fadeAlpha = Math.max(0, this.fadeAlpha - dt * 3.2);
      this.veil.alpha = this.fadeAlpha;
      if (this.fadeAlpha <= 0) {
        this.fadeState = 'idle';
        this.veil.isVisible = false;
        this.veil.isPointerBlocker = false;
        this.tex.rootContainer.isHitTestVisible = false;
      }
    }
  }

  rebind(scene: Scene): void {
    if (this.disposed) return;
    const keptAlpha = this.fadeAlpha;
    const keptState = this.fadeState;
    this.tex.dispose();
    this.buildUi(scene);
    this.fadeAlpha = keptAlpha;
    this.fadeState = keptState;
    this.veil.alpha = keptAlpha;
    const on = keptAlpha > 0.01 || keptState === 'in';
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
    this.titleText.color = '#ff4455'; // 典雅红
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
    this.respawnBtn.background = 'rgba(255, 255, 255, 0.10)'; // 高级半透明磨砂质感
    this.respawnBtn.cornerRadius = 23; // 胶囊圆角
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
      this.hide();
      this.onRespawnClick?.();
    });

    this.panel.addControl(this.respawnBtn);
    this.tex.addControl(this.veil);
  }
}
