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
  private static readonly CANVAS_W = 256;
  private static readonly CANVAS_H = 24;
  private static readonly BORDER = 3;

  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly team: TeamId;
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
    texture.magFilter = THREE.LinearFilter;
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
    this.team = team;
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

    // 1. 深色精致外框底座 (圆角 5px)
    this.roundRect(0, 0, w, h, 5);
    ctx.fillStyle = '#090d16';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 2. 内部暗色背景槽
    const innerW = w - b * 2;
    const innerH = h - b * 2;
    this.roundRect(b, b, innerW, innerH, 3);
    ctx.fillStyle = '#111827';
    ctx.fill();

    // 3. 血量填充渐变
    const fillW = Math.max(0, Math.round(innerW * ratio));
    if (fillW > 0) {
      this.roundRect(b, b, fillW, innerH, 2.5);
      const grad = ctx.createLinearGradient(b, b, b, b + innerH);

      if (ratio <= 0.2) {
        grad.addColorStop(0, '#f87171');
        grad.addColorStop(1, '#991b1b');
      } else if (ratio <= 0.4) {
        grad.addColorStop(0, '#fbbf24');
        grad.addColorStop(1, '#b45309');
      } else if (this.team === 'blue') {
        grad.addColorStop(0, '#4ade80');
        grad.addColorStop(1, '#16a34a');
      } else {
        grad.addColorStop(0, '#f43f5e');
        grad.addColorStop(1, '#be123c');
      }
      ctx.fillStyle = grad;
      ctx.fill();

      // 4. 顶部镜面高光 (Specular Highlight)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.32)';
      ctx.fillRect(b, b, fillW, Math.max(1, innerH * 0.35));
    }

    // 5. 每 10% 血量细刻度刻印线
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 10; i += 1) {
      const x = b + (innerW * i) / 10;
      ctx.beginPath();
      ctx.moveTo(x, b);
      ctx.lineTo(x, b + innerH);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    for (let i = 1; i < 10; i += 1) {
      const x = b + (innerW * i) / 10 + 1;
      ctx.beginPath();
      ctx.moveTo(x, b);
      ctx.lineTo(x, b + innerH);
      ctx.stroke();
    }

    this.texture.needsUpdate = true;
  }

  private roundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void {
    const ctx = this.ctx;
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
