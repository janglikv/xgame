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
}

const OFFICIAL_TEX_BASE =
  'https://www.babylonjs-playground.com/textures/';

/**
 * 简单矩形场地：Y=0 平面地板 + 四周矮墙 + 外围兜底大地板。
 * 与坐标系范围对齐：X ±20、Z ±20。
 */
export class Floor {
  static readonly HALF_X = 20;
  static readonly HALF_Z = 20;
  static readonly WALL_THICKNESS = 0.25;
  static readonly WALL_HEIGHT = 0.5;
  static readonly GROUND_SIZE = 4000;
  static readonly FLOOR_THICKNESS = 0.05;
  static readonly GROUND_Y = -0.08;

  readonly root: TransformNode;
  readonly scene: Scene;
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

    const sizeX = Floor.HALF_X * 2;
    const sizeZ = Floor.HALF_Z * 2;
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

    // 矩形主场地 Plane
    this.floorMesh = MeshBuilder.CreateGround(
      'FloorSurface',
      { width: sizeX, height: sizeZ, subdivisions: 1 },
      scene,
    );
    this.floorMesh.position.y = 0;
    this.floorMesh.receiveShadows = true;
    this.floorMesh.parent = this.root;

    const wallY = h / 2;
    const halfX = Floor.HALF_X;
    const halfZ = Floor.HALF_Z;

    // ±Z 长边（沿 X）
    for (const [i, z] of [-halfZ - t / 2, halfZ + t / 2].entries()) {
      const wall = MeshBuilder.CreateBox(
        `WallLong_${i}`,
        { width: sizeX + t * 2, height: h, depth: t },
        scene,
      );
      wall.position = new Vector3(0, wallY, z);
      wall.receiveShadows = true;
      wall.parent = this.root;
      shadowGenerator?.addShadowCaster(wall);
      this.wallMeshes.push(wall);
    }

    // ±X 短边（沿 Z）
    for (const [i, x] of [-halfX - t / 2, halfX + t / 2].entries()) {
      const wall = MeshBuilder.CreateBox(
        `WallShort_${i}`,
        { width: t, height: h, depth: sizeZ },
        scene,
      );
      wall.position = new Vector3(x, wallY, 0);
      wall.receiveShadows = true;
      wall.parent = this.root;
      shadowGenerator?.addShadowCaster(wall);
      this.wallMeshes.push(wall);
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
    const { floorMat, wallMat, fallbackMat } = createMaterials(this.scene, surface);
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
 */
function createMaterials(
  scene: Scene,
  surface: FloorSurface,
): {
  floorMat: StandardMaterial;
  wallMat: StandardMaterial;
  fallbackMat: StandardMaterial;
} {
  const preset =
    FLOOR_SURFACE_PRESETS.find((p) => p.id === surface) ||
    FLOOR_SURFACE_PRESETS[0];

  if (surface === 'tiles') {
    const floorMat = new StandardMaterial('floorMat_tiles', scene);
    const diffuse = new Texture(
      `${OFFICIAL_TEX_BASE}albedo.png`,
      scene,
      false,
      true,
      Texture.TRILINEAR_SAMPLINGMODE,
    );
    diffuse.uScale = preset.uScale;
    diffuse.vScale = preset.vScale;
    diffuse.wrapU = Texture.WRAP_ADDRESSMODE;
    diffuse.wrapV = Texture.WRAP_ADDRESSMODE;
    floorMat.diffuseTexture = diffuse;
    floorMat.diffuseColor = Color3.White();
    floorMat.specularColor = new Color3(0.15, 0.15, 0.16);
    floorMat.specularPower = 32;
    floorMat.ambientColor = new Color3(0.35, 0.35, 0.38);

    const wallMat = mat(scene, 'wallMat_tiles', 0x3a3d42);
    const fallbackMat = mat(scene, 'fallbackMat_tiles', 0x1a1b1e);
    return { floorMat, wallMat, fallbackMat };
  }

  if (surface === 'dirtGrass') {
    const floorMat = new StandardMaterial('floorMat_dirtGrass', scene);
    const tex = bakeDirtGrassTexture(scene, 512);
    tex.uScale = preset.uScale;
    tex.vScale = preset.vScale;
    floorMat.diffuseTexture = tex;
    floorMat.diffuseColor = Color3.White();
    floorMat.specularColor = Color3.Black();
    floorMat.ambientColor = new Color3(0.35, 0.38, 0.3);

    const wallMat = mat(scene, 'wallMat_dirtGrass', 0x4a3f32);
    const fallbackMat = mat(scene, 'fallbackMat_dirtGrass', 0x2c241c);
    return { floorMat, wallMat, fallbackMat };
  }

  if (surface === 'cyberGrid') {
    const floorMat = new StandardMaterial('floorMat_cyberGrid', scene);
    const tex = bakeCyberGridTexture(scene, 512);
    tex.uScale = preset.uScale;
    tex.vScale = preset.vScale;
    floorMat.diffuseTexture = tex;
    // 微弱自发光，不再全量使用亮纹理做 emissiveTexture，避免夺目刺眼
    floorMat.emissiveColor = new Color3(0.06, 0.08, 0.12);
    floorMat.diffuseColor = new Color3(0.65, 0.65, 0.7);
    floorMat.specularColor = new Color3(0.1, 0.15, 0.25);

    const wallMat = mat(scene, 'wallMat_cyberGrid', 0x120b20);
    const fallbackMat = mat(scene, 'fallbackMat_cyberGrid', 0x06030c);
    return { floorMat, wallMat, fallbackMat };
  }

  if (surface === 'checker') {
    const floorMat = new StandardMaterial('floorMat_checker', scene);
    const tex = bakeCheckerTexture(scene, 512);
    tex.uScale = preset.uScale;
    tex.vScale = preset.vScale;
    floorMat.diffuseTexture = tex;
    floorMat.diffuseColor = Color3.White();
    floorMat.specularColor = new Color3(0.2, 0.2, 0.2);

    const wallMat = mat(scene, 'wallMat_checker', 0x2b2c30);
    const fallbackMat = mat(scene, 'fallbackMat_checker', 0x111215);
    return { floorMat, wallMat, fallbackMat };
  }

  if (surface === 'cobblestone') {
    const floorMat = new StandardMaterial('floorMat_cobblestone', scene);
    const tex = bakeCobblestoneTexture(scene, 512);
    tex.uScale = preset.uScale;
    tex.vScale = preset.vScale;
    floorMat.diffuseTexture = tex;
    floorMat.diffuseColor = Color3.White();
    floorMat.specularColor = new Color3(0.1, 0.1, 0.1);

    const wallMat = mat(scene, 'wallMat_cobblestone', 0x3d3835);
    const fallbackMat = mat(scene, 'fallbackMat_cobblestone', 0x1c1917);
    return { floorMat, wallMat, fallbackMat };
  }

  if (surface === 'sand') {
    const floorMat = new StandardMaterial('floorMat_sand', scene);
    const tex = bakeSandTexture(scene, 512);
    tex.uScale = preset.uScale;
    tex.vScale = preset.vScale;
    floorMat.diffuseTexture = tex;
    floorMat.diffuseColor = Color3.White();
    floorMat.specularColor = Color3.Black();

    const wallMat = mat(scene, 'wallMat_sand', 0x735a3b);
    const fallbackMat = mat(scene, 'fallbackMat_sand', 0x3d2f1d);
    return { floorMat, wallMat, fallbackMat };
  }

  if (surface === 'marble') {
    const floorMat = new StandardMaterial('floorMat_marble', scene);
    const tex = bakeMarbleTexture(scene, 512);
    tex.uScale = preset.uScale;
    tex.vScale = preset.vScale;
    floorMat.diffuseTexture = tex;
    floorMat.diffuseColor = Color3.White();
    floorMat.specularColor = new Color3(0.4, 0.4, 0.45);
    floorMat.specularPower = 64;

    const wallMat = mat(scene, 'wallMat_marble', 0x484b54);
    const fallbackMat = mat(scene, 'fallbackMat_marble', 0x212328);
    return { floorMat, wallMat, fallbackMat };
  }

  if (surface === 'woodPlanks') {
    const floorMat = new StandardMaterial('floorMat_woodPlanks', scene);
    const tex = bakeWoodPlanksTexture(scene, 512);
    tex.uScale = preset.uScale;
    tex.vScale = preset.vScale;
    floorMat.diffuseTexture = tex;
    floorMat.diffuseColor = Color3.White();
    floorMat.specularColor = new Color3(0.15, 0.1, 0.05);

    const wallMat = mat(scene, 'wallMat_woodPlanks', 0x4a2e1b);
    const fallbackMat = mat(scene, 'fallbackMat_woodPlanks', 0x24160c);
    return { floorMat, wallMat, fallbackMat };
  }

  // default 'dark'
  const floorMat = mat(scene, 'floorMat_dark', 0x1b1d20);
  floorMat.specularColor = new Color3(0.2, 0.2, 0.22);
  const wallMat = mat(scene, 'wallMat_dark', 0x282b30);
  const fallbackMat = mat(scene, 'fallbackMat_dark', 0x101114);
  return { floorMat, wallMat, fallbackMat };
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
