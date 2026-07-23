import { Container, Graphics } from 'pixi.js';
import {
  drawPineLocal,
  PINE_LOCAL_HALF_W,
  PINE_LOCAL_SHADOW,
  PINE_LOCAL_TOP,
} from './PineTree';

/**
 * 水平分块宽度（树格数）。
 * 同一行拆成多段，便于视口水平裁剪；过大则单段几何偏重，过小则 sort 节点变多。
 * 32 格 ≈ 1152px。
 */
export const TREE_CHUNK_CELLS = 32;

export type TreePlant = {
  /** 世界 X（脚底） */
  x: number;
  shade: number;
};

/**
 * 同一 worldY 行内的一段松树，合成一个 DisplayObject 参与 Y-sort。
 *
 * - position = (0, worldY)，本地 X = 世界 X，本地脚底 Y = 0
 * - zIndex = worldY（与角色脚底同一语义）
 * - 使用合并 Graphics（非逐棵 Container）；不做全图 cacheAsTexture，避免数万级 VRAM
 */
export class TreeRowChunk extends Container {
  readonly worldY: number;
  /** 世界空间 AABB（含树冠 / 阴影，供视口裁剪） */
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly treeCount: number;

  constructor(worldY: number, plants: readonly TreePlant[]) {
    super();
    this.label = 'TreeRowChunk';
    this.eventMode = 'none';
    this.worldY = worldY;
    this.treeCount = plants.length;
    this.position.set(0, worldY);
    this.zIndex = worldY;

    let minFootX = Infinity;
    let maxFootX = -Infinity;

    const g = new Graphics();
    g.label = 'TreeChunkGfx';
    for (const p of plants) {
      drawPineLocal(g, p.shade, p.x, 0);
      if (p.x < minFootX) minFootX = p.x;
      if (p.x > maxFootX) maxFootX = p.x;
    }
    this.addChild(g);

    this.minX = minFootX - PINE_LOCAL_HALF_W;
    this.maxX = maxFootX + PINE_LOCAL_HALF_W;
    this.minY = worldY - PINE_LOCAL_TOP;
    this.maxY = worldY + PINE_LOCAL_SHADOW;
  }
}
