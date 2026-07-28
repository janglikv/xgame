import {
  TREE_BODY_PROFILE_ID,
  profileHurtR,
  profileSolidR,
} from './bodyProfiles';
import type { TreeSize } from './maps/types';

/**
 * 可砍树视觉 / 玩法档案。
 * 碰撞模板只有一份 `tree`（中树为 1×）；小/大树乘 bodyShapeScale。
 */
export type TreeSizeProfile = {
  /** 相对 drawPineLocal 的显示缩放 */
  scale: number;
  maxHp: number;
  woodDrop: number;
  /** 近战可砍距离（脚底→脚底） */
  interactR: number;
  hpBarY: number;
  hpBarW: number;
  ringR: number;
  tint: number;
};

/** 中树视觉 scale = 碰撞模板 1× 基准 */
export const TREE_MEDIUM_VISUAL_SCALE = 0.72;

function scaled(base: number, scale: number): number {
  return Math.max(1, Math.round((base * scale) / TREE_MEDIUM_VISUAL_SCALE));
}

function visualProfile(
  scale: number,
  extras: { maxHp: number; woodDrop: number; tint: number },
): TreeSizeProfile {
  return {
    scale,
    maxHp: extras.maxHp,
    woodDrop: extras.woodDrop,
    interactR: scaled(56, scale),
    hpBarY: -Math.round(108 * (scale / TREE_MEDIUM_VISUAL_SCALE)),
    hpBarW: scaled(36, scale),
    ringR: scaled(10, scale),
    tint: extras.tint,
  };
}

export const TREE_SIZE_PROFILE: Record<TreeSize, TreeSizeProfile> = {
  sapling: visualProfile(0.38, {
    maxHp: 18,
    woodDrop: 1,
    tint: 0x8aaa62,
  }),
  medium: visualProfile(TREE_MEDIUM_VISUAL_SCALE, {
    maxHp: 36,
    woodDrop: 2,
    tint: 0x6a8a5a,
  }),
  large: visualProfile(1.55, {
    maxHp: 90,
    woodDrop: 5,
    tint: 0x547848,
  }),
};

/** 体型相对中树的碰撞形状缩放 */
export function treeBodyShapeScale(size: TreeSize): number {
  return TREE_SIZE_PROFILE[size].scale / TREE_MEDIUM_VISUAL_SCALE;
}

/** solid 半径：模板主圆 × 体型缩放 */
export function treeSolidR(size: TreeSize): number {
  return Math.max(
    1,
    Math.round(profileSolidR(TREE_BODY_PROFILE_ID) * treeBodyShapeScale(size)),
  );
}

/** hurt 近似半径：模板 × 体型缩放 */
export function treeHurtR(size: TreeSize): number {
  return Math.max(
    1,
    Math.round(profileHurtR(TREE_BODY_PROFILE_ID) * treeBodyShapeScale(size)),
  );
}
