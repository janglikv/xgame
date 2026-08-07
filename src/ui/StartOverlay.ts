import * as THREE from 'three';
import { setGameCursor } from './GameCursor';

export interface StartOverlayOptions {
  /** 点击「开始游戏」后回调（仅触发一次） */
  onStart: () => void;
}

/**
 * 开局暂停全屏 HUD：需点击播放按钮后才开始对局。
 * 正交场景 + Canvas 纹理，叠在主画面之上。
 */
export class StartOverlay {
  private static readonly CANVAS_W = 900;
  private static readonly CANVAS_H = 520;
  private static readonly RENDER_SCALE = 2;
  private static readonly PANEL_H = 0.78;
  private static readonly PANEL_ASPECT =
    StartOverlay.CANVAS_W / StartOverlay.CANVAS_H;
  private static readonly MAX_WIDTH_RATIO = 0.72;

  private readonly domElement: HTMLElement;
  private readonly onStart: () => void;

  private readonly uiScene = new THREE.Scene();
  private readonly uiCamera: THREE.OrthographicCamera;
  private readonly root = new THREE.Group();
  private readonly dimMesh: THREE.Mesh;
  private readonly panelMesh: THREE.Mesh;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly panelMat: THREE.MeshBasicMaterial;

  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2();

  private visible = true;
  private dirty = true;
  private pulseT = 0;
  private hoverPlay = false;
  private pressPlay = false;
  private viewW = 1;
  private viewH = 1;

  /** 播放按钮在画布布局坐标中的矩形 */
  private playBtn = { x: 0, y: 0, w: 0, h: 0 };

  private readonly onPointerDown: (e: PointerEvent) => void;
  private readonly onPointerMove: (e: PointerEvent) => void;
  private readonly onPointerUp: (e: PointerEvent) => void;
  private readonly onPointerLeave: () => void;
  private readonly onKeyDown: (e: KeyboardEvent) => void;

  constructor(domElement: HTMLElement, options: StartOverlayOptions) {
    this.domElement = domElement;
    this.onStart = options.onStart;

    this.uiCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    this.uiCamera.position.z = 1;

    this.dimMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial({
        color: 0x04070c,
        transparent: true,
        opacity: 0.78,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.dimMesh.name = 'StartDim';
    this.dimMesh.renderOrder = 0;
    this.dimMesh.position.z = -0.02;
    this.root.add(this.dimMesh);

    this.canvas = document.createElement('canvas');
    this.canvas.width =
      StartOverlay.CANVAS_W * StartOverlay.RENDER_SCALE;
    this.canvas.height =
      StartOverlay.CANVAS_H * StartOverlay.RENDER_SCALE;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable for StartOverlay');
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
    });

    const panelW = StartOverlay.PANEL_H * StartOverlay.PANEL_ASPECT;
    this.panelMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(panelW, StartOverlay.PANEL_H),
      this.panelMat,
    );
    this.panelMesh.name = 'StartPanel';
    this.panelMesh.renderOrder = 1;
    this.panelMesh.position.z = 0;
    this.root.add(this.panelMesh);

    this.root.visible = true;
    this.uiScene.add(this.root);

    this.layoutPlayButton();
    this.redraw();
    this.setSize(16, 9);

    this.onPointerDown = (e: PointerEvent) => {
      if (!this.visible || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      this.pressPlay = this.hitPlay(e.clientX, e.clientY);
      this.hoverPlay = this.pressPlay;
      this.dirty = true;
    };

    this.onPointerMove = (e: PointerEvent) => {
      if (!this.visible) return;
      const hit = this.hitPlay(e.clientX, e.clientY);
      if (hit !== this.hoverPlay) {
        this.hoverPlay = hit;
        this.dirty = true;
      }
      setGameCursor(this.domElement, hit ? 'default' : 'default');
    };

    this.onPointerUp = (e: PointerEvent) => {
      if (!this.visible || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const hit = this.hitPlay(e.clientX, e.clientY);
      if (this.pressPlay && hit) {
        this.start();
      }
      this.pressPlay = false;
      this.hoverPlay = hit;
      this.dirty = true;
    };

    this.onPointerLeave = () => {
      if (!this.visible) return;
      this.hoverPlay = false;
      this.pressPlay = false;
      this.dirty = true;
    };

    this.onKeyDown = (e: KeyboardEvent) => {
      if (!this.visible) return;
      if (e.repeat) return;
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        this.start();
      }
    };

    // capture：优先于游戏指令，避免点到地面移动
    this.domElement.addEventListener('pointerdown', this.onPointerDown, true);
    this.domElement.addEventListener('pointermove', this.onPointerMove, true);
    this.domElement.addEventListener('pointerup', this.onPointerUp, true);
    this.domElement.addEventListener('pointerleave', this.onPointerLeave, true);
    window.addEventListener('keydown', this.onKeyDown);
  }

  get isVisible(): boolean {
    return this.visible;
  }

  /** 脉冲动画（真实时间） */
  update(delta: number): void {
    if (!this.visible) return;
    this.pulseT += delta;
    this.dirty = true;
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

    const baseW = StartOverlay.PANEL_H * StartOverlay.PANEL_ASPECT;
    const baseH = StartOverlay.PANEL_H;
    const maxW = aspect * 2 * StartOverlay.MAX_WIDTH_RATIO;
    const scale = baseW > maxW ? maxW / baseW : 1;
    this.panelMesh.scale.set(scale, scale, 1);

    const worldH = baseH * scale;
    if (worldH > 1.5) {
      const s2 = 1.5 / baseH;
      this.panelMesh.scale.set(s2, s2, 1);
    }
  }

  render(renderer: THREE.WebGLRenderer): void {
    if (!this.visible) return;
    if (this.dirty) this.redraw();

    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.uiScene, this.uiCamera);
    renderer.autoClear = prevAutoClear;
  }

  dispose(): void {
    this.domElement.removeEventListener('pointerdown', this.onPointerDown, true);
    this.domElement.removeEventListener('pointermove', this.onPointerMove, true);
    this.domElement.removeEventListener('pointerup', this.onPointerUp, true);
    this.domElement.removeEventListener('pointerleave', this.onPointerLeave, true);
    window.removeEventListener('keydown', this.onKeyDown);

    this.dimMesh.geometry.dispose();
    (this.dimMesh.material as THREE.Material).dispose();
    this.panelMesh.geometry.dispose();
    this.panelMat.dispose();
    this.texture.dispose();
  }

  private start(): void {
    if (!this.visible) return;
    this.visible = false;
    this.root.visible = false;
    this.pressPlay = false;
    this.hoverPlay = false;
    this.onStart();
  }

  private layoutPlayButton(): void {
    const W = StartOverlay.CANVAS_W;
    const H = StartOverlay.CANVAS_H;
    const bw = 280;
    const bh = 72;
    this.playBtn = {
      x: (W - bw) / 2,
      y: H * 0.58,
      w: bw,
      h: bh,
    };
  }

  private hitPlay(clientX: number, clientY: number): boolean {
    const rect = this.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;

    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -(((clientY - rect.top) / rect.height) * 2 - 1);
    this.pointerNdc.set(x, y);
    this.raycaster.setFromCamera(this.pointerNdc, this.uiCamera);

    const hits = this.raycaster.intersectObject(this.panelMesh, false);
    if (hits.length === 0) return false;
    const uv = hits[0]?.uv;
    if (!uv) return false;
    const px = uv.x * StartOverlay.CANVAS_W;
    const py = (1 - uv.y) * StartOverlay.CANVAS_H;
    const b = this.playBtn;
    return px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h;
  }

  private redraw(): void {
    this.dirty = false;
    const s = StartOverlay.RENDER_SCALE;
    const W = StartOverlay.CANVAS_W;
    const H = StartOverlay.CANVAS_H;
    const ctx = this.ctx;

    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const accent = '#f9a8d4';
    const accentStrong = '#ec4899';
    const accentDim = 'rgba(236, 72, 153, 0.35)';

    // 面板底板
    roundRect(ctx, 40, 40, W - 80, H - 80, 24);
    ctx.fillStyle = 'rgba(8, 14, 24, 0.92)';
    ctx.fill();
    ctx.strokeStyle = accentDim;
    ctx.lineWidth = 2;
    ctx.stroke();

    // 标题
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font =
      '600 22px "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillStyle = 'rgba(249, 168, 212, 0.55)';
    ctx.fillText('LU · O · LU', W / 2, 110);

    ctx.font =
      '700 56px "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
    ctx.fillStyle = accent;
    ctx.shadowColor = 'rgba(236, 72, 153, 0.45)';
    ctx.shadowBlur = 22;
    ctx.fillText('准备就绪', W / 2, 175);
    ctx.shadowBlur = 0;

    ctx.font =
      '500 20px "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillStyle = 'rgba(226, 232, 240, 0.72)';
    ctx.fillText('点击播放开始对局', W / 2, 230);

    // 播放按钮
    const b = this.playBtn;
    const pulse = 0.5 + 0.5 * Math.sin(this.pulseT * 3.2);
    const hovered = this.hoverPlay || this.pressPlay;
    const pressOff = this.pressPlay ? 2 : 0;

    roundRect(ctx, b.x, b.y + pressOff, b.w, b.h, 16);
    const grad = ctx.createLinearGradient(b.x, b.y, b.x + b.w, b.y + b.h);
    if (hovered) {
      grad.addColorStop(0, '#f472b6');
      grad.addColorStop(1, accentStrong);
    } else {
      grad.addColorStop(0, 'rgba(236, 72, 153, 0.88)');
      grad.addColorStop(1, 'rgba(190, 24, 93, 0.95)');
    }
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.strokeStyle = hovered
      ? 'rgba(255, 255, 255, 0.55)'
      : `rgba(255, 255, 255, ${0.22 + pulse * 0.18})`;
    ctx.lineWidth = 2;
    ctx.stroke();

    // 播放三角
    const triCx = b.x + 48;
    const triCy = b.y + b.h / 2 + pressOff;
    ctx.beginPath();
    ctx.moveTo(triCx - 6, triCy - 12);
    ctx.lineTo(triCx - 6, triCy + 12);
    ctx.lineTo(triCx + 14, triCy);
    ctx.closePath();
    ctx.fillStyle = '#fff';
    ctx.fill();

    ctx.font =
      '700 26px "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.fillText('开始游戏', b.x + 78, b.y + b.h / 2 + pressOff + 1);

    ctx.textAlign = 'center';
    ctx.font =
      '400 15px "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillStyle = 'rgba(148, 163, 184, 0.65)';
    ctx.fillText('或按 Enter / Space', W / 2, H - 88);
  }
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
