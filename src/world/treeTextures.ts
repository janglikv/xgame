import { Texture } from 'pixi.js';
import type { TreeKind } from '../data/maps/types';
import { APPLE_POSITIONS } from './AppleTree';
import { hexToRgbString as hex, TREE_BAKE_SCALE } from './treeCommon';

/**
 * 共享树贴图：矢量树烘焙成 Texture，全场 Sprite 复用（对齐草的 grassTextures 路径）。
 * 锚点在脚底中心。
 */

const W = 128;
const H = 128;
/** 脚底在纹理中的像素坐标 */
const FOOT_X = W * 0.5;
const FOOT_Y = H - 10;

/** 烘焙时用的画布缩放（与 drawPineLocal / drawAppleTreeLocal 内部 2.7 一致） */
const BAKE_SCALE = TREE_BAKE_SCALE;

let pineTexture: Texture | null = null;
const appleTextures: Array<Texture | null> = [null, null, null, null];

function strokePoly(
  ctx: CanvasRenderingContext2D,
  pts: number[],
  fill: string,
  lineW: number,
  stroke = 'rgba(0,0,0,1)',
): void {
  if (pts.length < 6) return;
  ctx.beginPath();
  ctx.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i < pts.length; i += 2) {
    ctx.lineTo(pts[i]!, pts[i + 1]!);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineW;
  ctx.stroke();
}

function paintPine(ctx: CanvasRenderingContext2D): void {
  const scale = BAKE_SCALE;
  const trunkH = 3.2 * scale;
  const trunkW = 3.2 * scale;
  const x = FOOT_X;
  const y = FOOT_Y;
  const outline = Math.max(1.8, 1.15 * scale);

  ctx.beginPath();
  ctx.ellipse(x, y + 2, 11 * scale, 3.6 * scale, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.fill();

  ctx.fillStyle = hex(0x4a2e18);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = outline;
  ctx.beginPath();
  ctx.rect(x - trunkW / 2, y - trunkH, trunkW, trunkH + 1);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = 'rgba(139,90,50,0.4)';
  ctx.fillRect(x - trunkW / 2 + 0.6, y - trunkH, trunkW * 0.35, trunkH);

  const deep = 0x1f5a1a;
  const mid = 0x2d7a28;
  const lite = 0x58b848;
  const layers = [
    { baseY: y - trunkH * 0.35, halfW: 15 * scale, height: 18 * scale, color: deep },
    {
      baseY: y - trunkH * 0.35 - 8 * scale,
      halfW: 12 * scale,
      height: 16 * scale,
      color: mid,
    },
    {
      baseY: y - trunkH * 0.35 - 16 * scale,
      halfW: 8.5 * scale,
      height: 15 * scale,
      color: lite,
    },
  ];
  for (const layer of layers) {
    const tipY = layer.baseY - layer.height;
    strokePoly(
      ctx,
      [x, tipY, x - layer.halfW, layer.baseY, x + layer.halfW, layer.baseY],
      hex(layer.color),
      outline,
    );
  }

  const tipBase = y - trunkH * 0.35 - 28 * scale;
  strokePoly(
    ctx,
    [
      x,
      tipBase - 4 * scale,
      x - 3.6 * scale,
      tipBase + 8 * scale,
      x + 2.6 * scale,
      tipBase + 8 * scale,
    ],
    'rgba(126,212,95,0.55)',
    outline * 0.85,
  );
}

function paintApple(ctx: CanvasRenderingContext2D, appleCount: number): void {
  const scale = BAKE_SCALE;
  const trunkH = 3.4 * scale;
  const trunkW = 3.6 * scale;
  const x = FOOT_X;
  const y = FOOT_Y;
  const outline = Math.max(1.8, 1.15 * scale);

  ctx.beginPath();
  ctx.ellipse(x, y + 2, 12 * scale, 3.8 * scale, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.fill();

  strokePoly(
    ctx,
    [
      x - trunkW * 0.65,
      y,
      x - trunkW * 0.5,
      y - trunkH,
      x + trunkW * 0.5,
      y - trunkH,
      x + trunkW * 0.65,
      y,
    ],
    hex(0x4a2e18),
    outline,
  );
  strokePoly(
    ctx,
    [
      x - trunkW * 0.45,
      y - trunkH,
      x - trunkW * 0.1,
      y - trunkH,
      x - trunkW * 0.2,
      y,
      x - trunkW * 0.55,
      y,
    ],
    'rgba(139,90,50,0.4)',
    0,
  );

  const deep = 0x1f5a1a;
  const mid = 0x2d7a28;
  const lite = 0x58b848;
  const crowns: Array<{ pts: number[]; color: number }> = [
    {
      color: deep,
      pts: [
        x,
        y - trunkH * 0.35 - 14 * scale,
        x - 9 * scale,
        y - trunkH * 0.35 - 12 * scale,
        x - 16 * scale,
        y - trunkH * 0.35 - 4 * scale,
        x - 12 * scale,
        y - trunkH * 0.35,
        x + 12 * scale,
        y - trunkH * 0.35,
        x + 16 * scale,
        y - trunkH * 0.35 - 4 * scale,
        x + 9 * scale,
        y - trunkH * 0.35 - 12 * scale,
      ],
    },
    {
      color: mid,
      pts: [
        x,
        y - trunkH * 0.35 - 20 * scale,
        x - 7.5 * scale,
        y - trunkH * 0.35 - 18 * scale,
        x - 13.5 * scale,
        y - trunkH * 0.35 - 11 * scale,
        x - 10 * scale,
        y - trunkH * 0.35 - 7 * scale,
        x + 10 * scale,
        y - trunkH * 0.35 - 7 * scale,
        x + 13.5 * scale,
        y - trunkH * 0.35 - 11 * scale,
        x + 7.5 * scale,
        y - trunkH * 0.35 - 18 * scale,
      ],
    },
    {
      color: lite,
      pts: [
        x,
        y - trunkH * 0.35 - 27 * scale,
        x - 6 * scale,
        y - trunkH * 0.35 - 24 * scale,
        x - 10.5 * scale,
        y - trunkH * 0.35 - 18 * scale,
        x - 7.5 * scale,
        y - trunkH * 0.35 - 15 * scale,
        x + 7.5 * scale,
        y - trunkH * 0.35 - 15 * scale,
        x + 10.5 * scale,
        y - trunkH * 0.35 - 18 * scale,
        x + 6 * scale,
        y - trunkH * 0.35 - 24 * scale,
      ],
    },
  ];
  for (const c of crowns) {
    strokePoly(ctx, c.pts, hex(c.color), outline);
  }

  const tipBase = y - trunkH * 0.35 - 24 * scale;
  strokePoly(
    ctx,
    [
      x,
      tipBase - 5 * scale,
      x - 4.5 * scale,
      tipBase + 3 * scale,
      x + 4.5 * scale,
      tipBase + 3 * scale,
    ],
    'rgba(126,212,95,0.6)',
    outline * 0.85,
  );

  const count = Math.min(APPLE_POSITIONS.length, Math.max(0, appleCount));
  for (let i = 0; i < count; i++) {
    const pos = APPLE_POSITIONS[i]!;
    const fx = x + pos.ox;
    const fy = y + pos.oy;
    const fr = 5.0 * (scale / 2.7);

    ctx.beginPath();
    ctx.arc(fx, fy, fr, 0, Math.PI * 2);
    ctx.fillStyle = hex(0xef3333);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.95)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(fx - fr * 0.3, fy - fr * 0.3, fr * 0.36, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(fx, fy - fr);
    ctx.lineTo(fx + 1, fy - fr - 2.5);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    strokePoly(
      ctx,
      [fx + 1, fy - fr - 2.5, fx + 3.5, fy - fr - 3.5, fx + 2.5, fy - fr - 1],
      hex(0x7ed45f),
      0.8,
    );
  }
}

function bake(paint: (ctx: CanvasRenderingContext2D) => void): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Texture.EMPTY;
  ctx.clearRect(0, 0, W, H);
  paint(ctx);
  const tex = Texture.from(canvas);
  tex.source.scaleMode = 'linear';
  return tex;
}

/** 松树共享贴图 */
export function getPineTreeTexture(): Texture {
  if (pineTexture && !pineTexture.destroyed) return pineTexture;
  pineTexture = bake(paintPine);
  return pineTexture;
}

/** 苹果树共享贴图（0~3 个挂果变体） */
export function getAppleTreeTexture(appleCount: number): Texture {
  const n = Math.min(3, Math.max(0, Math.floor(appleCount)));
  const cached = appleTextures[n];
  if (cached && !cached.destroyed) return cached;
  const tex = bake((ctx) => paintApple(ctx, n));
  appleTextures[n] = tex;
  return tex;
}

export function getTreeTexture(kind: TreeKind, appleCount = 0): Texture {
  if (kind === 'apple') return getAppleTreeTexture(appleCount);
  return getPineTreeTexture();
}

/** 脚底锚点（u,v） */
export const TREE_SPRITE_ANCHOR = {
  x: FOOT_X / W,
  y: FOOT_Y / H,
} as const;
