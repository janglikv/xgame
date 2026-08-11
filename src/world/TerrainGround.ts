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
  type Mesh,
} from '@babylonjs/core';
import { TerrainMaterial } from '@babylonjs/materials/terrain';
import { Floor } from './Floor';

/**
 * 官方 Texture Library（Playground CDN）。
 * @see https://doc.babylonjs.com/toolsAndResources/assetLibraries/availableTextures/
 */
const TEX = 'https://www.babylonjs-playground.com/textures/';

export interface TerrainGroundResult {
  root: TransformNode;
  terrain: Mesh;
  material: TerrainMaterial;
}

/**
 * 空白场景地面：**完全平坦** CreateGround + TerrainMaterial（草/石/砖混合）。
 * 不再使用 heightMap，避免任何高低差遮挡角色/阵法。
 * 物理地面由 buildArenaColliders({ includeFloor: true }) 负责。
 *
 * mix：自烘焙（官方 mixMap 偏蓝 → 几乎只显示 floor）。
 * R=草 G=石 B=地砖。
 */
export function createTerrainGround(
  scene: Scene,
  shadowGenerator?: ShadowGenerator,
  options?: {
    /** 地表贴图平铺次数（越大纹样越小） */
    textureScale?: number;
  },
): TerrainGroundResult {
  const texScale = options?.textureScale ?? 36;
  const sizeX = Floor.HALF_X * 2;
  const sizeZ = Floor.HALF_Z * 2;

  const root = new TransformNode('TerrainGround', scene);

  // —— 兜底大地板（纯色、不接阴影）——
  const fallbackMat = solidMat(scene, 'terrainFallbackMat', 0x2c241c);
  const ground = MeshBuilder.CreateGround(
    'TerrainFallbackGround',
    { width: Floor.GROUND_SIZE, height: Floor.GROUND_SIZE },
    scene,
  );
  ground.position.y = Floor.GROUND_Y;
  ground.material = fallbackMat;
  ground.receiveShadows = false;
  ground.parent = root;

  // —— TerrainMaterial：官方三套贴图 + 自烘焙 mix ——
  const terrainMaterial = new TerrainMaterial('terrainMaterial', scene);
  terrainMaterial.mixTexture = bakeTerrainMixMap(scene, 256);

  const diffuse1 = new Texture(`${TEX}grass.png`, scene);
  const diffuse2 = new Texture(`${TEX}rock.png`, scene);
  const diffuse3 = new Texture(`${TEX}floor.png`, scene);
  applyUvScale(diffuse1, texScale);
  applyUvScale(diffuse2, texScale);
  applyUvScale(diffuse3, texScale * 1.35);
  terrainMaterial.diffuseTexture1 = diffuse1;
  terrainMaterial.diffuseTexture2 = diffuse2;
  terrainMaterial.diffuseTexture3 = diffuse3;

  const bump1 = new Texture(`${TEX}grassn.png`, scene);
  const bump2 = new Texture(`${TEX}rockn.png`, scene);
  const bump3 = new Texture(`${TEX}floor_bump.PNG`, scene);
  applyUvScale(bump1, texScale);
  applyUvScale(bump2, texScale);
  applyUvScale(bump3, texScale * 1.35);
  terrainMaterial.bumpTexture1 = bump1;
  terrainMaterial.bumpTexture2 = bump2;
  terrainMaterial.bumpTexture3 = bump3;

  terrainMaterial.specularColor = new Color3(0.08, 0.08, 0.08);
  terrainMaterial.specularPower = 32;

  // 完全平坦主场地（Y=0），无高度图、无细分起伏
  const terrain = MeshBuilder.CreateGround(
    'blankTerrainFlat',
    { width: sizeX, height: sizeZ, subdivisions: 1 },
    scene,
  );
  terrain.position.y = 0;
  terrain.material = terrainMaterial;
  terrain.receiveShadows = true;
  terrain.parent = root;

  // —— 围墙 ——
  const wallMat = solidMat(scene, 'terrainWallMat', 0x4a3f32);
  const t = Floor.WALL_THICKNESS;
  const h = Floor.WALL_HEIGHT;
  const wallY = h / 2;
  const halfX = Floor.HALF_X;
  const halfZ = Floor.HALF_Z;

  for (const [i, z] of [-halfZ - t / 2, halfZ + t / 2].entries()) {
    const wall = MeshBuilder.CreateBox(
      `TerrainWallLong_${i}`,
      { width: sizeX + t * 2, height: h, depth: t },
      scene,
    );
    wall.position = new Vector3(0, wallY, z);
    wall.material = wallMat;
    wall.receiveShadows = true;
    wall.parent = root;
    shadowGenerator?.addShadowCaster(wall);
  }
  for (const [i, x] of [-halfX - t / 2, halfX + t / 2].entries()) {
    const wall = MeshBuilder.CreateBox(
      `TerrainWallShort_${i}`,
      { width: t, height: h, depth: sizeZ },
      scene,
    );
    wall.position = new Vector3(x, wallY, 0);
    wall.material = wallMat;
    wall.receiveShadows = true;
    wall.parent = root;
    shadowGenerator?.addShadowCaster(wall);
  }

  return { root, terrain, material: terrainMaterial };
}

function applyUvScale(tex: Texture, scale: number): void {
  tex.uScale = scale;
  tex.vScale = scale;
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
}

/**
 * TerrainMaterial 混合图：R→草 G→石 B→地砖。
 * 官方 mixMap 偏蓝，整片会只剩 floor.png；这里以草为主、石/砖做斑块。
 */
function bakeTerrainMixMap(scene: Scene, size: number): DynamicTexture {
  const tex = new DynamicTexture(
    'terrainMixMap',
    { width: size, height: size },
    scene,
    false,
  );
  tex.wrapU = Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;

  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const img = ctx.createImageData(size, size);
  const data = img.data;
  const seed = 11;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const n1 = fbm(u * 3.2, v * 3.2, seed);
      const n2 = fbm(u * 7.5 + 2.1, v * 7.5 - 1.4, seed + 5);

      let r = 0.72 + n1 * 0.2;
      let g = smoothstep(0.52, 0.78, n1) * (0.55 + n2 * 0.35);
      let b = smoothstep(0.62, 0.88, n2) * (0.35 + n1 * 0.2);

      const sum = r + g + b || 1;
      r /= sum;
      g /= sum;
      b /= sum;

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
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
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

function solidMat(scene: Scene, name: string, hex: number): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = new Color3(
    ((hex >> 16) & 0xff) / 255,
    ((hex >> 8) & 0xff) / 255,
    (hex & 0xff) / 255,
  );
  m.specularColor = Color3.Black();
  return m;
}
