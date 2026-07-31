import * as THREE from 'three';
import type { CameraParams } from '../controls/CameraController';

export interface EscMenuOptions {
  /** 坐标参考线开关回调 */
  onAxesChange: (visible: boolean) => void;
  /** 碰撞体积白圈开关回调 */
  onColliderMarkersChange: (visible: boolean) => void;
  /**
   * 时间快进：在真实时间 realSeconds 内推进 gameSeconds 游戏时间。
   * 例：(60, 1) 一分钟 / 一秒；(180, 3) 三分钟 / 三秒。
   */
  onSkipTime: (gameSeconds: number, realSeconds: number) => void;
  /** 全局亮度 0~1（1=最亮） */
  onBrightnessChange: (value: number) => void;
  /**
   * 视角模式：true = 锁定（跟随英雄 + 右键点地 / WASD 移动）；
   * false = 自由（WASD 移镜头 / 左键拖拽）。
   */
  onCameraLockChange: (locked: boolean) => void;
  /** 固定相机开关回调 */
  onFixedCameraChange?: (fixed: boolean) => void;
  /** 英雄无敌开关回调 */
  onGodModeChange?: (invincible: boolean) => void;
  /** 自动出兵开关回调 */
  onMinionSpawnChange?: (enabled: boolean) => void;
  /** 防御塔无敌开关回调 */
  onTowerInvincibleChange?: (invincible: boolean) => void;
  /** 面板开/关（用于暂停相机等） */
  onOpenChange?: (open: boolean) => void;
  /** 获取当前相机实时参数 */
  getCameraParams?: () => CameraParams;

  initialAxesVisible?: boolean;
  initialColliderMarkersVisible?: boolean;
  initialBrightness?: number;
  initialCameraLocked?: boolean;
  initialFixedCamera?: boolean;
  initialGodMode?: boolean;
  initialMinionSpawn?: boolean;
  initialTowerInvincible?: boolean;
}

type HitId =
  | 'axes'
  | 'colliders'
  | 'cameraLock'
  | 'fixedCamera'
  | 'godMode'
  | 'minionSpawn'
  | 'towerInvincible'
  | 'brightness'
  | 'skip1m'
  | 'skip3m'
  | 'close'
  | 'dim';

interface HitRegion {
  id: HitId;
  /** 画布像素矩形（左上为原点） */
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * ESC 设置面板：Three.js 正交 HUD + Canvas 纹理绘制。
 * 紧凑型双栏高科技面板。
 *
 * UI 空间：正交相机 top/bottom = ±1（屏高 = 2），left/right = ±aspect。
 * 面板几何按 PANEL_H 构建，窄屏时在 setSize 中等比缩小。
 */
export class EscMenu {
  /**
   * 布局坐标系尺寸（hit-test / 绘制逻辑单位）。
   * 实际纹理像素 = 布局 × RENDER_SCALE，保证 Retina 上不糊。
   */
  private static readonly CANVAS_W = 1400;
  private static readonly CANVAS_H = 700;
  /**
   * 纹理超采样倍率。Retina(dpr=2) 时面板约 2500×1250 设备像素，
   * 2× 布局即可接近 1:1，文字与开关边缘更锐利。
   */
  private static readonly RENDER_SCALE = 2;
  private static readonly PANEL_ASPECT =
    EscMenu.CANVAS_W / EscMenu.CANVAS_H;
  /**
   * 面板在 UI 空间中的目标高度（屏幕高度为 2 → 约 58% 屏高）。
   * 宽高由 CANVAS 纵横比决定，避免被纵向/横向拉变形。
   */
  private static readonly PANEL_H = 1.16;
  /** 面板最大占屏宽比例（相对可视宽度 2*aspect） */
  private static readonly MAX_WIDTH_RATIO = 0.86;

  /** 亮度滑条有效轨道相对 region 的内边距 */
  private static readonly SLIDER_PAD_X = 22;
  private static readonly SLIDER_TRACK_H = 10;

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

  private readonly onAxesChange: (visible: boolean) => void;
  private readonly onColliderMarkersChange: (visible: boolean) => void;
  private readonly onSkipTime: (
    gameSeconds: number,
    realSeconds: number,
  ) => void;
  private readonly onBrightnessChange: (value: number) => void;
  private readonly onCameraLockChange: (locked: boolean) => void;
  private readonly onFixedCameraChange?: (fixed: boolean) => void;
  private readonly onGodModeChange?: (invincible: boolean) => void;
  private readonly onMinionSpawnChange?: (enabled: boolean) => void;
  private readonly onTowerInvincibleChange?: (invincible: boolean) => void;
  private readonly onOpenChange?: (open: boolean) => void;
  private readonly getCameraParams?: () => CameraParams;

  private readonly onKeyDown: (e: KeyboardEvent) => void;
  private readonly onPointerDown: (e: PointerEvent) => void;
  private readonly onPointerMove: (e: PointerEvent) => void;
  private readonly onPointerUp: (e: PointerEvent) => void;
  private readonly onPointerLeave: () => void;

  private readonly domElement: HTMLElement;

  private open = false;
  private axesOn: boolean;
  private collidersOn: boolean;
  /** true = 锁定视角 */
  private cameraLocked: boolean;
  /** true = 固定相机视角 */
  private fixedCameraOn: boolean;
  private godModeOn: boolean;
  private minionSpawnOn: boolean;
  private towerInvincibleOn: boolean;
  /** 全局亮度 0~1 */
  private brightness: number;
  private hoverId: HitId | null = null;
  private pressId: HitId | null = null;
  private draggingBrightness = false;
  private viewW = 1;
  private viewH = 1;
  private regions: HitRegion[] = [];
  private dirty = true;

  constructor(domElement: HTMLElement, options: EscMenuOptions) {
    this.domElement = domElement;
    this.onAxesChange = options.onAxesChange;
    this.onColliderMarkersChange = options.onColliderMarkersChange;
    this.onSkipTime = options.onSkipTime;
    this.onBrightnessChange = options.onBrightnessChange;
    this.onCameraLockChange = options.onCameraLockChange;
    this.onFixedCameraChange = options.onFixedCameraChange;
    this.onGodModeChange = options.onGodModeChange;
    this.onMinionSpawnChange = options.onMinionSpawnChange;
    this.onTowerInvincibleChange = options.onTowerInvincibleChange;
    this.onOpenChange = options.onOpenChange;
    this.getCameraParams = options.getCameraParams;
    this.axesOn = options.initialAxesVisible ?? true;
    this.collidersOn = options.initialColliderMarkersVisible ?? true;
    this.cameraLocked = options.initialCameraLocked ?? false;
    this.fixedCameraOn = options.initialFixedCamera ?? false;
    this.godModeOn = options.initialGodMode ?? false;
    this.minionSpawnOn = options.initialMinionSpawn ?? true;
    this.towerInvincibleOn = options.initialTowerInvincible ?? false;
    this.brightness = THREE.MathUtils.clamp(
      options.initialBrightness ?? 1,
      0,
      1,
    );

    this.uiCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    this.uiCamera.position.z = 1;

    // 全屏半透明遮罩
    this.dimMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial({
        color: 0x060a10,
        transparent: true,
        opacity: 0.68,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.dimMesh.name = 'EscMenuDim';
    this.dimMesh.renderOrder = 0;
    this.dimMesh.position.z = -0.02;
    this.root.add(this.dimMesh);

    // 面板 canvas 纹理（物理像素 = 布局 × RENDER_SCALE）
    this.canvas = document.createElement('canvas');
    this.canvas.width = EscMenu.CANVAS_W * EscMenu.RENDER_SCALE;
    this.canvas.height = EscMenu.CANVAS_H * EscMenu.RENDER_SCALE;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
    // 文本更锐利（仍走布局坐标，靠 transform 超采样）
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.anisotropy = 1;

    this.panelMat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    const panelW = EscMenu.PANEL_H * EscMenu.PANEL_ASPECT;
    this.panelMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(panelW, EscMenu.PANEL_H),
      this.panelMat,
    );
    this.panelMesh.name = 'EscMenuPanel';
    this.panelMesh.renderOrder = 1;
    this.panelMesh.position.z = 0;
    this.root.add(this.panelMesh);

    this.root.visible = false;
    this.uiScene.add(this.root);

    this.layoutRegions();
    this.redraw();
    // 默认按 16:9 占位，避免 setSize 调用前相机仍是 1:1 导致面板左右被裁切
    this.setSize(16, 9);

    this.onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return;
      e.preventDefault();
      this.setOpen(!this.open);
    };

    this.onPointerDown = (e: PointerEvent) => {
      if (!this.open || e.button !== 0) return;
      e.preventDefault();
      const id = this.hitTest(e.clientX, e.clientY);
      this.pressId = id;
      this.setHover(id);
      if (id === 'brightness') {
        this.draggingBrightness = true;
        try {
          this.domElement.setPointerCapture(e.pointerId);
        } catch {
          // ignore capture failures
        }
        this.applyBrightnessFromPointer(e.clientX, e.clientY);
      }
    };

    this.onPointerMove = (e: PointerEvent) => {
      if (!this.open) return;
      if (this.draggingBrightness) {
        this.applyBrightnessFromPointer(e.clientX, e.clientY);
        this.domElement.style.cursor = 'pointer';
        return;
      }
      this.setHover(this.hitTest(e.clientX, e.clientY));
      this.updateCursor();
    };

    this.onPointerUp = (e: PointerEvent) => {
      if (!this.open || e.button !== 0) return;
      if (this.draggingBrightness) {
        this.draggingBrightness = false;
        this.pressId = null;
        try {
          if (this.domElement.hasPointerCapture(e.pointerId)) {
            this.domElement.releasePointerCapture(e.pointerId);
          }
        } catch {
          // ignore
        }
        this.setHover(this.hitTest(e.clientX, e.clientY));
        this.updateCursor();
        return;
      }
      const id = this.hitTest(e.clientX, e.clientY);
      if (id && id === this.pressId) this.activate(id);
      this.pressId = null;
      this.setHover(id);
      this.updateCursor();
    };

    this.onPointerLeave = () => {
      this.draggingBrightness = false;
      this.pressId = null;
      this.setHover(null);
      if (this.open) this.domElement.style.cursor = 'default';
    };

    window.addEventListener('keydown', this.onKeyDown);
    this.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.domElement.addEventListener('pointermove', this.onPointerMove);
    this.domElement.addEventListener('pointerup', this.onPointerUp);
    this.domElement.addEventListener('pointerleave', this.onPointerLeave);
  }

  get isOpen(): boolean {
    return this.open;
  }

  setOpen(open: boolean): void {
    if (this.open === open) return;
    this.open = open;
    this.root.visible = open;
    this.hoverId = null;
    this.pressId = null;
    this.draggingBrightness = false;
    this.dirty = true;
    if (!open) {
      this.domElement.style.cursor = 'grab';
    } else {
      this.updateCursor();
    }
    this.onOpenChange?.(open);
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

    // 遮罩铺满可视区域
    this.dimMesh.scale.set(aspect, 1, 1);

    // 几何体基准：宽 = PANEL_H * ASPECT，高 = PANEL_H
    // 仅在超出最大宽度时等比缩小，绝不非等比拉伸
    const baseW = EscMenu.PANEL_H * EscMenu.PANEL_ASPECT;
    const baseH = EscMenu.PANEL_H;
    const maxW = aspect * 2 * EscMenu.MAX_WIDTH_RATIO;
    const scale = baseW > maxW ? maxW / baseW : 1;
    this.panelMesh.scale.set(scale, scale, 1);

    // 兜底：确保高度也不顶满屏（极端超宽屏几乎不会触发）
    const worldH = baseH * scale;
    if (worldH > 1.7) {
      const s2 = 1.7 / baseH;
      this.panelMesh.scale.set(s2, s2, 1);
    }
  }

  render(renderer: THREE.WebGLRenderer): void {
    if (!this.open) return;
    if (this.dirty || this.getCameraParams) {
      this.redraw();
    }

    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.uiScene, this.uiCamera);
    renderer.autoClear = prevAutoClear;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    this.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.domElement.removeEventListener('pointerleave', this.onPointerLeave);

    this.panelMesh.geometry.dispose();
    this.panelMat.dispose();
    this.texture.dispose();
    this.dimMesh.geometry.dispose();
    (this.dimMesh.material as THREE.Material).dispose();
  }

  private activate(id: HitId): void {
    switch (id) {
      case 'axes':
        this.axesOn = !this.axesOn;
        this.dirty = true;
        this.onAxesChange(this.axesOn);
        break;
      case 'colliders':
        this.collidersOn = !this.collidersOn;
        this.dirty = true;
        this.onColliderMarkersChange(this.collidersOn);
        break;
      case 'cameraLock':
        this.cameraLocked = !this.cameraLocked;
        if (!this.cameraLocked) {
          this.fixedCameraOn = false;
          this.onFixedCameraChange?.(false);
        }
        this.dirty = true;
        this.onCameraLockChange(this.cameraLocked);
        break;
      case 'fixedCamera':
        this.fixedCameraOn = !this.fixedCameraOn;
        if (this.fixedCameraOn) {
          this.cameraLocked = true;
          this.onCameraLockChange(true);
        }
        this.dirty = true;
        this.onFixedCameraChange?.(this.fixedCameraOn);
        break;
      case 'godMode':
        this.godModeOn = !this.godModeOn;
        this.dirty = true;
        this.onGodModeChange?.(this.godModeOn);
        break;
      case 'minionSpawn':
        this.minionSpawnOn = !this.minionSpawnOn;
        this.dirty = true;
        this.onMinionSpawnChange?.(this.minionSpawnOn);
        break;
      case 'towerInvincible':
        this.towerInvincibleOn = !this.towerInvincibleOn;
        this.dirty = true;
        this.onTowerInvincibleChange?.(this.towerInvincibleOn);
        break;
      case 'skip1m':
        this.onSkipTime(60, 1);
        this.setOpen(false);
        break;
      case 'skip3m':
        this.onSkipTime(180, 3);
        this.setOpen(false);
        break;
      case 'brightness':
        break;
      case 'close':
      case 'dim':
        this.setOpen(false);
        break;
    }
  }

  private setHover(id: HitId | null): void {
    if (this.hoverId === id) return;
    this.hoverId = id;
    this.dirty = true;
  }

  private updateCursor(): void {
    if (!this.open) return;
    const interactive =
      this.hoverId === 'axes' ||
      this.hoverId === 'colliders' ||
      this.hoverId === 'cameraLock' ||
      this.hoverId === 'fixedCamera' ||
      this.hoverId === 'godMode' ||
      this.hoverId === 'minionSpawn' ||
      this.hoverId === 'towerInvincible' ||
      this.hoverId === 'brightness' ||
      this.hoverId === 'skip1m' ||
      this.hoverId === 'skip3m' ||
      this.hoverId === 'close';
    this.domElement.style.cursor = interactive ? 'pointer' : 'default';
  }

  private applyBrightnessFromPointer(clientX: number, clientY: number): void {
    const canvasPos = this.clientToCanvas(clientX, clientY);
    if (!canvasPos) return;
    const region = this.region('brightness');
    const trackX = region.x + EscMenu.SLIDER_PAD_X;
    const trackW = region.w - EscMenu.SLIDER_PAD_X * 2;
    if (trackW <= 0) return;
    const t = THREE.MathUtils.clamp((canvasPos.x - trackX) / trackW, 0, 1);
    if (Math.abs(t - this.brightness) < 1e-4) return;
    this.brightness = t;
    this.dirty = true;
    this.onBrightnessChange(this.brightness);
  }

  private clientToCanvas(
    clientX: number,
    clientY: number,
  ): { x: number; y: number } | null {
    const rect = this.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -(((clientY - rect.top) / rect.height) * 2 - 1);
    this.pointerNdc.set(x, y);
    this.raycaster.setFromCamera(this.pointerNdc, this.uiCamera);
    const hits = this.raycaster.intersectObject(this.panelMesh, false);
    if (hits.length === 0) return null;
    const uv = hits[0].uv;
    if (!uv) return null;
    return {
      x: uv.x * EscMenu.CANVAS_W,
      y: (1 - uv.y) * EscMenu.CANVAS_H,
    };
  }

  private hitTest(clientX: number, clientY: number): HitId | null {
    const rect = this.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -(((clientY - rect.top) / rect.height) * 2 - 1);
    this.pointerNdc.set(x, y);
    this.raycaster.setFromCamera(this.pointerNdc, this.uiCamera);

    const panelHits = this.raycaster.intersectObject(this.panelMesh, false);
    if (panelHits.length > 0) {
      const uv = panelHits[0].uv;
      if (!uv) return null;
      const px = uv.x * EscMenu.CANVAS_W;
      const py = (1 - uv.y) * EscMenu.CANVAS_H;
      for (const r of this.regions) {
        if (
          px >= r.x &&
          px <= r.x + r.w &&
          py >= r.y &&
          py <= r.y + r.h
        ) {
          return r.id;
        }
      }
      return null;
    }

    const dimHits = this.raycaster.intersectObject(this.dimMesh, false);
    if (dimHits.length > 0) return 'dim';
    return null;
  }

  private region(id: HitId): HitRegion {
    const found = this.regions.find((r) => r.id === id);
    if (!found) throw new Error(`EscMenu region missing: ${id}`);
    return found;
  }

  private layoutRegions(): void {
    const W = EscMenu.CANVAS_W;
    const H = EscMenu.CANVAS_H;
    const pad = 40;
    const gap = 28;
    const colW = (W - pad * 2 - gap) / 2;
    const leftX = pad;
    const rightX = pad + colW + gap;

    // 左栏：7 个开关（紧凑但不挤）
    const rowH = 62;
    const rowGap = 8;
    const listY = 96;

    // 右栏：相机卡片 → 亮度 → 快进
    const brightY = 318;
    const brightH = 100;

    const skipY = 456;
    const skipH = 56;
    const skipGap = 12;
    const skipBtnW = (colW - skipGap) / 2;

    const closeH = 58;
    // 贴在左栏底部下方，消除大块留白
    const listEnd = listY + (rowH + rowGap) * 6 + rowH;
    const closeY = Math.min(H - pad - closeH, listEnd + 24);

    this.regions = [
      { id: 'axes', x: leftX, y: listY, w: colW, h: rowH },
      {
        id: 'colliders',
        x: leftX,
        y: listY + (rowH + rowGap) * 1,
        w: colW,
        h: rowH,
      },
      {
        id: 'cameraLock',
        x: leftX,
        y: listY + (rowH + rowGap) * 2,
        w: colW,
        h: rowH,
      },
      {
        id: 'fixedCamera',
        x: leftX,
        y: listY + (rowH + rowGap) * 3,
        w: colW,
        h: rowH,
      },
      {
        id: 'godMode',
        x: leftX,
        y: listY + (rowH + rowGap) * 4,
        w: colW,
        h: rowH,
      },
      {
        id: 'minionSpawn',
        x: leftX,
        y: listY + (rowH + rowGap) * 5,
        w: colW,
        h: rowH,
      },
      {
        id: 'towerInvincible',
        x: leftX,
        y: listY + (rowH + rowGap) * 6,
        w: colW,
        h: rowH,
      },
      { id: 'brightness', x: rightX, y: brightY, w: colW, h: brightH },
      { id: 'skip1m', x: rightX, y: skipY, w: skipBtnW, h: skipH },
      {
        id: 'skip3m',
        x: rightX + skipBtnW + skipGap,
        y: skipY,
        w: skipBtnW,
        h: skipH,
      },
      {
        id: 'close',
        x: pad,
        y: closeY,
        w: W - pad * 2,
        h: closeH,
      },
    ];
  }

  private redraw(): void {
    const { ctx } = this;
    const W = EscMenu.CANVAS_W;
    const H = EscMenu.CANVAS_H;
    const pad = 40;
    const s = EscMenu.RENDER_SCALE;

    // 物理像素清空后，按布局坐标绘制（scale 提升纹理清晰度）
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(s, 0, 0, s, 0, 0);

    // 只绘制圆角面板区域，四周透明 → 屏上不会出现“被拉升的硬边框”
    this.roundRect(16, 16, W - 32, H - 32, 22);
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, 'rgba(24, 34, 50, 0.97)');
    bg.addColorStop(1, 'rgba(10, 14, 22, 0.98)');
    ctx.fillStyle = bg;
    ctx.fill();

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.36)';
    ctx.lineWidth = 2;
    ctx.stroke();

    const shine = ctx.createLinearGradient(0, 16, 0, 72);
    shine.addColorStop(0, 'rgba(96, 165, 250, 0.18)');
    shine.addColorStop(1, 'rgba(96, 165, 250, 0)');
    ctx.fillStyle = shine;
    ctx.fillRect(18, 18, W - 36, 56);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#f8fafc';
    ctx.font = '700 30px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillText('系统设置', pad, 58);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#94a3b8';
    ctx.font = '400 16px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillText('按 Esc 关闭', W - pad, 58);

    // 左栏 7 个开关
    this.drawToggleRow(
      this.region('axes'),
      '坐标参考线',
      'XYZ 轴、网格与米数刻度',
      this.axesOn,
      this.hoverId === 'axes',
      this.pressId === 'axes',
    );
    this.drawToggleRow(
      this.region('colliders'),
      '碰撞体积白圈',
      '地面圆形碰撞范围提示',
      this.collidersOn,
      this.hoverId === 'colliders',
      this.pressId === 'colliders',
    );
    this.drawToggleRow(
      this.region('cameraLock'),
      '锁定视角',
      this.cameraLocked
        ? '跟随英雄 · 右键点地 / WASD 移动'
        : '关闭后为自由视角（WASD 移镜头 / 拖拽）',
      this.cameraLocked,
      this.hoverId === 'cameraLock',
      this.pressId === 'cameraLock',
    );
    this.drawToggleRow(
      this.region('fixedCamera'),
      '固定相机',
      '锁定并预设俯视角 (Pitch -66°, Yaw -34°)',
      this.fixedCameraOn,
      this.hoverId === 'fixedCamera',
      this.pressId === 'fixedCamera',
    );
    this.drawToggleRow(
      this.region('godMode'),
      '英雄无敌',
      '受到攻击与敌方技能时不扣除血量',
      this.godModeOn,
      this.hoverId === 'godMode',
      this.pressId === 'godMode',
    );
    this.drawToggleRow(
      this.region('minionSpawn'),
      '自动出兵',
      '双方基地按波次定时刷新小兵',
      this.minionSpawnOn,
      this.hoverId === 'minionSpawn',
      this.pressId === 'minionSpawn',
    );
    this.drawToggleRow(
      this.region('towerInvincible'),
      '防御塔无敌',
      '防御塔受小兵与英雄攻击时不扣除血量',
      this.towerInvincibleOn,
      this.hoverId === 'towerInvincible',
      this.pressId === 'towerInvincible',
    );

    // 右栏 1：相机实时参数仪表卡片
    const gap = 28;
    const colW = (W - pad * 2 - gap) / 2;
    const rightX = pad + colW + gap;
    this.drawCameraParamsSection(rightX, 96, colW);

    // 右栏 2：全局亮度
    this.drawBrightnessRow(
      this.region('brightness'),
      this.brightness,
      this.hoverId === 'brightness' || this.draggingBrightness,
      this.draggingBrightness,
    );

    // 右栏 3：时间快进
    const skip1 = this.region('skip1m');
    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 15px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('时间快进 (TIME WARP)', rightX, skip1.y - 10);

    this.drawActionButton(
      skip1,
      '快进 1 分钟',
      this.hoverId === 'skip1m',
      this.pressId === 'skip1m',
      'secondary',
    );
    this.drawActionButton(
      this.region('skip3m'),
      '快进 3 分钟',
      this.hoverId === 'skip3m',
      this.pressId === 'skip3m',
      'secondary',
    );

    // 底部全宽：继续游戏按钮
    this.drawActionButton(
      this.region('close'),
      '继续游戏 (RESUME)',
      this.hoverId === 'close',
      this.pressId === 'close',
      'primary',
    );

    this.texture.needsUpdate = true;
    this.dirty = false;
  }

  private drawCameraParamsSection(
    startX: number,
    startY: number,
    width: number,
  ): void {
    const { ctx } = this;
    const cardY = startY + 18;
    const cardH = 168;

    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 15px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('相机实效参数 (CAMERA REALTIME DATA)', startX, startY + 10);

    this.roundRect(startX, cardY, width, cardH, 12);
    const bgGrad = ctx.createLinearGradient(
      startX,
      cardY,
      startX,
      cardY + cardH,
    );
    bgGrad.addColorStop(0, 'rgba(15, 23, 42, 0.88)');
    bgGrad.addColorStop(1, 'rgba(10, 16, 28, 0.93)');
    ctx.fillStyle = bgGrad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(96, 165, 250, 0.32)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const p = this.getCameraParams?.() ?? {
      x: -0.4,
      y: 3.7,
      z: 1.5,
      pitchDeg: -66.0,
      yawDeg: -34.0,
      fov: 55,
      near: 0.1,
      far: 1000,
      moveSpeed: 1.8,
      lookSpeed: 0.002,
      mode: 'locked',
    };

    const cellW = (width - 16 - 8) / 2;
    const cellH = (cardH - 16 - 8) / 2;

    const items = [
      {
        title: '位置 (POS X / Y / Z)',
        value: `X: ${p.x.toFixed(1)}  Y: ${p.y.toFixed(1)}  Z: ${p.z.toFixed(1)}`,
        col: 0,
        row: 0,
        highlight: false,
      },
      {
        title: '视角 (PITCH / YAW)',
        value: `俯仰 ${p.pitchDeg.toFixed(1)}°  偏航 ${p.yawDeg.toFixed(1)}°`,
        col: 1,
        row: 0,
        highlight: false,
      },
      {
        title: '视场与深度范围 (FOV & DEPTH)',
        value: `FOV: ${p.fov}°  范围: ${p.near}m - ${p.far}m`,
        col: 0,
        row: 1,
        highlight: false,
      },
      {
        title: '视角模式与控制速度',
        value: `${p.mode === 'locked' ? (this.fixedCameraOn ? '🔒 固定视角' : '🔒 锁定跟随') : '✈️ 自由视角'}  ${p.moveSpeed.toFixed(1)}m/s`,
        col: 1,
        row: 1,
        highlight: true,
      },
    ];

    for (const item of items) {
      const cx = startX + 8 + item.col * (cellW + 8);
      const cy = cardY + 8 + item.row * (cellH + 8);

      this.roundRect(cx, cy, cellW, cellH, 8);
      ctx.fillStyle = item.highlight
        ? 'rgba(30, 48, 76, 0.65)'
        : 'rgba(20, 30, 48, 0.50)';
      ctx.fill();

      ctx.fillStyle = '#64748b';
      ctx.font = '600 12px system-ui, -apple-system, "Segoe UI", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(item.title, cx + 10, cy + 22);

      ctx.fillStyle = item.highlight ? '#93c5fd' : '#e2e8f0';
      ctx.font = '600 15px monospace, system-ui, sans-serif';
      ctx.fillText(item.value, cx + 10, cy + 46);
    }
  }

  private drawToggleRow(
    region: HitRegion,
    title: string,
    desc: string,
    on: boolean,
    hover: boolean,
    pressed: boolean,
  ): void {
    const { ctx } = this;
    const { x, y, w, h } = region;

    this.roundRect(x, y, w, h, 10);
    if (hover || pressed) {
      ctx.fillStyle = pressed
        ? 'rgba(30, 48, 72, 0.92)'
        : 'rgba(28, 44, 66, 0.88)';
    } else {
      ctx.fillStyle = 'rgba(15, 23, 34, 0.72)';
    }
    ctx.fill();
    ctx.strokeStyle = hover
      ? 'rgba(96, 165, 250, 0.45)'
      : 'rgba(148, 163, 184, 0.14)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#e8eef6';
    ctx.font = '600 18px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillText(title, x + 16, y + 24);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '400 13px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillText(desc, x + 16, y + 44);

    const sw = 52;
    const sh = 28;
    const sx = x + w - 16 - sw;
    const sy = y + (h - sh) / 2;
    this.roundRect(sx, sy, sw, sh, sh / 2);
    ctx.fillStyle = on ? '#3b82f6' : '#334155';
    ctx.fill();

    const knob = 22;
    const kx = on ? sx + sw - 3 - knob : sx + 3;
    const ky = sy + (sh - knob) / 2;
    ctx.beginPath();
    ctx.arc(kx + knob / 2, ky + knob / 2, knob / 2, 0, Math.PI * 2);
    ctx.fillStyle = '#e2e8f0';
    ctx.fill();
  }

  private drawBrightnessRow(
    region: HitRegion,
    value: number,
    hover: boolean,
    active: boolean,
  ): void {
    const { ctx } = this;
    const { x, y, w, h } = region;
    const t = THREE.MathUtils.clamp(value, 0, 1);

    this.roundRect(x, y, w, h, 10);
    ctx.fillStyle =
      hover || active ? 'rgba(28, 44, 66, 0.88)' : 'rgba(15, 23, 34, 0.72)';
    ctx.fill();
    ctx.strokeStyle =
      hover || active
        ? 'rgba(96, 165, 250, 0.45)'
        : 'rgba(148, 163, 184, 0.14)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#e8eef6';
    ctx.font = '600 18px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillText('全局画面亮度', x + 16, y + 26);

    const pct = `${Math.round(t * 100)}%`;
    ctx.textAlign = 'right';
    ctx.fillStyle = '#93c5fd';
    ctx.font = '600 18px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillText(pct, x + w - 16, y + 26);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#94a3b8';
    ctx.font = '400 13px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillText('拖动滑条实时调暗 / 调亮画面', x + 16, y + 46);

    const trackX = x + EscMenu.SLIDER_PAD_X;
    const trackW = w - EscMenu.SLIDER_PAD_X * 2;
    const trackH = EscMenu.SLIDER_TRACK_H;
    const trackY = y + h - 20;
    this.roundRect(trackX, trackY, trackW, trackH, trackH / 2);
    ctx.fillStyle = 'rgba(51, 65, 85, 0.95)';
    ctx.fill();

    const fillW = Math.max(trackH, trackW * t);
    this.roundRect(trackX, trackY, fillW, trackH, trackH / 2);
    const fillGrad = ctx.createLinearGradient(trackX, 0, trackX + trackW, 0);
    fillGrad.addColorStop(0, '#1e3a5f');
    fillGrad.addColorStop(1, '#60a5fa');
    ctx.fillStyle = fillGrad;
    ctx.fill();

    const knobR = 10;
    const knobX = trackX + trackW * t;
    const knobY = trackY + trackH / 2;
    ctx.beginPath();
    ctx.arc(knobX, knobY, knobR, 0, Math.PI * 2);
    ctx.fillStyle = '#e2e8f0';
    ctx.fill();
    ctx.strokeStyle = active ? '#93c5fd' : 'rgba(15, 23, 42, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  private drawActionButton(
    region: HitRegion,
    label: string,
    hover: boolean,
    pressed: boolean,
    variant: 'primary' | 'secondary',
  ): void {
    const { ctx } = this;
    const { x, y, w, h } = region;

    this.roundRect(x, y, w, h, 10);

    if (variant === 'primary') {
      const grad = ctx.createLinearGradient(x, y, x, y + h);
      if (pressed) {
        grad.addColorStop(0, '#60a5fa');
        grad.addColorStop(1, '#3b82f6');
      } else if (hover) {
        grad.addColorStop(0, '#bfdbfe');
        grad.addColorStop(1, '#60a5fa');
      } else {
        grad.addColorStop(0, '#93c5fd');
        grad.addColorStop(1, '#60a5fa');
      }
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.fillStyle = '#0b1220';
    } else {
      if (pressed) {
        ctx.fillStyle = 'rgba(37, 60, 92, 0.95)';
      } else if (hover) {
        ctx.fillStyle = 'rgba(32, 52, 80, 0.92)';
      } else {
        ctx.fillStyle = 'rgba(20, 32, 48, 0.88)';
      }
      ctx.fill();
      ctx.strokeStyle = hover
        ? 'rgba(96, 165, 250, 0.55)'
        : 'rgba(148, 163, 184, 0.22)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#e8eef6';
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 18px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillText(label, x + w / 2, y + h / 2 + 0.5);
  }

  private roundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void {
    const { ctx } = this;
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }
}
