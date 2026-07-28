import { Graphics } from 'pixi.js';

const GRASS_SCALE = 2.2;

const COLORS = {
  deep: 0x225c1e,
  mid: 0x3d942e,
  lite: 0x62bf47,
  hi: 0xa2f07d,
} as const;

/**
 * 在 Graphics 上绘制一丛精致的草地（程序化矢量风格）。
 * @param g Graphics 实例
 * @param shade 阴影色调 (0: 默认, 1: 亮色, 2: 偏暗)
 * @param ox 脚底 X
 * @param oy 脚底 Y
 */
export function drawGrassLocal(
  g: Graphics,
  shade = 0,
  ox = 0,
  oy = 0,
): void {
  const scale = GRASS_SCALE;
  const x = ox;
  const y = oy;

  const deepColor =
    shade === 0 ? COLORS.deep : shade === 1 ? 0x2a6b25 : 0x1a4a17;
  const midColor =
    shade === 0 ? COLORS.mid : shade === 1 ? 0x48aa38 : 0x307b23;
  const liteColor =
    shade === 0 ? COLORS.lite : shade === 1 ? 0x76d859 : 0x51a33a;
  const hiColor =
    shade === 0 ? COLORS.hi : shade === 1 ? 0xb5f299 : 0x7ecc5e;

  const outline = Math.max(1.2, 0.9 * scale);
  const strokeBlack = { width: outline, color: 0x000000, alpha: 0.9 };

  // 脚底透光微阴影
  g.ellipse(x, y + 1, 9 * scale, 3 * scale).fill({
    color: 0x000000,
    alpha: 0.18,
  });

  // 后层草叶（深色）
  const backBlades = [
    { tip: [x - 10 * scale, y - 14 * scale], right: x - 2 * scale },
    { tip: [x + 11 * scale, y - 13 * scale], right: x + 9 * scale },
    { tip: [x - 3 * scale, y - 18 * scale], right: x + 3 * scale },
  ];

  for (const b of backBlades) {
    g.poly([x - 4 * scale, y, b.tip[0], b.tip[1], b.right, y], true)
      .fill({ color: deepColor })
      .stroke(strokeBlack);
  }

  // 中层草叶（主绿）
  const midBlades = [
    { tipX: x - 13 * scale, tipY: y - 10 * scale, rightX: x - 3 * scale },
    { tipX: x - 6 * scale, tipY: y - 20 * scale, rightX: x + 1 * scale },
    { tipX: x + 5 * scale, tipY: y - 21 * scale, rightX: x + 7 * scale },
    { tipX: x + 12 * scale, tipY: y - 11 * scale, rightX: x + 13 * scale },
  ];

  for (const mb of midBlades) {
    g.poly([mb.rightX - 6 * scale, y, mb.tipX, mb.tipY, mb.rightX, y], true)
      .fill({ color: midColor })
      .stroke(strokeBlack);
  }

  // 前层草叶（亮绿与高光）
  const frontBlades = [
    { tipX: x - 8 * scale, tipY: y - 13 * scale, color: liteColor },
    { tipX: x + 1 * scale, tipY: y - 17 * scale, color: hiColor },
    { tipX: x + 7 * scale, tipY: y - 14 * scale, color: liteColor },
  ];

  for (const fb of frontBlades) {
    g.poly([x - 2 * scale, y, fb.tipX, fb.tipY, x + 3 * scale, y], true)
      .fill({ color: fb.color })
      .stroke(strokeBlack);
  }

  // 高光尖端微笔触
  g.poly(
    [
      x + 1 * scale,
      y - 17 * scale,
      x - 1 * scale,
      y - 10 * scale,
      x + 2 * scale,
      y - 10 * scale,
    ],
    true,
  ).fill({ color: hiColor, alpha: 0.65 });
}
