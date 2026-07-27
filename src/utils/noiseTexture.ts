import { Texture } from 'pixi.js';

function createRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * 2D 杂色哈希采样
 */
function hash2D(x: number, y: number, seed: number): number {
  const n = Math.sin(x * 12.9898 + y * 78.233 + seed * 43.123) * 43758.5453;
  return n - Math.floor(n);
}

/**
 * 2D 平滑网格噪声 (Value Noise with Smoothstep)
 */
export function smoothNoise2D(x: number, y: number, seed = 42): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;

  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);

  const n00 = hash2D(ix, iy, seed);
  const n10 = hash2D(ix + 1, iy, seed);
  const n01 = hash2D(ix, iy + 1, seed);
  const n11 = hash2D(ix + 1, iy + 1, seed);

  const nx0 = n00 + (n10 - n00) * ux;
  const nx1 = n01 + (n11 - n01) * ux;
  return nx0 + (nx1 - nx0) * uy;
}

/**
 * 2D 分形布朗运动 (Fractal Brownian Motion / FBM)
 * 用于生成多尺度的自然纹理 (低频色彩起伏 + 高频杂色)
 */
export function fbm2D(
  x: number,
  y: number,
  octaves = 3,
  persistence = 0.5,
  lacunarity = 2.0,
  seed = 42,
): number {
  let total = 0;
  let frequency = 1.0;
  let amplitude = 1.0;
  let maxValue = 0;

  for (let i = 0; i < octaves; i++) {
    total += smoothNoise2D(x * frequency, y * frequency, seed + i * 101) * amplitude;
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }

  return total / maxValue;
}

export interface SeamlessNoiseOpts {
  width?: number;
  height?: number;
  seed?: number;
  octaves?: number;
  grainIntensity?: number;
  contrast?: number;
}

/**
 * 生成无缝程序化 2D 噪点贴图 (Seamless Noise Texture)
 * 适用于 Pixi.js TilingSprite 蒙版 overlay
 */
export function makeSeamlessNoiseTexture(opts?: SeamlessNoiseOpts): Texture {
  const w = opts?.width ?? 256;
  const h = opts?.height ?? 256;
  const seed = opts?.seed ?? 1337;
  const octaves = opts?.octaves ?? 3;
  const grain = opts?.grainIntensity ?? 0.3;
  const contrast = opts?.contrast ?? 1.2;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Texture.WHITE;

  const img = ctx.createImageData(w, h);
  const data = img.data;

  const gridN = 16;
  const grid: number[][] = [];
  const rng = createRng(seed);

  for (let gy = 0; gy < gridN; gy++) {
    grid[gy] = [];
    for (let gx = 0; gx < gridN; gx++) {
      grid[gy]![gx] = rng();
    }
  }

  function sampleGridSeamless(gx: number, gy: number): number {
    const wrappedX = ((gx % gridN) + gridN) % gridN;
    const wrappedY = ((gy % gridN) + gridN) % gridN;
    return grid[wrappedY]![wrappedX]!;
  }

  function seamlessNoiseAt(nx: number, ny: number, scale: number): number {
    const gx = nx * scale;
    const gy = ny * scale;
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const fx = gx - ix;
    const fy = gy - iy;

    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);

    const v00 = sampleGridSeamless(ix, iy);
    const v10 = sampleGridSeamless(ix + 1, iy);
    const v01 = sampleGridSeamless(ix, iy + 1);
    const v11 = sampleGridSeamless(ix + 1, iy + 1);

    const vx0 = v00 + (v10 - v00) * ux;
    const vx1 = v01 + (v11 - v01) * ux;
    return vx0 + (vx1 - vx0) * uy;
  }

  for (let y = 0; y < h; y++) {
    const ny = y / h;
    for (let x = 0; x < w; x++) {
      const nx = x / w;

      let val = 0;
      let amp = 1.0;
      let maxAmp = 0;
      let sc = 1.0;

      for (let o = 0; o < octaves; o++) {
        val += seamlessNoiseAt(nx, ny, gridN * sc) * amp;
        maxAmp += amp;
        amp *= 0.5;
        sc *= 2.0;
      }
      val /= maxAmp;

      // 调整对比度与高频噪点颗粒
      val = 0.5 + (val - 0.5) * contrast;
      const microGrain = (rng() - 0.5) * grain;
      val = Math.min(1, Math.max(0, val + microGrain));

      const gray = Math.floor(val * 255);
      const idx = (y * w + x) * 4;
      data[idx] = gray;
      data[idx + 1] = gray;
      data[idx + 2] = gray;
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  return Texture.from(canvas);
}
