import * as THREE from 'three';
import type { MissFortune } from '../world/champions/MissFortune';

/**
 * 屏幕空间 2D 英雄血条 HUD (MOBA 风格)
 * 采用屏幕 NDC 投影，绝对保证悬浮于角色及帽子顶部上方固定像素间距，在任何视角下都不遮挡英雄。
 */
export class HeroHealthBarHUD {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private width = 1;
  private height = 1;

  /** 伤害缓动平滑 HP (用于损伤残余留影条) */
  private animHp = -1;
  private readonly tempVec = new THREE.Vector3();

  constructor(container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.style.position = 'absolute';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.pointerEvents = 'none';
    this.canvas.style.zIndex = '5';

    container.appendChild(this.canvas);

    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context failed for HeroHealthBarHUD');
    this.ctx = ctx;
  }

  setSize(w: number, h: number): void {
    this.width = Math.max(w, 1);
    this.height = Math.max(h, 1);
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(this.width * dpr);
    this.canvas.height = Math.floor(this.height * dpr);
  }

  update(
    camera: THREE.PerspectiveCamera,
    hero: MissFortune,
    delta: number,
  ): void {
    const { ctx, canvas } = this;
    const dpr = window.devicePixelRatio || 1;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!hero.isAlive || !hero.visible) return;

    // 获取英雄世界空间头顶（超越粉色帽子与动作上扬）
    this.tempVec.set(
      hero.position.x,
      hero.position.y + 1.85,
      hero.position.z,
    );

    // 投影到 NDC [-1, 1]
    this.tempVec.project(camera);

    // 在近平面前方且在视角范围内才渲染
    if (this.tempVec.z > 1 || this.tempVec.z < -1) return;
    if (Math.abs(this.tempVec.x) > 1.3 || Math.abs(this.tempVec.y) > 1.3) {
      return;
    }

    // 屏幕像素坐标 (左上原点)
    const screenX = ((this.tempVec.x + 1) / 2) * this.width;
    const screenY = ((-this.tempVec.y + 1) / 2) * this.height;

    // 缓动平滑 HP
    if (this.animHp < 0) this.animHp = hero.hp;
    if (this.animHp > hero.hp) {
      this.animHp = Math.max(hero.hp, this.animHp - delta * hero.maxHp * 0.8);
    } else {
      this.animHp = hero.hp;
    }

    const currentHp = hero.hp;
    const maxHp = Math.max(hero.maxHp, 1);
    const hpRatio = THREE.MathUtils.clamp(currentHp / maxHp, 0, 1);
    const animRatio = THREE.MathUtils.clamp(this.animHp / maxHp, 0, 1);

    ctx.save();
    ctx.scale(dpr, dpr);

    // 血条尺寸
    const barW = 96;
    const barH = 10;
    // 居中，上方留 24px 间距，绝不遮挡角色帽子
    const x = screenX - barW / 2;
    const y = screenY - 24;

    // 绘制外阴影
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;

    // 1. 底框背景
    this.roundRect(ctx, x, y, barW, barH, 4);
    ctx.fillStyle = '#0b0f17';
    ctx.fill();

    ctx.shadowColor = 'transparent';

    // 边框描边
    ctx.strokeStyle = 'rgba(51, 65, 85, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const innerMargin = 2;
    const fillW = Math.max(0, barW - innerMargin * 2);
    const fillH = barH - innerMargin * 2;
    const fillX = x + innerMargin;
    const fillY = y + innerMargin;

    // 2. 受击红/灰平滑残余条
    if (animRatio > hpRatio) {
      const ghostW = fillW * animRatio;
      this.roundRect(ctx, fillX, fillY, ghostW, fillH, 2);
      ctx.fillStyle = 'rgba(239, 68, 68, 0.85)';
      ctx.fill();
    }

    // 3. 实际血量条
    if (hpRatio > 0) {
      const realW = fillW * hpRatio;
      this.roundRect(ctx, fillX, fillY, realW, fillH, 2);
      const grad = ctx.createLinearGradient(fillX, fillY, fillX, fillY + fillH);
      if (hpRatio > 0.3) {
        grad.addColorStop(0, '#60a5fa');
        grad.addColorStop(1, '#2563eb');
      } else {
        grad.addColorStop(0, '#f87171');
        grad.addColorStop(1, '#dc2626');
      }
      ctx.fillStyle = grad;
      ctx.fill();

      // 血条顶光
      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.fillRect(fillX, fillY, realW, Math.max(1, fillH * 0.35));
    }

    // 4. 百分比分格线 (每 100 HP 一格)
    const stepHp = 100;
    const totalSteps = Math.floor(maxHp / stepHp);
    if (totalSteps > 1 && totalSteps < 20) {
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.45)';
      ctx.lineWidth = 1;
      for (let i = 1; i < totalSteps; i += 1) {
        const dividerX = fillX + (fillW * (i * stepHp)) / maxHp;
        ctx.beginPath();
        ctx.moveTo(dividerX, fillY);
        ctx.lineTo(dividerX, fillY + fillH);
        ctx.stroke();
      }
    }

    // 5. 头顶英雄名字文本
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.font = '600 12px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = '#f1f5f9';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
    ctx.shadowBlur = 4;
    ctx.fillText('Miss Fortune', screenX, y - 4);

    ctx.restore();
  }

  dispose(): void {
    this.canvas.remove();
  }

  private roundRect(
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
}
