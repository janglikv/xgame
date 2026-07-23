import { Assets, Texture } from 'pixi.js';

/** 深蓝近黑，与松树 / 飞剑描边一致 */
export const OUTLINE_COLOR_DEFAULT = 0x0a1220;

/**
 * 角色 / 蜘蛛（scale≈0.07~0.1，贴图约 700~1100px）
 * 约 2 屏幕像素粗。
 */
export const OUTLINE_PX_CHARACTER = 28;

/** 飞剑小图（SPEAR_SCALE≈0.037） */
export const OUTLINE_PX_SPEAR = 30;

export type OutlineBakeResult = {
  texture: Texture;
  /** 四边外扩的贴图像素（0 = 未描边） */
  pad: number;
  contentWidth: number;
  contentHeight: number;
};

/**
 * 贴图四周 pad 后，把「脚底锚点」换算到新贴图坐标系。
 * 等量 padding 时，原图内容的本地坐标（相对脚底）保持不变。
 */
export function paddedFootAnchorY(
  originalFootY: number,
  contentHeight: number,
  pad: number,
): number {
  if (pad <= 0 || contentHeight <= 0) return originalFootY;
  return (pad + originalFootY * contentHeight) / (contentHeight + pad * 2);
}

/**
 * 给透明底贴图扩一圈实心描边，再叠回原图。
 * 失败或 thickness≤0 时返回原贴图（pad=0）。
 */
export function bakeOutlineTexture(
  texture: Texture,
  thickness: number,
  color: number = OUTLINE_COLOR_DEFAULT,
): OutlineBakeResult {
  const contentWidth = Math.max(1, Math.round(texture.width));
  const contentHeight = Math.max(1, Math.round(texture.height));
  const empty: OutlineBakeResult = {
    texture,
    pad: 0,
    contentWidth,
    contentHeight,
  };

  const resource = texture.source.resource as CanvasImageSource | null | undefined;
  if (!resource || thickness <= 0) return empty;

  const pad = Math.ceil(thickness);
  const cw = contentWidth + pad * 2;
  const ch = contentHeight + pad * 2;

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return empty;

  ctx.drawImage(resource, pad, pad, contentWidth, contentHeight);
  const src = ctx.getImageData(0, 0, cw, ch);
  const alpha = new Uint8Array(cw * ch);
  for (let i = 0; i < alpha.length; i++) {
    alpha[i] = src.data[i * 4 + 3]!;
  }

  const out = ctx.createImageData(cw, ch);
  const od = out.data;
  const cr = (color >> 16) & 0xff;
  const cg = (color >> 8) & 0xff;
  const cb = color & 0xff;
  const rad = thickness;
  const rad2 = rad * rad;
  const ALPHA_ON = 24;

  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const ai = y * cw + x;
      if (alpha[ai]! < ALPHA_ON) continue;

      // 仅从轮廓附近像素向外扩
      let edge = alpha[ai]! < 230;
      if (!edge) {
        for (let dy = -1; dy <= 1 && !edge; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (
              nx < 0 ||
              ny < 0 ||
              nx >= cw ||
              ny >= ch ||
              alpha[ny * cw + nx]! < ALPHA_ON
            ) {
              edge = true;
            }
          }
        }
      }
      if (!edge) continue;

      const y0 = Math.max(0, y - rad);
      const y1 = Math.min(ch - 1, y + rad);
      const x0 = Math.max(0, x - rad);
      const x1 = Math.min(cw - 1, x + rad);
      for (let ny = y0; ny <= y1; ny++) {
        const dy = ny - y;
        const dy2 = dy * dy;
        for (let nx = x0; nx <= x1; nx++) {
          const dx = nx - x;
          if (dx * dx + dy2 > rad2) continue;
          const oi = (ny * cw + nx) * 4;
          od[oi] = cr;
          od[oi + 1] = cg;
          od[oi + 2] = cb;
          od[oi + 3] = 255;
        }
      }
    }
  }

  ctx.putImageData(out, 0, 0);
  ctx.drawImage(resource, pad, pad, contentWidth, contentHeight);

  return {
    texture: Texture.from(canvas),
    pad,
    contentWidth,
    contentHeight,
  };
}

const outlineCache = new Map<string, OutlineBakeResult>();

/** 按 url + 厚度 + 颜色缓存；多实例角色 / 蜘蛛共用一次烘焙 */
export async function loadOutlinedTexture(
  url: string,
  thickness: number = OUTLINE_PX_CHARACTER,
  color: number = OUTLINE_COLOR_DEFAULT,
): Promise<OutlineBakeResult> {
  const key = `${url}\0${thickness}\0${color}`;
  const hit = outlineCache.get(key);
  if (hit) return hit;

  const base = await Assets.load<Texture>(url);
  const result = bakeOutlineTexture(base, thickness, color);
  outlineCache.set(key, result);
  return result;
}
