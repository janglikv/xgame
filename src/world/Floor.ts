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
  | 'hubGrid'
  | 'flameGrid'
  | 'cyberGrid'
  | 'tiles'
  | 'dirtGrass'
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
    id: 'hubGrid',
    name: '静谧暖木大厅',
    englishName: 'Cozy Haven',
    description: '温润拼接胡桃木与静谧暖金微光',
    uScale: 8,
    vScale: 8,
  },
  {
    id: 'flameGrid',
    name: '烈焰熔岩裂隙',
    englishName: 'Inferno Core',
    description: '焦黑玄武岩与流淌炽热火光的熔岩地表',
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
   * 是否在场地中心 (0,0) 或指定偏移位置生成方形围墙（指定边长米数，如 3 表示 3×3 米围墙）。
   */
  centerWallSize?: number;
  /**
   * 方形围墙中心偏移坐标（默认 { x: 0, z: 0 }）。
   */
  centerWallOffset?: { x: number; z: number };
  /**
   * 是否在四角生成 L 型梯形围墙（路径见 {@link Floor.L_WALL_CORNER_PATHS}）。
   */
  addLWall?: boolean;
  /**
   * 是否用朝屏幕下方（+X，固定镜头所在一侧）开口的方围把传送阵围起来。
   */
  addPadCoverWall?: boolean;
  /**
   * 沿边切除米数：切去固定俯视下屏幕左右两角（TL / BR），正方形变成六边形。
   * 0 或不设则保持矩形外墙。
   */
  hexagonCut?: number;
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
  /**
   * 四角围墙路径（1 格 = 1 米）：在 14×14 正方形场地的 4 个角落靠近外边沿处，距离边墙 2 格（5 米处），形成网格对齐的 1 米臂长 L 型掩体。
   */
  static readonly L_WALL_CORNER_PATHS = [
    { name: 'BR', path: [new Vector3(4, 0, -5), new Vector3(5, 0, -5), new Vector3(5, 0, -4)] },
    { name: 'TR', path: [new Vector3(4, 0, 5), new Vector3(5, 0, 5), new Vector3(5, 0, 4)] },
    { name: 'TL', path: [new Vector3(-4, 0, 5), new Vector3(-5, 0, 5), new Vector3(-5, 0, 4)] },
    { name: 'BL', path: [new Vector3(-4, 0, -5), new Vector3(-5, 0, -5), new Vector3(-5, 0, -4)] },
  ];

  /**
   * 可玩区外轮廓顶点（不含闭合重复点）。
   * hexagonCut > 0 时切去屏幕左右两角，矩形变为六边形。
   */
  static playableOutline(
    minX: number,
    maxX: number,
    minZ: number,
    maxZ: number,
    hexagonCut = 0,
  ): Vector3[] {
    if (hexagonCut > 0) {
      const cut = Math.min(hexagonCut, maxX - minX, maxZ - minZ);
      return [
        new Vector3(minX, 0, minZ),
        new Vector3(maxX - cut, 0, minZ),
        new Vector3(maxX, 0, minZ + cut),
        new Vector3(maxX, 0, maxZ),
        new Vector3(minX + cut, 0, maxZ),
        new Vector3(minX, 0, maxZ - cut),
      ];
    }
    return [
      new Vector3(minX, 0, minZ),
      new Vector3(maxX, 0, minZ),
      new Vector3(maxX, 0, maxZ),
      new Vector3(minX, 0, maxZ),
    ];
  }

  /**
   * 外围墙中心线（闭合，末点重复起点）。墙体内侧贴齐可玩边界。
   */
  static outerWallCenterPath(
    minX: number,
    maxX: number,
    minZ: number,
    maxZ: number,
    thickness: number,
    hexagonCut = 0,
  ): Vector3[] {
    const inner = Floor.playableOutline(minX, maxX, minZ, maxZ, hexagonCut);
    const dist = thickness / 2;
    const n = inner.length;
    const center: Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const prev = inner[(i - 1 + n) % n]!;
      const curr = inner[i]!;
      const next = inner[(i + 1) % n]!;
      const e1x = curr.x - prev.x;
      const e1z = curr.z - prev.z;
      const e2x = next.x - curr.x;
      const e2z = next.z - curr.z;
      const l1 = Math.hypot(e1x, e1z) || 1;
      const l2 = Math.hypot(e2x, e2z) || 1;
      // 外法线：CCW 路径右侧 (dx, dz) → (dz, -dx)
      const n1x = e1z / l1;
      const n1z = -e1x / l1;
      const n2x = e2z / l2;
      const n2z = -e2x / l2;
      let mx = n1x + n2x;
      let mz = n1z + n2z;
      const ml = Math.hypot(mx, mz) || 1;
      mx /= ml;
      mz /= ml;
      const denom = mx * n1x + mz * n1z;
      const miter = Math.abs(denom) < 1e-4 ? 1 : 1 / denom;
      const clamped = Math.min(Math.abs(miter), 4) * Math.sign(miter || 1);
      center.push(
        new Vector3(
          curr.x + mx * dist * clamped,
          0,
          curr.z + mz * dist * clamped,
        ),
      );
    }
    center.push(center[0]!.clone());
    return center;
  }

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
    _shadowGenerator?: ShadowGenerator,
    options: FloorOptions = {},
  ) {
    this.scene = scene;
    this.root = new TransformNode('Floor', scene);
    this.currentSurface = options.surface ?? 'cyberGrid';
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

    // 单条首尾闭合路径：矩形或六边形外墙，梯形截面 Extrude
    const loopPath = Floor.outerWallCenterPath(
      minX,
      maxX,
      minZ,
      maxZ,
      t,
      options.hexagonCut ?? 0,
    );

    const wall = createTrapezoidExtrudedWall(
      'RenderWall_ClosedLoop',
      { path: loopPath, bottomWidth: t, topWidth: 0.5, height: h, close: true },
      scene,
    );
    wall.receiveShadows = false;
    wall.parent = this.root;
    this.wallMeshes.push(wall);

    // 中心/指定位置方形围墙（闭合梯形围墙）
    if (options.centerWallSize && options.centerWallSize > 0) {
      const cHalf = options.centerWallSize / 2;
      const ox = options.centerWallOffset?.x ?? 0;
      const oz = options.centerWallOffset?.z ?? 0;
      const centerLoopPath = [
        new Vector3(ox - cHalf, 0, oz - cHalf),
        new Vector3(ox + cHalf, 0, oz - cHalf),
        new Vector3(ox + cHalf, 0, oz + cHalf),
        new Vector3(ox - cHalf, 0, oz + cHalf),
        new Vector3(ox - cHalf, 0, oz - cHalf),
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
      centerWall.receiveShadows = false;
      centerWall.parent = this.root;
      this.wallMeshes.push(centerWall);
    }

    // 四角 L 型围墙（位于左上、右上、左下、右下四个象限，单条平滑管道）
    if (options.addLWall) {
      for (const config of Floor.L_WALL_CORNER_PATHS) {
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
        lWall.receiveShadows = false;
        lWall.parent = this.root;
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
      padCover.receiveShadows = false;
      padCover.parent = this.root;
      this.wallMeshes.push(padCover);
    }

    // 初始化应用当前 Surface
    this.applySurface(this.currentSurface);
    this.floorMesh?.freezeWorldMatrix();
    this.groundMesh?.freezeWorldMatrix();
    for (const wall of this.wallMeshes) {
      wall.freezeWorldMatrix();
    }
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

  if (surface === 'hubGrid') {
    const floorMat = new StandardMaterial('floorMat_hubGrid', scene);
    const tex = bakeHubGridTexture(scene, 512);
    tex.uScale = uScale;
    tex.vScale = vScale;
    floorMat.diffuseTexture = tex;
    // 温馨柔和的温润漫反射与微弱暖金环境光
    floorMat.emissiveColor = new Color3(0.06, 0.04, 0.02);
    floorMat.diffuseColor = new Color3(0.95, 0.90, 0.84);
    floorMat.specularColor = new Color3(0.12, 0.09, 0.06);
    floorMat.specularPower = 24;

    const fallbackMat = mat(scene, 'fallbackMat_hubGrid', 0x140e0a);
    return { floorMat, wallMat, fallbackMat };
  }

  if (surface === 'flameGrid') {
    const floorMat = new StandardMaterial('floorMat_flameGrid', scene);
    const tex = bakeFlameGridTexture(scene, 512);
    tex.uScale = uScale;
    tex.vScale = vScale;
    floorMat.diffuseTexture = tex;

    // 增加重钢装甲高精度噪声法线贴图（倒角切面 + 螺栓浮雕 + 金属研磨微观拉丝噪点）
    const normalTex = bakeFlameGridNormalTexture(scene, 512);
    normalTex.uScale = uScale;
    normalTex.vScale = vScale;
    floorMat.bumpTexture = normalTex;
    floorMat.bumpTexture.level = 0.45;

    // 参考围墙红褐玄武岩色系的暗调红褐重钢装甲（深度压低漫反射，消除过曝发亮，深沉暗黑）
    floorMat.diffuseColor = new Color3(0.36, 0.26, 0.21);
    floorMat.specularColor = new Color3(0.20, 0.12, 0.08);
    floorMat.specularPower = 48;
    floorMat.emissiveColor = new Color3(0.012, 0.006, 0.003);

    const fallbackMat = mat(scene, 'fallbackMat_flameGrid', 0x120805);
    return { floorMat, wallMat, fallbackMat };
  }

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

  const rawVerts = unwrapPath(options.path, closed);
  if (rawVerts.length < 2) {
    return MeshBuilder.CreateBox(name, { size: 0.01 }, scene);
  }

  // 闭合时追加起点以单调递增展开 UV，避免末段拉伸
  const verts = closed ? [...rawVerts, rawVerts[0]!] : rawVerts;
  const ringLen = verts.length;

  // 沿折线计算累积弧长（米数）
  const arcLengths: number[] = [0];
  for (let i = 1; i < ringLen; i++) {
    const d = Vector3.Distance(verts[i - 1]!, verts[i]!);
    arcLengths.push(arcLengths[i - 1]! + d);
  }

  const innerBot: Vector3[] = [];
  const innerTop: Vector3[] = [];
  const outerTop: Vector3[] = [];
  const outerBot: Vector3[] = [];

  for (let i = 0; i < ringLen; i++) {
    const p = verts[i]!;
    const inward = pathVertexInward(rawVerts, i % rawVerts.length, closed);
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
  const vCoords = [0.0, 0.35, 0.65, 1.0];
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r]!;
    const v = vCoords[r]!;
    for (let i = 0; i < ringLen; i++) {
      const vert = ring[i]!;
      positions.push(vert.x, vert.y, vert.z);
      uvs.push(arcLengths[i]!, v);
    }
  }

  const ringIndex = (r: number, i: number) => r * ringLen + i;
  const quad = (a: number, b: number, c: number, d: number) => {
    indices.push(a, b, c, a, c, d);
  };

  const segs = ringLen - 1;
  for (let i = 0; i < segs; i++) {
    const j = i + 1;
    for (let r = 0; r < rings.length; r++) {
      const r2 = (r + 1) % rings.length;
      quad(ringIndex(r, i), ringIndex(r, j), ringIndex(r2, j), ringIndex(r2, i));
    }
  }

  if (!closed) {
    // 为开口围墙两端的切面（End Caps）生成独立顶点，UV 映射到无缝纯暗岩区（u=0.25），彻底消除切面上的亮橙发光缝
    const baseIdx0 = positions.length / 3;
    const p0 = [innerBot[0]!, innerTop[0]!, outerTop[0]!, outerBot[0]!];
    for (const p of p0) {
      positions.push(p.x, p.y, p.z);
    }
    uvs.push(0.25, 0.05, 0.25, 0.30, 0.35, 0.30, 0.35, 0.05);
    quad(baseIdx0 + 0, baseIdx0 + 1, baseIdx0 + 2, baseIdx0 + 3);

    const baseIdx1 = positions.length / 3;
    const e = ringLen - 1;
    const pe = [innerBot[e]!, outerBot[e]!, outerTop[e]!, innerTop[e]!];
    for (const p of pe) {
      positions.push(p.x, p.y, p.z);
    }
    uvs.push(0.25, 0.05, 0.35, 0.05, 0.35, 0.30, 0.25, 0.30);
    quad(baseIdx1 + 0, baseIdx1 + 1, baseIdx1 + 2, baseIdx1 + 3);
  }

  const normals = new Array<number>(positions.length).fill(0);
  VertexData.ComputeNormals(positions, indices, normals);

  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.indices = indices;
  vertexData.normals = normals;
  vertexData.uvs = uvs;

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





/** 为围墙烘焙每 1 米一段的竖向分割缝与立体转折边缘贴图 */
function bakeWallTexture(surface: FloorSurface, scene: Scene): DynamicTexture {
  const size = 256;
  const tex = new DynamicTexture(
    `wallTex_${surface}`,
    { width: size, height: size },
    scene,
    false,
  );
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;

  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;

  // 1. 根据不同主题底色填充
  let baseColor = '#1e2128';
  let seamGlowColor = 'rgba(255, 255, 255, 0.20)';
  let accentColor = 'rgba(255, 255, 255, 0.5)';

  if (surface === 'hubGrid') {
    // 宁静暖木：温润胡桃木色 + 暖金嵌槽
    baseColor = '#362217';
    seamGlowColor = 'rgba(235, 185, 110, 0.55)';
    accentColor = 'rgba(255, 210, 120, 0.90)';
  } else if (surface === 'flameGrid') {
    // 烈焰熔岩：明朗红褐火山玄武岩 + 炽热金橙熔岩嵌缝
    baseColor = '#4e3026';
    seamGlowColor = 'rgba(255, 100, 30, 0.95)';
    accentColor = 'rgba(255, 220, 90, 1.0)';
  } else if (surface === 'cyberGrid') {
    // 赛博科技：深蓝钛合金 + 青蓝发光缝
    baseColor = '#121c2e';
    seamGlowColor = 'rgba(0, 220, 255, 0.70)';
    accentColor = 'rgba(0, 245, 255, 0.95)';
  }

  // 基础底色
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);

  // 2. 绘制 1m 主分割缝（位于 x=0 与 x=256）与 0.5m 次级分割线（位于 x=128）
  const drawVerticalSeam = (x: number, isMain: boolean) => {
    // 阴影凹槽
    ctx.fillStyle = 'rgba(15, 6, 4, 0.7)';
    const grooveW = isMain ? 5 : 2.5;
    ctx.fillRect(x - grooveW / 2, 0, grooveW, size);

    // 炽亮导光 / 材质嵌线
    ctx.strokeStyle = seamGlowColor;
    ctx.lineWidth = isMain ? 2.2 : 1.1;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size);
    ctx.stroke();

    // 槽左侧受光面倒角高光
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.30)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x - grooveW / 2 - 1, 0);
    ctx.lineTo(x - grooveW / 2 - 1, size);
    ctx.stroke();

    // 槽右侧阴影过渡
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + grooveW / 2 + 1, 0);
    ctx.lineTo(x + grooveW / 2 + 1, size);
    ctx.stroke();

    // 顶面连接处发光晶核（y 处于顶面中心 128）
    if (isMain) {
      ctx.fillStyle = accentColor;
      ctx.beginPath();
      ctx.arc(x, 128, 3.0, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  // 两侧边界主缝（无缝平铺接缝）
  drawVerticalSeam(0, true);
  drawVerticalSeam(size, true);
  // 中间 0.5m 辅助分割槽
  drawVerticalSeam(size / 2, false);

  // 3. 梯形顶面与内外侧坡面的水平转折倒角线（y=89 对应内顶折角，y=166 对应外顶折角）
  // 顶面区域（y: 89 ~ 166）明朗平台走道质感
  ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
  ctx.fillRect(0, 89, size, 77);

  // 水平棱角高光线
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.38)';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(0, 89);
  ctx.lineTo(size, 89);
  ctx.moveTo(0, 166);
  ctx.lineTo(size, 166);
  ctx.stroke();

  // 水平棱角下阴影线
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, 91);
  ctx.lineTo(size, 91);
  ctx.moveTo(0, 168);
  ctx.lineTo(size, 168);
  ctx.stroke();

  tex.update(false);
  return tex;
}

/**
 * 根据当前地板 Presets 样式匹配带有 1 米分割缝的围墙材质
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
  const wallTex = bakeWallTexture(surface, scene);
  wallMat.diffuseTexture = wallTex;
  wallMat.diffuseColor = Color3.White();

  switch (surface) {
    case 'hubGrid':
      wallMat.diffuseColor = new Color3(0.95, 0.90, 0.85);
      wallMat.specularColor = new Color3(0.30, 0.22, 0.16);
      wallMat.emissiveColor = new Color3(0.06, 0.035, 0.02);
      break;
    case 'flameGrid':
      wallMat.diffuseColor = new Color3(1.15, 1.05, 1.0);
      wallMat.specularColor = new Color3(0.60, 0.40, 0.30);
      wallMat.specularPower = 22;
      wallMat.emissiveColor = new Color3(0.28, 0.14, 0.08);
      break;
    case 'tiles':
      wallMat.diffuseColor = new Color3(0.85, 0.88, 0.90);
      wallMat.specularColor = new Color3(0.35, 0.40, 0.45);
      wallMat.emissiveColor = new Color3(0.04, 0.05, 0.06);
      break;
    case 'dirtGrass':
      wallMat.diffuseColor = new Color3(0.85, 0.90, 0.85);
      wallMat.specularColor = new Color3(0.28, 0.35, 0.25);
      wallMat.emissiveColor = new Color3(0.03, 0.05, 0.03);
      break;
    case 'cyberGrid':
      wallMat.diffuseColor = new Color3(0.85, 0.90, 0.98);
      wallMat.specularColor = new Color3(0.40, 0.50, 0.70);
      wallMat.emissiveColor = new Color3(0.06, 0.08, 0.12);
      break;
    case 'checker':
      wallMat.diffuseColor = new Color3(0.88, 0.88, 0.92);
      wallMat.specularColor = new Color3(0.35, 0.35, 0.40);
      wallMat.emissiveColor = new Color3(0.04, 0.04, 0.05);
      break;
    case 'cobblestone':
      wallMat.diffuseColor = new Color3(0.90, 0.85, 0.82);
      wallMat.specularColor = new Color3(0.35, 0.30, 0.25);
      wallMat.emissiveColor = new Color3(0.05, 0.04, 0.03);
      break;
    case 'sand':
      wallMat.diffuseColor = new Color3(0.95, 0.90, 0.85);
      wallMat.specularColor = new Color3(0.40, 0.32, 0.24);
      wallMat.emissiveColor = new Color3(0.06, 0.04, 0.03);
      break;
    case 'marble':
      wallMat.diffuseColor = new Color3(0.90, 0.92, 0.95);
      wallMat.specularColor = new Color3(0.45, 0.48, 0.52);
      wallMat.emissiveColor = new Color3(0.05, 0.06, 0.07);
      break;
    case 'woodPlanks':
      wallMat.diffuseColor = new Color3(0.92, 0.85, 0.80);
      wallMat.specularColor = new Color3(0.35, 0.25, 0.18);
      wallMat.emissiveColor = new Color3(0.05, 0.03, 0.02);
      break;
    default:
    case 'dark':
      wallMat.diffuseColor = new Color3(0.85, 0.85, 0.88);
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

/** 0. 大厅专属温馨宁静暖木静谧地表（温润拼接木纹 + 暖金微光嵌条 + 柔和萤火星芒） */
function bakeHubGridTexture(scene: Scene, size: number): DynamicTexture {
  const tex = new DynamicTexture(
    'hubGridTex',
    { width: size, height: size },
    scene,
    false,
  );
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;

  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;

  // 1. 底层：温润深沉的炭木暖褐基础底色
  const bgGrad = ctx.createRadialGradient(
    size / 2,
    size / 2,
    size * 0.1,
    size / 2,
    size / 2,
    size * 0.7,
  );
  bgGrad.addColorStop(0, '#241b14');
  bgGrad.addColorStop(1, '#150f0b');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, size, size);

  const gridMeters = 5;
  const step = size / gridMeters;
  const slatsPerBlock = 4;
  const slatSize = step / slatsPerBlock;

  // 2. 绘制 1m x 1m 交错拼木（Parquet）木纹与温润木质肌理
  for (let gx = 0; gx < gridMeters; gx++) {
    for (let gy = 0; gy < gridMeters; gy++) {
      const bx = gx * step;
      const by = gy * step;
      const isHorizontal = (gx + gy) % 2 === 0;

      for (let s = 0; s < slatsPerBlock; s++) {
        const sx = isHorizontal ? bx : bx + s * slatSize;
        const sy = isHorizontal ? by + s * slatSize : by;
        const sw = isHorizontal ? step : slatSize;
        const sh = isHorizontal ? slatSize : step;

        // 木条略带随机天然色差（深胡桃木、暖柚木、琥珀木）
        const slatSeed = gx * 13 + gy * 7 + s * 19;
        const toneVar = ((slatSeed % 5) - 2) * 0.035;
        const rBase = Math.floor(36 + toneVar * 80);
        const gBase = Math.floor(27 + toneVar * 60);
        const bBase = Math.floor(20 + toneVar * 40);

        ctx.fillStyle = `rgb(${rBase}, ${gBase}, ${bBase})`;
        ctx.fillRect(sx, sy, sw, sh);

        // 木纹内部渐变与柔和微噪高光
        const woodGrad = isHorizontal
          ? ctx.createLinearGradient(sx, sy, sx + sw, sy)
          : ctx.createLinearGradient(sx, sy, sx, sy + sh);
        woodGrad.addColorStop(0, 'rgba(255, 220, 180, 0.04)');
        woodGrad.addColorStop(0.5, 'rgba(0, 0, 0, 0.0)');
        woodGrad.addColorStop(1, 'rgba(0, 0, 0, 0.08)');
        ctx.fillStyle = woodGrad;
        ctx.fillRect(sx, sy, sw, sh);

        // 柔和微细木纹线条（Organic Grain Lines）
        ctx.strokeStyle = 'rgba(255, 230, 190, 0.03)';
        ctx.lineWidth = 1;
        const grainCount = 3;
        for (let g = 1; g <= grainCount; g++) {
          if (isHorizontal) {
            const gyPos = sy + (sh / (grainCount + 1)) * g;
            ctx.beginPath();
            ctx.moveTo(sx + 2, gyPos);
            ctx.lineTo(sx + sw - 2, gyPos);
            ctx.stroke();
          } else {
            const gxPos = sx + (sw / (grainCount + 1)) * g;
            ctx.beginPath();
            ctx.moveTo(gxPos, sy + 2);
            ctx.lineTo(gxPos, sy + sh - 2);
            ctx.stroke();
          }
        }

        // 木条细缝（Slat Seam）
        ctx.strokeStyle = '#0e0a07';
        ctx.lineWidth = 1.2;
        ctx.strokeRect(sx, sy, sw, sh);
      }

      // 1m 网格边框（柔和暖暗棕）
      ctx.strokeStyle = 'rgba(18, 12, 8, 0.95)';
      ctx.lineWidth = 2.0;
      ctx.strokeRect(bx, by, step, step);

      // 边缘微弱暖木反光倒角
      ctx.strokeStyle = 'rgba(255, 225, 185, 0.05)';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + 1, by + 1, step - 2, step - 2);
    }
  }

  // 3. 温暖雅致的暖金嵌线与星芒节点（Warm Amber Glow & Brass Inlays）
  // 3.1 暖金导光嵌线（细柔暖铜条感）
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = 'rgba(225, 175, 95, 0.35)';
  for (let i = 0; i <= gridMeters; i++) {
    const p = i * step;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }

  // 3.2 节点暖金光晕与静谧星芒
  for (let x = 0; x <= gridMeters; x++) {
    for (let y = 0; y <= gridMeters; y++) {
      const px = x * step;
      const py = y * step;
      const isMajor = x % 5 === 0 && y % 5 === 0;

      // 柔和漫射微光晕（Like soft lantern / warm firefly）
      const glowRad = isMajor ? 10 : 6;
      const glow = ctx.createRadialGradient(px, py, 0, px, py, glowRad);
      glow.addColorStop(
        0,
        isMajor ? 'rgba(255, 200, 90, 0.28)' : 'rgba(255, 190, 80, 0.16)',
      );
      glow.addColorStop(1, 'rgba(255, 170, 60, 0.0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(px, py, glowRad, 0, Math.PI * 2);
      ctx.fill();

      // 中心温润暖金铜饰圆点
      ctx.fillStyle = isMajor
        ? 'rgba(255, 225, 130, 0.95)'
        : 'rgba(240, 190, 95, 0.85)';
      ctx.beginPath();
      ctx.arc(px, py, isMajor ? 2.6 : 1.6, 0, Math.PI * 2);
      ctx.fill();

      // 微妙优雅的四向星芒小触角
      if (isMajor) {
        ctx.strokeStyle = 'rgba(255, 220, 120, 0.65)';
        ctx.lineWidth = 1;
        const arm = 4;
        ctx.beginPath();
        ctx.moveTo(px - arm, py);
        ctx.lineTo(px + arm, py);
        ctx.moveTo(px, py - arm);
        ctx.lineTo(px, py + arm);
        ctx.stroke();
      }
    }
  }

  tex.update(false);
  return tex;
}

/** 1. 第一关专属精密平整红褐重钢装甲甲板（4x4 密集模数 + 纯平冷轧钢板 + 精密微倒角 + 沉头微铆钉 + 反应堆流线） */
function bakeFlameGridTexture(scene: Scene, size: number): DynamicTexture {
  const tex = new DynamicTexture(
    'flameGridTex',
    { width: size, height: size },
    scene,
    false,
  );
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;

  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;

  // 1. 底层：深暗红黑焦炭接缝阴影基底
  ctx.fillStyle = '#140a07';
  ctx.fillRect(0, 0, size, size);

  // 采用 4x4（每块 1.25m x 1.25m）密集精密模块化装甲钢板
  const panelsPerAxis = 4;
  const panelSize = size / panelsPerAxis;

  for (let py = 0; py < panelsPerAxis; py++) {
    for (let px = 0; px < panelsPerAxis; px++) {
      const bx = px * panelSize;
      const by = py * panelSize;
      const pad = 1.0; // 钢板四周极微小机械装甲间隙
      const pw = panelSize - pad * 2;
      const ph = panelSize - pad * 2;

      // 2.1 钢板基底纯平填充（平整纯净，与围墙同系的红褐暗钢）
      const pSeed = px * 17 + py * 31;
      const toneShift = ((pSeed % 3) - 1) * 2;
      const baseR = 46 + toneShift;
      const baseG = 27 + Math.floor(toneShift * 0.6);
      const baseB = 21 + Math.floor(toneShift * 0.5);
      ctx.fillStyle = `rgb(${baseR}, ${baseG}, ${baseB})`;
      ctx.fillRect(bx + pad, by + pad, pw, ph);

      // 2.2 平整均匀的冷轧金属微研磨拉丝（非常微弱平滑，消除凹凸不平感）
      const isHorizontalGrain = (px + py) % 2 === 0;
      const grainLines = 14;
      for (let g = 0; g < grainLines; g++) {
        const seedG = (pSeed * 37 + g * 19) % 1000;
        const gPos = (g / grainLines) * (isHorizontalGrain ? ph : pw);
        const gThickness = 1.0;
        const gAlpha = 0.012 + (seedG % 4) * 0.005;
        ctx.fillStyle = `rgba(255, 205, 175, ${gAlpha})`;
        if (isHorizontalGrain) {
          ctx.fillRect(bx + pad + 1, by + pad + gPos, pw - 2, gThickness);
        } else {
          ctx.fillRect(bx + pad + gPos, by + pad + 1, gThickness, ph - 2);
        }
      }

      // 2.3 极轻微平整漫反射光膜（平整均匀，绝无倾斜高坡）
      ctx.fillStyle = 'rgba(255, 220, 190, 0.025)';
      ctx.fillRect(bx + pad + 1, by + pad + 1, pw - 2, ph - 2);

      // 2.4 四角精致微小工业沉头螺栓（Crisp Micro Hex Bolts）
      const boltMargin = 7;
      const boltCoords = [
        { x: bx + pad + boltMargin, y: by + pad + boltMargin },
        { x: bx + pad + pw - boltMargin, y: by + pad + boltMargin },
        { x: bx + pad + boltMargin, y: by + pad + ph - boltMargin },
        { x: bx + pad + pw - boltMargin, y: by + pad + ph - boltMargin },
      ];

      for (const b of boltCoords) {
        // 沉头圆坑（深暗金属凹槽）
        // 凹坑上边缘微弱金属切面
        ctx.strokeStyle = 'rgba(255, 210, 175, 0.18)';
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.arc(b.x, b.y, 2.2, Math.PI * 0.8, Math.PI * 1.8);
        ctx.stroke();

        // 螺栓金属圆芯
        ctx.fillStyle = 'rgba(165, 125, 105, 0.85)';
        ctx.beginPath();
        ctx.arc(b.x - 0.3, b.y - 0.3, 1.1, 0, Math.PI * 2);
        ctx.fill();

        // 螺栓金属高光反光微点
        ctx.fillStyle = 'rgba(255, 245, 230, 0.80)';
        ctx.beginPath();
        ctx.arc(b.x - 0.5, b.y - 0.5, 0.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // 2.5 钢板装甲极细 0.30px 机械微倒角（极隐蔽微弱，绝无粗边框）
      // 受光顶边与左边（极弱化暖白金属微光）
      ctx.strokeStyle = 'rgba(255, 215, 185, 0.035)';
      ctx.lineWidth = 0.30;
      ctx.beginPath();
      ctx.moveTo(bx + pad, by + pad + ph);
      ctx.lineTo(bx + pad, by + pad);
      ctx.lineTo(bx + pad + pw, by + pad);
      ctx.stroke();

      // 背光底边与右边（极微弱阴影）
      ctx.strokeStyle = 'rgba(10, 4, 3, 0.15)';
      ctx.lineWidth = 0.30;
      ctx.beginPath();
      ctx.moveTo(bx + pad + pw, by + pad);
      ctx.lineTo(bx + pad + pw, by + pad + ph);
      ctx.lineTo(bx + pad, by + pad + ph);
      ctx.stroke();
    }
  }

  // 3. 装甲板接缝与反应堆等离子能量回路（极致纤细 0.22px~0.4px 极细暗丝）
  for (let i = 0; i <= panelsPerAxis; i++) {
    const p = i * panelSize;

    // 3.1 极细微深暗缝（线宽收窄至 0.4px，透明度仅 0.15）
    ctx.fillStyle = 'rgba(10, 4, 3, 0.15)';
    ctx.fillRect(p - 0.2, 0, 0.4, size);
    ctx.fillRect(0, p - 0.2, size, 0.4);

    // 3.2 极细地温暗丝（0.22px 超细微丝，透明度 0.15，若隐若现）
    ctx.strokeStyle = 'rgba(255, 95, 25, 0.15)';
    ctx.lineWidth = 0.22;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }

  // 4. 反应堆能量接口（极致弱化微点）
  for (let x = 0; x <= panelsPerAxis; x++) {
    for (let y = 0; y <= panelsPerAxis; y++) {
      const px = x * panelSize;
      const py = y * panelSize;

      // 极微小暗金交接点
      ctx.fillStyle = 'rgba(235, 110, 30, 0.15)';
      ctx.beginPath();
      ctx.arc(px, py, 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  tex.update(false);
  return tex;
}

/** 1.1 第一关专属重钢装甲高精度噪声法线贴图（极平滑微切缝 + 细腻金属研磨微观拉丝噪点） */
function bakeFlameGridNormalTexture(scene: Scene, size: number): DynamicTexture {
  const tex = new DynamicTexture(
    'flameGridNormalTex',
    { width: size, height: size },
    scene,
    false,
  );
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;

  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const imgData = ctx.createImageData(size, size);
  const data = imgData.data;

  const panelsPerAxis = 4;
  const panelSize = size / panelsPerAxis; // 128
  const boltMargin = 7;

  // 1. 计算高度场（Height Field Array）
  const heights = new Float32Array(size * size);

  for (let y = 0; y < size; y++) {
    const py = Math.floor(y / panelSize);
    const ly = y % panelSize;

    for (let x = 0; x < size; x++) {
      const px = Math.floor(x / panelSize);
      const lx = x % panelSize;
      const idx = y * size + x;

      // 1.1 钢板装甲边缘与接缝槽深度（极微细落差，半宽仅 0.4px，落差仅 0.06）
      const distEdge = Math.min(lx, panelSize - lx, ly, panelSize - ly);
      let h = 1.0;

      if (distEdge < 0.4) {
        h = 0.94;
      } else if (distEdge < 1.0) {
        h = 0.94 + ((distEdge - 0.4) / 0.6) * 0.06;
      } else {
        h = 1.0;
      }

      // 1.2 四角沉头螺栓与孔洞凹凸
      const boltPts = [
        { bx: boltMargin, by: boltMargin },
        { bx: panelSize - boltMargin, by: boltMargin },
        { bx: boltMargin, by: panelSize - boltMargin },
        { bx: panelSize - boltMargin, by: panelSize - boltMargin },
      ];

      for (const bp of boltPts) {
        const dx = lx - bp.bx;
        const dy = ly - bp.by;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < 2.0) {
          if (d < 0.9) {
            h = Math.max(h, 0.88 + (0.9 - d) * 0.2);
          } else {
            h = Math.min(h, 0.78 + (d - 0.9) * 0.2);
          }
        }
      }

      // 1.3 金属研磨各向异性拉丝与微观冷轧钢表面微噪
      const u = x / 64;
      const v = y / 64;
      const isHoriz = (px + py) % 2 === 0;
      const brushNoise = isHoriz
        ? (periodicValueNoise(u * 16, v * 2, 32, 101) - 0.5) * 0.045
        : (periodicValueNoise(u * 2, v * 16, 32, 101) - 0.5) * 0.045;
      const microGrain = (hash2(x * 0.37 + 17, y * 0.43 + 31) - 0.5) * 0.025;

      heights[idx] = h + brushNoise + microGrain;
    }
  }

  // 2. 利用中心差分滤波器计算切线空间法线（微弱平滑强度 1.4）
  const normalStrength = 1.4;

  for (let y = 0; y < size; y++) {
    const yPrev = (y - 1 + size) % size;
    const yNext = (y + 1) % size;

    for (let x = 0; x < size; x++) {
      const xPrev = (x - 1 + size) % size;
      const xNext = (x + 1) % size;

      const hL = heights[y * size + xPrev];
      const hR = heights[y * size + xNext];
      const hU = heights[yPrev * size + x];
      const hD = heights[yNext * size + x];

      // 中心差分梯度
      const dx = (hR - hL) * normalStrength;
      const dy = (hD - hU) * normalStrength;

      // 切线空间法线：N = normalize(-dx, -dy, 1.0)
      const nz = 1.0;
      const len = Math.sqrt(dx * dx + dy * dy + nz * nz);
      const nx = -dx / len;
      const ny = -dy / len;
      const normZ = nz / len;

      // 映射到切线空间 RGB (0..255)
      const pIdx = (y * size + x) * 4;
      data[pIdx] = Math.floor((nx * 0.5 + 0.5) * 255);
      data[pIdx + 1] = Math.floor((ny * 0.5 + 0.5) * 255);
      data[pIdx + 2] = Math.floor((normZ * 0.5 + 0.5) * 255);
      data[pIdx + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
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

function periodicValueNoise(
  x: number,
  y: number,
  period: number,
  seed: number,
): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);

  const rx0 = ((x0 % period) + period) % period;
  const rx1 = (((x0 + 1) % period) + period) % period;
  const ry0 = ((y0 % period) + period) % period;
  const ry1 = (((y0 + 1) % period) + period) % period;

  const a = hash2(rx0 + seed * 0.11, ry0 + seed * 0.17);
  const b = hash2(rx1 + seed * 0.11, ry0 + seed * 0.17);
  const c = hash2(rx0 + seed * 0.11, ry1 + seed * 0.17);
  const d = hash2(rx1 + seed * 0.11, ry1 + seed * 0.17);

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
