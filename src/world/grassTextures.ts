import { Texture } from 'pixi.js';

/**
 * 共享草贴图：把矢量草烘焙成一张纹理，所有草实例用 Sprite 复用。
 * 锚点在脚底中心（纹理底边中点）。
 */
let grassTexture: Texture | null = null;

const W = 96;
const H = 72;
/** 脚底在纹理中的像素坐标 */
const FOOT_X = W * 0.5;
const FOOT_Y = H - 8;

function fillBlade(
  ctx: CanvasRenderingContext2D,
  baseX: number,
  baseY: number,
  tipX: number,
  tipY: number,
  halfW: number,
  color: string,
): void {
  ctx.beginPath();
  ctx.moveTo(baseX - halfW, baseY);
  ctx.lineTo(tipX, tipY);
  ctx.lineTo(baseX + halfW, baseY);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
}

function paintGrass(ctx: CanvasRenderingContext2D): void {
  const x = FOOT_X;
  const y = FOOT_Y;
  const s = 2.05;

  // 脚底阴影
  ctx.beginPath();
  ctx.ellipse(x, y + 1, 9 * s, 3 * s, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fill();

  // 后层
  fillBlade(ctx, x, y, x - 10 * s, y - 14 * s, 4 * s * 0.55, '#225c1e');
  fillBlade(ctx, x, y, x + 11 * s, y - 13 * s, 4 * s * 0.55, '#225c1e');
  fillBlade(ctx, x, y, x - 3 * s, y - 18 * s, 4 * s * 0.55, '#225c1e');

  // 中层
  fillBlade(ctx, x, y, x - 13 * s, y - 10 * s, 3.2 * s, '#3d942e');
  fillBlade(ctx, x, y, x - 6 * s, y - 20 * s, 3.2 * s, '#3d942e');
  fillBlade(ctx, x, y, x + 5 * s, y - 21 * s, 3.2 * s, '#3d942e');
  fillBlade(ctx, x, y, x + 12 * s, y - 11 * s, 3.2 * s, '#3d942e');

  // 前层亮叶
  fillBlade(ctx, x, y, x - 8 * s, y - 13 * s, 2.6 * s, '#62bf47');
  fillBlade(ctx, x, y, x + 1 * s, y - 17 * s, 2.4 * s, '#a2f07d');
  fillBlade(ctx, x, y, x + 7 * s, y - 14 * s, 2.6 * s, '#62bf47');
}

/** 获取（惰性创建）共享草纹理 */
export function getGrassTexture(): Texture {
  if (grassTexture && !grassTexture.destroyed) {
    return grassTexture;
  }
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    grassTexture = Texture.EMPTY;
    return grassTexture;
  }
  ctx.clearRect(0, 0, W, H);
  paintGrass(ctx);
  grassTexture = Texture.from(canvas);
  grassTexture.source.scaleMode = 'linear';
  return grassTexture;
}

/** 脚底锚点（u,v） */
export const GRASS_SPRITE_ANCHOR = {
  x: FOOT_X / W,
  y: FOOT_Y / H,
} as const;
