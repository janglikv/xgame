import { SpatialHashGrid } from '../utils/SpatialHashGrid';

/**
 * 草/树坐标网格索引：播种判距 / 最近大草查询 O(邻格)。
 * (已重构接入通用的 SpatialHashGrid 数据结构)
 */
export class GrassSpatialIndex<T extends { worldX: number; worldY: number }> extends SpatialHashGrid<T> {}
