import { Container, Graphics } from 'pixi.js';

/** 与 WorldMap 松树视觉一致的尺寸（避免循环依赖，本地常量） */
const PINE_SCALE = 2.7;
const PINE_TRUNK_H = 3.2;

/**
 * 单棵松树本地包围（脚底 = 0,0），含描边与阴影余量。
 * 用于行 chunk 裁剪 pad / AABB。
 */
export const PINE_LOCAL_HALF_W = 15 * PINE_SCALE + 6;
/** 树冠顶点在脚底上方的大致高度 */
export const PINE_LOCAL_TOP = PINE_TRUNK_H * PINE_SCALE * 0.35 + 28 * PINE_SCALE + 4 * PINE_SCALE + 6;
/** 阴影落到脚底下方 */
export const PINE_LOCAL_SHADOW = 2 + 3.6 * PINE_SCALE + 4;

const COLORS = {
  canopyDeep: 0x1f5a1a,
  canopy: 0x2d7a28,
  canopyMid: 0x3d9634,
  canopyLight: 0x58b848,
  canopyHi: 0x7ed45f,
  trunkDark: 0x4a2e18,
  trunkHi: 0x8b5a32,
} as const;

/**
 * 单棵松树显示对象（调试 / 兼容；运行时森林走 TreeRowChunk）。
 * 原点 = 脚底（世界坐标）；zIndex = worldY 参与纵深排序。
 */
export class PineTree extends Container {
  readonly worldX: number;
  readonly worldY: number;

  constructor(worldX: number, worldY: number, shade: number) {
    super();
    this.label = 'PineTree';
    this.eventMode = 'none';
    this.worldX = worldX;
    this.worldY = worldY;
    this.position.set(worldX, worldY);
    this.zIndex = worldY;

    const g = new Graphics();
    g.label = 'PineGfx';
    drawPineLocal(g, shade);
    this.addChild(g);
  }
}

/**
 * 在 Graphics 上画一棵松树。
 * @param ox 脚底本地 X（默认 0）
 * @param oy 脚底本地 Y（默认 0；行 chunk 内通常为 0）
 */
export function drawPineLocal(
  g: Graphics,
  shade: number,
  ox = 0,
  oy = 0,
): void {
  const scale = PINE_SCALE;
  const trunkH = PINE_TRUNK_H * scale;
  const trunkW = 3.2 * scale;
  const x = ox;
  const y = oy;

  const deep =
    shade === 0 ? COLORS.canopyDeep : shade === 1 ? 0x1a5016 : 0x245c1f;
  const mid =
    shade === 0 ? COLORS.canopy : shade === 1 ? COLORS.canopyMid : 0x348a2c;
  const lite =
    shade === 0 ? COLORS.canopyLight : shade === 1 ? 0x4faa3e : COLORS.canopyHi;

  const outline = Math.max(1.8, 1.15 * scale);
  const strokeBlack = { width: outline, color: 0x000000, alpha: 1 };

  g.ellipse(x, y + 2, 11 * scale, 3.6 * scale).fill({
    color: 0x000000,
    alpha: 0.16,
  });

  g.rect(x - trunkW / 2, y - trunkH, trunkW, trunkH + 1)
    .fill({ color: COLORS.trunkDark })
    .stroke(strokeBlack);
  g.rect(x - trunkW / 2 + 0.6, y - trunkH, trunkW * 0.35, trunkH).fill({
    color: COLORS.trunkHi,
    alpha: 0.4,
  });

  const layers: Array<{
    baseY: number;
    halfW: number;
    height: number;
    color: number;
  }> = [
    {
      baseY: y - trunkH * 0.35,
      halfW: 15 * scale,
      height: 18 * scale,
      color: deep,
    },
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
    g.poly(
      [x, tipY, x - layer.halfW, layer.baseY, x + layer.halfW, layer.baseY],
      true,
    )
      .fill({ color: layer.color })
      .stroke(strokeBlack);
  }

  const tipBase = y - trunkH * 0.35 - 28 * scale;
  g.poly(
    [
      x,
      tipBase - 4 * scale,
      x - 3.6 * scale,
      tipBase + 8 * scale,
      x + 2.6 * scale,
      tipBase + 8 * scale,
    ],
    true,
  )
    .fill({ color: COLORS.canopyHi, alpha: 0.55 })
    .stroke({ width: outline * 0.85, color: 0x000000, alpha: 0.9 });
}
