import { Graphics } from 'pixi.js';
import { TREE_COLORS as COLORS } from './treeCommon';

/** 程序化松树视觉尺寸（与可砍树 / 编辑器共用） */
const PINE_SCALE = 2.7;
const PINE_TRUNK_H = 3.2;

/**
 * 在 Graphics 上画一棵松树。
 * @param ox 脚底本地 X（默认 0）
 * @param oy 脚底本地 Y（默认 0）
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

  // 1. 脚底椭圆阴影
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
