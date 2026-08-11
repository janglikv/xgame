import {
  Color3,
  DynamicTexture,
  MeshBuilder,
  type Scene,
  ShadowGenerator,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
} from '@babylonjs/core';

/**
 * 主场地表面样式。
 * - tiles：官方 Texture Library 瓷砖（CDN floor.png + floor_bump）
 * - dirtGrass：程序化泥土草坪
 * - dark：纯色
 */
export type FloorSurface = 'dark' | 'dirtGrass' | 'tiles';

export interface FloorOptions {
  /** 默认 dark；tiles 枢纽瓷砖；dirtGrass 空白场景泥土草坪 */
  surface?: FloorSurface;
}

/**
 * 官方贴图库（Playground / docs Texture Library）。
 * 不在 npm 包内，运行时从 CDN 拉取；离线或 CDN 失败时材质会空白直到加载完成。
 * @see https://doc.babylonjs.com/toolsAndResources/assetLibraries/availableTextures/
 */
const OFFICIAL_TEX_BASE =
  'https://www.babylonjs-playground.com/textures/';

/**
 * 简单矩形场地：Y=0 平面地板 + 四周矮墙 + 外围兜底大地板。
 * 与坐标系范围对齐：X ±20、Z ±20。
 *
 * 贴图样式仅作用于主场地；兜底大地板仍用纯色且不接阴影。
 */
export class Floor {
  /** X 方向半宽（米）→ 总长 40 */
  static readonly HALF_X = 20;
  /** Z 方向半宽（米）→ 总宽 40 */
  static readonly HALF_Z = 20;
  /** 围墙厚度（米） */
  static readonly WALL_THICKNESS = 0.25;
  /** 围墙高度（米）；底边贴齐 Y=0 */
  static readonly WALL_HEIGHT = 0.5;
  /**
   * 兜底大地板边长（米）。
   * 超大平面近似无限；必须在矩形地板厚度之下，否则会 z-fighting 闪烁。
   */
  static readonly GROUND_SIZE = 4000;
  /** 矩形地板厚度（米）；顶面贴齐 Y=0 */
  static readonly FLOOR_THICKNESS = 0.05;
  /**
   * 兜底地面 Y（米）。
   * 须 < -FLOOR_THICKNESS，避免与矩形盒体相交。
   */
  static readonly GROUND_Y = -0.08;

  readonly root: TransformNode;

  constructor(
    scene: Scene,
    shadowGenerator?: ShadowGenerator,
    options: FloorOptions = {},
  ) {
    this.root = new TransformNode('Floor', scene);

    const surface = options.surface ?? 'dark';
    const sizeX = Floor.HALF_X * 2;
    const sizeZ = Floor.HALF_Z * 2;
    const t = Floor.WALL_THICKNESS;
    const h = Floor.WALL_HEIGHT;
    const floorThick = Floor.FLOOR_THICKNESS;

    const { floorMat, wallMat, fallbackMat } = createMaterials(scene, surface);
    const useTexturedGround = surface === 'dirtGrass' || surface === 'tiles';

    // 兜底大地板：纯色、不接阴影（4000m 平面若参与阴影体会把 shadow map 分辨率拉崩）
    const ground = MeshBuilder.CreateGround(
      'FallbackGround',
      { width: Floor.GROUND_SIZE, height: Floor.GROUND_SIZE },
      scene,
    );
    ground.position.y = Floor.GROUND_Y;
    ground.material = fallbackMat;
    ground.receiveShadows = false;
    ground.parent = this.root;

    // 矩形主场地
    if (useTexturedGround) {
      // Ground 平面 UV 规整，适合贴图；物理碰撞仍由 arenaColliders 的盒体负责
      const floor = MeshBuilder.CreateGround(
        'FloorSurface',
        { width: sizeX, height: sizeZ, subdivisions: 1 },
        scene,
      );
      floor.position.y = 0;
      floor.material = floorMat;
      floor.receiveShadows = true;
      floor.parent = this.root;
    } else {
      const floor = MeshBuilder.CreateBox(
        'FloorSurface',
        { width: sizeX, height: floorThick, depth: sizeZ },
        scene,
      );
      floor.position.y = -floorThick / 2;
      floor.material = floorMat;
      floor.receiveShadows = true;
      floor.parent = this.root;
    }

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
      wall.material = wallMat;
      wall.receiveShadows = true;
      wall.parent = this.root;
      shadowGenerator?.addShadowCaster(wall);
    }

    // ±X 短边（沿 Z）
    for (const [i, x] of [-halfX - t / 2, halfX + t / 2].entries()) {
      const wall = MeshBuilder.CreateBox(
        `WallShort_${i}`,
        { width: t, height: h, depth: sizeZ },
        scene,
      );
      wall.position = new Vector3(x, wallY, 0);
      wall.material = wallMat;
      wall.receiveShadows = true;
      wall.parent = this.root;
      shadowGenerator?.addShadowCaster(wall);
    }
  }
}

function createMaterials(
  scene: Scene,
  surface: FloorSurface,
): {
  floorMat: StandardMaterial;
  wallMat: StandardMaterial;
  fallbackMat: StandardMaterial;
} {
  if (surface === 'tiles') {
    // 试官方 Texture Library：albedo.png
    const floorMat = new StandardMaterial('floorMat_tiles', scene);
    const tileScale = 6;

    const diffuse = new Texture(
      `${OFFICIAL_TEX_BASE}albedo.png`,
      scene,
      false,
      true,
      Texture.TRILINEAR_SAMPLINGMODE,
    );
    diffuse.uScale = tileScale;
    diffuse.vScale = tileScale;
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
    // 40m 场地重复若干次，避免糊成一大块色
    tex.uScale = 8;
    tex.vScale = 8;
    floorMat.diffuseTexture = tex;
    floorMat.diffuseColor = Color3.White();
    floorMat.specularColor = Color3.Black();
    floorMat.ambientColor = new Color3(0.35, 0.38, 0.3);

    const wallMat = mat(scene, 'wallMat_dirtGrass', 0x4a3f32);
    const fallbackMat = mat(scene, 'fallbackMat_dirtGrass', 0x2c241c);
    return { floorMat, wallMat, fallbackMat };
  }

  const floorMat = mat(scene, 'floorMat', 0x1e2022);
  const wallMat = mat(scene, 'wallMat', 0x2a2e32);
  return { floorMat, wallMat, fallbackMat: floorMat };
}

/**
 * 启动时烘焙泥土 + 草坪斑块（512²；只画一次）。
 * 价值噪声叠几层，再按阈值混草/土，最后撒细颗粒。
 */
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

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** 0..1 伪随机 */
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
  const c = colorFromHex(hex);
  m.diffuseColor = c;
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
