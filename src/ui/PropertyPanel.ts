import * as THREE from 'three';

const TOGGLE_KEY = 'Tab';

export interface PropertyPanelSnapshot {
  pos: THREE.Vector3;
  /** 水平朝向（度） */
  yawDeg: number;
  /** 俯仰（度） */
  pitchDeg: number;
  pointerLocked: boolean;
  fps: number;
}

/**
 * 按住 Tab 显示、松开隐藏的属性面板（Three.js 正交叠加）。
 */
export class PropertyPanel {
  private readonly uiScene = new THREE.Scene();
  private readonly uiCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);

  private readonly root: THREE.Group;
  private readonly panelMesh: THREE.Mesh;
  private readonly panelMaterial: THREE.MeshBasicMaterial;

  private visible = false;

  private readonly onKeyDown: (e: KeyboardEvent) => void;
  private readonly onKeyUp: (e: KeyboardEvent) => void;
  private readonly onBlur: () => void;

  constructor() {
    this.uiCamera.position.z = 1;

    this.root = new THREE.Group();
    this.root.name = 'PropertyPanel';
    this.root.visible = false;
    this.uiScene.add(this.root);

    this.panelMaterial = new THREE.MeshBasicMaterial({
      map: createPanelTexture(null),
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    // 右侧竖向信息卡（高度基准坐标）
    this.panelMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.72, 0.9),
      this.panelMaterial,
    );
    this.panelMesh.position.set(0, 0, 0);
    this.root.add(this.panelMesh);

    this.onKeyDown = (e) => {
      if (e.code !== TOGGLE_KEY) return;
      // 按住不重复触发；拦截浏览器焦点切换
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      this.show();
    };

    this.onKeyUp = (e) => {
      if (e.code !== TOGGLE_KEY) return;
      e.preventDefault();
      e.stopPropagation();
      this.hide();
    };

    // 失焦时若 Tab 已弹起但未收到 keyup，确保关闭
    this.onBlur = () => {
      this.hide();
    };

    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    window.addEventListener('blur', this.onBlur);

    this.resize(16, 9);
  }

  get isVisible(): boolean {
    return this.visible;
  }

  show(): void {
    if (this.visible) return;
    this.visible = true;
    this.root.visible = true;
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.root.visible = false;
  }

  /**
   * 每帧在可见时刷新面板内容。
   */
  update(data: PropertyPanelSnapshot): void {
    if (!this.visible) return;

    const next = createPanelTexture(data);
    const prev = this.panelMaterial.map;
    this.panelMaterial.map = next;
    this.panelMaterial.needsUpdate = true;
    prev?.dispose();
  }

  resize(width: number, height: number): void {
    const w = Math.max(width, 1);
    const h = Math.max(height, 1);
    const aspect = w / h;

    this.uiCamera.left = -aspect;
    this.uiCamera.right = aspect;
    this.uiCamera.top = 1;
    this.uiCamera.bottom = -1;
    this.uiCamera.updateProjectionMatrix();

    // 贴在右侧，留边距
    const panelW = 0.72;
    this.panelMesh.position.x = aspect - panelW * 0.5 - 0.06;
    this.panelMesh.position.y = 0;
  }

  render(renderer: THREE.WebGLRenderer): void {
    if (!this.visible) return;

    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.uiScene, this.uiCamera);
    renderer.autoClear = prevAutoClear;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('keyup', this.onKeyUp, true);
    window.removeEventListener('blur', this.onBlur);

    this.panelMesh.geometry.dispose();
    this.panelMaterial.map?.dispose();
    this.panelMaterial.dispose();
  }
}

function createPanelTexture(data: PropertyPanelSnapshot | null): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 640;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');

  // 背景卡片
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  roundRect(ctx, 8, 8, canvas.width - 16, canvas.height - 16, 20);
  ctx.fillStyle = 'rgba(15, 20, 28, 0.92)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
  ctx.lineWidth = 3;
  ctx.stroke();

  // 标题
  ctx.fillStyle = '#e5e7eb';
  ctx.font = 'bold 36px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('属性', 36, 36);

  ctx.fillStyle = '#6b7280';
  ctx.font = '22px system-ui, sans-serif';
  ctx.fillText('按住 Tab · 松开关闭', 36, 82);

  // 分隔线
  ctx.strokeStyle = 'rgba(75, 85, 99, 0.8)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(36, 120);
  ctx.lineTo(canvas.width - 36, 120);
  ctx.stroke();

  const lines: Array<{ label: string; value: string }> = data
    ? [
        {
          label: '位置 X',
          value: data.pos.x.toFixed(2),
        },
        {
          label: '位置 Y',
          value: data.pos.y.toFixed(2),
        },
        {
          label: '位置 Z',
          value: data.pos.z.toFixed(2),
        },
        {
          label: 'Yaw',
          value: `${data.yawDeg.toFixed(1)}°`,
        },
        {
          label: 'Pitch',
          value: `${data.pitchDeg.toFixed(1)}°`,
        },
        {
          label: '指针锁定',
          value: data.pointerLocked ? '是' : '否',
        },
        {
          label: 'FPS',
          value: data.fps.toFixed(0),
        },
      ]
    : [{ label: '状态', value: '等待数据…' }];

  let y = 150;
  for (const row of lines) {
    ctx.fillStyle = '#9ca3af';
    ctx.font = '24px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(row.label, 40, y);

    ctx.fillStyle = '#f3f4f6';
    ctx.font = 'bold 26px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(row.value, canvas.width - 40, y);
    y += 52;
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
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
