import { Graphics } from 'pixi.js';

const APPLE_TREE_SCALE = 2.65;
const TRUNK_H = 3.6;

const COLORS = {
  canopyBack: 0x164619,
  canopyDeep: 0x226926,
  canopyMid: 0x358e3a,
  canopyLight: 0x4fc055,
  canopyHi: 0x86e68d,
  trunkDark: 0x482916,
  trunkMid: 0x6e3f22,
  trunkHi: 0x985933,
} as const;

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
 * 高颜值程序化苹果树绘制。
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
  const trunkW = 3.8 * scale;
  const x = ox;
  const y = oy;

  const backColor =
    shade === 0 ? COLORS.canopyBack : shade === 1 ? 0x1d5821 : 0x123814;
  const deepColor =
    shade === 0 ? COLORS.canopyDeep : shade === 1 ? 0x2b782f : 0x19521d;
  const midColor =
    shade === 0 ? COLORS.canopyMid : shade === 1 ? 0x3ea244 : 0x27702c;
  const liteColor =
    shade === 0 ? COLORS.canopyLight : shade === 1 ? 0x5bce62 : 0x3da045;

  const outline = Math.max(1.8, 1.15 * scale);
  const strokeBlack = { width: outline, color: 0x000000, alpha: 1 };

  // 脚底阴影
  g.ellipse(x, y + 2, 13 * scale, 4.2 * scale).fill({
    color: 0x000000,
    alpha: 0.2,
  });

  // 主树干（底部带轻微展开根基）
  g.poly(
    [
      x - trunkW * 0.75,
      y,
      x - trunkW * 0.5,
      y - trunkH,
      x + trunkW * 0.5,
      y - trunkH,
      x + trunkW * 0.75,
      y,
    ],
    true,
  )
    .fill({ color: COLORS.trunkDark })
    .stroke(strokeBlack);

  // 树干高光侧面
  g.poly(
    [
      x - trunkW * 0.45,
      y - trunkH,
      x - trunkW * 0.1,
      y - trunkH,
      x - trunkW * 0.2,
      y,
      x - trunkW * 0.65,
      y,
    ],
    true,
  ).fill({ color: COLORS.trunkHi, alpha: 0.5 });

  // 树枝主分叉
  g.poly(
    [
      x - trunkW * 0.4,
      y - trunkH + 2,
      x - 7 * scale,
      y - trunkH - 6 * scale,
      x - 4 * scale,
      y - trunkH - 6 * scale,
      x,
      y - trunkH + 2,
    ],
    true,
  )
    .fill({ color: COLORS.trunkMid })
    .stroke(strokeBlack);

  g.poly(
    [
      x,
      y - trunkH + 2,
      x + 4 * scale,
      y - trunkH - 7 * scale,
      x + 7 * scale,
      y - trunkH - 7 * scale,
      x + trunkW * 0.4,
      y - trunkH + 2,
    ],
    true,
  )
    .fill({ color: COLORS.trunkMid })
    .stroke(strokeBlack);

  // 丰满多层次圆冠（前中后景）
  const canopyY = y - trunkH * 0.65;
  const clusters = [
    // 后景（深绿底座）
    { cx: x - 11 * scale, cy: canopyY - 4 * scale, r: 13.5 * scale, color: backColor },
    { cx: x + 11 * scale, cy: canopyY - 5 * scale, r: 13 * scale, color: backColor },
    // 中景
    { cx: x - 12 * scale, cy: canopyY - 12 * scale, r: 12 * scale, color: deepColor },
    { cx: x + 12 * scale, cy: canopyY - 13 * scale, r: 11.5 * scale, color: deepColor },
    { cx: x - 6 * scale, cy: canopyY - 19 * scale, r: 11.5 * scale, color: midColor },
    { cx: x + 6 * scale, cy: canopyY - 20 * scale, r: 11 * scale, color: midColor },
    // 前景顶部
    { cx: x, cy: canopyY - 26 * scale, r: 10.5 * scale, color: liteColor },
    { cx: x - 3 * scale, cy: canopyY - 14 * scale, r: 10 * scale, color: liteColor },
  ];

  for (const c of clusters) {
    g.circle(c.cx, c.cy, c.r)
      .fill({ color: c.color })
      .stroke(strokeBlack);
  }

  // 树冠顶部娇嫩高光斑
  g.circle(x - 3 * scale, canopyY - 29 * scale, 4.5 * scale).fill({
    color: COLORS.canopyHi,
    alpha: 0.55,
  });
  g.circle(x + 5 * scale, canopyY - 22 * scale, 3.5 * scale).fill({
    color: COLORS.canopyHi,
    alpha: 0.45,
  });

  // 鲜红大苹果绘制（按数量画前 count 个）
  const count = Math.min(APPLE_POSITIONS.length, Math.max(0, appleCount));
  for (let i = 0; i < count; i++) {
    const pos = APPLE_POSITIONS[i]!;
    const fx = x + pos.ox;
    const fy = y + pos.oy;
    const fr = 5.2 * (scale / 2.65);

    // 鲜红饱满果实
    g.circle(fx, fy, fr).fill({ color: 0xef3333 }).stroke({
      width: 1.2,
      color: 0x440808,
      alpha: 0.9,
    });
    // 苹果高光点
    g.circle(fx - fr * 0.3, fy - fr * 0.3, fr * 0.38).fill({
      color: 0xffffff,
      alpha: 0.55,
    });
    // 果柄
    g.moveTo(fx, fy - fr).lineTo(fx + 1, fy - fr - 2.5).stroke({
      width: 1.2,
      color: 0x331c0c,
    });
    // 小树叶
    g.poly([fx + 1, fy - fr - 2.5, fx + 3.5, fy - fr - 3.5, fx + 2.5, fy - fr - 1], true).fill({
      color: 0x58cc2a,
    });
  }
}
