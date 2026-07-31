import * as THREE from 'three';
import type { TeamId } from '../combat/CombatUnit';

export interface HealthBarOptions {
  /** 本地空间宽度（Sprite scale.x） */
  width?: number;
  /** 本地空间高度（Sprite scale.y） */
  height?: number;
  /** 本地 Y 偏移（头顶上方） */
  yOffset?: number;
  /** 队伍色：蓝/红填充 */
  team?: TeamId;
  /** 满血时隐藏（默认 false，始终显示） */
  hideWhenFull?: boolean;
  /** Sprite 屏幕锚点 (X 方向，默认 0.5；小于 0.5 屏幕投影向右偏) */
  centerX?: number;
}

/**
 * 始终朝向相机的世界空间血条（Canvas 纹理 + Sprite）。
 * 作为单位子节点挂载；若父级有缩放，请用 width/height 补偿。
 */
export class HealthBar extends THREE.Sprite {
  private static readonly CANVAS_W = 128;
  private static readonly CANVAS_H = 16;
  private static readonly BORDER = 2;

  private static readonly BG = '#1a1a1e';
  private static readonly BORDER_COLOR = '#0a0a0c';
  private static readonly FILL_BLUE = '#3b82f6';
  private static readonly FILL_RED = '#ef4444';
  private static readonly FILL_LOW = '#f59e0b';
  private static readonly FILL_CRIT = '#dc2626';

  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly fillColor: string;
  private readonly hideWhenFull: boolean;

  private lastRatio = -1;
  private lastVisible: boolean | null = null;

  constructor(options: HealthBarOptions = {}) {
    const width = options.width ?? 1;
    const height = options.height ?? 0.12;
    const yOffset = options.yOffset ?? 1.2;
    const team = options.team ?? 'blue';
    const hideWhenFull = options.hideWhenFull ?? false;
    const centerX = options.centerX ?? 0.5;

    const canvas = document.createElement('canvas');
    canvas.width = HealthBar.CANVAS_W;
    canvas.height = HealthBar.CANVAS_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable for HealthBar');

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.LinearFilter;

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      sizeAttenuation: true,
    });

    super(material);
    this.name = 'HealthBar';
    this.ctx = ctx;
    this.texture = texture;
    this.fillColor = team === 'red' ? HealthBar.FILL_RED : HealthBar.FILL_BLUE;
    this.hideWhenFull = hideWhenFull;

    this.center.set(centerX, 0.5);
    this.scale.set(width, height, 1);
    this.position.set(0, yOffset, 0);
    this.renderOrder = 10;

    this.draw(1);
  }

  /** 按当前/最大生命更新显示 */
  setHp(current: number, max: number): void {
    const safeMax = Math.max(max, 1e-6);
    const ratio = THREE.MathUtils.clamp(current / safeMax, 0, 1);
    const alive = current > 0;
    const visible = alive && (!this.hideWhenFull || ratio < 1 - 1e-6);

    if (this.lastVisible !== visible) {
      this.visible = visible;
      this.lastVisible = visible;
    }

    if (!visible) return;

    if (Math.abs(ratio - this.lastRatio) < 1e-4) return;
    this.draw(ratio);
  }

  dispose(): void {
    this.texture.dispose();
    (this.material as THREE.SpriteMaterial).dispose();
  }

  private draw(ratio: number): void {
    this.lastRatio = ratio;
    const w = HealthBar.CANVAS_W;
    const h = HealthBar.CANVAS_H;
    const b = HealthBar.BORDER;
    const ctx = this.ctx;

    ctx.clearRect(0, 0, w, h);

    // 外框
    ctx.fillStyle = HealthBar.BORDER_COLOR;
    ctx.fillRect(0, 0, w, h);

    // 底槽
    ctx.fillStyle = HealthBar.BG;
    ctx.fillRect(b, b, w - b * 2, h - b * 2);

    // 血量填充
    const innerW = w - b * 2;
    const fillW = Math.max(0, Math.round(innerW * ratio));
    if (fillW > 0) {
      ctx.fillStyle = this.pickFill(ratio);
      ctx.fillRect(b, b, fillW, h - b * 2);
    }

    this.texture.needsUpdate = true;
  }

  /** 低血变黄/红，便于读状态；队伍底色仍作主色 */
  private pickFill(ratio: number): string {
    if (ratio <= 0.2) return HealthBar.FILL_CRIT;
    if (ratio <= 0.4) return HealthBar.FILL_LOW;
    return this.fillColor;
  }
}
