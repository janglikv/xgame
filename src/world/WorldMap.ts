import { Container, Graphics } from 'pixi.js';
import { getActiveMapDef, setActiveMapDef } from '../data/maps/activeMap';
import type { LevelMapDef } from '../data/maps/types';
import {
  cellRectToWorld,
  isWalkable,
  shouldPlantTree,
} from '../data/maps/walkMask';
import type { Vec2 } from '../utils/math';
import { ISLAND_SIZE, PINE_SPACING } from './mapLayout';
import { PineTree } from './PineTree';

// 布局常量 re-export，保持旧 import 路径可用
export {
  CELL_PITCH,
  CHANNEL_WIDTH,
  FOREST_WIDTH,
  GRID,
  ISLAND_SIZE,
  MAP_SIZE,
  MAP_WORLD_HALF,
  OUTER_FOREST_WIDTH,
  islandCenter,
  isRemovedIsland,
} from './mapLayout';

/** 角色/实体默认碰撞半径（世界像素） */
export const DEFAULT_BODY_RADIUS = 16;

/** 开阔区装饰：短边小于此值的走廊不刷花草 */
const DECOR_MIN_SIDE = 280;

/** 岛内装饰内缩 */
const EDGE_INSET = 24;

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

export type { Vec2 };

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
 * 点是否落在密林阻挡区。
 * 默认整图挡；walkable 并集可走。
 */
export function isTreeBlocked(x: number, y: number): boolean {
  return !isWalkable(x, y, getActiveMapDef());
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
    const dx = Math.abs(toX - fromX);
    const dy = Math.abs(toY - fromY);
    return dx >= dy ? { x: toX, y: fromY } : { x: fromX, y: toY };
  }

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
 * 程序地图：草坪底 + 按 LevelMapDef 抠空种树。
 * 地图内容在世界坐标中绘制；镜头变换由外层 worldRoot 负责。
 */
export class WorldMap extends Container {
  private readonly root: Container;
  private readonly trees: PineTree[] = [];
  private readonly def: LevelMapDef;
  private built = false;

  constructor(
    def?: LevelMapDef,
    private readonly seed = 42,
  ) {
    super();
    this.label = 'WorldMap';
    this.eventMode = 'none';
    this.def = def ?? getActiveMapDef();
    this.root = new Container();
    this.root.label = 'MapRoot';
    this.addChild(this.root);
  }

  get mapDef(): LevelMapDef {
    return this.def;
  }

  /** 松树实例（脚底世界坐标，参与 Y-sort） */
  getTrees(): readonly PineTree[] {
    return this.trees;
  }

  async load(): Promise<void> {
    if (this.built) return;
    setActiveMapDef(this.def);
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

  static clampWorld(x: number, y: number): Vec2 {
    const h = mapHalfFromActive();
    return {
      x: Math.min(h, Math.max(-h, x)),
      y: Math.min(h, Math.max(-h, y)),
    };
  }

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

  static clampCamera(
    desiredX: number,
    desiredY: number,
    viewW: number,
    viewH: number,
  ): Vec2 {
    const half = mapHalfFromActive();
    return {
      x: clampAxis(desiredX, viewW, half),
      y: clampAxis(desiredY, viewH, half),
    };
  }

  private build(): void {
    this.root.removeChildren();
    this.trees.length = 0;

    const grass = new Graphics();
    grass.label = 'Grass';
    const decor = new Graphics();
    decor.label = 'Decor';

    this.drawGrassBase(grass);
    this.drawWalkableDecor(decor);
    this.spawnForestTrees();

    this.root.addChild(grass, decor);
  }

  private drawGrassBase(g: Graphics): void {
    const size = this.def.mapSize;
    const h = size / 2;
    g.rect(-h, -h, size, size).fill({ color: COLORS.grass });

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

  /** 在较开阔的可走格子矩形内刷花草装饰 */
  private drawWalkableDecor(decor: Graphics): void {
    let idx = 0;
    for (const cell of this.def.walk) {
      const r = cellRectToWorld(cell, this.def.mapSize, this.def.cellSize);
      if (Math.min(r.w, r.h) < DECOR_MIN_SIDE) continue;
      this.drawRegionDecor(decor, r, idx);
      idx++;
    }
  }

  private drawRegionDecor(
    g: Graphics,
    r: { x: number; y: number; w: number; h: number },
    idx: number,
  ): void {
    const rng = createRng(
      (this.seed ^ Math.imul(idx + 1, 73856093) ^ Math.imul(r.w | 0, 19349663)) >>>
        0,
    );

    const x0 = r.x + EDGE_INSET + 8;
    const y0 = r.y + EDGE_INSET + 8;
    const x1 = r.x + r.w - EDGE_INSET - 8;
    const y1 = r.y + r.h - EDGE_INSET - 8;
    if (x1 <= x0 || y1 <= y0) return;

    const area = r.w * r.h;
    const scale = Math.min(1.4, Math.max(0.35, area / (ISLAND_SIZE * ISLAND_SIZE)));

    for (let i = 0; i < Math.floor(35 * scale); i++) {
      const x = x0 + rng() * (x1 - x0);
      const y = y0 + rng() * (y1 - y0);
      const rx = 36 + rng() * 64;
      const ry = 28 + rng() * 48;
      const color =
        rng() < 0.4
          ? COLORS.grassDark
          : rng() < 0.7
            ? COLORS.grassSoft
            : COLORS.grassLight;
      g.ellipse(x, y, rx, ry).fill({ color, alpha: 0.28 });
    }

    for (let i = 0; i < Math.floor(14 * scale); i++) {
      if (rng() > 0.75) continue;
      const x = x0 + rng() * (x1 - x0);
      const y = y0 + rng() * (y1 - y0);
      const rad = 12 + rng() * 18;
      g.ellipse(x, y, rad * 1.1, rad * 0.7).fill({
        color: COLORS.dirtDark,
        alpha: 0.3,
      });
      g.ellipse(x, y, rad, rad * 0.55).fill({ color: COLORS.dirt, alpha: 0.45 });
    }

    for (let i = 0; i < Math.floor(75 * scale); i++) {
      const x = x0 + rng() * (x1 - x0);
      const y = y0 + rng() * (y1 - y0);
      const blades = 2 + Math.floor(rng() * 3);
      for (let k = 0; k < blades; k++) {
        const lean = -0.5 + rng();
        const hh = 12 + rng() * 14;
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
    for (let i = 0; i < Math.floor(24 * scale); i++) {
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
   * 全图网格密植松树；walkable（含树冠净空）内不种。
   */
  private spawnForestTrees(): void {
    const def = this.def;
    const half = def.mapSize / 2;
    const origin = -half + PINE_SPACING * 0.5;
    const cols = Math.floor(def.mapSize / PINE_SPACING);
    const rows = Math.floor(def.mapSize / PINE_SPACING);

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = origin + col * PINE_SPACING;
        const y = origin + row * PINE_SPACING;
        if (!shouldPlantTree(x, y, def)) continue;
        const shade = (col + row) % 3;
        this.trees.push(new PineTree(x, y, shade));
      }
    }
  }
}

function mapHalfFromActive(): number {
  return getActiveMapDef().mapSize / 2;
}

function clampAxis(desired: number, viewSize: number, mapHalf: number): number {
  const maxCam = mapHalf - viewSize / 2;
  if (maxCam <= 0) return 0;
  return Math.min(maxCam, Math.max(-maxCam, desired));
}
