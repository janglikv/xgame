import type { CellRect, LevelMapDef } from './types';

/** 种树时相对可走边的额外净空（世界像素，小于一格时主要靠边距） */
export const TREE_CLEAR_MARGIN = 8;

export type WalkGrid = {
  cols: number;
  rows: number;
  cellSize: number;
  mapSize: number;
  /** 1 = 可走 */
  mask: Uint8Array;
};

export function mapHalf(def: LevelMapDef): number {
  return def.mapSize / 2;
}

export function gridDims(mapSize: number, cellSize: number): {
  cols: number;
  rows: number;
} {
  const n = Math.floor(mapSize / cellSize);
  return { cols: n, rows: n };
}

export function cellKey(c: number, r: number, cols: number): number {
  return r * cols + c;
}

/** 世界坐标 → 格子（可越界，调用方 clamp） */
export function worldToCell(
  x: number,
  y: number,
  mapSize: number,
  cellSize: number,
): { c: number; r: number } {
  const half = mapSize / 2;
  return {
    c: Math.floor((x + half) / cellSize),
    r: Math.floor((y + half) / cellSize),
  };
}

/** 格子左上角世界坐标 */
export function cellOrigin(
  c: number,
  r: number,
  mapSize: number,
  cellSize: number,
): { x: number; y: number } {
  const half = mapSize / 2;
  return {
    x: -half + c * cellSize,
    y: -half + r * cellSize,
  };
}

/** 格子中心世界坐标 */
export function cellCenter(
  c: number,
  r: number,
  mapSize: number,
  cellSize: number,
): { x: number; y: number } {
  const o = cellOrigin(c, r, mapSize, cellSize);
  return { x: o.x + cellSize / 2, y: o.y + cellSize / 2 };
}

/** 格子矩形 → 世界 AABB（左上 + 宽高） */
export function cellRectToWorld(
  rect: CellRect,
  mapSize: number,
  cellSize: number,
): { x: number; y: number; w: number; h: number } {
  const o = cellOrigin(rect.c, rect.r, mapSize, cellSize);
  return {
    x: o.x,
    y: o.y,
    w: rect.w * cellSize,
    h: rect.h * cellSize,
  };
}

export function buildWalkGrid(def: LevelMapDef): WalkGrid {
  const { cols, rows } = gridDims(def.mapSize, def.cellSize);
  const mask = new Uint8Array(cols * rows);
  for (const rect of def.walk) {
    const c0 = Math.max(0, rect.c);
    const r0 = Math.max(0, rect.r);
    const c1 = Math.min(cols, rect.c + rect.w);
    const r1 = Math.min(rows, rect.r + rect.h);
    for (let r = r0; r < r1; r++) {
      for (let c = c0; c < c1; c++) {
        mask[cellKey(c, r, cols)] = 1;
      }
    }
  }
  return {
    cols,
    rows,
    cellSize: def.cellSize,
    mapSize: def.mapSize,
    mask,
  };
}

let cached: { def: LevelMapDef; grid: WalkGrid } | null = null;

export function invalidateWalkCache(): void {
  cached = null;
}

export function getWalkGrid(def: LevelMapDef): WalkGrid {
  if (cached?.def === def) return cached.grid;
  const grid = buildWalkGrid(def);
  cached = { def, grid };
  return grid;
}

function inMask(grid: WalkGrid, c: number, r: number): boolean {
  if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) return false;
  return grid.mask[cellKey(c, r, grid.cols)] === 1;
}

/**
 * 点是否可走。
 * margin > 0：向外扩（种树净空）；margin < 0：向内缩（身体半径）。
 */
export function isWalkable(
  x: number,
  y: number,
  def: LevelMapDef,
  margin = 0,
): boolean {
  const grid = getWalkGrid(def);
  if (margin === 0) {
    const { c, r } = worldToCell(x, y, def.mapSize, def.cellSize);
    return inMask(grid, c, r);
  }

  // 采样圆/盒：用 margin 推开的四角 + 中心
  const samples =
    margin > 0
      ? [
          [0, 0],
          [margin, 0],
          [-margin, 0],
          [0, margin],
          [0, -margin],
        ]
      : [
          [0, 0],
          [margin, 0],
          [-margin, 0],
          [0, margin],
          [0, -margin],
        ];

  if (margin > 0) {
    // 扩：任一点在可走格内 → 视为可走（种树时 !isWalkable 才种）
    for (const [dx, dy] of samples) {
      const { c, r } = worldToCell(x + dx, y + dy, def.mapSize, def.cellSize);
      if (inMask(grid, c, r)) return true;
    }
    return false;
  }

  // 缩：全部采样点都在可走格内
  for (const [dx, dy] of samples) {
    const { c, r } = worldToCell(x + dx, y + dy, def.mapSize, def.cellSize);
    if (!inMask(grid, c, r)) return false;
  }
  return true;
}

export function shouldPlantTree(
  x: number,
  y: number,
  def: LevelMapDef,
  clearMargin = TREE_CLEAR_MARGIN,
): boolean {
  return !isWalkable(x, y, def, clearMargin);
}

/** 格子集合 → 合并为尽量少的 CellRect（行游程 + 纵向合并） */
export function mergeCellsToRects(
  cells: Iterable<number>,
  cols: number,
  rows: number,
): CellRect[] {
  const set = new Set(cells);
  if (set.size === 0) return [];

  // 每行：水平 runs [c0, c1)
  const rowRuns: Array<Array<{ c: number; w: number }>> = [];
  for (let r = 0; r < rows; r++) {
    const runs: Array<{ c: number; w: number }> = [];
    let c = 0;
    while (c < cols) {
      if (!set.has(cellKey(c, r, cols))) {
        c++;
        continue;
      }
      const c0 = c;
      while (c < cols && set.has(cellKey(c, r, cols))) c++;
      runs.push({ c: c0, w: c - c0 });
    }
    rowRuns.push(runs);
  }

  const used: boolean[][] = rowRuns.map((runs) => runs.map(() => false));
  const out: CellRect[] = [];

  for (let r = 0; r < rows; r++) {
    const runs = rowRuns[r]!;
    for (let i = 0; i < runs.length; i++) {
      if (used[r]![i]) continue;
      const { c, w } = runs[i]!;
      used[r]![i] = true;
      let h = 1;
      // 向下合并相同 run
      for (let rr = r + 1; rr < rows; rr++) {
        const idx = rowRuns[rr]!.findIndex(
          (run, j) => !used[rr]![j] && run.c === c && run.w === w,
        );
        if (idx < 0) break;
        used[rr]![idx] = true;
        h++;
      }
      out.push({ c, r, w, h });
    }
  }
  return out;
}

/** 世界矩形光栅化进格子集合（重叠即纳入） */
export function rasterizeWorldRect(
  x: number,
  y: number,
  w: number,
  h: number,
  mapSize: number,
  cellSize: number,
  into: Set<number>,
): void {
  const { cols, rows } = gridDims(mapSize, cellSize);
  const half = mapSize / 2;
  const c0 = Math.max(0, Math.floor((x + half) / cellSize));
  const r0 = Math.max(0, Math.floor((y + half) / cellSize));
  const c1 = Math.min(cols, Math.ceil((x + w + half) / cellSize));
  const r1 = Math.min(rows, Math.ceil((y + h + half) / cellSize));
  for (let r = r0; r < r1; r++) {
    for (let c = c0; c < c1; c++) {
      into.add(cellKey(c, r, cols));
    }
  }
}

export function cellsFromWalk(def: LevelMapDef): Set<number> {
  const { cols } = gridDims(def.mapSize, def.cellSize);
  const set = new Set<number>();
  for (const rect of def.walk) {
    for (let r = rect.r; r < rect.r + rect.h; r++) {
      for (let c = rect.c; c < rect.c + rect.w; c++) {
        set.add(cellKey(c, r, cols));
      }
    }
  }
  return set;
}

export function countWalkCells(def: LevelMapDef): number {
  return cellsFromWalk(def).size;
}

export function isSpawnValid(def: LevelMapDef): boolean {
  if (def.walk.length === 0) return false;
  return isWalkable(def.spawn.x, def.spawn.y, def, 0);
}

export function cloneLevelDef(def: LevelMapDef): LevelMapDef {
  return {
    id: def.id,
    mapSize: def.mapSize,
    cellSize: def.cellSize,
    spawn: { x: def.spawn.x, y: def.spawn.y },
    walk: def.walk.map((r) => ({ ...r })),
    // 保留 undefined（旧关卡默认刷怪）与 []（明确无敌人）的区别
    enemies:
      def.enemies === undefined
        ? undefined
        : def.enemies.map((e) => ({ ...e })),
  };
}

/** 从格子集合生成完整 def.walk */
export function defFromCells(
  base: Pick<LevelMapDef, 'id' | 'mapSize' | 'cellSize' | 'spawn'> &
    Partial<Pick<LevelMapDef, 'enemies'>>,
  cells: Set<number>,
): LevelMapDef {
  const { cols, rows } = gridDims(base.mapSize, base.cellSize);
  return {
    id: base.id,
    mapSize: base.mapSize,
    cellSize: base.cellSize,
    spawn: { ...base.spawn },
    walk: mergeCellsToRects(cells, cols, rows),
    enemies: (base.enemies ?? []).map((e) => ({ ...e })),
  };
}
