/**
 * 草坐标网格索引：播种判距 / 最近大草查询 O(邻格)。
 */
export class GrassSpatialIndex<T extends { worldX: number; worldY: number }> {
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

  /** 位置未变时可 no-op；草世界坐标固定，一般不需要 move */
  rebuild(items: ReadonlyArray<T>): void {
    this.clear();
    for (const it of items) this.insert(it);
  }

  /**
   * 半径内是否存在任意邻居（用于最小间距）。
   * @param ignore 忽略自身
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
   * 找最近满足 predicate 的对象；由近到远扩环，避免全图扫。
   * @param maxRadius 最大搜索半径；Infinity 表示不限
   */
  findNearest(
    x: number,
    y: number,
    predicate: (item: T) => boolean,
    maxRadius = Infinity,
  ): { item: T; dist: number } | null {
    const { cx, cy } = this.cellOf(x, y);
    let best: T | null = null;
    let bestD2 = maxRadius === Infinity ? Infinity : maxRadius * maxRadius;

    const consider = (g: T): void => {
      if (!predicate(g)) return;
      const dx = g.worldX - x;
      const dy = g.worldY - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = g;
      }
    };

    const scanCell = (ix: number, iy: number): void => {
      const bucket = this.cells.get(this.key(ix, iy));
      if (!bucket) return;
      for (const g of bucket) consider(g);
    };

    const maxReach =
      maxRadius === Infinity
        ? 512
        : Math.min(512, Math.ceil(maxRadius * this.invCell) + 1);

    for (let reach = 0; reach <= maxReach; reach++) {
      if (reach === 0) {
        scanCell(cx, cy);
      } else {
        // 只扫外环，避免重复
        for (let ix = cx - reach; ix <= cx + reach; ix++) {
          scanCell(ix, cy - reach);
          scanCell(ix, cy + reach);
        }
        for (let iy = cy - reach + 1; iy <= cy + reach - 1; iy++) {
          scanCell(cx - reach, iy);
          scanCell(cx + reach, iy);
        }
      }
      // 外环理论最近距离 = reach * cellSize；已有更近则结束
      if (best && bestD2 <= (reach * this.cellSize) ** 2) break;
    }

    if (!best) return null;
    return { item: best, dist: Math.sqrt(bestD2) };
  }
}
