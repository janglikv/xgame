import type { Scene } from '@babylonjs/core';
import {
  AdvancedDynamicTexture,
  Control,
  Rectangle,
} from '@babylonjs/gui';

/**
 * 全屏黑场遮罩（Babylon GUI，非 HTML）。
 * 绑定当前渲染 Scene；场景切换时 rebind，可保留 alpha。
 */
export class FadeOverlay {
  private tex!: AdvancedDynamicTexture;
  private veil!: Rectangle;
  private alpha = 0;
  private disposed = false;

  constructor(scene: Scene) {
    this.buildUi(scene);
  }

  /** 0 = 全透明，1 = 纯黑 */
  getAlpha(): number {
    return this.alpha;
  }

  setAlpha(value: number): void {
    const a = Math.max(0, Math.min(1, value));
    this.alpha = a;
    this.veil.alpha = a;
    // alpha≈0 时隐藏，避免挡拾取；有遮罩时拦截指针
    const on = a > 0.001;
    this.veil.isVisible = on;
    this.veil.isPointerBlocker = on;
    this.tex.rootContainer.isHitTestVisible = on;
  }

  /**
   * 切换绑定 Scene。默认保留当前黑场进度（传送切场景时需全程保持全黑）。
   */
  rebind(scene: Scene, preserveAlpha = true): void {
    if (this.disposed) return;
    const kept = preserveAlpha ? this.alpha : 0;
    this.tex.dispose();
    this.buildUi(scene);
    this.setAlpha(kept);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.tex.dispose();
  }

  private buildUi(scene: Scene): void {
    this.tex = AdvancedDynamicTexture.CreateFullscreenUI(
      'FadeOverlayUI',
      true,
      scene,
    );
    this.tex.idealWidth = 1280;
    // 盖在 FPS / 设置之上，避免切场景时露出 UI 字
    if (this.tex.layer) {
      this.tex.layer.layerMask = 0x0fffffff;
    }
    this.tex.rootContainer.isHitTestVisible = false;

    this.veil = new Rectangle('fadeVeil');
    this.veil.width = '100%';
    this.veil.height = '100%';
    this.veil.thickness = 0;
    this.veil.background = '#000000';
    this.veil.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    this.veil.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    this.veil.isVisible = false;
    this.veil.isPointerBlocker = false;
    this.veil.alpha = 0;
    this.tex.addControl(this.veil);
  }
}
