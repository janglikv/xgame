import { Container, Graphics } from 'pixi.js';
import { getActiveMapDef, setActiveMapDef } from '../data/maps/activeMap';
import type { LevelMapDef } from '../data/maps/types';
import {
  clampToWalkableWorld,
  hitsTreeObstacle,
  isOcean,
  landRectOf,
  normalizeTrees,
  syncRuntimeTreesFromDef,
  treeIdOf,
  treeKindOf,
} from '../data/maps/walkMask';
import type { Vec2 } from '../utils/math';
import { generateOrganicContour, OceanLayer } from './OceanLayer';
import {
  TreeRowChunk,
  type TreePlant,
} from './TreeRowChunk';

// 布局常量 re-export，保持旧 import 路径可用
export {
  CELL_PITCH,
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

/** 岛内装饰内缩 */
const EDGE_INSET = 28;

const COLORS = {
  grass: 0x7fd84a,
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
 * 点是否不可走：海，或树干 solid。
 * 保留函数名 bodyHitsTrees 以兼容旧调用。
 */
export function isTreeBlocked(x: number, y: number): boolean {
  const def = getActiveMapDef();
  if (isOcean(x, y, def, 0)) return true;
  return hitsTreeObstacle(x, y, 0);
}

/** 实体圆是否碰到海 / 树干（闪现射线等需要「硬阻挡」的场合） */
export function bodyHitsTrees(
  x: number,
  y: number,
  radius = DEFAULT_BODY_RADIUS,
): boolean {
  const r = Math.max(0, radius);
  const def = getActiveMapDef();
  if (isOcean(x, y, def, r)) return true;
  return hitsTreeObstacle(x, y, r);
}

/** 仅树干 solid（不含海）——走路用，避免海岸被当轴对齐硬墙卡脚 */
function bodyHitsTrunk(
  x: number,
  y: number,
  radius = DEFAULT_BODY_RADIUS,
): boolean {
  return hitsTreeObstacle(x, y, Math.max(0, radius));
}

/**
 * 从 from 移向 to：树用轴分离滑动；海不在这里硬挡。
 * 海岸由 resolveSolid → clampWorld 做法线钳制，可沿岸滑行不卡脚。
 */
export function resolveTreeCollision(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  radius = DEFAULT_BODY_RADIUS,
): Vec2 {
  if (!bodyHitsTrunk(toX, toY, radius)) {
    return { x: toX, y: toY };
  }

  const canX = !bodyHitsTrunk(toX, fromY, radius);
  const canY = !bodyHitsTrunk(fromX, toY, radius);

  if (canX && !canY) return { x: toX, y: fromY };
  if (canY && !canX) return { x: fromX, y: toY };
  if (canX && canY) {
    const dx = Math.abs(toX - fromX);
    const dy = Math.abs(toY - fromY);
    return dx >= dy ? { x: toX, y: fromY } : { x: fromX, y: toY };
  }

  if (bodyHitsTrunk(fromX, fromY, radius)) {
    const escaped = tryEscapeTrees(fromX, fromY, radius);
    if (escaped) return escaped;
  }

  return { x: fromX, y: fromY };
}

/** 闪现射线采样默认步长（世界像素） */
const BLINK_RAY_STEP = 4;

/**
 * 闪现落点：沿 from→to 射线采样，返回最后一个不撞树的位置。
 * 与走路轴分离不同——贴墙时停在墙前，不会横向滑移或整段取消。
 * 坐标应为 solid 圆心（与 resolveSolid / bodyHitsTrees 一致）。
 */
export function resolveBlinkAlongRay(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  radius = DEFAULT_BODY_RADIUS,
  step = BLINK_RAY_STEP,
): Vec2 {
  const clampedFrom = WorldMap.clampWorld(fromX, fromY);
  const clampedTo = WorldMap.clampWorld(toX, toY);
  const dx = clampedTo.x - clampedFrom.x;
  const dy = clampedTo.y - clampedFrom.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-4) {
    return { x: clampedFrom.x, y: clampedFrom.y };
  }

  // 起点已卡进树：尽量脱困，避免整条射线无效
  if (bodyHitsTrees(clampedFrom.x, clampedFrom.y, radius)) {
    const escaped = tryEscapeTrees(clampedFrom.x, clampedFrom.y, radius);
    if (escaped) return WorldMap.clampWorld(escaped.x, escaped.y);
    return { x: clampedFrom.x, y: clampedFrom.y };
  }

  const inv = 1 / dist;
  const nx = dx * inv;
  const ny = dy * inv;
  const sampleStep = Math.max(1, step);

  let lastX = clampedFrom.x;
  let lastY = clampedFrom.y;

  for (let d = sampleStep; d < dist; d += sampleStep) {
    const x = clampedFrom.x + nx * d;
    const y = clampedFrom.y + ny * d;
    if (bodyHitsTrees(x, y, radius)) {
      return { x: lastX, y: lastY };
    }
    lastX = x;
    lastY = y;
  }

  // 精确终点（避免步长漏掉最后一小段）
  if (!bodyHitsTrees(clampedTo.x, clampedTo.y, radius)) {
    return { x: clampedTo.x, y: clampedTo.y };
  }
  return { x: lastX, y: lastY };
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
 * 海岛地图：海水底 + 陆地草坪 + 编辑器摆放的树。
 * 地图内容在世界坐标中绘制；镜头变换由外层 worldRoot 负责。
 */
export class WorldMap extends Container {
  private readonly root: Container;
  /** 静态松树行 chunk（仅 pine；harvest 由实体绘制） */
  private readonly treeChunks: TreeRowChunk[] = [];
  private readonly def: LevelMapDef;
  private built = false;
  private ocean: OceanLayer | null = null;

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

  /** 松树行 chunk（脚底 worldY = zIndex，参与 Y-sort） */
  getTreeChunks(): readonly TreeRowChunk[] {
    return this.treeChunks;
  }

  async load(): Promise<void> {
    if (this.built) return;
    setActiveMapDef(this.def);
    syncRuntimeTreesFromDef(this.def);
    this.build();
    this.built = true;
  }

  /** 海面动画（波纹滚动 / 泡沫呼吸） */
  update(deltaMS: number): void {
    this.ocean?.update(deltaMS);
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

  /** 钳制玩家至自然可走区域（草地+金沙滩，贴有机海岸线，禁止入海） */
  static clampWorld(x: number, y: number, radius = DEFAULT_BODY_RADIUS): Vec2 {
    const def = getActiveMapDef();
    return clampToWalkableWorld(x, y, def, radius);
  }

  static resolveSolid(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    radius = DEFAULT_BODY_RADIUS,
  ): Vec2 {
    const hit = resolveTreeCollision(fromX, fromY, toX, toY, radius);
    return WorldMap.clampWorld(hit.x, hit.y, radius);
  }

  /**
   * 闪现专用：沿射线取最后一个可站 solid 圆心（见 {@link resolveBlinkAlongRay}）。
   */
  static resolveBlink(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    radius = DEFAULT_BODY_RADIUS,
  ): Vec2 {
    return resolveBlinkAlongRay(fromX, fromY, toX, toY, radius);
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
    this.treeChunks.length = 0;
    this.ocean = null;

    const landRect = this.landRect();
    const ocean = new OceanLayer(
      oceanDrawExtent(this.def.mapSize),
      landRect,
      this.seed,
    );
    this.ocean = ocean;

    const land = new Graphics();
    land.label = 'Land';
    const decor = new Graphics();
    decor.label = 'Decor';

    this.drawLand(land);
    this.drawLandDecor(decor);
    this.spawnPlacedTreeChunks();

    this.root.addChild(ocean, land, decor);
  }

  private landRect(): { x: number; y: number; w: number; h: number } {
    return landRectOf(this.def);
  }

  /**
   * 上帝模式改树后：重建静态松树 chunk，并同步 solid 表。
   * 返回新 chunk，由 LevelScene 挂到 sortLayer（Y-sort）。
   */
  rebuildPlacedTrees(): readonly TreeRowChunk[] {
    for (const chunk of this.treeChunks) {
      chunk.parent?.removeChild(chunk);
      chunk.destroy({ children: true });
    }
    this.treeChunks.length = 0;
    syncRuntimeTreesFromDef(this.def);
    this.spawnPlacedTreeChunks();
    return this.treeChunks;
  }

  private drawLand(g: Graphics): void {
    const r = this.landRect();
    if (r.w <= 0 || r.h <= 0) return;

    // 1) 泥土草根过渡包边 - 向内缩进 -90px
    const soilContour = generateOrganicContour(r, -90, this.seed, 220);
    if (soilContour.length < 3) return;

    g.beginPath();
    g.moveTo(soilContour[0]!.x, soilContour[0]!.y);
    for (let i = 1; i < soilContour.length; i++) {
      g.lineTo(soilContour[i]!.x, soilContour[i]!.y);
    }
    g.closePath();
    g.fill({ color: 0x5b9d36, alpha: 0.95 });

    // 2) 岛屿主草地 - 向内缩进 -96px，留出超大面积阳光金沙滩！
    const grassContour = generateOrganicContour(r, -96, this.seed, 220);
    g.beginPath();
    g.moveTo(grassContour[0]!.x, grassContour[0]!.y);
    for (let i = 1; i < grassContour.length; i++) {
      g.lineTo(grassContour[i]!.x, grassContour[i]!.y);
    }
    g.closePath();
    g.fill({ color: COLORS.grass, alpha: 1.0 });

    // 3) 草地中央柔和阳光光斑 - 向内缩进 -130px
    const innerGrass = generateOrganicContour(r, -130, this.seed, 220);
    g.beginPath();
    g.moveTo(innerGrass[0]!.x, innerGrass[0]!.y);
    for (let i = 1; i < innerGrass.length; i++) {
      g.lineTo(innerGrass[i]!.x, innerGrass[i]!.y);
    }
    g.closePath();
    g.fill({ color: 0x8be555, alpha: 0.28 });
  }

  private drawLandDecor(g: Graphics): void {
    const r = this.landRect();
    if (r.w <= 64 || r.h <= 64) return;

    const rng = createRng(this.seed ^ 0x3333);
    const x0 = r.x + EDGE_INSET;
    const y0 = r.y + EDGE_INSET;
    const x1 = r.x + r.w - EDGE_INSET;
    const y1 = r.y + r.h - EDGE_INSET;
    if (x1 <= x0 || y1 <= y0) return;

    const area = r.w * r.h;
    const scale = Math.min(1.6, Math.max(0.4, area / (2000 * 2000)));

    for (let i = 0; i < Math.floor(90 * scale); i++) {
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
    for (let i = 0; i < Math.floor(28 * scale); i++) {
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
   * 仅绘制 kind=pine 的静态树（harvest 由 HarvestableTree 实体画）。
   * 按 worldY 量化分行 + 水平邻近合并 chunk。
   */
  private spawnPlacedTreeChunks(): void {
    const pines = normalizeTrees(this.def).filter(
      (t) => treeKindOf(t) === 'pine',
    );
    if (pines.length === 0) return;

    /** 同一「行」：worldY 量化到 4px，避免浮点拆碎 */
    const ROW_Q = 4;
    const byRow = new Map<number, typeof pines>();
    for (const t of pines) {
      const key = Math.round(t.y / ROW_Q) * ROW_Q;
      const list = byRow.get(key) ?? [];
      list.push(t);
      byRow.set(key, list);
    }

    const CHUNK_W = 1152;
    for (const [, list] of byRow) {
      list.sort((a, b) => a.x - b.x);
      const y =
        list.reduce((s, t) => s + t.y, 0) / Math.max(1, list.length);
      for (let i = 0; i < list.length; ) {
        const chunk: TreePlant[] = [];
        const x0 = list[i]!.x;
        while (i < list.length && list[i]!.x < x0 + CHUNK_W) {
          const t = list[i]!;
          const shade =
            Math.abs(Math.round(t.x) + Math.round(t.y) + treeIdOf(t).length) %
            3;
          chunk.push({ x: t.x, shade });
          i++;
        }
        if (chunk.length > 0) {
          this.treeChunks.push(new TreeRowChunk(y, chunk));
        }
      }
    }
  }
}

/** 海洋绘制范围：至少盖住陆地外很大一圈，缩小时也是一片海 */
export function oceanDrawExtent(mapSize: number): number {
  return Math.max(mapSize * 8, 20000);
}

function mapHalfFromActive(): number {
  return getActiveMapDef().mapSize / 2;
}

/**
 * 镜头可移到陆地外侧一段，让角色站在岸边时能看到大片海，
 * 而不是把视野死死钳在 mapSize 方框内（看起来像「只围一圈海」）。
 */
function clampAxis(desired: number, viewSize: number, landHalf: number): number {
  const oceanPad = landHalf * 2;
  const worldHalf = landHalf + oceanPad;
  const maxCam = worldHalf - viewSize / 2;
  if (maxCam <= 0) return 0;
  return Math.min(maxCam, Math.max(-maxCam, desired));
}
