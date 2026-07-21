import { Container, Graphics } from 'pixi.js';

/** 卡通草地配色（始终按白天绘制，黑夜用 NightOverlay 叠加） */
const COLORS = {
  base: 0x8fdc56,
  baseSoft: 0x7dcf48,
  patchDark: 0x6fbf3a,
  patchLight: 0xa8e86e,
  blade: 0x4caf2f,
  bladeMid: 0x5fc43a,
  bladeLight: 0x7ed957,
  bladeHi: 0xb6f07a,
  dirt: 0xd8b48a,
  dirtDark: 0xc49a6c,
  dirtHi: 0xf0d7b0,
  flowerPink: 0xff7eb3,
  flowerYellow: 0xffe14a,
  flowerWhite: 0xfff6e0,
  flowerBlue: 0x7ec8ff,
  flowerCenter: 0xff9f43,
  flowerHi: 0xfff3c4,
} as const;

/** 地图整体缩放（1 = 原始尺寸，0.5 = 缩小一倍） */
const MAP_SCALE = 0.5;

const PATCH_CELL = 140 * MAP_SCALE;
const DIRT_CELL = 260 * MAP_SCALE;
const TUFT_CELL = 52 * MAP_SCALE;
const FLOWER_CELL = 160 * MAP_SCALE;

function createRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function cellSeed(base: number, cx: number, cy: number, salt: number): number {
  const x = cx | 0;
  const y = cy | 0;
  return (
    (base ^
      Math.imul(x, 73856093) ^
      Math.imul(y, 19349663) ^
      Math.imul(salt, 83492791)) >>>
    0
  );
}

/**
 * 代码绘制的卡通草地（白天样式）。
 * 黑夜请在上层叠 NightOverlay，而不是换一套色盘。
 */
export class CartoonGrass extends Container {
  private readonly g: Graphics;
  private readonly seed: number;
  private viewWidth = 0;
  private viewHeight = 0;
  private lastCamX = Number.NaN;
  private lastCamY = Number.NaN;

  constructor(seed = 42) {
    super();
    this.label = 'CartoonGrass';
    this.seed = seed;
    this.g = new Graphics();
    this.g.label = 'GrassGraphics';
    this.addChild(this.g);
  }

  draw(
    width: number,
    height: number,
    cameraX = 0,
    cameraY = 0,
    force = false,
  ): void {
    if (width <= 0 || height <= 0) return;

    const quant = 8;
    const qx = Math.floor(cameraX / quant) * quant;
    const qy = Math.floor(cameraY / quant) * quant;
    if (
      !force &&
      width === this.viewWidth &&
      height === this.viewHeight &&
      qx === this.lastCamX &&
      qy === this.lastCamY
    ) {
      this.g.position.set(-(cameraX - qx), -(cameraY - qy));
      return;
    }

    this.viewWidth = width;
    this.viewHeight = height;
    this.lastCamX = qx;
    this.lastCamY = qy;

    const pad = quant + 48;
    this.position.set(-pad, -pad);
    this.g.position.set(-(cameraX - qx), -(cameraY - qy));

    const originX = qx - width / 2 - pad;
    const originY = qy - height / 2 - pad;
    const drawW = width + pad * 2;
    const drawH = height + pad * 2;

    const g = this.g;
    g.clear();
    g.rect(0, 0, drawW, drawH).fill({ color: COLORS.base });

    this.drawPatches(g, originX, originY, drawW, drawH);
    this.drawDirt(g, originX, originY, drawW, drawH);
    this.drawTufts(g, originX, originY, drawW, drawH);
    this.drawFlowers(g, originX, originY, drawW, drawH);
  }

  private worldToLocal(
    wx: number,
    wy: number,
    originX: number,
    originY: number,
  ): { x: number; y: number } {
    return { x: wx - originX, y: wy - originY };
  }

  private drawPatches(
    g: Graphics,
    originX: number,
    originY: number,
    drawW: number,
    drawH: number,
  ): void {
    const x0 = Math.floor(originX / PATCH_CELL) - 1;
    const y0 = Math.floor(originY / PATCH_CELL) - 1;
    const x1 = Math.ceil((originX + drawW) / PATCH_CELL) + 1;
    const y1 = Math.ceil((originY + drawH) / PATCH_CELL) + 1;

    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const rng = createRng(cellSeed(this.seed, cx, cy, 1));
        if (rng() > 0.62) continue;

        const wx = cx * PATCH_CELL + rng() * PATCH_CELL;
        const wy = cy * PATCH_CELL + rng() * PATCH_CELL;
        const { x, y } = this.worldToLocal(wx, wy, originX, originY);
        const rx = (50 + rng() * 80) * MAP_SCALE;
        const ry = (36 + rng() * 55) * MAP_SCALE;
        const roll = rng();
        const color =
          roll < 0.34
            ? COLORS.patchDark
            : roll < 0.7
              ? COLORS.baseSoft
              : COLORS.patchLight;

        g.ellipse(x, y, rx, ry).fill({ color, alpha: 0.35 });
        g.ellipse(x - rx * 0.35, y + ry * 0.1, rx * 0.55, ry * 0.7).fill({
          color,
          alpha: 0.22,
        });
        g.ellipse(x + rx * 0.3, y - ry * 0.08, rx * 0.5, ry * 0.65).fill({
          color,
          alpha: 0.2,
        });
      }
    }
  }

  private drawDirt(
    g: Graphics,
    originX: number,
    originY: number,
    drawW: number,
    drawH: number,
  ): void {
    const x0 = Math.floor(originX / DIRT_CELL) - 1;
    const y0 = Math.floor(originY / DIRT_CELL) - 1;
    const x1 = Math.ceil((originX + drawW) / DIRT_CELL) + 1;
    const y1 = Math.ceil((originY + drawH) / DIRT_CELL) + 1;

    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const rng = createRng(cellSeed(this.seed, cx, cy, 2));
        if (rng() > 0.28) continue;

        const wx = cx * DIRT_CELL + rng() * DIRT_CELL;
        const wy = cy * DIRT_CELL + rng() * DIRT_CELL;
        const { x, y } = this.worldToLocal(wx, wy, originX, originY);
        const r = (16 + rng() * 20) * MAP_SCALE;

        g.ellipse(x, y, r * 1.15, r * 0.75).fill({
          color: COLORS.dirtDark,
          alpha: 0.25,
        });
        g.ellipse(x, y, r, r * 0.62).fill({
          color: COLORS.dirt,
          alpha: 0.55,
        });
        g.ellipse(x - r * 0.15, y - r * 0.12, r * 0.35, r * 0.22).fill({
          color: COLORS.dirtHi,
          alpha: 0.35,
        });
      }
    }
  }

  private drawTufts(
    g: Graphics,
    originX: number,
    originY: number,
    drawW: number,
    drawH: number,
  ): void {
    const x0 = Math.floor(originX / TUFT_CELL) - 1;
    const y0 = Math.floor(originY / TUFT_CELL) - 1;
    const x1 = Math.ceil((originX + drawW) / TUFT_CELL) + 1;
    const y1 = Math.ceil((originY + drawH) / TUFT_CELL) + 1;

    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const rng = createRng(cellSeed(this.seed, cx, cy, 3));
        if (rng() > 0.42) continue;

        const jx = (rng() - 0.5) * TUFT_CELL * 0.55;
        const jy = (rng() - 0.5) * TUFT_CELL * 0.55;
        const wx = cx * TUFT_CELL + TUFT_CELL * 0.5 + jx;
        const wy = cy * TUFT_CELL + TUFT_CELL * 0.5 + jy;
        const { x, y } = this.worldToLocal(wx, wy, originX, originY);
        this.drawCartoonClump(g, x, y, rng);
      }
    }
  }

  private drawCartoonClump(
    g: Graphics,
    x: number,
    y: number,
    rng: () => number,
  ): void {
    const bladeCount = 2 + Math.floor(rng() * 3);
    const baseScale = (0.85 + rng() * 0.45) * MAP_SCALE;

    const order: number[] = [];
    for (let i = 0; i < bladeCount; i++) order.push(i);
    order.sort((a, b) => {
      const da = Math.abs(a - (bladeCount - 1) / 2);
      const db = Math.abs(b - (bladeCount - 1) / 2);
      return db - da;
    });

    for (const i of order) {
      const t = bladeCount === 1 ? 0.5 : i / (bladeCount - 1);
      const lean = -0.7 + t * 1.4 + (rng() - 0.5) * 0.2;
      const h = (16 + rng() * 14) * baseScale;
      const halfW = (4.5 + rng() * 2.5) * baseScale;
      const roll = rng();
      const color =
        roll < 0.3
          ? COLORS.blade
          : roll < 0.7
            ? COLORS.bladeMid
            : COLORS.bladeLight;

      this.drawLeaf(
        g,
        x + (t - 0.5) * 6 * MAP_SCALE,
        y,
        lean,
        h,
        halfW,
        color,
        rng() > 0.4,
      );
    }
  }

  private drawLeaf(
    g: Graphics,
    x: number,
    y: number,
    lean: number,
    h: number,
    halfW: number,
    color: number,
    withHighlight: boolean,
  ): void {
    const tipX = x + Math.sin(lean) * h;
    const tipY = y - Math.cos(lean) * h;
    const midX = x + Math.sin(lean) * h * 0.45;
    const midY = y - Math.cos(lean) * h * 0.45;
    const nx = Math.cos(lean);
    const ny = Math.sin(lean);

    const leftX = midX - nx * halfW;
    const leftY = midY - ny * halfW;
    const rightX = midX + nx * halfW;
    const rightY = midY + ny * halfW;

    g.moveTo(x, y);
    g.quadraticCurveTo(leftX, leftY, tipX, tipY);
    g.quadraticCurveTo(rightX, rightY, x, y);
    g.fill({ color });

    if (withHighlight) {
      const h2 = h * 0.62;
      const w2 = halfW * 0.38;
      const tip2X = x + Math.sin(lean) * h2 * 0.92 + nx * halfW * 0.15;
      const tip2Y = y - Math.cos(lean) * h2 * 0.92 + ny * halfW * 0.15;
      const mid2X = x + Math.sin(lean) * h2 * 0.4 + nx * halfW * 0.12;
      const mid2Y = y - Math.cos(lean) * h2 * 0.4 + ny * halfW * 0.12;
      const l2x = mid2X - nx * w2;
      const l2y = mid2Y - ny * w2;
      const r2x = mid2X + nx * w2 * 0.5;
      const r2y = mid2Y + ny * w2 * 0.5;
      const base2X = x + nx * halfW * 0.1;
      const base2Y = y - h * 0.08;

      g.moveTo(base2X, base2Y);
      g.quadraticCurveTo(l2x, l2y, tip2X, tip2Y);
      g.quadraticCurveTo(r2x, r2y, base2X, base2Y);
      g.fill({ color: COLORS.bladeHi, alpha: 0.55 });
    }
  }

  private drawFlowers(
    g: Graphics,
    originX: number,
    originY: number,
    drawW: number,
    drawH: number,
  ): void {
    const flowerColors = [
      COLORS.flowerPink,
      COLORS.flowerYellow,
      COLORS.flowerWhite,
      COLORS.flowerBlue,
    ];
    const x0 = Math.floor(originX / FLOWER_CELL) - 1;
    const y0 = Math.floor(originY / FLOWER_CELL) - 1;
    const x1 = Math.ceil((originX + drawW) / FLOWER_CELL) + 1;
    const y1 = Math.ceil((originY + drawH) / FLOWER_CELL) + 1;

    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const rng = createRng(cellSeed(this.seed, cx, cy, 4));
        if (rng() > 0.22) continue;

        const wx = cx * FLOWER_CELL + rng() * FLOWER_CELL;
        const wy = cy * FLOWER_CELL + rng() * FLOWER_CELL;
        const { x, y } = this.worldToLocal(wx, wy, originX, originY);
        const color = flowerColors[Math.floor(rng() * flowerColors.length)]!;
        const size = (3.2 + rng() * 2.8) * MAP_SCALE;

        const petals = 5;
        for (let p = 0; p < petals; p++) {
          const a = (p / petals) * Math.PI * 2 - Math.PI / 2;
          g.circle(
            x + Math.cos(a) * size * 0.85,
            y + Math.sin(a) * size * 0.85,
            size * 0.72,
          ).fill({ color });
        }
        g.circle(x, y, size * 0.55).fill({ color: COLORS.flowerCenter });
        g.circle(x - size * 0.12, y - size * 0.12, size * 0.18).fill({
          color: COLORS.flowerHi,
          alpha: 0.7,
        });
      }
    }
  }
}
