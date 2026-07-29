/**
 * 泥地轮动与林→泥参数。
 * 极简生态：泥地 → 稀草 → 草地 → 密树 → 泥地
 *
 * 调参时优先改这里，避免散落在 HarvestWorld 各处。
 */

/** 局部统计半径（草密/树密判定） */
export const ECO_R = 160;

/** 泥地上草数量上限（稀） */
export const MUD_GRASS_CAP = 6;
/** 泥地草间距 */
export const MUD_GRASS_SPACING = 62;
/** 泥地内稀草达到此数后快速改土 */
export const MUD_CLEAR_GRASS = 3;
/** 泥地改土速度：有草（点/秒，满 100，相比原本减慢 100 倍）；无草（删除自然恢复，为 0） */
export const MUD_FERTILITY_WITH_GRASS = 0.1;
export const MUD_FERTILITY_BARE = 0;

/** 局部草数 ≥ 此值才可发芽成树（需成片草地） */
export const MEADOW_GRASS_FOR_TREE = 10;
/** 局部树数 ≥ 此值才塌泥（够「大片林」后再轮动） */
export const FOREST_TREE_COLLAPSE = 16;

/** 单次塌缩基础泥斑半径 */
export const COLLAPSE_MUD_RADIUS = 110;
/** 两泥斑中心距 ≤ r1+r2+此值 → 合并成一片 */
export const MUD_MERGE_GAP = 55;
/** 单片泥地半径上限（再大就盖满岛） */
export const MUD_RADIUS_MAX = 260;
/** 单片泥地半径下限 */
export const MUD_RADIUS_MIN = 90;
/** 塌缩点距已有泥斑 ≤ 此值时，优先并入该泥斑而非另开新斑 */
export const MUD_ATTRACT_R = 220;

/** 泥地内树死亡率倍率（地力废了，逼林缘外迁） */
export const MUD_TREE_DEATH_MULT = 4.5;
/** 泥地内树生长/播种减速 */
export const MUD_TREE_GROW_MULT = 0.25;

/**
 * 抱团成林：
 * - 全岛有活树时，新苗只落主林林缘
 * - 仅 0 树时允许茂密草地冒 1 个种核
 */
export const FOREST_EDGE_DIST_MIN = 44;
export const FOREST_EDGE_DIST_MAX = 86;
/** 落点必须落在某棵活树此半径内（同簇） */
export const FOREST_CLUSTER_JOIN_R = 100;
/** 选主林时统计邻居的半径 */
export const FOREST_MAIN_NEIGHBOR_R = 140;
