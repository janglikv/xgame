import { Container, Graphics } from 'pixi.js';
import { PineTree } from './PineTree';

/** 九宫格边长（3×3 岛） */
export const GRID = 3;

/** 单岛外沿边长（世界像素） */
export const ISLAND_SIZE = 960;

/** 岛与岛之间的森林走廊宽度 */
export const FOREST_WIDTH = 280;

/** 整图最外圈松林带宽（围住九宫格） */
export const OUTER_FOREST_WIDTH = 200;

/** 松树网格间距（越小越密） */
const PINE_SPACING = 36;

/** 松树整体尺寸倍率（碰撞过道净空用；绘制见 PineTree） */
const PINE_SCALE = 2.7;

/** 岛内装饰内缩（避免贴边） */
const EDGE_INSET = 16;

/** 林间通道 / 墙洞宽度（视觉与可行走草坪宽） */
const PATH_WIDTH = 78;

/** 角色/实体默认碰撞半径（世界像素） */
export const DEFAULT_BODY_RADIUS = 16;

/** 相邻岛中心距 */
export const CELL_PITCH = ISLAND_SIZE + FOREST_WIDTH;

/** 九宫格核心区边长（不含外圈林带） */
const CORE_SIZE = GRID * ISLAND_SIZE + (GRID - 1) * FOREST_WIDTH;

/** 整图边长（核心 + 外圈林带） */
export const MAP_SIZE = CORE_SIZE + 2 * OUTER_FOREST_WIDTH;

/** 地图半宽/半高（中心 = 原点） */
export const MAP_WORLD_HALF = MAP_SIZE / 2;

/** @deprecated 使用 FOREST_WIDTH；保留别名以免外部引用断裂 */
export const CHANNEL_WIDTH = FOREST_WIDTH;

const COLORS = {
  grass: 0x7fd84a,
  grassSoft: 0x6fc93c,
  grassDark: 0x5bb832,
  grassLight: 0xa6eb6e,
  dirt: 0xd8b48a,
  dirtDark: 0xc49a6c,
  blade: 0x4caf2f,
  bladeLight: 0x7ed957,
  flowerPink: 0xff7eb3,
  flowerYellow: 0xffe14a,
  flowerWhite: 0xfff6e0,
  flowerCenter: 0xff9f43,
} as const;

export type Vec2 = { x: number; y: number };

function createRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 九宫格岛中心（世界坐标）。
 * ix/iy ∈ [0, GRID)，(0,0) 为左上，(1,1) 为中心岛。
 * 外圈留 OUTER_FOREST_WIDTH 松林。
 */
export function islandCenter(ix: number, iy: number): Vec2 {
  const start = -MAP_WORLD_HALF + OUTER_FOREST_WIDTH + ISLAND_SIZE / 2;
  return {
    x: start + ix * CELL_PITCH,
    y: start + iy * CELL_PITCH,
  };
}

type Rect = { x: number; y: number; w: number; h: number };

/** 岛外沿轴对齐包围盒（世界坐标） */
function islandBounds(ix: number, iy: number): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  const c = islandCenter(ix, iy);
  const h = ISLAND_SIZE / 2;
  return {
    left: c.x - h,
    top: c.y - h,
    right: c.x + h,
    bottom: c.y + h,
  };
}

function pointInRect(px: number, py: number, r: Rect): boolean {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

function pointInAnyRect(px: number, py: number, rects: Rect[]): boolean {
  for (const r of rects) {
    if (pointInRect(px, py, r)) return true;
  }
  return false;
}

function pointInAnyIsland(px: number, py: number, margin: number): boolean {
  for (let iy = 0; iy < GRID; iy++) {
    for (let ix = 0; ix < GRID; ix++) {
      const b = islandBounds(ix, iy);
      if (
        px >= b.left - margin &&
        px <= b.right + margin &&
        py >= b.top - margin &&
        py <= b.bottom + margin
      ) {
        return true;
      }
    }
  }
  return false;
}

/** 可种树区域：外圈林带 + 岛间十字走廊 */
function collectForestRects(): Rect[] {
  const h = MAP_WORLD_HALF;
  const o = OUTER_FOREST_WIDTH;
  const rects: Rect[] = [
    { x: -h, y: -h, w: MAP_SIZE, h: o },
    { x: -h, y: h - o, w: MAP_SIZE, h: o },
    { x: -h, y: -h, w: o, h: MAP_SIZE },
    { x: h - o, y: -h, w: o, h: MAP_SIZE },
  ];

  const coreLeft = -h + o;
  for (let i = 0; i < GRID - 1; i++) {
    const cx = coreLeft + ISLAND_SIZE + FOREST_WIDTH / 2 + i * CELL_PITCH;
    rects.push({
      x: cx - FOREST_WIDTH / 2,
      y: -h,
      w: FOREST_WIDTH,
      h: MAP_SIZE,
    });
    const cy = coreLeft + ISLAND_SIZE + FOREST_WIDTH / 2 + i * CELL_PITCH;
    rects.push({
      x: -h,
      y: cy - FOREST_WIDTH / 2,
      w: MAP_SIZE,
      h: FOREST_WIDTH,
    });
  }
  return rects;
}

/**
 * 林间过道（无树可行走）。
 * 宽度 = 路宽 + 树冠余量，与种树清空区一致。
 */
function collectPathRects(): Rect[] {
  const clear = PATH_WIDTH + 26 * PINE_SCALE;
  const half = clear / 2;
  const rects: Rect[] = [];

  for (let iy = 0; iy < GRID; iy++) {
    for (let ix = 0; ix < GRID - 1; ix++) {
      const a = islandCenter(ix, iy);
      const b = islandCenter(ix + 1, iy);
      const x0 = a.x + ISLAND_SIZE / 2;
      const x1 = b.x - ISLAND_SIZE / 2;
      const left = Math.min(x0, x1);
      const len = Math.abs(x1 - x0);
      rects.push({ x: left, y: a.y - half, w: len, h: clear });
    }
  }

  for (let iy = 0; iy < GRID - 1; iy++) {
    for (let ix = 0; ix < GRID; ix++) {
      const a = islandCenter(ix, iy);
      const b = islandCenter(ix, iy + 1);
      const y0 = a.y + ISLAND_SIZE / 2;
      const y1 = b.y - ISLAND_SIZE / 2;
      const top = Math.min(y0, y1);
      const len = Math.abs(y1 - y0);
      rects.push({ x: a.x - half, y: top, w: clear, h: len });
    }
  }

  return rects;
}

let cachedForestRects: Rect[] | null = null;
let cachedPathRects: Rect[] | null = null;

function forestRects(): Rect[] {
  if (!cachedForestRects) cachedForestRects = collectForestRects();
  return cachedForestRects;
}

function pathRects(): Rect[] {
  if (!cachedPathRects) cachedPathRects = collectPathRects();
  return cachedPathRects;
}

/**
 * 点是否落在密林阻挡区（有树、不可走）。
 * 岛内 / 过道可走；走廊与外圈林带不可走。
 */
export function isTreeBlocked(x: number, y: number): boolean {
  if (pointInAnyIsland(x, y, 0)) return false;
  if (pointInAnyRect(x, y, pathRects())) return false;
  return pointInAnyRect(x, y, forestRects());
}

/** 实体圆形碰撞体是否碰到树区 */
export function bodyHitsTrees(
  x: number,
  y: number,
  radius = DEFAULT_BODY_RADIUS,
): boolean {
  const r = Math.max(0, radius);
  if (isTreeBlocked(x, y)) return true;
  if (r <= 0) return false;
  // 四向采样，近似圆盘
  return (
    isTreeBlocked(x + r, y) ||
    isTreeBlocked(x - r, y) ||
    isTreeBlocked(x, y + r) ||
    isTreeBlocked(x, y - r) ||
    isTreeBlocked(x + r * 0.7, y + r * 0.7) ||
    isTreeBlocked(x - r * 0.7, y + r * 0.7) ||
    isTreeBlocked(x + r * 0.7, y - r * 0.7) ||
    isTreeBlocked(x - r * 0.7, y - r * 0.7)
  );
}

/**
 * 从 from 移向 to 时做轴分离滑动，避免穿进树区。
 * 返回最终可站立坐标（仍可能需再 clamp 地图边界）。
 */
export function resolveTreeCollision(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  radius = DEFAULT_BODY_RADIUS,
): Vec2 {
  if (!bodyHitsTrees(toX, toY, radius)) {
    return { x: toX, y: toY };
  }

  const canX = !bodyHitsTrees(toX, fromY, radius);
  const canY = !bodyHitsTrees(fromX, toY, radius);

  if (canX && !canY) return { x: toX, y: fromY };
  if (canY && !canX) return { x: fromX, y: toY };
  if (canX && canY) {
    // 两轴都可行时取离目标更近的一侧（斜向贴墙）
    const dx = Math.abs(toX - fromX);
    const dy = Math.abs(toY - fromY);
    return dx >= dy ? { x: toX, y: fromY } : { x: fromX, y: toY };
  }

  // 仍堵在树里（例如已生成在林内）：尝试轻推到最近可走采样
  if (bodyHitsTrees(fromX, fromY, radius)) {
    const escaped = tryEscapeTrees(fromX, fromY, radius);
    if (escaped) return escaped;
  }

  return { x: fromX, y: fromY };
}

function tryEscapeTrees(
  x: number,
  y: number,
  radius: number,
): Vec2 | null {
  const steps = [8, 16, 28, 44, 64, 96];
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ];
  for (const dist of steps) {
    for (const [dx, dy] of dirs) {
      const nx = x + dx * dist;
      const ny = y + dy * dist;
      if (!bodyHitsTrees(nx, ny, radius)) return { x: nx, y: ny };
    }
  }
  return null;
}

/**
 * 程序生成的九宫格地图：
 * 全图草坪底 + 可排序松树实例（由关卡 sortLayer 托管）。
 * 地图内容在世界坐标中绘制；镜头变换由外层 worldRoot 负责。
 */
export class WorldMap extends Container {
  private readonly root: Container;
  private readonly trees: PineTree[] = [];
  private built = false;

  constructor(private readonly seed = 42) {
    super();
    this.label = 'WorldMap';
    this.eventMode = 'none';
    this.root = new Container();
    this.root.label = 'MapRoot';
    this.addChild(this.root);
  }

  /** 松树实例（脚底世界坐标，参与 Y-sort） */
  getTrees(): readonly PineTree[] {
    return this.trees;
  }

  /** 与位图版 API 兼容；程序地图同步构建即可 */
  async load(): Promise<void> {
    if (this.built) return;
    this.build();
    this.built = true;
  }

  /**
   * 旧 API 保留空实现：镜头已由 LevelScene.worldRoot 统一变换。
   */
  sync(
    _width: number,
    _height: number,
    _cameraX = 0,
    _cameraY = 0,
    _force = false,
    _zoom = 1,
  ): void {
    // no-op
  }

  /** 限制世界坐标在地图范围内（角色/实体不走出图外）。 */
  static clampWorld(x: number, y: number): Vec2 {
    const h = MAP_WORLD_HALF;
    return {
      x: Math.min(h, Math.max(-h, x)),
      y: Math.min(h, Math.max(-h, y)),
    };
  }

  /**
   * 地图边界 + 树区碰撞后的最终落点。
   * @param fromX/fromY 本帧移动前坐标（用于轴分离滑动）
   */
  static resolveSolid(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    radius = DEFAULT_BODY_RADIUS,
  ): Vec2 {
    const hit = resolveTreeCollision(fromX, fromY, toX, toY, radius);
    return WorldMap.clampWorld(hit.x, hit.y);
  }

  /**
   * 限制相机，使视口始终被地图填满，不露出图外。
   * 地图比视口小时锁在 0。
   */
  static clampCamera(
    desiredX: number,
    desiredY: number,
    viewW: number,
    viewH: number,
  ): Vec2 {
    return {
      x: clampAxis(desiredX, viewW, MAP_WORLD_HALF),
      y: clampAxis(desiredY, viewH, MAP_WORLD_HALF),
    };
  }

  private build(): void {
    this.root.removeChildren();
    this.trees.length = 0;

    const grass = new Graphics();
    grass.label = 'Grass';
    const decor = new Graphics();
    decor.label = 'Decor';

    // 草坪 + 岛装饰；树改为独立实例供纵深排序
    this.drawGrassBase(grass);
    this.drawIslandDecorAll(decor);
    this.spawnForestTrees();

    this.root.addChild(grass, decor);
  }

  /** 整张地图统一草坪底，过道/岛/林下都同一层 */
  private drawGrassBase(g: Graphics): void {
    const h = MAP_WORLD_HALF;
    g.rect(-h, -h, MAP_SIZE, MAP_SIZE).fill({ color: COLORS.grass });

    const rng = createRng(this.seed ^ 0x2222);
    const band = 72;
    for (let y = -h; y < h; y += band) {
      for (let x = -h; x < h; x += band) {
        if (rng() > 0.55) continue;
        const wx = x + rng() * band;
        const wy = y + rng() * band;
        const rx = 36 + rng() * 70;
        const ry = 26 + rng() * 50;
        const color =
          rng() < 0.4
            ? COLORS.grassDark
            : rng() < 0.75
              ? COLORS.grassSoft
              : COLORS.grassLight;
        g.ellipse(wx, wy, rx, ry).fill({ color, alpha: 0.22 });
      }
    }
  }

  private drawIslandDecorAll(decor: Graphics): void {
    for (let iy = 0; iy < GRID; iy++) {
      for (let ix = 0; ix < GRID; ix++) {
        this.drawIslandDecor(decor, ix, iy, islandBounds(ix, iy));
      }
    }
  }

  private drawIslandDecor(
    g: Graphics,
    ix: number,
    iy: number,
    b: { left: number; top: number; right: number; bottom: number },
  ): void {
    const rng = createRng(
      (this.seed ^ Math.imul(ix + 1, 73856093) ^ Math.imul(iy + 1, 19349663)) >>>
        0,
    );

    const x0 = b.left + EDGE_INSET + 8;
    const y0 = b.top + EDGE_INSET + 8;
    const x1 = b.right - EDGE_INSET - 8;
    const y1 = b.bottom - EDGE_INSET - 8;

    for (let i = 0; i < 10; i++) {
      const x = x0 + rng() * (x1 - x0);
      const y = y0 + rng() * (y1 - y0);
      const rx = 28 + rng() * 48;
      const ry = 20 + rng() * 36;
      const color =
        rng() < 0.4
          ? COLORS.grassDark
          : rng() < 0.7
            ? COLORS.grassSoft
            : COLORS.grassLight;
      g.ellipse(x, y, rx, ry).fill({ color, alpha: 0.28 });
    }

    for (let i = 0; i < 4; i++) {
      if (rng() > 0.7) continue;
      const x = x0 + rng() * (x1 - x0);
      const y = y0 + rng() * (y1 - y0);
      const r = 10 + rng() * 14;
      g.ellipse(x, y, r * 1.1, r * 0.7).fill({
        color: COLORS.dirtDark,
        alpha: 0.3,
      });
      g.ellipse(x, y, r, r * 0.55).fill({ color: COLORS.dirt, alpha: 0.45 });
    }

    for (let i = 0; i < 22; i++) {
      const x = x0 + rng() * (x1 - x0);
      const y = y0 + rng() * (y1 - y0);
      const blades = 2 + Math.floor(rng() * 3);
      for (let k = 0; k < blades; k++) {
        const lean = -0.5 + rng();
        const hh = 10 + rng() * 12;
        const tipX = x + lean * 6 + (k - 1) * 3;
        const tipY = y - hh;
        g.moveTo(x + (k - 1) * 2, y);
        g.quadraticCurveTo(
          x + (k - 1) * 2 + lean * 3,
          y - hh * 0.5,
          tipX,
          tipY,
        );
        g.quadraticCurveTo(
          x + (k - 1) * 2 - lean * 2,
          y - hh * 0.45,
          x + (k - 1) * 2,
          y,
        );
        g.fill({
          color: rng() < 0.5 ? COLORS.blade : COLORS.bladeLight,
          alpha: 0.85,
        });
      }
    }

    const flowerColors = [
      COLORS.flowerPink,
      COLORS.flowerYellow,
      COLORS.flowerWhite,
    ];
    for (let i = 0; i < 6; i++) {
      if (rng() > 0.55) continue;
      const x = x0 + rng() * (x1 - x0);
      const y = y0 + rng() * (y1 - y0);
      const color = flowerColors[Math.floor(rng() * flowerColors.length)]!;
      const s = 2.5 + rng() * 2;
      for (let p = 0; p < 5; p++) {
        const a = (p / 5) * Math.PI * 2;
        g.circle(
          x + Math.cos(a) * s * 0.8,
          y + Math.sin(a) * s * 0.8,
          s * 0.7,
        ).fill({ color });
      }
      g.circle(x, y, s * 0.5).fill({ color: COLORS.flowerCenter });
    }
  }

  /**
   * 整齐密植松树实例：等距网格，种在走廊 + 外圈林带；
   * 过道清空。实例交给 LevelScene.sortLayer 做 Y-sort。
   */
  private spawnForestTrees(): void {
    const paths = pathRects();
    const forests = forestRects();
    const half = MAP_WORLD_HALF;

    const origin = -half + PINE_SPACING * 0.5;
    const cols = Math.floor(MAP_SIZE / PINE_SPACING);
    const rows = Math.floor(MAP_SIZE / PINE_SPACING);

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = origin + col * PINE_SPACING;
        const y = origin + row * PINE_SPACING;

        if (!pointInAnyRect(x, y, forests)) continue;
        if (pointInAnyIsland(x, y, 6)) continue;
        if (pointInAnyRect(x, y, paths)) continue;

        const shade = (col + row) % 3;
        this.trees.push(new PineTree(x, y, shade));
      }
    }
  }
}

function clampAxis(desired: number, viewSize: number, mapHalf: number): number {
  const maxCam = mapHalf - viewSize / 2;
  if (maxCam <= 0) return 0;
  return Math.min(maxCam, Math.max(-maxCam, desired));
}
