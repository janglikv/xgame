/**
 * 通用二维网格哈希数据结构（Spatial Hash Grid）：
 * 用于快速 O(1) 空间查询、邻居检定与范围检索。
 */
export class SpatialHashGrid<T extends { worldX: number; worldY: number }> {
  private readonly cellSize: number;
  private readonly invCell: number;
  private readonly cells = new Map<string, T[]>();

  constructor(cellSize = 64) {
    this.cellSize = Math.max(16, cellSize);
    this.invCell = 1 / this.cellSize;
  }

  clear(): void {
    this.cells.clear();
  }

  private key(cx: number, cy: number): string {
    return `${cx},${cy}`;
  }

  private cellOf(x: number, y: number): { cx: number; cy: number } {
    return {
      cx: Math.floor(x * this.invCell),
      cy: Math.floor(y * this.invCell),
    };
  }

  insert(item: T): void {
    const { cx, cy } = this.cellOf(item.worldX, item.worldY);
    const k = this.key(cx, cy);
    let bucket = this.cells.get(k);
    if (!bucket) {
      bucket = [];
      this.cells.set(k, bucket);
    }
    bucket.push(item);
  }

  remove(item: T): void {
    const { cx, cy } = this.cellOf(item.worldX, item.worldY);
    const bucket = this.cells.get(this.key(cx, cy));
    if (!bucket) return;
    const i = bucket.indexOf(item);
    if (i >= 0) bucket.splice(i, 1);
    if (bucket.length === 0) this.cells.delete(this.key(cx, cy));
  }

  rebuild(items: ReadonlyArray<T>): void {
    this.clear();
    for (const it of items) this.insert(it);
  }

  /**
   * 半径内是否存在任意邻居
   */
  anyWithin(
    x: number,
    y: number,
    radius: number,
    ignore?: T | null,
  ): boolean {
    const r2 = radius * radius;
    const { cx, cy } = this.cellOf(x, y);
    const reach = Math.ceil(radius * this.invCell);
    for (let iy = cy - reach; iy <= cy + reach; iy++) {
      for (let ix = cx - reach; ix <= cx + reach; ix++) {
        const bucket = this.cells.get(this.key(ix, iy));
        if (!bucket) continue;
        for (const g of bucket) {
          if (ignore && g === ignore) continue;
          const dx = g.worldX - x;
          const dy = g.worldY - y;
          if (dx * dx + dy * dy < r2) return true;
        }
      }
    }
    return false;
  }

  /**
   * 统计半径内满足条件的对象数量
   */
  countWithin(
    x: number,
    y: number,
    radius: number,
    filter?: (item: T) => boolean,
    ignore?: T | null,
  ): number {
    let count = 0;
    this.forEachWithin(
      x,
      y,
      radius,
      (item) => {
        if (!filter || filter(item)) {
          count++;
        }
      },
      ignore,
    );
    return count;
  }

  /**
   * 查找最近对象
   */
  findNearest(
    x: number,
    y: number,
    filter?: (item: T) => boolean,
    searchRadius = 2500,
  ): { item: T; dist: number } | null {
    let bestDist2 = searchRadius * searchRadius;
    let bestItem: T | null = null;
    this.forEachWithin(
      x,
      y,
      searchRadius,
      (item, dist2) => {
        if (filter && !filter(item)) return;
        if (dist2 < bestDist2) {
          bestDist2 = dist2;
          bestItem = item;
        }
      },
    );
    if (!bestItem) return null;
    return { item: bestItem, dist: Math.sqrt(bestDist2) };
  }

  /**
   * 遍历半径内对象
   */
  forEachWithin(
    x: number,
    y: number,
    radius: number,
    visitor: (item: T, dist2: number) => boolean | void,
    ignore?: T | null,
  ): void {
    const r2 = radius * radius;
    const { cx, cy } = this.cellOf(x, y);
    const reach = Math.ceil(radius * this.invCell);
    for (let iy = cy - reach; iy <= cy + reach; iy++) {
      for (let ix = cx - reach; ix <= cx + reach; ix++) {
        const bucket = this.cells.get(this.key(ix, iy));
        if (!bucket) continue;
        for (const item of bucket) {
          if (ignore && item === ignore) continue;
          const dx = item.worldX - x;
          const dy = item.worldY - y;
          const d2 = dx * dx + dy * dy;
          if (d2 < r2) {
            if (visitor(item, d2) === true) return;
          }
        }
      }
    }
  }

  /**
   * 收集半径内所有符合条件的对象
   */
  queryRadius(x: number, y: number, radius: number): T[] {
    const results: T[] = [];
    this.forEachWithin(x, y, radius, (item) => {
      results.push(item);
    });
    return results;
  }
}
