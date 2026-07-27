import {
  Container,
  Graphics,
  Texture,
  TilingSprite,
} from 'pixi.js';

/**
 * 深邃大海与自然海岸线调色板
 */
const PALETTE = {
  /** 极深大洋底层 (深邃蓝黑) */
  abyssal: 0x071b2d,
  /** 远海深邃湛蓝 */
  deepSea: 0x0c314b,
  /** 过渡暗深海 */
  midSea: 0x114a6e,
  /** 沉稳过渡蓝色 */
  outerLagoon: 0x16668c,
  /** 浅滩翡翠青蓝色 */
  shallowReef: 0x1d8a94,
  /** 焦散水彩波光 */
  causticWater: 0x48b6c4,
  /** 湿沙痕暗褐 */
  wetSandDark: 0x98733e,
  /** 浅滩湿沙 */
  wetSand: 0xbc9658,
  /** 自然金沙滩主色 */
  goldenSand: 0xe3c588,
  /** 阳光亮沙边 */
  lightSand: 0xf0deaf,
  /** 浪花纯白 */
  foamWhite: 0xffffff,
  /** 柔和浪尖 */
  foamSoft: 0xd6f7ff,
} as const;

const CAUSTIC_TILE = 256;

export interface LandRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point2D {
  x: number;
  y: number;
}

/**
 * 重构版高级程序化海洋与自然海岸线系统 (Organic Coastline & Ocean System)
 */
export class OceanLayer extends Container {
  private readonly causticsA: TilingSprite;
  private readonly causticsB: TilingSprite;
  private readonly baseShoreGraphics: Graphics;
  private readonly dynamicWaveGraphics: Graphics;
  private readonly sparklesGraphics: Graphics;
  private animTime = 0;

  private readonly land: LandRect | null;
  private readonly extent: number;
  private readonly seed: number;

  // 缓存静态自然海岸线轮廓点集
  private organicCoastlineBase: Point2D[] = [];

  constructor(
    extent: number,
    land?: LandRect,
    seed = 42,
  ) {
    super();
    this.label = 'OceanLayer';
    this.eventMode = 'none';
    this.extent = extent;
    this.land = land ?? null;
    this.seed = seed;

    const h = extent / 2;

    // 1. 深邃大洋底色背景 (多沉稳暗蓝色阶渐变)
    const base = new Graphics();
    base.label = 'OceanBase';
    base.rect(-h, -h, extent, extent).fill({ color: PALETTE.abyssal });
    base.circle(0, 0, extent * 0.48).fill({ color: PALETTE.deepSea, alpha: 0.85 });
    base.circle(0, 0, extent * 0.28).fill({ color: PALETTE.midSea, alpha: 0.6 });
    this.addChild(base);

    // 2. 双层 Voronoi 焦散波光纹理
    const texA = makeSeamlessCausticsTexture({ seed, cells: 8, sharpness: 8.0 });
    this.causticsA = new TilingSprite({ texture: texA, width: extent, height: extent });
    this.causticsA.label = 'CausticsA';
    this.causticsA.position.set(-h, -h);
    this.causticsA.alpha = 0.24;
    this.causticsA.tint = PALETTE.causticWater;
    this.addChild(this.causticsA);

    const texB = makeSeamlessCausticsTexture({ seed: seed ^ 0x937c15a, cells: 14, sharpness: 6.5 });
    this.causticsB = new TilingSprite({ texture: texB, width: extent, height: extent });
    this.causticsB.label = 'CausticsB';
    this.causticsB.position.set(-h, -h);
    this.causticsB.alpha = 0.15;
    this.causticsB.tint = PALETTE.foamSoft;
    this.addChild(this.causticsB);

    // 3. 静态海岸线与沙滩层 Graphics
    this.baseShoreGraphics = new Graphics();
    this.baseShoreGraphics.label = 'BaseShore';
    this.addChild(this.baseShoreGraphics);

    // 4. 动态波浪拍岸泡沫 Graphics
    this.dynamicWaveGraphics = new Graphics();
    this.dynamicWaveGraphics.label = 'DynamicWaves';
    this.addChild(this.dynamicWaveGraphics);

    // 5. 阳光水面闪烁 Graphics
    this.sparklesGraphics = new Graphics();
    this.sparklesGraphics.label = 'Sparkles';
    this.addChild(this.sparklesGraphics);

    // 预先生成自然海岸线轮廓并渲染静态浅滩沙滩
    this.initOrganicShore();
  }

  /**
   * 初始化自然有机海岸线、沙滩与浅海过渡
   */
  private initOrganicShore(): void {
    if (!this.land) return;

    // 生成基础有机轮廓 (采样 220 个点)
    this.organicCoastlineBase = generateOrganicContour(this.land, 0, this.seed, 220);

    const g = this.baseShoreGraphics;
    g.clear();

    // 1) 辽阔自然的浅海过渡层
    const lagoonLayers = [
      { offset: 72, color: PALETTE.outerLagoon, alpha: 0.55 },
      { offset: 52, color: PALETTE.shallowReef, alpha: 0.78 },
      { offset: 32, color: PALETTE.shallowReef, alpha: 0.92 },
    ];

    for (const layer of lagoonLayers) {
      const contour = generateOrganicContour(this.land, layer.offset, this.seed, 220);
      drawPolygon(g, contour, layer.color, layer.alpha);
    }

    // 2) 潮汐湿沙痕轨迹层 (Tidal Wet Sand Mark)
    const wetSandContour = generateOrganicContour(this.land, 48, this.seed, 220);
    drawPolygon(g, wetSandContour, PALETTE.wetSandDark, 0.95);

    const wetSandInnerContour = generateOrganicContour(this.land, 36, this.seed, 220);
    drawPolygon(g, wetSandInnerContour, PALETTE.wetSand, 0.95);

    // 3) 超级宽广辽阔的金色沙滩带 (Golden Sand Beach)
    const beachContour = generateOrganicContour(this.land, 24, this.seed, 220);
    drawPolygon(g, beachContour, PALETTE.goldenSand, 1.0);

    // 4) 亮沙边高光与细腻内金沙
    const innerBeachContour = generateOrganicContour(this.land, -35, this.seed, 220);
    drawPolygon(g, innerBeachContour, PALETTE.lightSand, 0.85);

    // 5) 沙滩颗粒与贝壳碎石细致散点 (Sand Grains & Shells)
    this.drawSandDetails(g);
  }

  /**
   * 绘制宽广沙滩上的泥土与微小碎石沙粒细节
   */
  private drawSandDetails(g: Graphics): void {
    if (!this.land) return;
    const rng = createRng(this.seed ^ 0x7777);

    for (let i = 0; i < 300; i++) {
      const idx = Math.floor(rng() * this.organicCoastlineBase.length);
      const pt = this.organicCoastlineBase[idx]!;
      // 在超大沙滩带上分布微小细沙与贝壳
      const rOffset = (rng() - 0.5) * 90;
      const sx = pt.x + rOffset;
      const sy = pt.y + rOffset;
      const size = 0.8 + rng() * 1.8;
      const color = rng() > 0.4 ? PALETTE.lightSand : PALETTE.wetSandDark;
      g.circle(sx, sy, size).fill({ color, alpha: 0.65 });
    }
  }

  /**
   * 帧更新：水波漂移、海浪沿着自然海岸线冲刷拍岸、水闪烁
   */
  update(deltaMS: number): void {
    const dt = deltaMS / 1000;
    this.animTime += dt;

    // 1. 焦散贴图双层漂移
    this.causticsA.tilePosition.x += 8.5 * dt;
    this.causticsA.tilePosition.y += 4.2 * dt;
    this.causticsB.tilePosition.x -= 6.0 * dt;
    this.causticsB.tilePosition.y += 7.8 * dt;

    this.causticsA.alpha = 0.24 + Math.sin(this.animTime * 1.2) * 0.04;
    this.causticsB.alpha = 0.15 + Math.cos(this.animTime * 1.5) * 0.03;

    // 2. 动态有机海浪拍岸与浪花泡沫
    this.updateOrganicShoreWaves();

    // 3. 极细微波光闪烁
    this.updateSparkles();
  }

  /**
   * 绘制跟随弯曲海岸线推涌的纤细精致海浪与超微海沫
   */
  private updateOrganicShoreWaves(): void {
    if (!this.land) return;

    const g = this.dynamicWaveGraphics;
    g.clear();

    const t = this.animTime;

    // 5 重纤细绵密的水纹海浪 (极细描边 + 层次推进)
    const waves = [
      { speed: 0.65, phase: 0.0, maxOff: 48, minOff: 2, width: 1.5, alpha: 0.95 },
      { speed: 0.60, phase: 1.2, maxOff: 66, minOff: 5, width: 1.2, alpha: 0.85 },
      { speed: 0.55, phase: 2.4, maxOff: 84, minOff: 8, width: 1.0, alpha: 0.75 },
      { speed: 0.50, phase: 3.6, maxOff: 102, minOff: 11, width: 0.9, alpha: 0.60 },
      { speed: 0.45, phase: 4.8, maxOff: 120, minOff: 14, width: 0.8, alpha: 0.45 },
    ];

    for (const wave of waves) {
      const progress = ((t * wave.speed + wave.phase) % 1 + 1) % 1;
      const currentOffset = wave.maxOff * (1 - progress) + wave.minOff * progress;

      const fade = Math.sin(progress * Math.PI);
      const waveAlpha = wave.alpha * fade;
      if (waveAlpha <= 0.02) continue;

      const waveDistort = Math.sin(t * 3.5 + progress * 6) * 3;
      const waveContour = generateOrganicContour(
        this.land,
        currentOffset + waveDistort,
        this.seed,
        240,
      );

      // 1) 绘制主水浪极细白亮描边 (1.0~1.5px 超纤细丝线)
      drawContourStroke(g, waveContour, PALETTE.foamWhite, waveAlpha, wave.width);

      // 2) 浪尖平行微距细水痕 (次级双丝浪纹)
      if (waveAlpha > 0.3) {
        const subContour = generateOrganicContour(
          this.land,
          currentOffset + waveDistort - 1.8,
          this.seed,
          240,
        );
        drawContourStroke(g, subContour, PALETTE.foamSoft, waveAlpha * 0.5, wave.width * 0.6);
      }

      // 3) 超微海沫碎粒
      if (progress > 0.3 && waveAlpha > 0.2) {
        const step = 4;
        for (let i = 0; i < waveContour.length; i += step) {
          const pt = waveContour[i]!;
          const fx = pt.x + (Math.sin(i * 0.4 + t * 4) * 1.5);
          const fy = pt.y + (Math.cos(i * 0.4 + t * 4) * 1.5);
          const fSize = 0.35 + Math.abs(Math.sin(i * 1.3 + t * 3)) * 0.55;
          g.circle(fx, fy, fSize).fill({ color: PALETTE.foamWhite, alpha: waveAlpha * 0.8 });
        }
      }
    }
  }

  /**
   * 阳光水面极细微闪烁点
   */
  private updateSparkles(): void {
    this.sparklesGraphics.clear();

    const t = this.animTime;
    const numSparkles = 45;

    for (let i = 0; i < numSparkles; i++) {
      const rx = (hash1D(i * 17 + 3) - 0.5) * (this.extent * 0.85);
      const ry = (hash1D(i * 31 + 7) - 0.5) * (this.extent * 0.85);

      if (this.land) {
        if (
          rx >= this.land.x - 30 &&
          rx <= this.land.x + this.land.w + 30 &&
          ry >= this.land.y - 30 &&
          ry <= this.land.y + this.land.h + 30
        ) {
          continue;
        }
      }

      const freq = 2.0 + hash1D(i * 13) * 3.0;
      const phase = hash1D(i * 19) * Math.PI * 2;
      const sparkleAlpha = Math.max(0, Math.sin(t * freq + phase) ** 4);

      if (sparkleAlpha > 0.05) {
        const size = 1.2 + hash1D(i * 7) * 2.0;
        this.sparklesGraphics
          .circle(rx, ry, size)
          .fill({ color: PALETTE.foamWhite, alpha: sparkleAlpha * 0.75 });
      }
    }
  }
}

/** 绘制填充多边形 */
function drawPolygon(g: Graphics, points: Point2D[], color: number, alpha: number): void {
  if (points.length < 3) return;
  g.beginPath();
  g.moveTo(points[0]!.x, points[0]!.y);
  for (let i = 1; i < points.length; i++) {
    g.lineTo(points[i]!.x, points[i]!.y);
  }
  g.closePath();
  g.fill({ color, alpha });
}

/** 绘制多边形描边线 */
function drawContourStroke(
  g: Graphics,
  points: Point2D[],
  color: number,
  alpha: number,
  lineWidth: number,
): void {
  if (points.length < 3) return;
  g.beginPath();
  g.moveTo(points[0]!.x, points[0]!.y);
  for (let i = 1; i < points.length; i++) {
    g.lineTo(points[i]!.x, points[i]!.y);
  }
  g.closePath();
  g.stroke({ width: lineWidth, color, alpha });
}

/**
 * 自然有机海岸线轮廓生成器：
 * 将圆角矩形基础周长通过多频谐波 (Multifrequency Harmonics) 扰动映射为曲折弯曲的自然海岸路径。
 */
export function generateOrganicContour(
  land: LandRect,
  offset: number,
  seed = 42,
  numSamples = 220,
): Point2D[] {
  const points: Point2D[] = [];
  const { x, y, w, h } = land;
  // 自然流畅的大圆弧转角，彻底消除直角与深色折角
  const r = Math.min(w, h) * 0.12;

  for (let i = 0; i < numSamples; i++) {
    const u = i / numSamples;
    const { pos, normal } = sampleRectBoundaryNormal(x, y, w, h, r, u);

    const s1 = Math.sin(u * Math.PI * 6 + seed) * 16;
    const s2 = Math.cos(u * Math.PI * 14 + seed * 1.7) * 7;
    const s3 = Math.sin(u * Math.PI * 26 + seed * 2.9) * 3.5;

    const totalDistort = offset + s1 + s2 + s3;

    points.push({
      x: pos.x + normal.x * totalDistort,
      y: pos.y + normal.y * totalDistort,
    });
  }

  return points;
}

/**
 * 沿圆角矩形边界参数化采样 (u ∈ [0, 1])，输出位置 pos 与精确法向量 normal
 */
function sampleRectBoundaryNormal(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  u: number,
): { pos: Point2D; normal: Point2D } {
  const straightW = Math.max(1, w - 2 * r);
  const straightH = Math.max(1, h - 2 * r);
  const cornerArc = 0.5 * Math.PI * r;
  const totalPerimeter = 2 * straightW + 2 * straightH + 4 * cornerArc;

  let d = u * totalPerimeter;

  // Segment 1: 上直边
  if (d <= straightW) {
    const t = d / straightW;
    return {
      pos: { x: x + r + t * straightW, y },
      normal: { x: 0, y: -1 },
    };
  }
  d -= straightW;

  // Segment 2: 右上圆角
  if (d <= cornerArc) {
    const angle = (d / cornerArc) * (Math.PI / 2) - Math.PI / 2;
    const cx = x + w - r;
    const cy = y + r;
    const nx = Math.cos(angle);
    const ny = Math.sin(angle);
    return {
      pos: { x: cx + nx * r, y: cy + ny * r },
      normal: { x: nx, y: ny },
    };
  }
  d -= cornerArc;

  // Segment 3: 右直边
  if (d <= straightH) {
    const t = d / straightH;
    return {
      pos: { x: x + w, y: y + r + t * straightH },
      normal: { x: 1, y: 0 },
    };
  }
  d -= straightH;

  // Segment 4: 右下圆角
  if (d <= cornerArc) {
    const angle = (d / cornerArc) * (Math.PI / 2);
    const cx = x + w - r;
    const cy = y + h - r;
    const nx = Math.cos(angle);
    const ny = Math.sin(angle);
    return {
      pos: { x: cx + nx * r, y: cy + ny * r },
      normal: { x: nx, y: ny },
    };
  }
  d -= cornerArc;

  // Segment 5: 下直边
  if (d <= straightW) {
    const t = d / straightW;
    return {
      pos: { x: x + w - r - t * straightW, y: y + h },
      normal: { x: 0, y: 1 },
    };
  }
  d -= straightW;

  // Segment 6: 左下圆角
  if (d <= cornerArc) {
    const angle = (d / cornerArc) * (Math.PI / 2) + Math.PI / 2;
    const cx = x + r;
    const cy = y + h - r;
    const nx = Math.cos(angle);
    const ny = Math.sin(angle);
    return {
      pos: { x: cx + nx * r, y: cy + ny * r },
      normal: { x: nx, y: ny },
    };
  }
  d -= cornerArc;

  // Segment 7: 左直边
  if (d <= straightH) {
    const t = d / straightH;
    return {
      pos: { x, y: y + h - r - t * straightH },
      normal: { x: -1, y: 0 },
    };
  }
  d -= straightH;

  // Segment 8: 左上圆角
  const angle = (Math.min(d, cornerArc) / cornerArc) * (Math.PI / 2) + Math.PI;
  const cx = x + r;
  const cy = y + r;
  const nx = Math.cos(angle);
  const ny = Math.sin(angle);
  return {
    pos: { x: cx + nx * r, y: cy + ny * r },
    normal: { x: nx, y: ny },
  };
}

function hash1D(n: number): number {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

interface CausticsOpts {
  seed: number;
  cells: number;
  sharpness: number;
}

function makeSeamlessCausticsTexture(opts: CausticsOpts): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = CAUSTIC_TILE;
  canvas.height = CAUSTIC_TILE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Texture.WHITE;

  const img = ctx.createImageData(CAUSTIC_TILE, CAUSTIC_TILE);
  const data = img.data;

  const N = opts.cells;
  const points: [number, number][][] = [];
  const rng = createRng(opts.seed);

  for (let gy = 0; gy < N; gy++) {
    points[gy] = [];
    for (let gx = 0; gx < N; gx++) {
      const px = (gx + 0.15 + rng() * 0.7) / N;
      const py = (gy + 0.15 + rng() * 0.7) / N;
      points[gy]![gx] = [px, py];
    }
  }

  for (let y = 0; y < CAUSTIC_TILE; y++) {
    const ny = y / CAUSTIC_TILE;
    const cellY = Math.floor(ny * N);

    for (let x = 0; x < CAUSTIC_TILE; x++) {
      const nx = x / CAUSTIC_TILE;
      const cellX = Math.floor(nx * N);

      let d1 = 999;
      let d2 = 999;

      for (let dy = -1; dy <= 1; dy++) {
        const gy = (cellY + dy + N) % N;
        const wrapY = dy + cellY < 0 ? -1 : dy + cellY >= N ? 1 : 0;

        for (let dx = -1; dx <= 1; dx++) {
          const gx = (cellX + dx + N) % N;
          const wrapX = dx + cellX < 0 ? -1 : dx + cellX >= N ? 1 : 0;

          const [ptX, ptY] = points[gy]![gx]!;
          const realPtX = ptX + wrapX;
          const realPtY = ptY + wrapY;

          const dist = Math.hypot(nx - realPtX, ny - realPtY);
          if (dist < d1) {
            d2 = d1;
            d1 = dist;
          } else if (dist < d2) {
            d2 = dist;
          }
        }
      }

      const diff = d2 - d1;
      let intensity = Math.pow(Math.max(0, 1.0 - diff * opts.sharpness), 2.5);
      intensity = Math.min(1.0, Math.max(0, intensity));

      const alpha = Math.floor(intensity * 255);
      const idx = (y * CAUSTIC_TILE + x) * 4;
      data[idx] = 255;
      data[idx + 1] = 255;
      data[idx + 2] = 255;
      data[idx + 3] = alpha;
    }
  }

  ctx.putImageData(img, 0, 0);
  return Texture.from(canvas);
}

function createRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
