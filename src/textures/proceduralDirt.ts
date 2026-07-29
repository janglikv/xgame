import * as THREE from 'three';

export interface ProceduralDirtOptions {
  /** 贴图分辨率（正方形），默认 512 */
  resolution?: number;
  /** 随机种子 */
  seed?: number;
  /** 贴图对应的真实尺寸（米），用于世界平铺，默认 2m */
  tileMeters?: number;
}

export interface ProceduralDirtMaps {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  /** 每张贴图覆盖的米数 */
  tileMeters: number;
  dispose: () => void;
}

/**
 * 启动时程序化烘焙泥土 PBR 贴图（只生成一次，运行时按普通贴图采样）。
 */
export function createProceduralDirtMaps(
  options: ProceduralDirtOptions = {},
): ProceduralDirtMaps {
  const resolution = options.resolution ?? 512;
  const seed = options.seed ?? 42;
  const tileMeters = options.tileMeters ?? 2;

  const height = buildHeightField(resolution, seed);

  const albedoCanvas = document.createElement('canvas');
  const normalCanvas = document.createElement('canvas');
  const roughCanvas = document.createElement('canvas');
  albedoCanvas.width = normalCanvas.width = roughCanvas.width = resolution;
  albedoCanvas.height = normalCanvas.height = roughCanvas.height = resolution;

  const albedoCtx = mustCtx(albedoCanvas);
  const normalCtx = mustCtx(normalCanvas);
  const roughCtx = mustCtx(roughCanvas);

  const albedo = albedoCtx.createImageData(resolution, resolution);
  const normal = normalCtx.createImageData(resolution, resolution);
  const rough = roughCtx.createImageData(resolution, resolution);

  // 泥土调色：亮褐 / 中褐 / 深褐
  const cLight = { r: 118, g: 84, b: 52 };
  const cMid = { r: 86, g: 58, b: 36 };
  const cDark = { r: 52, g: 34, b: 22 };

  const strength = 2.8; // 法线强度

  for (let y = 0; y < resolution; y++) {
    for (let x = 0; x < resolution; x++) {
      const i = y * resolution + x;
      const h = height[i]!;

      // 细节色噪，打破色块
      const speck =
        0.5 +
        0.5 *
          noise2D(x * 0.17 + seed * 3.1, y * 0.17 + seed * 1.7, seed + 99);
      const gravel =
        noise2D(x * 0.41 + 20, y * 0.41 - 11, seed + 7) > 0.72 ? 0.18 : 0;

      // 高度混合颜色：低处更深、高处略浅
      const t = THREE.MathUtils.clamp(h * 0.65 + speck * 0.35, 0, 1);
      let r: number;
      let g: number;
      let b: number;
      if (t < 0.5) {
        const k = t / 0.5;
        r = lerp(cDark.r, cMid.r, k);
        g = lerp(cDark.g, cMid.g, k);
        b = lerp(cDark.b, cMid.b, k);
      } else {
        const k = (t - 0.5) / 0.5;
        r = lerp(cMid.r, cLight.r, k);
        g = lerp(cMid.g, cLight.g, k);
        b = lerp(cMid.b, cLight.b, k);
      }

      // 少量浅色砂砾点
      r = clamp8(r + gravel * 90);
      g = clamp8(g + gravel * 70);
      b = clamp8(b + gravel * 40);

      const pi = i * 4;
      albedo.data[pi] = r;
      albedo.data[pi + 1] = g;
      albedo.data[pi + 2] = b;
      albedo.data[pi + 3] = 255;

      // 由高度场求法线（可平铺采样）
      const hL = sampleHeight(height, resolution, x - 1, y);
      const hR = sampleHeight(height, resolution, x + 1, y);
      const hD = sampleHeight(height, resolution, x, y - 1);
      const hU = sampleHeight(height, resolution, x, y + 1);
      const dx = (hR - hL) * strength;
      const dy = (hU - hD) * strength;
      // 切空间法线，Z 朝外
      let nx = -dx;
      let ny = -dy;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      normal.data[pi] = Math.round((nx * 0.5 + 0.5) * 255);
      normal.data[pi + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normal.data[pi + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      normal.data[pi + 3] = 255;

      // 粗糙度：整体很糙，低洼略低一点（微湿）
      const roughV = clamp8(210 + h * 35 - gravel * 40);
      rough.data[pi] = roughV;
      rough.data[pi + 1] = roughV;
      rough.data[pi + 2] = roughV;
      rough.data[pi + 3] = 255;
    }
  }

  albedoCtx.putImageData(albedo, 0, 0);
  normalCtx.putImageData(normal, 0, 0);
  roughCtx.putImageData(rough, 0, 0);

  // albedo 用 sRGB；法线 / 粗糙度为数据贴图，保持线性
  const map = toTexture(albedoCanvas, THREE.SRGBColorSpace);
  const normalMap = toTexture(normalCanvas, THREE.NoColorSpace);
  const roughnessMap = toTexture(roughCanvas, THREE.NoColorSpace);

  return {
    map,
    normalMap,
    roughnessMap,
    tileMeters,
    dispose: () => {
      map.dispose();
      normalMap.dispose();
      roughnessMap.dispose();
    },
  };
}

/**
 * 用程序泥土贴图创建地面材质，并按世界尺寸设置平铺。
 */
export function createProceduralDirtMaterial(
  worldSizeX: number,
  worldSizeZ: number,
  options: ProceduralDirtOptions = {},
): { material: THREE.MeshStandardMaterial; maps: ProceduralDirtMaps } {
  const maps = createProceduralDirtMaps(options);
  const repeatX = worldSizeX / maps.tileMeters;
  const repeatZ = worldSizeZ / maps.tileMeters;

  for (const tex of [maps.map, maps.normalMap, maps.roughnessMap]) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatZ);
  }

  const material = new THREE.MeshStandardMaterial({
    map: maps.map,
    normalMap: maps.normalMap,
    normalScale: new THREE.Vector2(1.1, 1.1),
    roughnessMap: maps.roughnessMap,
    roughness: 1,
    metalness: 0,
    color: 0xffffff,
  });

  return { material, maps };
}

function toTexture(
  canvas: HTMLCanvasElement,
  colorSpace: THREE.ColorSpace,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = colorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

function mustCtx(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas context unavailable');
  return ctx;
}

function buildHeightField(resolution: number, seed: number): Float32Array {
  const data = new Float32Array(resolution * resolution);
  for (let y = 0; y < resolution; y++) {
    for (let x = 0; x < resolution; x++) {
      // 多八度 fbm，做成可平铺噪声（period = resolution 在格子空间）
      const u = x / resolution;
      const v = y / resolution;
      let h = 0;
      let amp = 1;
      let freq = 1;
      let norm = 0;
      for (let o = 0; o < 5; o++) {
        h +=
          amp *
          tileableNoise2D(u * freq * 4, v * freq * 4, freq * 4, seed + o * 17);
        norm += amp;
        amp *= 0.5;
        freq *= 2;
      }
      h = h / norm;
      // 再叠一层细碎颗粒
      h =
        h * 0.78 +
        0.22 *
          tileableNoise2D(u * 24, v * 24, 24, seed + 100);
      data[y * resolution + x] = h;
    }
  }
  return data;
}

function sampleHeight(
  height: Float32Array,
  resolution: number,
  x: number,
  y: number,
): number {
  const xi = ((x % resolution) + resolution) % resolution;
  const yi = ((y % resolution) + resolution) % resolution;
  return height[yi * resolution + xi]!;
}

/** 可平铺 value noise（period 为周期格子数） */
function tileableNoise2D(
  x: number,
  y: number,
  period: number,
  seed: number,
): number {
  // 将连续坐标映射到 period 环上
  const px = ((x % period) + period) % period;
  const py = ((y % period) + period) % period;
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const x1 = (x0 + 1) % Math.max(1, Math.round(period));
  const y1 = (y0 + 1) % Math.max(1, Math.round(period));
  const fx = px - x0;
  const fy = py - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);

  const p = Math.max(1, Math.round(period));
  const n00 = hash2D(x0, y0, seed, p);
  const n10 = hash2D(x1, y0, seed, p);
  const n01 = hash2D(x0, y1, seed, p);
  const n11 = hash2D(x1, y1, seed, p);

  const ix0 = lerp(n00, n10, sx);
  const ix1 = lerp(n01, n11, sx);
  return lerp(ix0, ix1, sy);
}

function noise2D(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const n00 = hash2D(x0, y0, seed, 0);
  const n10 = hash2D(x0 + 1, y0, seed, 0);
  const n01 = hash2D(x0, y0 + 1, seed, 0);
  const n11 = hash2D(x0 + 1, y0 + 1, seed, 0);
  return lerp(lerp(n00, n10, sx), lerp(n01, n11, sx), sy);
}

function hash2D(x: number, y: number, seed: number, period: number): number {
  let xi = x;
  let yi = y;
  if (period > 0) {
    xi = ((xi % period) + period) % period;
    yi = ((yi % period) + period) % period;
  }
  let n = xi * 374761393 + yi * 668265263 + seed * 1274126177;
  n = (n ^ (n >>> 13)) * 1274126177;
  n = n ^ (n >>> 16);
  return (n >>> 0) / 4294967295;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp8(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}
