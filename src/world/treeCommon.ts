/**
 * 树木绘制公共数据与视觉配置（松树、苹果树共享数据层）
 */

export const TREE_COLORS = {
  canopyDeep: 0x1f5a1a,
  canopy: 0x2d7a28,
  canopyMid: 0x3d9634,
  canopyLight: 0x58b848,
  canopyHi: 0x7ed45f,
  trunkDark: 0x4a2e18,
  trunkHi: 0x8b5a32,
  appleRed: 0xef3333,
} as const;

/** 烘焙贴图共享缩放比例 */
export const TREE_BAKE_SCALE = 2.7;

/** 颜色值辅助函数：16 进制转 rgba 字符串 (供 Canvas 2D 使用) */
export function hexToRgbString(c: number, alpha = 1): string {
  const r = (c >> 16) & 0xff;
  const g = (c >> 8) & 0xff;
  const b = c & 0xff;
  if (alpha >= 1) return `rgb(${r},${g},${b})`;
  return `rgba(${r},${g},${b},${alpha})`;
}
