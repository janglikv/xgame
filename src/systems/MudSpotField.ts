import {
  MUD_ATTRACT_R,
  MUD_MERGE_GAP,
  MUD_RADIUS_MAX,
  MUD_RADIUS_MIN,
} from '../data/mudProfiles';

export type MudSpot = {
  x: number;
  y: number;
  radius: number;
  /** 0→100：稀草改土进度，满则泥地→草地 */
  fertility: number;
};

/**
 * 泥斑集合：查询、吸引合并、邻近合成。
 * 不含清树/种草等世界副作用（由 HarvestWorld 编排）。
 */
export class MudSpotField {
  readonly spots: MudSpot[] = [];

  clear(): void {
    this.spots.length = 0;
  }

  isInMudSpot(x: number, y: number): boolean {
    for (let i = 0; i < this.spots.length; i++) {
      const m = this.spots[i]!;
      const dx = x - m.x;
      const dy = y - m.y;
      if (dx * dx + dy * dy <= m.radius * m.radius) return true;
    }
    return false;
  }

  /** 覆盖点 (x,y) 的泥斑；多个时取半径最大者 */
  findMudSpot(x: number, y: number): MudSpot | null {
    let best: MudSpot | null = null;
    for (let i = 0; i < this.spots.length; i++) {
      const m = this.spots[i]!;
      const dx = x - m.x;
      const dy = y - m.y;
      if (dx * dx + dy * dy > m.radius * m.radius) continue;
      if (!best || m.radius > best.radius) best = m;
    }
    return best;
  }

  /** 最近泥斑（中心距 ≤ maxDist） */
  findNearestMud(x: number, y: number, maxDist: number): MudSpot | null {
    let best: MudSpot | null = null;
    let bestD = maxDist;
    for (const m of this.spots) {
      const d = Math.hypot(m.x - x, m.y - y);
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
    return best;
  }

  /**
   * 新增/扩张泥地：能并就并，优先并入附近最大泥斑。
   */
  addMudSpot(x: number, y: number, radius: number): void {
    const rNew = Math.max(MUD_RADIUS_MIN, Math.min(MUD_RADIUS_MAX, radius));

    let attractIdx = -1;
    let attractScore = -1;
    for (let i = 0; i < this.spots.length; i++) {
      const m = this.spots[i]!;
      const d = Math.hypot(m.x - x, m.y - y);
      if (d > MUD_ATTRACT_R + m.radius * 0.35) continue;
      const score = m.radius * 2.2 - d * 0.35;
      if (score > attractScore) {
        attractScore = score;
        attractIdx = i;
      }
    }

    if (attractIdx >= 0) {
      this.mergeMudInto(this.spots[attractIdx]!, x, y, rNew);
    } else {
      this.spots.push({ x, y, radius: rNew, fertility: 0 });
    }

    this.consolidate();
  }

  /** 邻近泥斑合并到稳定（tick 里也可再压一遍） */
  consolidate(): void {
    this.consolidateMudSpots();
  }

  /** 把 (x,y,r) 并入目标泥斑：质心加权 + 半径包住两圆 */
  private mergeMudInto(
    target: MudSpot,
    x: number,
    y: number,
    radius: number,
  ): void {
    const w1 = target.radius * target.radius;
    const w2 = radius * radius;
    const w = w1 + w2;
    const nx = (target.x * w1 + x * w2) / w;
    const ny = (target.y * w1 + y * w2) / w;
    const d1 = Math.hypot(target.x - nx, target.y - ny);
    const d2 = Math.hypot(x - nx, y - ny);
    const cover = Math.max(d1 + target.radius, d2 + radius);
    const grown = cover * 1.06 + MUD_MERGE_GAP * 0.15;
    target.x = nx;
    target.y = ny;
    target.radius = Math.min(
      MUD_RADIUS_MAX,
      Math.max(target.radius, radius, grown),
    );
    target.fertility = Math.min(target.fertility, 12);
  }

  /**
   * 邻近泥斑反复合并，直到只剩互不挨着的几大片（通常 1～2 片）。
   */
  private consolidateMudSpots(): void {
    let guard = 0;
    while (guard++ < 32) {
      let merged = false;
      outer: for (let i = 0; i < this.spots.length; i++) {
        const a = this.spots[i]!;
        for (let j = i + 1; j < this.spots.length; j++) {
          const b = this.spots[j]!;
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d <= a.radius + b.radius + MUD_MERGE_GAP) {
            if (a.radius >= b.radius) {
              this.mergeMudInto(a, b.x, b.y, b.radius);
              this.spots.splice(j, 1);
            } else {
              this.mergeMudInto(b, a.x, a.y, a.radius);
              this.spots.splice(i, 1);
            }
            merged = true;
            break outer;
          }
        }
      }
      if (!merged) break;
    }
  }
}
