import * as THREE from 'three';

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
   * 视角模式：true = 锁定（跟随英雄 + 右键点地移动）；
   * false = 自由（WASD / 左键拖拽）。
   */
  onCameraLockChange: (locked: boolean) => void;
  /** 英雄无敌开关回调 */
  onGodModeChange?: (invincible: boolean) => void;
  /** 自动出兵开关回调 */
  onMinionSpawnChange?: (enabled: boolean) => void;
  /** 防御塔无敌开关回调 */
  onTowerInvincibleChange?: (invincible: boolean) => void;
  /** 面板开/关（用于暂停相机等） */
  onOpenChange?: (open: boolean) => void;
  initialAxesVisible?: boolean;
  initialColliderMarkersVisible?: boolean;
  initialBrightness?: number;
  initialCameraLocked?: boolean;
  initialGodMode?: boolean;
  initialMinionSpawn?: boolean;
  initialTowerInvincible?: boolean;
}

type HitId =
  | 'axes'
  | 'colliders'
  | 'cameraLock'
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
 * 与主场景同 canvas 叠加渲染，交互走 raycast / UV 命中。
 */
export class EscMenu {
  private static readonly CANVAS_W = 720;
  private static readonly CANVAS_H = 1420;
  /** 面板在 UI 空间中的高度（屏幕高度为 2 时） */
  private static readonly PANEL_H = 1.48;
  private static readonly PANEL_ASPECT =
    EscMenu.CANVAS_W / EscMenu.CANVAS_H;

  /** 亮度滑条有效轨道相对 region 的内边距 */
  private static readonly SLIDER_PAD_X = 24;
  private static readonly SLIDER_TRACK_H = 12;

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
  private readonly onGodModeChange?: (invincible: boolean) => void;
  private readonly onMinionSpawnChange?: (enabled: boolean) => void;
  private readonly onTowerInvincibleChange?: (invincible: boolean) => void;
  private readonly onOpenChange?: (open: boolean) => void;

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
    this.onGodModeChange = options.onGodModeChange;
    this.onMinionSpawnChange = options.onMinionSpawnChange;
    this.onTowerInvincibleChange = options.onTowerInvincibleChange;
    this.onOpenChange = options.onOpenChange;
    this.axesOn = options.initialAxesVisible ?? true;
    this.collidersOn = options.initialColliderMarkersVisible ?? true;
    this.cameraLocked = options.initialCameraLocked ?? false;
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
        opacity: 0.62,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.dimMesh.name = 'EscMenuDim';
    this.dimMesh.renderOrder = 0;
    this.dimMesh.position.z = -0.02;
    this.root.add(this.dimMesh);

    // 面板 canvas 纹理
    this.canvas = document.createElement('canvas');
    this.canvas.width = EscMenu.CANVAS_W;
    this.canvas.height = EscMenu.CANVAS_H;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

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
          // ignore capture failures (rare non-primary pointers)
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
      // 交还给相机控制器自己的 cursor
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

    // 遮罩铺满当前视口
    this.dimMesh.scale.set(aspect, 1, 1);
  }

  /** 在主场景之后调用：不清色，只清深度后叠 HUD */
  render(renderer: THREE.WebGLRenderer): void {
    if (!this.open) return;
    if (this.dirty) this.redraw();

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
        this.dirty = true;
        this.onCameraLockChange(this.cameraLocked);
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
        // 1 分钟游戏时间，1 秒真实时间完成
        this.onSkipTime(60, 1);
        this.setOpen(false);
        break;
      case 'skip3m':
        // 3 分钟游戏时间，3 秒真实时间完成
        this.onSkipTime(180, 3);
        this.setOpen(false);
        break;
      case 'brightness':
        // 拖动中处理，点击不切换
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

  /** 屏幕坐标 → 面板 canvas 像素；点不在面板上返回 null */
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

    // 先测面板
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

    // 点在遮罩上（关闭）
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
    const pad = 44;
    const rowH = 88;
    const rowGap = 12;
    const listY = 160;
    const rowW = W - pad * 2;

    const brightH = 110;
    // 六行开关：坐标 / 碰撞 / 锁定视角 / 英雄无敌 / 自动出兵 / 防御塔无敌
    const brightY = listY + (rowH + rowGap) * 6 + 6;

    const skipY = brightY + brightH + 46;
    const skipH = 68;
    const skipGap = 14;
    const skipBtnW = (rowW - skipGap) / 2;

    this.regions = [
      { id: 'axes', x: pad, y: listY, w: rowW, h: rowH },
      {
        id: 'colliders',
        x: pad,
        y: listY + (rowH + rowGap) * 1,
        w: rowW,
        h: rowH,
      },
      {
        id: 'cameraLock',
        x: pad,
        y: listY + (rowH + rowGap) * 2,
        w: rowW,
        h: rowH,
      },
      {
        id: 'godMode',
        x: pad,
        y: listY + (rowH + rowGap) * 3,
        w: rowW,
        h: rowH,
      },
      {
        id: 'minionSpawn',
        x: pad,
        y: listY + (rowH + rowGap) * 4,
        w: rowW,
        h: rowH,
      },
      {
        id: 'towerInvincible',
        x: pad,
        y: listY + (rowH + rowGap) * 5,
        w: rowW,
        h: rowH,
      },
      { id: 'brightness', x: pad, y: brightY, w: rowW, h: brightH },
      { id: 'skip1m', x: pad, y: skipY, w: skipBtnW, h: skipH },
      {
        id: 'skip3m',
        x: pad + skipBtnW + skipGap,
        y: skipY,
        w: skipBtnW,
        h: skipH,
      },
      {
        id: 'close',
        x: pad,
        y: EscMenu.CANVAS_H - pad - 68,
        w: rowW,
        h: 68,
      },
    ];
  }

  private redraw(): void {
    const { ctx } = this;
    const W = EscMenu.CANVAS_W;
    const H = EscMenu.CANVAS_H;
    const pad = 44;

    ctx.clearRect(0, 0, W, H);

    // 面板底板
    this.roundRect(pad * 0.35, pad * 0.35, W - pad * 0.7, H - pad * 0.7, 28);
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, 'rgba(30, 40, 56, 0.97)');
    bg.addColorStop(1, 'rgba(12, 16, 24, 0.98)');
    ctx.fillStyle = bg;
    ctx.fill();

    // 边框高光
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.28)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 顶部分割光带
    const shine = ctx.createLinearGradient(0, 20, 0, 90);
    shine.addColorStop(0, 'rgba(96, 165, 250, 0.12)');
    shine.addColorStop(1, 'rgba(96, 165, 250, 0)');
    ctx.fillStyle = shine;
    ctx.fillRect(pad * 0.35 + 2, pad * 0.35 + 2, W - pad * 0.7 - 4, 70);

    // 标题
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#e8eef6';
    ctx.font = '700 42px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillText('设置', pad, 92);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '400 22px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillText('按 Esc 关闭', pad, 130);

    // 显示开关
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
        ? '保持当前相对位置与朝向跟随 · 右键点地'
        : '关闭后为自由视角（WASD / 拖拽）',
      this.cameraLocked,
      this.hoverId === 'cameraLock',
      this.pressId === 'cameraLock',
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

    // 全局亮度
    this.drawBrightnessRow(
      this.region('brightness'),
      this.brightness,
      this.hoverId === 'brightness' || this.draggingBrightness,
      this.draggingBrightness,
    );

    // 时间快进
    const skip1 = this.region('skip1m');
    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 20px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('时间快进', pad, skip1.y - 18);

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

    // 继续游戏按钮
    this.drawActionButton(
      this.region('close'),
      '继续游戏',
      this.hoverId === 'close',
      this.pressId === 'close',
      'primary',
    );

    this.texture.needsUpdate = true;
    this.dirty = false;
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

    this.roundRect(x, y, w, h, 16);
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
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#e8eef6';
    ctx.font = '600 28px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillText(title, x + 24, y + 42);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '400 20px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillText(desc, x + 24, y + 74);

    // 开关
    const sw = 78;
    const sh = 42;
    const sx = x + w - 24 - sw;
    const sy = y + (h - sh) / 2;
    this.roundRect(sx, sy, sw, sh, sh / 2);
    ctx.fillStyle = on ? '#3b82f6' : '#334155';
    ctx.fill();

    const knob = 32;
    const kx = on ? sx + sw - 5 - knob : sx + 5;
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

    this.roundRect(x, y, w, h, 16);
    ctx.fillStyle =
      hover || active ? 'rgba(28, 44, 66, 0.88)' : 'rgba(15, 23, 34, 0.72)';
    ctx.fill();
    ctx.strokeStyle =
      hover || active
        ? 'rgba(96, 165, 250, 0.45)'
        : 'rgba(148, 163, 184, 0.14)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#e8eef6';
    ctx.font = '600 28px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillText('全局亮度', x + 24, y + 38);

    const pct = `${Math.round(t * 100)}%`;
    ctx.textAlign = 'right';
    ctx.fillStyle = '#93c5fd';
    ctx.font = '600 24px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillText(pct, x + w - 24, y + 38);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#94a3b8';
    ctx.font = '400 18px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillText('拖动滑条调暗画面', x + 24, y + 64);

    // 轨道
    const trackX = x + EscMenu.SLIDER_PAD_X;
    const trackW = w - EscMenu.SLIDER_PAD_X * 2;
    const trackH = EscMenu.SLIDER_TRACK_H;
    const trackY = y + h - 36;
    this.roundRect(trackX, trackY, trackW, trackH, trackH / 2);
    ctx.fillStyle = 'rgba(51, 65, 85, 0.95)';
    ctx.fill();

    // 已填充
    const fillW = Math.max(trackH, trackW * t);
    this.roundRect(trackX, trackY, fillW, trackH, trackH / 2);
    const fillGrad = ctx.createLinearGradient(trackX, 0, trackX + trackW, 0);
    fillGrad.addColorStop(0, '#1e3a5f');
    fillGrad.addColorStop(1, '#60a5fa');
    ctx.fillStyle = fillGrad;
    ctx.fill();

    // 滑块
    const knobR = 14;
    const knobX = trackX + trackW * t;
    const knobY = trackY + trackH / 2;
    ctx.beginPath();
    ctx.arc(knobX, knobY, knobR, 0, Math.PI * 2);
    ctx.fillStyle = '#e2e8f0';
    ctx.fill();
    ctx.strokeStyle = active ? '#93c5fd' : 'rgba(15, 23, 42, 0.45)';
    ctx.lineWidth = 2;
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

    this.roundRect(x, y, w, h, 14);

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
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#e8eef6';
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 26px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillText(label, x + w / 2, y + h / 2 + 1);
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
