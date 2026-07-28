import type { TreeSize } from './maps/types';

/**
 * 可砍树体型档案（视觉 + 碰撞统一入口）。
 * solid / hurt 按相对中树的 scale 比例推导，避免只改外观忘改碰撞。
 */
const MEDIUM_SCALE = 0.72;
const MEDIUM_SOLID_R = 14;
const MEDIUM_HURT_R = 22;
const MEDIUM_INTERACT_R = 56;

function scaled(base: number, scale: number): number {
  return Math.max(1, Math.round((base * scale) / MEDIUM_SCALE));
}

export type TreeSizeProfile = {
  /** 相对 drawPineLocal 的显示缩放 */
  scale: number;
  maxHp: number;
  woodDrop: number;
  /** 走路 / 投射物 solid 半径（脚底） */
  solidR: number;
  /** 受击 / 武器命中半径 */
  hurtR: number;
  /** 近战可砍距离（脚底→脚底） */
  interactR: number;
  hpBarY: number;
  hpBarW: number;
  ringR: number;
  tint: number;
};

function profile(
  scale: number,
  extras: {
    maxHp: number;
    woodDrop: number;
    tint: number;
  },
): TreeSizeProfile {
  return {
    scale,
    maxHp: extras.maxHp,
    woodDrop: extras.woodDrop,
    solidR: scaled(MEDIUM_SOLID_R, scale),
    hurtR: scaled(MEDIUM_HURT_R, scale),
    interactR: scaled(MEDIUM_INTERACT_R, scale),
    hpBarY: -Math.round(108 * (scale / MEDIUM_SCALE)),
    hpBarW: scaled(36, scale),
    ringR: scaled(10, scale),
    tint: extras.tint,
  };
}

export const TREE_SIZE_PROFILE: Record<TreeSize, TreeSizeProfile> = {
  sapling: profile(0.38, {
    maxHp: 18,
    woodDrop: 1,
    tint: 0x8aaa62,
  }),
  medium: profile(MEDIUM_SCALE, {
    maxHp: 36,
    woodDrop: 2,
    tint: 0x6a8a5a,
  }),
  large: profile(1.55, {
    maxHp: 90,
    woodDrop: 5,
    tint: 0x547848,
  }),
};

export function treeSolidR(size: TreeSize): number {
  return TREE_SIZE_PROFILE[size].solidR;
}
