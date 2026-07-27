import {
  Container,
  Graphics,
  Texture,
  TilingSprite,
} from 'pixi.js';

/** 深 / 浅海水色 */
const C = {
  deep: 0x0a3550,
  mid: 0x0e4a6e,
  lite: 0x1a6a90,
} as const;

/** 无缝噪声贴图边长（2 的幂，便于 tile） */
const TILE = 256;

/**
 * 程序化海面：深浅规则噪点双层慢滚（无岸线）。
 */
export class OceanLayer extends Container {
  private readonly layerA: TilingSprite;
  private readonly layerB: TilingSprite;

  constructor(
    extent: number,
    _land?: { x: number; y: number; w: number; h: number },
    seed = 42,
  ) {
    super();
    this.label = 'OceanLayer';
    this.eventMode = 'none';

    const h = extent / 2;

    // 底：最深海色
    const base = new Graphics();
    base.label = 'OceanBase';
    base.rect(-h, -h, extent, extent).fill({ color: C.deep });
    this.addChild(base);

    // 层 A：较大尺度噪点（深浅斑）
    const texA = makeSeamlessNoiseTexture({
      seed,
      scale: 0.045,
      octaves: 3,
      contrast: 1.15,
    });
    this.layerA = new TilingSprite({
      texture: texA,
      width: extent,
      height: extent,
    });
    this.layerA.label = 'OceanNoiseA';
    this.layerA.position.set(-h, -h);
    this.layerA.alpha = 0.55;
    this.layerA.tint = C.mid;
    this.addChild(this.layerA);

    // 层 B：更细噪点，反向慢漂
    const texB = makeSeamlessNoiseTexture({
      seed: seed ^ 0x9e3779b9,
      scale: 0.09,
      octaves: 2,
      contrast: 1.0,
    });
    this.layerB = new TilingSprite({
      texture: texB,
      width: extent,
      height: extent,
    });
    this.layerB.label = 'OceanNoiseB';
    this.layerB.position.set(-h, -h);
    this.layerB.alpha = 0.28;
    this.layerB.tint = C.lite;
    this.addChild(this.layerB);
  }

  /** 双层反向慢滚，形成轻微流动感 */
  update(deltaMS: number): void {
    const dt = deltaMS / 1000;
    this.layerA.tilePosition.x += 6 * dt;
    this.layerA.tilePosition.y += 3.5 * dt;
    this.layerB.tilePosition.x -= 4 * dt;
    this.layerB.tilePosition.y += 5.5 * dt;
  }
}

type NoiseOpts = {
  seed: number;
  /** 频率：越大斑点越碎 */
  scale: number;
  octaves: number;
  contrast: number;
};

/**
 * 无缝 value-noise 贴图：亮部透出浅色、暗部透底色。
 * 用环面坐标保证左右/上下可 tile。
 */
function makeSeamlessNoiseTexture(opts: NoiseOpts): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = TILE;
  canvas.height = TILE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Texture.WHITE;

  const img = ctx.createImageData(TILE, TILE);
  const data = img.data;
  const perm = buildPerm(opts.seed);

  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      // 环面：把像素映射到 [0, 2π)，多 octave 叠加
      let amp = 1;
      let freq = opts.scale;
      let sum = 0;
      let norm = 0;
      for (let o = 0; o < opts.octaves; o++) {
        const n = seamlessValueNoise(x, y, TILE, freq, perm);
        sum += n * amp;
        norm += amp;
        amp *= 0.5;
        freq *= 2;
      }
      let v = sum / norm; // 0..1
      // 对比度：中间拉开深浅
      v = 0.5 + (v - 0.5) * opts.contrast;
      v = Math.max(0, Math.min(1, v));

      // 只写 alpha 通道式灰度：白=浅、黑=透明（叠在深底上）
      const a = Math.floor(v * 255);
      const i = (y * TILE + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = a;
    }
  }

  ctx.putImageData(img, 0, 0);
  return Texture.from(canvas);
}

/** 无缝 value noise：在 tile 上 periodic 的格子插值 */
function seamlessValueNoise(
  x: number,
  y: number,
  size: number,
  freq: number,
  perm: Uint8Array,
): number {
  // 格子数取整，保证 period 整除 tile
  const cells = Math.max(2, Math.round(size * freq));
  const cell = size / cells;
  const fx = x / cell;
  const fy = y / cell;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const x1 = (x0 + 1) % cells;
  const y1 = (y0 + 1) % cells;
  const x0m = ((x0 % cells) + cells) % cells;
  const y0m = ((y0 % cells) + cells) % cells;

  const v00 = hash2(x0m, y0m, perm);
  const v10 = hash2(x1, y0m, perm);
  const v01 = hash2(x0m, y1, perm);
  const v11 = hash2(x1, y1, perm);

  const sx = smooth(tx);
  const sy = smooth(ty);
  const a = lerp(v00, v10, sx);
  const b = lerp(v01, v11, sx);
  return lerp(a, b, sy);
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function hash2(x: number, y: number, perm: Uint8Array): number {
  const n = perm[(x + perm[y & 255]!) & 255]!;
  return n / 255;
}

function buildPerm(seed: number): Uint8Array {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = seed >>> 0;
  for (let i = 255; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    const tmp = p[i]!;
    p[i] = p[j]!;
    p[j] = tmp;
  }
  return p;
}
