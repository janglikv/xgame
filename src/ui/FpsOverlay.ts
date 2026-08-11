import {
  AdvancedDynamicTexture,
  Control,
  TextBlock,
} from '@babylonjs/gui';
import type { Scene } from '@babylonjs/core';

/**
 * 左上角 FPS（Babylon GUI，非 HTML）。
 */
export class FpsOverlay {
  private readonly tex: AdvancedDynamicTexture;
  private readonly label: TextBlock;
  private frameCount = 0;
  private lastUpdate = performance.now();
  private readonly updateInterval = 250;
  private visible = true;

  constructor(scene: Scene) {
    this.tex = AdvancedDynamicTexture.CreateFullscreenUI(
      'FpsOverlayUI',
      true,
      scene,
    );
    this.tex.idealWidth = 1280;
    this.tex.layer!.layerMask = 0x0fffffff;

    this.label = new TextBlock('fpsLabel');
    this.label.text = '-- FPS';
    this.label.color = '#00e676';
    this.label.fontSize = 16;
    this.label.fontFamily = 'Consolas, Monaco, monospace';
    this.label.fontWeight = '700';
    this.label.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    this.label.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    this.label.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    this.label.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    this.label.left = '12px';
    this.label.top = '12px';
    this.label.width = '120px';
    this.label.height = '28px';
    this.label.resizeToFit = false;
    this.label.isHitTestVisible = false;
    this.tex.addControl(this.label);
  }

  update(): void {
    if (!this.visible) return;
    const now = performance.now();
    this.frameCount++;
    const elapsed = now - this.lastUpdate;
    if (elapsed < this.updateInterval) return;

    const fps = Math.round((this.frameCount * 1000) / elapsed);
    this.label.text = `${fps} FPS`;
    if (fps >= 50) this.label.color = '#00e676';
    else if (fps >= 30) this.label.color = '#ffb300';
    else this.label.color = '#ff5252';

    this.frameCount = 0;
    this.lastUpdate = now;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.label.isVisible = visible;
  }

  dispose(): void {
    this.tex.dispose();
  }
}
