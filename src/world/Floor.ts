import {
  Color3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  type Scene,
  ShadowGenerator,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
  VertexData,
} from '@babylonjs/core';

/**
 * 主场地表面样式枚举。
 */
export type FloorSurface =
  | 'tiles'
  | 'dirtGrass'
  | 'cyberGrid'
  | 'checker'
  | 'cobblestone'
  | 'sand'
  | 'marble'
  | 'woodPlanks'
  | 'dark';

export interface FloorSurfacePreset {
  id: FloorSurface;
  name: string;
  englishName: string;
  description: string;
  uScale: number;
  vScale: number;
}

export const FLOOR_SURFACE_PRESETS: FloorSurfacePreset[] = [
  {
    id: 'tiles',
    name: '石砖瓷砖',
    englishName: 'Stone Tiles',
    description: '标准经典高品质石砖地面',
    uScale: 6,
    vScale: 6,
  },
  {
    id: 'dirtGrass',
    name: '自然草坪',
    englishName: 'Dirt & Grass',
    description: '噪声生成的生机泥土草皮',
    uScale: 8,
    vScale: 8,
  },
  {
    id: 'cyberGrid',
    name: '赛博网格',
    englishName: 'Cyber Grid',
    description: '霓虹发光与交叉点的竞技场网格',
    uScale: 8,
    vScale: 8,
  },
  {
    id: 'checker',
    name: '黑白棋盘',
    englishName: 'Checkerboard',
    description: '经典复古大理石质感棋盘格',
    uScale: 10,
    vScale: 10,
  },
  {
    id: 'cobblestone',
    name: '鹅卵石路',
    englishName: 'Cobblestone',
    description: '纹理分明的铺面鹅卵石石路',
    uScale: 6,
    vScale: 6,
  },
  {
    id: 'sand',
    name: '荒漠沙丘',
    englishName: 'Sand Dunes',
    description: '金黄风吹沙丘波纹与微粒',
    uScale: 6,
    vScale: 6,
  },
  {
    id: 'marble',
    name: '云石大理石',
    englishName: 'White Marble',
    description: '优雅大气的白色流纹大理石',
    uScale: 6,
    vScale: 6,
  },
  {
    id: 'woodPlanks',
    name: '暖色木板',
    englishName: 'Wood Planks',
    description: '温润舒适的防腐拼接木地板',
    uScale: 6,
    vScale: 6,
  },
  {
    id: 'dark',
    name: '极简暗黑',
    englishName: 'Dark Metal',
    description: '沉浸感十足的深色哑光地板',
    uScale: 1,
    vScale: 1,
  },
];

export interface FloorOptions {
  surface?: FloorSurface;
  /** 场地半宽（X 轴，米）；默认 {@link Floor.HALF_X}。围墙与可玩边界以此为准 */
  halfX?: number;
  /** 场地半深（Z 轴，米）；默认 {@link Floor.HALF_Z}。围墙与可玩边界以此为准 */
  halfZ?: number;
  /** 可玩区最小 X（优先于 ±halfX） */
  minX?: number;
  /** 可玩区最大 X */
  maxX?: number;
  /** 可玩区最小 Z（优先于 ±halfZ） */
  minZ?: number;
  /** 可玩区最大 Z */
  maxZ?: number;
  /**
   * 可视地板相对围墙四边外延的格数（1 格 = 1 米）。
   * 仅扩大主场地贴图平面，不移动围墙；用于避免地图外纯黑空洞。
   */
  extend?: number;
  /**
   * 是否在场地中心 (0,0) 生成方形围墙（指定边长米数，如 3 表示 3×3 米围墙）。
   */
  centerWallSize?: number;
  /**
   * 是否在右下角 (5, -5) 生成 L 型梯形围墙。
   */
  addLWall?: boolean;
  /**
   * 是否用朝屏幕下方（+X，固定镜头所在一侧）开口的方围把传送阵围起来。
   */
  addPadCoverWall?: boolean;
}

const OFFICIAL_TEX_BASE =
  'https://www.babylonjs-playground.com/textures/';

/**
 * 简单矩形场地：Y=0 平面地板 + 四周矮墙 + 外围兜底大地板。
 * 默认与坐标系范围对齐：X ±20、Z ±20（边长 40×40）。
 * 可通过 options.halfX / halfZ 覆盖可玩区；options.extend 让地板向外多铺一圈。
 */
export class Floor {
  static readonly HALF_X = 20;
  static readonly HALF_Z = 20;
  static readonly WALL_THICKNESS = 1.0;
  static readonly WALL_HEIGHT = 0.5;
  static readonly GROUND_SIZE = 4000;
  static readonly FLOOR_THICKNESS = 0.05;
  static readonly GROUND_Y = -0.08;
  /**
   * 传送阵方围：3×3，围绕 (0, -7)，在 +Z 北侧（z=-5.5）开出口。
   */
  static readonly SPAWN_COVER_PATH = [
    new Vector3(-1.5, 0, -5.5),
    new Vector3(-1.5, 0, -8.5),
    new Vector3(1.5, 0, -8.5),
    new Vector3(1.5, 0, -5.5),
  ];

  readonly root: TransformNode;
  readonly scene: Scene;
  /** 本实例可玩区半宽（X，围墙位置） */
  readonly halfX: number;
  /** 本实例可玩区半深（Z，围墙位置） */
  readonly halfZ: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  /** 可视地板相对围墙的外延（米） */
  readonly extend: number;
  private currentSurface: FloorSurface;
  private floorMesh?: Mesh;
  private groundMesh?: Mesh;
  private wallMeshes: Mesh[] = [];

  constructor(
    scene: Scene,
    shadowGenerator?: ShadowGenerator,
    options: FloorOptions = {},
  ) {
    this.scene = scene;
    this.root = new TransformNode('Floor', scene);
    this.currentSurface = options.surface ?? 'tiles';
    this.halfX = options.halfX ?? Floor.HALF_X;
    this.halfZ = options.halfZ ?? Floor.HALF_Z;
    this.minX = options.minX ?? -this.halfX;
    this.maxX = options.maxX ?? this.halfX;
    this.minZ = options.minZ ?? -this.halfZ;
    this.maxZ = options.maxZ ?? this.halfZ;
    this.extend = Math.max(0, options.extend ?? 0);

    // 围墙按可玩区；主地板可外延，避免墙外一片黑
    const floorMinX = this.minX - this.extend;
    const floorMaxX = this.maxX + this.extend;
    const floorMinZ = this.minZ - this.extend;
    const floorMaxZ = this.maxZ + this.extend;
    const floorSizeX = floorMaxX - floorMinX;
    const floorSizeZ = floorMaxZ - floorMinZ;
    const t = Floor.WALL_THICKNESS;
    const h = Floor.WALL_HEIGHT;

    // 兜底大地板：纯色、不接阴影
    this.groundMesh = MeshBuilder.CreateGround(
      'FallbackGround',
      { width: Floor.GROUND_SIZE, height: Floor.GROUND_SIZE },
      scene,
    );
    this.groundMesh.position.y = Floor.GROUND_Y;
    this.groundMesh.receiveShadows = false;
    this.groundMesh.parent = this.root;

    // 主场地贴图平面（可大于围墙范围）
    this.floorMesh = MeshBuilder.CreateGround(
      'FloorSurface',
      { width: floorSizeX, height: floorSizeZ, subdivisions: 1 },
      scene,
    );
    this.floorMesh.position.x = (floorMinX + floorMaxX) / 2;
    this.floorMesh.position.y = 0;
    this.floorMesh.position.z = (floorMinZ + floorMaxZ) / 2;
    this.floorMesh.receiveShadows = true;
    this.floorMesh.parent = this.root;

    const minX = this.minX;
    const maxX = this.maxX;
    const minZ = this.minZ;
    const maxZ = this.maxZ;

    // 单条首尾闭合路径：绕场地四周一整圈，4点梯形截面 Extrude 挤压无缝连贯
    const loopPath = [
      new Vector3(minX - t / 2, 0, minZ - t / 2),
      new Vector3(maxX + t / 2, 0, minZ - t / 2),
      new Vector3(maxX + t / 2, 0, maxZ + t / 2),
      new Vector3(minX - t / 2, 0, maxZ + t / 2),
      new Vector3(minX - t / 2, 0, minZ - t / 2),
    ];

    const wall = createTrapezoidExtrudedWall(
      'RenderWall_ClosedLoop',
      { path: loopPath, bottomWidth: t, topWidth: 0.5, height: h, close: true },
      scene,
    );
    wall.receiveShadows = true;
    wall.parent = this.root;
    shadowGenerator?.addShadowCaster(wall);
    this.wallMeshes.push(wall);

    // 中心围墙（标准 3×3 米闭合梯形围墙）
    if (options.centerWallSize && options.centerWallSize > 0) {
      const cHalf = options.centerWallSize / 2;
      const centerLoopPath = [
        new Vector3(-cHalf, 0, -cHalf),
        new Vector3(cHalf, 0, -cHalf),
        new Vector3(cHalf, 0, cHalf),
        new Vector3(-cHalf, 0, cHalf),
        new Vector3(-cHalf, 0, -cHalf),
      ];
      const centerWall = createTrapezoidExtrudedWall(
        `RenderWall_Center_${options.centerWallSize}x${options.centerWallSize}`,
        {
          path: centerLoopPath,
          bottomWidth: 0.8,
          topWidth: 0.4,
          height: h,
          close: true,
        },
        scene,
      );
      centerWall.receiveShadows = true;
      centerWall.parent = this.root;
      shadowGenerator?.addShadowCaster(centerWall);
      this.wallMeshes.push(centerWall);
    }

    // 四角 L 型围墙（位于左上、右上、左下、右下四个象限，单条平滑管道）
    if (options.addLWall) {
      const cornerConfigs = [
        { name: 'BR', path: [new Vector3(8, 0, -5), new Vector3(5, 0, -5), new Vector3(5, 0, -8)] },
        { name: 'TR', path: [new Vector3(8, 0, 5), new Vector3(5, 0, 5), new Vector3(5, 0, 8)] },
        { name: 'TL', path: [new Vector3(-8, 0, 5), new Vector3(-5, 0, 5), new Vector3(-5, 0, 8)] },
        { name: 'BL', path: [new Vector3(-8, 0, -5), new Vector3(-5, 0, -5), new Vector3(-5, 0, -8)] },
      ];

      for (const config of cornerConfigs) {
        const lWall = createTrapezoidExtrudedWall(
          `RenderWall_L_${config.name}`,
          {
            path: config.path,
            bottomWidth: 0.8,
            topWidth: 0.4,
            height: h,
            close: false,
          },
          scene,
        );
        lWall.receiveShadows = true;
        lWall.parent = this.root;
        shadowGenerator?.addShadowCaster(lWall);
        this.wallMeshes.push(lWall);
      }
    }

    // 传送阵方围：三面墙、+X（屏幕下）开口
    if (options.addPadCoverWall) {
      const padCover = createTrapezoidExtrudedWall(
        'RenderWall_SpawnCover',
        {
          path: Floor.SPAWN_COVER_PATH,
          bottomWidth: 0.8,
          topWidth: 0.4,
          height: h,
          close: false,
        },
        scene,
      );
      padCover.receiveShadows = true;
      padCover.parent = this.root;
      shadowGenerator?.addShadowCaster(padCover);
      this.wallMeshes.push(padCover);
    }

    // 初始化应用当前 Surface
    this.applySurface(this.currentSurface);
  }

  public getSurface(): FloorSurface {
    return this.currentSurface;
  }

  public setSurface(surface: FloorSurface): void {
    if (this.currentSurface === surface) return;
    this.currentSurface = surface;
    this.applySurface(surface);
  }

  private applySurface(surface: FloorSurface): void {
    // 贴图预设按默认 40m 场地校准；按可视地板边长等比缩放以保持米级对齐
    const visualSizeX = this.maxX - this.minX + this.extend * 2;
    const visualSizeZ = this.maxZ - this.minZ + this.extend * 2;
    const uMul = visualSizeX / (Floor.HALF_X * 2);
    const vMul = visualSizeZ / (Floor.HALF_Z * 2);
    const { floorMat, wallMat, fallbackMat } = createMaterials(
      this.scene,
      surface,
      uMul,
      vMul,
    );
    if (this.floorMesh) {
      this.floorMesh.material = floorMat;
    }
    if (this.groundMesh) {
      this.groundMesh.material = fallbackMat;
    }
    for (const wall of this.wallMeshes) {
      wall.material = wallMat;
    }
  }
}

/**
 * 材质生成器
 * @param uMul / vMul 相对默认 40m 场地的 UV 缩放（保持每格世界米数不变）
 */
function createMaterials(
  scene: Scene,
  surface: FloorSurface,
  uMul = 1,
  vMul = 1,
): {
  floorMat: StandardMaterial;
  wallMat: StandardMaterial;
  fallbackMat: StandardMaterial;
} {
  const preset =
    FLOOR_SURFACE_PRESETS.find((p) => p.id === surface) ||
    FLOOR_SURFACE_PRESETS[0];
  const uScale = preset.uScale * uMul;
  const vScale = preset.vScale * vMul;

  const wallMat = createWallMaterialForSurface(surface, scene);

  if (surface === 'tiles') {
    const floorMat = new StandardMaterial('floorMat_tiles', scene);
    const diffuse = new Texture(
      `${OFFICIAL_TEX_BASE}albedo.png`,
      scene,
      false,
      true,
      Texture.TRILINEAR_SAMPLINGMODE,
    );
    diffuse.uScale = uScale;
    diffuse.vScale = vScale;
    diffuse.wrapU = Texture.WRAP_ADDRESSMODE;
    diffuse.wrapV = Texture.WRAP_ADDRESSMODE;
    floorMat.diffuseTexture = diffuse;
    floorMat.diffuseColor = Color3.White();
    floorMat.specularColor = new Color3(0.15, 0.15, 0.16);
    floorMat.specularPower = 32;
    floorMat.ambientColor = new Color3(0.35, 0.35, 0.38);

    const fallbackMat = mat(scene, 'fallbackMat_tiles', 0x1a1b1e);
    return { floorMat, wallMat, fallbackMat };
  }

  if (surface === 'dirtGrass') {
    const floorMat = new StandardMaterial('floorMat_dirtGrass', scene);
    const tex = bakeDirtGrassTexture(scene, 512);
    tex.uScale = uScale;
    tex.vScale = vScale;
    floorMat.diffuseTexture = tex;
    floorMat.diffuseColor = Color3.White();
    floorMat.specularColor = Color3.Black();
    floorMat.ambientColor = new Color3(0.35, 0.38, 0.3);

    const fallbackMat = mat(scene, 'fallbackMat_dirtGrass', 0x2c241c);
    return { floorMat, wallMat, fallbackMat };
  }

  if (surface === 'cyberGrid') {
    const floorMat = new StandardMaterial('floorMat_cyberGrid', scene);
    const tex = bakeCyberGridTexture(scene, 512);
    tex.uScale = uScale;
    tex.vScale = vScale;
    floorMat.diffuseTexture = tex;
    // 微弱自发光，不再全量使用亮纹理做 emissiveTexture，避免夺目刺眼
    floorMat.emissiveColor = new Color3(0.06, 0.08, 0.12);
    floorMat.diffuseColor = new Color3(0.65, 0.65, 0.7);
    floorMat.specularColor = new Color3(0.1, 0.15, 0.25);

    const fallbackMat = mat(scene, 'fallbackMat_cyberGrid', 0x06030c);
    return { floorMat, wallMat, fallbackMat };
  }

  if (surface === 'checker') {
    const floorMat = new StandardMaterial('floorMat_checker', scene);
    const tex = bakeCheckerTexture(scene, 512);
    tex.uScale = uScale;
    tex.vScale = vScale;
    floorMat.diffuseTexture = tex;
    floorMat.diffuseColor = Color3.White();
    floorMat.specularColor = new Color3(0.2, 0.2, 0.2);

    const fallbackMat = mat(scene, 'fallbackMat_checker', 0x111215);
    return { floorMat, wallMat, fallbackMat };
  }

  if (surface === 'cobblestone') {
    const floorMat = new StandardMaterial('floorMat_cobblestone', scene);
    const tex = bakeCobblestoneTexture(scene, 512);
    tex.uScale = uScale;
    tex.vScale = vScale;
    floorMat.diffuseTexture = tex;
    floorMat.diffuseColor = Color3.White();
    floorMat.specularColor = new Color3(0.1, 0.1, 0.1);

    const fallbackMat = mat(scene, 'fallbackMat_cobblestone', 0x1c1917);
    return { floorMat, wallMat, fallbackMat };
  }

  if (surface === 'sand') {
    const floorMat = new StandardMaterial('floorMat_sand', scene);
    const tex = bakeSandTexture(scene, 512);
    tex.uScale = uScale;
    tex.vScale = vScale;
    floorMat.diffuseTexture = tex;
    floorMat.diffuseColor = Color3.White();
    floorMat.specularColor = Color3.Black();

    const fallbackMat = mat(scene, 'fallbackMat_sand', 0x3d2f1d);
    return { floorMat, wallMat, fallbackMat };
  }

  if (surface === 'marble') {
    const floorMat = new StandardMaterial('floorMat_marble', scene);
    const tex = bakeMarbleTexture(scene, 512);
    tex.uScale = uScale;
    tex.vScale = vScale;
    floorMat.diffuseTexture = tex;
    floorMat.diffuseColor = Color3.White();
    floorMat.specularColor = new Color3(0.4, 0.4, 0.45);
    floorMat.specularPower = 64;

    const fallbackMat = mat(scene, 'fallbackMat_marble', 0x212328);
    return { floorMat, wallMat, fallbackMat };
  }

  if (surface === 'woodPlanks') {
    const floorMat = new StandardMaterial('floorMat_woodPlanks', scene);
    const tex = bakeWoodPlanksTexture(scene, 512);
    tex.uScale = uScale;
    tex.vScale = vScale;
    floorMat.diffuseTexture = tex;
    floorMat.diffuseColor = Color3.White();
    floorMat.specularColor = new Color3(0.15, 0.1, 0.05);

    const fallbackMat = mat(scene, 'fallbackMat_woodPlanks', 0x24160c);
    return { floorMat, wallMat, fallbackMat };
  }

  // default 'dark'
  const floorMat = mat(scene, 'floorMat_dark', 0x1b1d20);
  floorMat.specularColor = new Color3(0.2, 0.2, 0.22);
  const fallbackMat = mat(scene, 'fallbackMat_dark', 0x101114);
  return { floorMat, wallMat, fallbackMat };
}

/**
 * 沿折线生成等宽梯形墙。
 * 不用 ExtrudeShape：闭合矩形只在拐角取样时，Path3D 会把切线取成 45° 平分线，
 * 整段墙的水平宽度会被插值拉歪（南北/东西看起来不一样宽）。
 * 这里对每个顶点做法线偏移（直角用 miter），保证垂直于墙身的底宽/顶宽处处相等。
 */
function createTrapezoidExtrudedWall(
  name: string,
  options: {
    path: Vector3[];
    bottomWidth?: number;
    topWidth?: number;
    height?: number;
    close?: boolean;
  },
  scene: Scene,
): Mesh {
  const bottomW = options.bottomWidth ?? 0.8;
  const topW = options.topWidth ?? 0.4;
  const h = options.height ?? Floor.WALL_HEIGHT;
  const closed = options.close ?? true;
  const y0 = 0.01;

  const verts = unwrapPath(options.path, closed);
  if (verts.length < 2) {
    return MeshBuilder.CreateBox(name, { size: 0.01 }, scene);
  }

  const innerBot: Vector3[] = [];
  const innerTop: Vector3[] = [];
  const outerTop: Vector3[] = [];
  const outerBot: Vector3[] = [];

  for (let i = 0; i < verts.length; i++) {
    const p = verts[i]!;
    const inward = pathVertexInward(verts, i, closed);
    innerBot.push(
      new Vector3(p.x + inward.x * (bottomW / 2), y0, p.z + inward.z * (bottomW / 2)),
    );
    innerTop.push(
      new Vector3(p.x + inward.x * (topW / 2), h, p.z + inward.z * (topW / 2)),
    );
    outerTop.push(
      new Vector3(p.x - inward.x * (topW / 2), h, p.z - inward.z * (topW / 2)),
    );
    outerBot.push(
      new Vector3(p.x - inward.x * (bottomW / 2), y0, p.z - inward.z * (bottomW / 2)),
    );
  }

  const rings = [innerBot, innerTop, outerTop, outerBot];
  const ringLen = innerBot.length;
  const positions: number[] = [];
  const indices: number[] = [];

  for (const ring of rings) {
    for (const v of ring) {
      positions.push(v.x, v.y, v.z);
    }
  }

  const ringIndex = (r: number, i: number) => r * ringLen + i;
  const quad = (a: number, b: number, c: number, d: number) => {
    indices.push(a, b, c, a, c, d);
  };

  const segs = closed ? ringLen : ringLen - 1;
  for (let i = 0; i < segs; i++) {
    const j = closed ? (i + 1) % ringLen : i + 1;
    for (let r = 0; r < rings.length; r++) {
      const r2 = (r + 1) % rings.length;
      quad(ringIndex(r, i), ringIndex(r, j), ringIndex(r2, j), ringIndex(r2, i));
    }
  }

  if (!closed) {
    quad(ringIndex(0, 0), ringIndex(1, 0), ringIndex(2, 0), ringIndex(3, 0));
    const e = ringLen - 1;
    quad(ringIndex(0, e), ringIndex(3, e), ringIndex(2, e), ringIndex(1, e));
  }

  const normals = new Array<number>(positions.length).fill(0);
  VertexData.ComputeNormals(positions, indices, normals);

  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.indices = indices;
  vertexData.normals = normals;

  const wallMesh = new Mesh(name, scene);
  vertexData.applyToMesh(wallMesh);
  wallMesh.convertToFlatShadedMesh();
  wallMesh.isPickable = true;
  return wallMesh;
}

/** 去掉闭合路径末尾重复的起点。 */
function unwrapPath(path: Vector3[], closed: boolean): Vector3[] {
  if (
    closed &&
    path.length > 1 &&
    path[0] &&
    path[path.length - 1] &&
    Vector3.DistanceSquared(path[0], path[path.length - 1]!) < 1e-8
  ) {
    return path.slice(0, -1);
  }
  return path.slice();
}

/** XZ 平面上垂直于折线的内向单位偏移（拐角按 miter，端点按段法线）。 */
function pathVertexInward(verts: Vector3[], i: number, closed: boolean): Vector3 {
  const n = verts.length;
  const p = verts[i]!;
  const prev = closed ? verts[(i - 1 + n) % n]! : verts[i - 1];
  const next = closed ? verts[(i + 1) % n]! : verts[i + 1];

  const horiz = (from: Vector3, to: Vector3): Vector3 | null => {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return null;
    return new Vector3(dx / len, 0, dz / len);
  };

  // 左法线（Y 向上时指向路径左侧）
  const leftOf = (dir: Vector3) => new Vector3(-dir.z, 0, dir.x);

  const dirIn = prev ? horiz(prev, p) : null;
  const dirOut = next ? horiz(p, next) : null;

  if (dirIn && dirOut) {
    const n0 = leftOf(dirIn);
    const n1 = leftOf(dirOut);
    const bis = n0.add(n1);
    const bl = bis.length();
    if (bl > 1e-6) {
      bis.scaleInPlace(1 / bl);
      const denom = Vector3.Dot(bis, n1);
      const miter = Math.abs(denom) < 1e-4 ? 1 : 1 / denom;
      // 限制极尖角，避免 miter 爆炸
      const clamped = Math.min(Math.abs(miter), 4) * Math.sign(miter || 1);
      return bis.scale(clamped);
    }
    return n1;
  }
  if (dirOut) return leftOf(dirOut);
  if (dirIn) return leftOf(dirIn);
  return new Vector3(1, 0, 0);
}





/**
 * 根据当前地板 Presets 样式匹配纯色深色系围墙材质（无贴图，色调与地板主题呼应，依赖 Flat Shading 折光）
 */
function createWallMaterialForSurface(
  surface: FloorSurface,
  scene: Scene,
): StandardMaterial {
  const matName = `wallMat_${surface}`;
  const existing = scene.getMaterialByName(matName);
  if (existing && existing instanceof StandardMaterial) {
    return existing;
  }

  const wallMat = new StandardMaterial(matName, scene);
  wallMat.diffuseTexture = null;

  switch (surface) {
    case 'tiles':
      wallMat.diffuseColor = new Color3(0.18, 0.21, 0.25);
      wallMat.specularColor = new Color3(0.35, 0.40, 0.45);
      wallMat.emissiveColor = new Color3(0.04, 0.05, 0.06);
      break;
    case 'dirtGrass':
      wallMat.diffuseColor = new Color3(0.16, 0.22, 0.15);
      wallMat.specularColor = new Color3(0.28, 0.35, 0.25);
      wallMat.emissiveColor = new Color3(0.03, 0.05, 0.03);
      break;
    case 'cyberGrid':
      wallMat.diffuseColor = new Color3(0.14, 0.18, 0.28);
      wallMat.specularColor = new Color3(0.35, 0.45, 0.65);
      wallMat.emissiveColor = new Color3(0.04, 0.06, 0.10);
      break;
    case 'checker':
      wallMat.diffuseColor = new Color3(0.18, 0.18, 0.22);
      wallMat.specularColor = new Color3(0.35, 0.35, 0.40);
      wallMat.emissiveColor = new Color3(0.04, 0.04, 0.05);
      break;
    case 'cobblestone':
      wallMat.diffuseColor = new Color3(0.22, 0.18, 0.15);
      wallMat.specularColor = new Color3(0.35, 0.30, 0.25);
      wallMat.emissiveColor = new Color3(0.05, 0.04, 0.03);
      break;
    case 'sand':
      wallMat.diffuseColor = new Color3(0.25, 0.20, 0.15);
      wallMat.specularColor = new Color3(0.40, 0.32, 0.24);
      wallMat.emissiveColor = new Color3(0.06, 0.04, 0.03);
      break;
    case 'marble':
      wallMat.diffuseColor = new Color3(0.22, 0.24, 0.28);
      wallMat.specularColor = new Color3(0.45, 0.48, 0.52);
      wallMat.emissiveColor = new Color3(0.05, 0.06, 0.07);
      break;
    case 'woodPlanks':
      wallMat.diffuseColor = new Color3(0.22, 0.15, 0.10);
      wallMat.specularColor = new Color3(0.35, 0.25, 0.18);
      wallMat.emissiveColor = new Color3(0.05, 0.03, 0.02);
      break;
    default:
    case 'dark':
      wallMat.diffuseColor = new Color3(0.16, 0.17, 0.20);
      wallMat.specularColor = new Color3(0.30, 0.32, 0.38);
      wallMat.emissiveColor = new Color3(0.04, 0.04, 0.05);
      break;
  }

  wallMat.specularPower = 32;
  wallMat.backFaceCulling = false;
  return wallMat;
}

/** 1. 泥土 + 草皮贴图 */
function bakeDirtGrassTexture(scene: Scene, size: number): DynamicTexture {
  const tex = new DynamicTexture(
    'dirtGrassTex',
    { width: size, height: size },
    scene,
    false,
  );
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;

  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const img = ctx.createImageData(size, size);
  const data = img.data;

  const seed = 42;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;

      const patch = fbm(u * 4.2, v * 4.2, seed);
      const mid = fbm(u * 11 + 3.1, v * 11 - 1.7, seed + 17);
      const grain = hash2(x * 0.37 + seed, y * 0.41 + seed * 1.3);

      const grassT = smoothstep(0.38, 0.62, patch);
      const bald = smoothstep(0.72, 0.88, fbm(u * 9.5 + 8, v * 9.5, seed + 3));
      const grass = grassT * (1 - bald * 0.85);

      const dr = 0.42 + mid * 0.1;
      const dg = 0.3 + mid * 0.08;
      const db = 0.18 + mid * 0.05;

      const gr = 0.28 + mid * 0.06;
      const gg = 0.42 + mid * 0.1;
      const gb = 0.2 + mid * 0.04;

      let r = dr + (gr - dr) * grass;
      let g = dg + (gg - dg) * grass;
      let b = db + (gb - db) * grass;

      const gAmt = (grain - 0.5) * 0.07;
      r = clamp01(r + gAmt);
      g = clamp01(g + gAmt * 0.9);
      b = clamp01(b + gAmt * 0.7);

      const i = (y * size + x) * 4;
      data[i] = (r * 255) | 0;
      data[i + 1] = (g * 255) | 0;
      data[i + 2] = (b * 255) | 0;
      data[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  tex.update(false);
  return tex;
}

/** 2. 赛博青紫发光网格贴图（1m 网格尺寸，与坐标轴 1m 刻度精确对齐） */
function bakeCyberGridTexture(scene: Scene, size: number): DynamicTexture {
  const tex = new DynamicTexture(
    'cyberGridTex',
    { width: size, height: size },
    scene,
    false,
  );
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;

  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  // 深紫黑背景
  ctx.fillStyle = '#06040c';
  ctx.fillRect(0, 0, size, size);

  // 每张贴图覆盖 5m x 5m，划分 5x5 个 1m x 1m 网格（40m 场地平铺 8x8，刚好过整米坐标）
  const gridMeters = 5;
  const step = size / gridMeters;

  // 1. 1m 细微暗青色网格线
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = 'rgba(0, 160, 200, 0.18)';

  for (let i = 0; i <= gridMeters; i++) {
    const pos = i * step;
    ctx.beginPath();
    ctx.moveTo(pos, 0);
    ctx.lineTo(pos, size);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, pos);
    ctx.lineTo(size, pos);
    ctx.stroke();
  }

  // 2. 5m 主沉稳紫框
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = 'rgba(120, 30, 140, 0.25)';
  ctx.strokeRect(0, 0, size, size);

  // 3. 1m 节点微弱发光圈与 5m 主节点
  for (let x = 0; x <= gridMeters; x++) {
    for (let y = 0; y <= gridMeters; y++) {
      const px = x * step;
      const py = y * step;
      const isMajor = x % 5 === 0 && y % 5 === 0;

      ctx.fillStyle = isMajor
        ? 'rgba(0, 230, 255, 0.45)'
        : 'rgba(0, 180, 210, 0.22)';
      ctx.beginPath();
      ctx.arc(px, py, isMajor ? 2.8 : 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  tex.update(false);
  return tex;
}

/** 3. 经典黑白大理石棋盘格 */
function bakeCheckerTexture(scene: Scene, size: number): DynamicTexture {
  const tex = new DynamicTexture(
    'checkerTex',
    { width: size, height: size },
    scene,
    false,
  );
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;

  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const grid = 4;
  const tileSize = size / grid;

  for (let r = 0; r < grid; r++) {
    for (let c = 0; c < grid; c++) {
      const isWhite = (r + c) % 2 === 0;
      const x = c * tileSize;
      const y = r * tileSize;

      ctx.fillStyle = isWhite ? '#e8ecef' : '#22262a';
      ctx.fillRect(x, y, tileSize, tileSize);

      // 内沉降线
      ctx.strokeStyle = isWhite ? '#cbd2d9' : '#141618';
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 2, y + 2, tileSize - 4, tileSize - 4);
    }
  }

  tex.update(false);
  return tex;
}

/** 4. 铺面鹅卵石/石板纹理 */
function bakeCobblestoneTexture(scene: Scene, size: number): DynamicTexture {
  const tex = new DynamicTexture(
    'cobblestoneTex',
    { width: size, height: size },
    scene,
    false,
  );
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;

  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.fillStyle = '#23201d';
  ctx.fillRect(0, 0, size, size);

  // 画鹅卵石石块
  const cols = 6;
  const rows = 6;
  const cellW = size / cols;
  const cellH = size / rows;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const offsetX = (hash2(r, c) - 0.5) * 8;
      const offsetY = (hash2(c, r) - 0.5) * 8;
      const x = c * cellW + cellW / 2 + offsetX;
      const y = r * cellH + cellH / 2 + offsetY;
      const rx = cellW * 0.38;
      const ry = cellH * 0.38;

      const shade = Math.floor(100 + hash2(r * 13, c * 17) * 80);
      ctx.fillStyle = `rgb(${shade}, ${shade - 10}, ${shade - 20})`;

      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, hash2(r, c) * Math.PI, 0, Math.PI * 2);
      ctx.fill();

      // 石块高光边框
      ctx.strokeStyle = `rgba(255, 255, 255, 0.15)`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  tex.update(false);
  return tex;
}

/** 5. 风吹金沙丘波纹 */
function bakeSandTexture(scene: Scene, size: number): DynamicTexture {
  const tex = new DynamicTexture(
    'sandTex',
    { width: size, height: size },
    scene,
    false,
  );
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;

  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const img = ctx.createImageData(size, size);
  const data = img.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;

      const wave = Math.sin(u * 20 + fbm(u * 5, v * 5, 100) * 4) * 0.5 + 0.5;
      const noise = hash2(x * 0.1, y * 0.1) * 0.08;

      const r = 0.85 + wave * 0.1 + noise;
      const g = 0.68 + wave * 0.08 + noise;
      const b = 0.38 + wave * 0.05 + noise;

      const i = (y * size + x) * 4;
      data[i] = (clamp01(r) * 255) | 0;
      data[i + 1] = (clamp01(g) * 255) | 0;
      data[i + 2] = (clamp01(b) * 255) | 0;
      data[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  tex.update(false);
  return tex;
}

/** 6. 优雅白色大理石流纹 */
function bakeMarbleTexture(scene: Scene, size: number): DynamicTexture {
  const tex = new DynamicTexture(
    'marbleTex',
    { width: size, height: size },
    scene,
    false,
  );
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;

  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const img = ctx.createImageData(size, size);
  const data = img.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;

      const n = fbm(u * 6, v * 6, 88);
      const vein = Math.sin((u + v + n * 1.5) * Math.PI * 6);
      const intensity = Math.abs(vein);

      const baseR = 0.92;
      const baseG = 0.94;
      const baseB = 0.96;

      const darkR = 0.35;
      const darkG = 0.38;
      const darkB = 0.42;

      const t = Math.pow(1 - intensity, 3);
      const r = baseR - (baseR - darkR) * t;
      const g = baseG - (baseG - darkG) * t;
      const b = baseB - (baseB - darkB) * t;

      const i = (y * size + x) * 4;
      data[i] = (clamp01(r) * 255) | 0;
      data[i + 1] = (clamp01(g) * 255) | 0;
      data[i + 2] = (clamp01(b) * 255) | 0;
      data[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  tex.update(false);
  return tex;
}

/** 7. 暖色拼接木地板 */
function bakeWoodPlanksTexture(scene: Scene, size: number): DynamicTexture {
  const tex = new DynamicTexture(
    'woodPlanksTex',
    { width: size, height: size },
    scene,
    false,
  );
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;

  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const planks = 8;
  const plankH = size / planks;

  for (let p = 0; p < planks; p++) {
    const y = p * plankH;
    const woodTone = 120 + Math.floor(hash2(p, 1) * 40);
    ctx.fillStyle = `rgb(${woodTone + 40}, ${woodTone}, ${woodTone - 40})`;
    ctx.fillRect(0, y, size, plankH);

    // 细木纹
    ctx.strokeStyle = `rgba(50, 20, 5, 0.15)`;
    ctx.lineWidth = 1;
    for (let l = 0; l < 4; l++) {
      ctx.beginPath();
      ctx.moveTo(0, y + (l * plankH) / 4);
      ctx.bezierCurveTo(
        size * 0.3,
        y + (l * plankH) / 4 + 4,
        size * 0.7,
        y + (l * plankH) / 4 - 4,
        size,
        y + (l * plankH) / 4,
      );
      ctx.stroke();
    }

    // 板缝缝隙
    ctx.strokeStyle = '#1b0d05';
    ctx.lineWidth = 3;
    ctx.strokeRect(0, y, size, plankH);
  }

  tex.update(false);
  return tex;
}

// 辅助 math 函数
function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);

  const a = hash2(x0 + seed * 0.11, y0 + seed * 0.17);
  const b = hash2(x0 + 1 + seed * 0.11, y0 + seed * 0.17);
  const c = hash2(x0 + seed * 0.11, y0 + 1 + seed * 0.17);
  const d = hash2(x0 + 1 + seed * 0.11, y0 + 1 + seed * 0.17);

  const ab = a + (b - a) * ux;
  const cd = c + (d - c) * ux;
  return ab + (cd - ab) * uy;
}

function fbm(x: number, y: number, seed: number): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < 4; i++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + i * 19);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

function mat(scene: Scene, name: string, hex: number): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = colorFromHex(hex);
  m.specularColor = Color3.Black();
  return m;
}

function colorFromHex(hex: number): Color3 {
  return new Color3(
    ((hex >> 16) & 0xff) / 255,
    ((hex >> 8) & 0xff) / 255,
    (hex & 0xff) / 255,
  );
}
