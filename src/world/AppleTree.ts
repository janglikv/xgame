import { Graphics } from 'pixi.js';
import { TREE_COLORS as COLORS } from './treeCommon';

/** 程序化苹果树视觉尺寸（与松树保持同一画风规范） */
const APPLE_TREE_SCALE = 2.7;
const TRUNK_H = 3.4;

export type AppleDot = {
  ox: number;
  oy: number;
};

/** 苹果在树冠上的美观挂布预设坐标 */
export const APPLE_POSITIONS: ReadonlyArray<AppleDot> = [
  { ox: -14 * 0.9, oy: -28 * 2.65 },
  { ox: 13 * 0.9, oy: -30 * 2.65 },
  { ox: -5 * 0.9, oy: -36 * 2.65 },
  { ox: 8 * 0.9, oy: -22 * 2.65 },
  { ox: -1 * 0.9, oy: -32 * 2.65 },
];

/**
 * 按松树画风重构的程序化苹果树绘制：
 * 1. 采用松树同款黑框硬描边 (strokeBlack)。
 * 2. 采用分层多边形 + 宝塔层叠结构的阔叶树冠。
 * 3. 直立带有侧面高光硬朗树干与脚底椭圆阴影。
 *
 * @param g Graphics 实例
 * @param shade 色调 (0: 默认, 1: 亮色, 2: 偏暗)
 * @param appleCount 树上挂着的红苹果数量
 * @param ox 脚底 X
 * @param oy 脚底 Y
 */
export function drawAppleTreeLocal(
  g: Graphics,
  shade = 0,
  appleCount = 0,
  ox = 0,
  oy = 0,
): void {
  const scale = APPLE_TREE_SCALE;
  const trunkH = TRUNK_H * scale;
  const trunkW = 3.6 * scale;
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

  // 1. 脚底椭圆阴影（与松树一致）
  g.ellipse(x, y + 2, 12 * scale, 3.8 * scale).fill({
    color: 0x000000,
    alpha: 0.16,
  });

  // 2. 直立硬朗树干（与松树同款风格：梯形底座 + 黑色硬边 + 左侧高光条）
  g.poly(
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
    true,
  )
    .fill({ color: COLORS.trunkDark })
    .stroke(strokeBlack);

  g.poly(
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
    true,
  ).fill({ color: COLORS.trunkHi, alpha: 0.4 });

  // 3. 分层宝塔式阔叶树冠（松树层叠多边形画风，3 层云阔叶）
  const layers: Array<{
    baseY: number;
    halfW: number;
    height: number;
    color: number;
    crownPoly: number[];
  }> = [
    // 底层（深绿阔冠）：带齿角多边形层叠
    {
      baseY: y - trunkH * 0.35,
      halfW: 16 * scale,
      height: 14 * scale,
      color: deep,
      crownPoly: [
        x, y - trunkH * 0.35 - 14 * scale,
        x - 9 * scale, y - trunkH * 0.35 - 12 * scale,
        x - 16 * scale, y - trunkH * 0.35 - 4 * scale,
        x - 12 * scale, y - trunkH * 0.35,
        x + 12 * scale, y - trunkH * 0.35,
        x + 16 * scale, y - trunkH * 0.35 - 4 * scale,
        x + 9 * scale, y - trunkH * 0.35 - 12 * scale,
      ],
    },
    // 中层（主绿树冠）
    {
      baseY: y - trunkH * 0.35 - 7 * scale,
      halfW: 13.5 * scale,
      height: 13 * scale,
      color: mid,
      crownPoly: [
        x, y - trunkH * 0.35 - 20 * scale,
        x - 7.5 * scale, y - trunkH * 0.35 - 18 * scale,
        x - 13.5 * scale, y - trunkH * 0.35 - 11 * scale,
        x - 10 * scale, y - trunkH * 0.35 - 7 * scale,
        x + 10 * scale, y - trunkH * 0.35 - 7 * scale,
        x + 13.5 * scale, y - trunkH * 0.35 - 11 * scale,
        x + 7.5 * scale, y - trunkH * 0.35 - 18 * scale,
      ],
    },
    // 顶层（亮绿树冠）
    {
      baseY: y - trunkH * 0.35 - 15 * scale,
      halfW: 10.5 * scale,
      height: 12 * scale,
      color: lite,
      crownPoly: [
        x, y - trunkH * 0.35 - 27 * scale,
        x - 6 * scale, y - trunkH * 0.35 - 24 * scale,
        x - 10.5 * scale, y - trunkH * 0.35 - 18 * scale,
        x - 7.5 * scale, y - trunkH * 0.35 - 15 * scale,
        x + 7.5 * scale, y - trunkH * 0.35 - 15 * scale,
        x + 10.5 * scale, y - trunkH * 0.35 - 18 * scale,
        x + 6 * scale, y - trunkH * 0.35 - 24 * scale,
      ],
    },
  ];

  for (const layer of layers) {
    g.poly(layer.crownPoly, true)
      .fill({ color: layer.color })
      .stroke(strokeBlack);
  }

  // 4. 树冠最顶部亮点帽（松树同款顶部亮冠）
  const tipBase = y - trunkH * 0.35 - 24 * scale;
  g.poly(
    [
      x,
      tipBase - 5 * scale,
      x - 4.5 * scale,
      tipBase + 3 * scale,
      x + 4.5 * scale,
      tipBase + 3 * scale,
    ],
    true,
  )
    .fill({ color: COLORS.canopyHi, alpha: 0.6 })
    .stroke({ width: outline * 0.85, color: 0x000000, alpha: 0.9 });

  // 5. 鲜红大苹果悬挂（带松树风格的硬线边框框线）
  const count = Math.min(APPLE_POSITIONS.length, Math.max(0, appleCount));
  for (let i = 0; i < count; i++) {
    const pos = APPLE_POSITIONS[i]!;
    const fx = x + pos.ox;
    const fy = y + pos.oy;
    const fr = 5.0 * (scale / 2.7);

    // 苹果主体（带硬线描边）
    g.circle(fx, fy, fr)
      .fill({ color: 0xef3333 })
      .stroke({ width: 1.2, color: 0x000000, alpha: 0.95 });

    // 苹果亮斑
    g.circle(fx - fr * 0.3, fy - fr * 0.3, fr * 0.36).fill({
      color: 0xffffff,
      alpha: 0.65,
    });

    // 黑色果柄线
    g.moveTo(fx, fy - fr).lineTo(fx + 1, fy - fr - 2.5).stroke({
      width: 1.2,
      color: 0x000000,
    });

    // 果叶（硬边小多边形）
    g.poly(
      [fx + 1, fy - fr - 2.5, fx + 3.5, fy - fr - 3.5, fx + 2.5, fy - fr - 1],
      true,
    )
      .fill({ color: 0x7ed45f })
      .stroke({ width: 0.8, color: 0x000000, alpha: 0.8 });
  }
}
