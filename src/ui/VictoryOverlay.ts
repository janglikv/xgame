import * as THREE from 'three';

export type MatchResult = 'victory' | 'defeat';

/**
 * 胜负结算全屏 HUD：水晶摧毁后显示胜利 / 失败。
 * 正交场景 + Canvas 纹理，叠在主画面之上。
 */
export class VictoryOverlay {
  private static readonly CANVAS_W = 1200;
  private static readonly CANVAS_H = 560;
  private static readonly RENDER_SCALE = 2;
  private static readonly PANEL_H = 0.72;
  private static readonly PANEL_ASPECT =
    VictoryOverlay.CANVAS_W / VictoryOverlay.CANVAS_H;
  private static readonly MAX_WIDTH_RATIO = 0.78;

  private readonly uiScene = new THREE.Scene();
  private readonly uiCamera: THREE.OrthographicCamera;
  private readonly root = new THREE.Group();
  private readonly dimMesh: THREE.Mesh;
  private readonly panelMesh: THREE.Mesh;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly panelMat: THREE.MeshBasicMaterial;

  private result: MatchResult | null = null;
  private dirty = true;
  private appearT = 0;
  private viewW = 1;
  private viewH = 1;

  constructor() {
    this.uiCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    this.uiCamera.position.z = 1;

    this.dimMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial({
        color: 0x04070c,
        transparent: true,
        opacity: 0.72,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.dimMesh.name = 'VictoryDim';
    this.dimMesh.renderOrder = 0;
    this.dimMesh.position.z = -0.02;
    this.root.add(this.dimMesh);

    this.canvas = document.createElement('canvas');
    this.canvas.width =
      VictoryOverlay.CANVAS_W * VictoryOverlay.RENDER_SCALE;
    this.canvas.height =
      VictoryOverlay.CANVAS_H * VictoryOverlay.RENDER_SCALE;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable for VictoryOverlay');
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    this.panelMat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      opacity: 0,
    });

    const panelW = VictoryOverlay.PANEL_H * VictoryOverlay.PANEL_ASPECT;
    this.panelMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(panelW, VictoryOverlay.PANEL_H),
      this.panelMat,
    );
    this.panelMesh.name = 'VictoryPanel';
    this.panelMesh.renderOrder = 1;
    this.panelMesh.position.z = 0;
    this.root.add(this.panelMesh);

    this.root.visible = false;
    this.uiScene.add(this.root);

    this.setSize(16, 9);
    this.redraw();
  }

  get isVisible(): boolean {
    return this.result !== null;
  }

  get matchResult(): MatchResult | null {
    return this.result;
  }

  /** 展示结算；重复调用同一结果会被忽略 */
  show(result: MatchResult): void {
    if (this.result === result) return;
    this.result = result;
    this.appearT = 0;
    this.root.visible = true;
    this.panelMat.opacity = 0;
    (this.dimMesh.material as THREE.MeshBasicMaterial).opacity = 0;
    this.dirty = true;
    this.redraw();
  }

  /** 淡入动画（真实时间） */
  update(delta: number): void {
    if (!this.result) return;
    this.appearT = Math.min(1, this.appearT + delta / 0.45);
    const t = easeOutCubic(this.appearT);
    this.panelMat.opacity = t;
    (this.dimMesh.material as THREE.MeshBasicMaterial).opacity = 0.72 * t;
    // 轻微上浮入场
    this.panelMesh.position.y = (1 - t) * -0.08;
  }

  setSize(width: number, height: number): void {
    this.viewW = Math.max(width, 1);
    this.viewH = Math.max(height, 1);
    const aspect = this.viewW / this.viewH;
    this.uiCamera.left = -aspect;
    this.uiCamera.right = aspect;
    this.uiCamera.top = 1;
    this.uiCamera.bottom = -1;
    this.uiCamera.updateProjectionMatrix();

    this.dimMesh.scale.set(aspect, 1, 1);

    const baseW = VictoryOverlay.PANEL_H * VictoryOverlay.PANEL_ASPECT;
    const baseH = VictoryOverlay.PANEL_H;
    const maxW = aspect * 2 * VictoryOverlay.MAX_WIDTH_RATIO;
    const scale = baseW > maxW ? maxW / baseW : 1;
    this.panelMesh.scale.set(scale, scale, 1);

    const worldH = baseH * scale;
    if (worldH > 1.4) {
      const s2 = 1.4 / baseH;
      this.panelMesh.scale.set(s2, s2, 1);
    }
  }

  render(renderer: THREE.WebGLRenderer): void {
    if (!this.result) return;
    if (this.dirty) this.redraw();

    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.uiScene, this.uiCamera);
    renderer.autoClear = prevAutoClear;
  }

  dispose(): void {
    this.dimMesh.geometry.dispose();
    (this.dimMesh.material as THREE.Material).dispose();
    this.panelMesh.geometry.dispose();
    this.panelMat.dispose();
    this.texture.dispose();
  }

  private redraw(): void {
    this.dirty = false;
    const s = VictoryOverlay.RENDER_SCALE;
    const W = VictoryOverlay.CANVAS_W;
    const H = VictoryOverlay.CANVAS_H;
    const ctx = this.ctx;

    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const victory = this.result === 'victory';
    const accent = victory ? '#f5d76e' : '#f87171';
    const accentDim = victory ? 'rgba(245, 215, 110, 0.35)' : 'rgba(248, 113, 113, 0.32)';
    const title = victory ? '胜利' : '失败';
    const subtitle = victory ? 'VICTORY' : 'DEFEAT';
    const detail = victory
      ? '敌方基地水晶已被摧毁'
      : '我方基地水晶已被摧毁';

    // 半透明面板底板
    roundRect(ctx, 48, 56, W - 96, H - 112, 22);
    ctx.fillStyle = 'rgba(8, 14, 24, 0.88)';
    ctx.fill();
    ctx.strokeStyle = accentDim;
    ctx.lineWidth = 2;
    ctx.stroke();

    // 上下装饰线
    const lineY1 = 148;
    const lineY2 = H - 150;
    ctx.strokeStyle = accentDim;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(120, lineY1);
    ctx.lineTo(W - 120, lineY1);
    ctx.moveTo(120, lineY2);
    ctx.lineTo(W - 120, lineY2);
    ctx.stroke();

    // 中心菱形光点装饰
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.85;
    drawDiamond(ctx, W / 2, lineY1, 7);
    drawDiamond(ctx, W / 2, lineY2, 7);
    ctx.globalAlpha = 1;

    // 英文副标题
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '600 28px "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillStyle = accentDim;
    ctx.fillText(subtitle, W / 2, 190);

    // 主标题
    ctx.font =
      '700 120px "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
    ctx.fillStyle = accent;
    ctx.shadowColor = victory
      ? 'rgba(245, 215, 110, 0.55)'
      : 'rgba(248, 113, 113, 0.45)';
    ctx.shadowBlur = 28;
    ctx.fillText(title, W / 2, H / 2 + 8);
    ctx.shadowBlur = 0;

    // 说明
    ctx.font =
      '500 26px "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillStyle = 'rgba(226, 232, 240, 0.78)';
    ctx.fillText(detail, W / 2, H - 190);

    ctx.font =
      '400 18px "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillStyle = 'rgba(148, 163, 184, 0.7)';
    ctx.fillText('刷新页面可重新开始', W / 2, H - 148);
  }
}

function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawDiamond(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy - size);
  ctx.lineTo(cx + size, cy);
  ctx.lineTo(cx, cy + size);
  ctx.lineTo(cx - size, cy);
  ctx.closePath();
  ctx.fill();
}
