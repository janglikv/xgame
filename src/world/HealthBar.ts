import {
  Color3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
  Vector3,
  type Scene,
} from '@babylonjs/core';

export interface HealthBarOptions {
  width?: number;
  height?: number;
  offsetY?: number;
  maxHp?: number;
  theme?: 'red' | 'green';
}

function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/**
 * 悬浮 3D 科技风血条 (Billboard Health Bar)。
 * 面向摄像机展示，支持缓冲血条延迟追赶 (Damage catch-up)、受击高亮闪烁动效、自定义红/绿主题。
 */
export class HealthBar {
  private readonly scene: Scene;
  private readonly plane: Mesh;
  private readonly texture: DynamicTexture;
  private readonly material: StandardMaterial;

  private maxHp: number;
  private currentHp: number;
  /** 缓冲滞后血量（用于受击平滑追赶动效） */
  private lagHp: number;
  /** 受击闪烁高亮脉冲 (0~1) */
  private hitPulse = 0;

  private theme: 'red' | 'green';
  private isVisible = true;

  constructor(
    scene: Scene,
    parent: TransformNode,
    options: HealthBarOptions = {},
  ) {
    this.scene = scene;
    this.maxHp = options.maxHp ?? 100;
    this.currentHp = this.maxHp;
    this.lagHp = this.maxHp;
    this.theme = options.theme ?? 'red';

    const w = options.width ?? 0.68;
    const h = options.height ?? 0.11;
    const offsetY = options.offsetY ?? 1.65;

    this.plane = MeshBuilder.CreatePlane(
      'healthBarPlane',
      { width: w, height: h },
      this.scene,
    );
    this.plane.parent = parent;
    this.plane.position = new Vector3(0, offsetY, 0);
    this.plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.plane.isPickable = false;
    this.plane.renderingGroupId = 1;

    // 创建高分辨率 256x32 动态贴图
    const texW = 256;
    const texH = 32;
    this.texture = new DynamicTexture(
      'healthBarTex',
      { width: texW, height: texH },
      this.scene,
      false,
    );
    this.texture.hasAlpha = true;

    this.material = new StandardMaterial('healthBarMat', this.scene);
    this.material.diffuseTexture = this.texture;
    this.material.emissiveTexture = this.texture;
    this.material.opacityTexture = this.texture;
    this.material.emissiveColor = new Color3(1, 1, 1);
    this.material.disableLighting = true;
    this.material.backFaceCulling = false;
    this.material.forceDepthWrite = false;
    this.material.useAlphaFromDiffuseTexture = true;
    this.material.transparencyMode = StandardMaterial.MATERIAL_ALPHABLEND;

    this.plane.material = this.material;

    this.redraw();
  }

  setHp(hp: number, maxHp?: number): void {
    if (maxHp !== undefined) this.maxHp = maxHp;
    const oldHp = this.currentHp;
    this.currentHp = Math.max(0, Math.min(this.maxHp, hp));

    if (this.currentHp < oldHp) {
      // 受到伤害时触发高亮脉冲
      this.hitPulse = 1.0;
    } else if (this.currentHp > oldHp) {
      // 治疗/重置时立刻同步缓冲血条
      this.lagHp = this.currentHp;
    }
    this.redraw();
  }

  takeDamage(amount: number): void {
    this.setHp(this.currentHp - amount);
  }

  getHp(): number {
    return this.currentHp;
  }

  getMaxHp(): number {
    return this.maxHp;
  }

  isDead(): boolean {
    return this.currentHp <= 0;
  }

  setVisible(visible: boolean): void {
    this.isVisible = visible;
    this.plane.setEnabled(visible);
  }

  setOffsetY(offsetY: number): void {
    this.plane.position.y = offsetY;
  }

  update(dt: number): void {
    if (!this.isVisible) return;

    let needRedraw = false;

    // 受击闪烁脉冲衰减
    if (this.hitPulse > 0) {
      this.hitPulse = Math.max(0, this.hitPulse - dt * 3.5);
      needRedraw = true;
    }

    // 滞后缓冲血条平滑追赶当前血条 (Catch-up animation)
    if (this.lagHp > this.currentHp) {
      const dropSpeed = this.maxHp * 0.85; // 0.85s 内完成追赶
      this.lagHp = Math.max(this.currentHp, this.lagHp - dt * dropSpeed);
      needRedraw = true;
    } else {
      this.lagHp = this.currentHp;
    }

    if (needRedraw) {
      this.redraw();
    }
  }

  private redraw(): void {
    const ctx = this.texture.getContext() as unknown as CanvasRenderingContext2D;
    const w = 256;
    const h = 32;

    ctx.clearRect(0, 0, w, h);

    const pad = 3;
    const innerX = pad;
    const innerY = pad;
    const innerW = w - pad * 2;
    const innerH = h - pad * 2;
    const radius = 6;

    // 1. 深色精致半透明圆角外框背景
    ctx.save();
    drawRoundRect(ctx, 0, 0, w, h, radius + 2);
    ctx.fillStyle = 'rgba(15, 14, 22, 0.82)';
    ctx.fill();

    // 边框受击高亮
    if (this.hitPulse > 0) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = `rgba(255, 220, 230, ${0.4 + 0.6 * this.hitPulse})`;
    } else {
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    }
    ctx.stroke();
    ctx.restore();

    // 血条内槽背景
    ctx.save();
    drawRoundRect(ctx, innerX, innerY, innerW, innerH, radius);
    ctx.fillStyle = 'rgba(28, 26, 38, 0.9)';
    ctx.fill();
    ctx.clip();

    const mainPct = Math.max(0, Math.min(1, this.currentHp / this.maxHp));
    const lagPct = Math.max(0, Math.min(1, this.lagHp / this.maxHp));

    // 2. 扣血缓冲滞后条 (Damage Lag Bar: 白色/金黄色)
    if (lagPct > mainPct) {
      const lagW = innerW * lagPct;
      ctx.fillStyle = this.theme === 'green' ? '#ffcc00' : '#ffaa33';
      ctx.fillRect(innerX, innerY, lagW, innerH);
    }

    // 3. 当前 HP 饱满纯色血条
    if (mainPct > 0) {
      const barW = innerW * mainPct;

      let fillColor = '#ff2244';
      if (this.theme === 'green') {
        if (mainPct > 0.5) {
          fillColor = '#00e676';
        } else if (mainPct > 0.25) {
          fillColor = '#84cc16';
        } else {
          fillColor = '#ef4444';
        }
      } else {
        if (mainPct > 0.5) {
          fillColor = '#ff2244';
        } else if (mainPct > 0.25) {
          fillColor = '#ff6600';
        } else {
          fillColor = '#d32f2f';
        }
      }

      ctx.fillStyle = fillColor;
      ctx.fillRect(innerX, innerY, barW, innerH);

      // 顶部高光线
      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.fillRect(innerX, innerY, barW, innerH * 0.35);
    }

    // 4. 受击全白闪烁蒙版
    if (this.hitPulse > 0) {
      ctx.fillStyle = `rgba(255, 255, 255, ${0.45 * this.hitPulse})`;
      ctx.fillRect(innerX, innerY, innerW, innerH);
    }

    ctx.restore();

    this.texture.update();
  }

  dispose(): void {
    if (!this.plane.isDisposed) {
      this.plane.dispose();
    }
    this.texture.dispose();
    this.material.dispose();
  }
}
