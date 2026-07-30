import * as THREE from 'three';
import { createWorldGridMaterial } from './worldGridMaterial';

/**
 * 灰色地板：中间矩形走廊 + 两端正八边形平台（Y = 0）+ 围墙 + 外围无限地平面。
 *
 * - 可走地图：一体 mesh；围墙为方管截面沿轮廓扫掠
 * - 无限地：超大平面，高度 = 围墙底面 WALL_Y_BOTTOM
 * - 三者共用世界空间米制网格材质（1m 细线 + 5m 主线）
 *
 * 可走区域：
 * - 走廊：X ∈ [-HALF_X, HALF_X]，Z ∈ [-HALF_Z, HALF_Z]
 * - 两端八边形：边长 = 地图宽（SIZE_Z），一平边与走廊端线重合
 */
export class DirtFloor extends THREE.Group {
  /** X 方向总长度（米，走廊） */
  static readonly SIZE_X = 20;
  /** Z 方向总长度（米，走廊宽 = 地图宽） */
  static readonly SIZE_Z = 4;
  /** X 半宽（米），走廊边界 ±HALF_X */
  static readonly HALF_X = 10;
  /** Z 半宽（米），走廊边界 ±HALF_Z（兵线两侧） */
  static readonly HALF_Z = 2;

  /**
   * 两端八边形边长（米）= 地图宽 SIZE_Z。
   * 正八边形：外接半径 R = s / (2·sin(π/8))；
   * 中心到平边（apothem）= s / (2·tan(π/8)) = s·(1+√2)/2。
   */
  static readonly OCT_SIDE = DirtFloor.SIZE_Z;
  /** 中心到平边的距离（apothem） */
  static readonly OCT_APOTHEM =
    DirtFloor.OCT_SIDE / (2 * Math.tan(Math.PI / 8));
  /** 外接圆半径（中心到顶点） */
  static readonly OCT_RADIUS =
    DirtFloor.OCT_SIDE / (2 * Math.sin(Math.PI / 8));

  /** 管道截面水平厚度（米）；整管在轮廓外侧 */
  static readonly WALL_SECTION = 0.36;
  /** 管道截面高度（米）= 原方形边长翻倍 */
  static readonly WALL_HEIGHT = DirtFloor.WALL_SECTION * 2;
  /** 管道底面 Y：下沉为高度的 3/4 */
  static readonly WALL_Y_BOTTOM = -DirtFloor.WALL_HEIGHT * 0.75;
  /**
   * 外围“无限”地平面边长（米）。
   * 实际用超大平面近似无限；高度与围墙底面 WALL_Y_BOTTOM 对齐。
   */
  static readonly INFINITE_GROUND_SIZE = 4000;

  readonly sizeX: number;
  readonly sizeZ: number;

  private readonly disposables: Array<{
    geometry: THREE.BufferGeometry;
    material: THREE.Material | THREE.Material[];
  }> = [];

  constructor() {
    super();
    this.name = 'DirtFloor';

    const sizeX = DirtFloor.SIZE_X;
    const sizeZ = DirtFloor.SIZE_Z;
    this.sizeX = sizeX;
    this.sizeZ = sizeZ;

    // 无限大地板：贴在围墙下沉底面高度，铺满外围（网格略暗）
    const groundSize = DirtFloor.INFINITE_GROUND_SIZE;
    const groundMat = createWorldGridMaterial({
      color: 0x0e1012,
      lineColor: 0x2a3340,
      majorLineColor: 0x3d4a5c,
      roughness: 0.92,
      metalness: 0.05,
      envMapIntensity: 0.4,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const groundGeo = new THREE.PlaneGeometry(groundSize, groundSize);
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.name = 'InfiniteGround';
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = DirtFloor.WALL_Y_BOTTOM;
    ground.receiveShadow = true;
    this.add(ground);
    this.disposables.push({ geometry: groundGeo, material: groundMat });

    // 可走地板：同世界网格，略亮以区分场内
    const floorMat = createWorldGridMaterial({
      color: 0x1e2022,
      lineColor: 0x4b5c70,
      majorLineColor: 0x6b8299,
      roughness: 0.45,
      metalness: 0.2,
      envMapIntensity: 0.8,
    });

    const floor = new THREE.Mesh(createUnifiedFloorGeometry(), floorMat);
    floor.name = 'DirtFloorSurface';
    floor.receiveShadow = true;
    this.add(floor);
    this.disposables.push({ geometry: floor.geometry, material: floorMat });

    // 围墙：方管 + 同世界网格（立面显示竖直/水平格）
    const wallMat = createWorldGridMaterial({
      color: 0x2a2e32,
      lineColor: 0x5a6a7c,
      majorLineColor: 0x7a8fa3,
      roughness: 0.55,
      metalness: 0.15,
      envMapIntensity: 0.7,
      flatShading: true,
    });
    const wallGeo = createSquarePipeGeometry(
      getFloorOutline(),
      DirtFloor.WALL_SECTION,
      DirtFloor.WALL_HEIGHT,
      DirtFloor.WALL_Y_BOTTOM,
    );
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.name = 'DirtFloorWall';
    wall.castShadow = true;
    wall.receiveShadow = true;
    this.add(wall);
    this.disposables.push({ geometry: wallGeo, material: wallMat });
  }

  dispose(): void {
    const seen = new Set<THREE.Material | THREE.BufferGeometry>();
    for (const { geometry, material } of this.disposables) {
      if (!seen.has(geometry)) {
        geometry.dispose();
        seen.add(geometry);
      }
      const list = Array.isArray(material) ? material : [material];
      for (const m of list) {
        if (!seen.has(m)) {
          m.dispose();
          seen.add(m);
        }
      }
    }
    this.disposables.length = 0;
    this.clear();
  }
}

/** 世界 XZ 轮廓点（俯视顺时针，不闭合重复） */
type OutlinePoint = { x: number; z: number };

/**
 * 走廊 + 两端八边形的外轮廓顶点（与地板几何共用同一套顶点顺序）。
 */
function getFloorOutline(): OutlinePoint[] {
  const halfX = DirtFloor.HALF_X;
  const halfZ = DirtFloor.HALF_Z;
  const R = DirtFloor.OCT_RADIUS;
  const ap = DirtFloor.OCT_APOTHEM;
  const negCx = -halfX - ap;
  const posCx = halfX + ap;

  const oct = (cx: number, angle: number): OutlinePoint => ({
    x: cx + R * Math.cos(angle),
    z: R * Math.sin(angle),
  });

  const pts: OutlinePoint[] = [];

  // 1) -X 八边形外侧：底接合 → 顶接合
  for (let i = 0; i <= 7; i++) {
    const angle = -Math.PI / 8 - (i * Math.PI) / 4;
    pts.push(oct(negCx, angle));
  }

  // 2) 走廊顶边 → +X 顶接合
  pts.push({ x: halfX, z: halfZ });

  // 3) +X 八边形外侧（跳过已写入的顶接合）
  for (let i = 1; i <= 7; i++) {
    const angle = (7 * Math.PI) / 8 - (i * Math.PI) / 4;
    pts.push(oct(posCx, angle));
  }

  // 4) 走廊底边由扫掠闭合时接回 pts[0]
  return pts;
}

/**
 * 走廊 + 两端八边形的外轮廓，三角化为单片水平面（法线 +Y）。
 */
function createUnifiedFloorGeometry(): THREE.BufferGeometry {
  const outline = getFloorOutline();
  const halfX = DirtFloor.HALF_X;
  const ap = DirtFloor.OCT_APOTHEM;
  const R = DirtFloor.OCT_RADIUS;

  const shape = new THREE.Shape();
  shape.moveTo(outline[0]!.x, outline[0]!.z);
  for (let i = 1; i < outline.length; i++) {
    shape.lineTo(outline[i]!.x, outline[i]!.z);
  }
  shape.lineTo(outline[0]!.x, outline[0]!.z);
  shape.closePath();

  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  if (pos) {
    const uvs = new Float32Array(pos.count * 2);
    const xMin = -halfX - 2 * ap;
    const xMax = halfX + 2 * ap;
    const zMin = -R;
    const zMax = R;
    const xSpan = xMax - xMin;
    const zSpan = zMax - zMin;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      uvs[i * 2] = (x - xMin) / xSpan;
      uvs[i * 2 + 1] = (z - zMin) / zSpan;
    }
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  }

  geo.computeVertexNormals();
  return geo;
}

/**
 * 矩形截面沿闭合折线扫掠成一体方管。
 *
 * - 截面四角硬边：四面各自独立顶点 + 面法线，避免平滑成圆柱
 * - 中心线外扩 thickness/2，内侧面贴齐地图外轮廓
 * - yBottom 可下沉，顶面 = yBottom + height
 */
function createSquarePipeGeometry(
  pathPts: readonly OutlinePoint[],
  thickness: number,
  height: number,
  yBottom: number,
): THREE.BufferGeometry {
  const n = pathPts.length;
  if (n < 3) {
    return new THREE.BufferGeometry();
  }

  const half = thickness * 0.5;
  const yTop = yBottom + height;
  const centerline = offsetPolylineOutward(pathPts, half);
  const outN = polylineOutwardNormals(centerline);

  // 每站截面四角（世界坐标）：底内 / 底外 / 顶外 / 顶内
  const ring: Array<{
    bi: THREE.Vector3;
    bo: THREE.Vector3;
    to: THREE.Vector3;
    ti: THREE.Vector3;
  }> = [];

  for (let i = 0; i < n; i++) {
    const p = centerline[i]!;
    const nx = outN[i]!.x;
    const nz = outN[i]!.z;
    const ix = p.x - nx * half;
    const iz = p.z - nz * half;
    const ox = p.x + nx * half;
    const oz = p.z + nz * half;
    ring.push({
      bi: new THREE.Vector3(ix, yBottom, iz),
      bo: new THREE.Vector3(ox, yBottom, oz),
      to: new THREE.Vector3(ox, yTop, oz),
      ti: new THREE.Vector3(ix, yTop, iz),
    });
  }

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];

  /** 硬边四边形：每角独立顶点，整面同一法线 */
  const addFace = (
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    d: THREE.Vector3,
    normal: THREE.Vector3,
    u0: number,
    u1: number,
  ): void => {
    const nx = normal.x;
    const ny = normal.y;
    const nz = normal.z;
    // a-b-c
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    uvs.push(u0, 0, u1, 0, u1, 1);
    // a-c-d
    positions.push(a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
    normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    uvs.push(u0, 0, u1, 1, u0, 1);
  };

  let arc = 0;
  let perimeter = 0;
  for (let i = 0; i < n; i++) {
    const a = centerline[i]!;
    const b = centerline[(i + 1) % n]!;
    perimeter += Math.hypot(b.x - a.x, b.z - a.z);
  }
  perimeter = Math.max(perimeter, 1e-6);

  const nOut = new THREE.Vector3();
  const nIn = new THREE.Vector3();
  const nUp = new THREE.Vector3(0, 1, 0);
  const nDown = new THREE.Vector3(0, -1, 0);

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = centerline[i]!;
    const b = centerline[j]!;
    const segLen = Math.hypot(b.x - a.x, b.z - a.z);
    const u0 = arc / perimeter;
    const u1 = (arc + segLen) / perimeter;
    arc += segLen;

    // 该段水平外侧法线（直边平面，保证侧面是平的）
    if (segLen > 1e-8) {
      nOut.set(-(b.z - a.z) / segLen, 0, (b.x - a.x) / segLen);
    } else {
      nOut.set(outN[i]!.x, 0, outN[i]!.z);
    }
    nIn.copy(nOut).multiplyScalar(-1);

    const ri = ring[i]!;
    const rj = ring[j]!;

    // 外侧面（硬边方管外壁）
    addFace(ri.bo, rj.bo, rj.to, ri.to, nOut, u0, u1);
    // 顶面
    addFace(ri.to, rj.to, rj.ti, ri.ti, nUp, u0, u1);
    // 内侧面
    addFace(ri.ti, rj.ti, rj.bi, ri.bi, nIn, u0, u1);
    // 底面
    addFace(ri.bi, rj.bi, rj.bo, ri.bo, nDown, u0, u1);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return geo;
}

/**
 * 闭合折线各顶点外扩 `dist`（miter）。
 * 轮廓俯视顺时针：外侧 = 前进方向左侧法线 (-dz, dx)。
 */
function offsetPolylineOutward(
  pts: readonly OutlinePoint[],
  dist: number,
): OutlinePoint[] {
  const n = pts.length;
  const out: OutlinePoint[] = [];
  const normals = polylineOutwardNormals(pts);
  for (let i = 0; i < n; i++) {
    const p = pts[i]!;
    const prev = pts[(i - 1 + n) % n]!;
    const next = pts[(i + 1) % n]!;

    const e1x = p.x - prev.x;
    const e1z = p.z - prev.z;
    const e2x = next.x - p.x;
    const e2z = next.z - p.z;
    const l1 = Math.hypot(e1x, e1z) || 1;
    const l2 = Math.hypot(e2x, e2z) || 1;
    // 边单位外侧法线
    const n1x = -(e1z / l1);
    const n1z = e1x / l1;
    const n2x = -(e2z / l2);
    const n2z = e2x / l2;

    let bx = n1x + n2x;
    let bz = n1z + n2z;
    const bl = Math.hypot(bx, bz);
    if (bl < 1e-8) {
      const nn = normals[i]!;
      out.push({ x: p.x + nn.x * dist, z: p.z + nn.z * dist });
      continue;
    }
    bx /= bl;
    bz /= bl;
    // miter 长度：dist / cos(半角)
    const cos = Math.max(0.2, n1x * bx + n1z * bz);
    const miter = dist / cos;
    out.push({ x: p.x + bx * miter, z: p.z + bz * miter });
  }
  return out;
}

/** 各顶点处外侧单位法线（相邻边法线平均后归一化） */
function polylineOutwardNormals(
  pts: readonly OutlinePoint[],
): OutlinePoint[] {
  const n = pts.length;
  const out: OutlinePoint[] = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n]!;
    const curr = pts[i]!;
    const next = pts[(i + 1) % n]!;

    const e1x = curr.x - prev.x;
    const e1z = curr.z - prev.z;
    const e2x = next.x - curr.x;
    const e2z = next.z - curr.z;
    const l1 = Math.hypot(e1x, e1z) || 1;
    const l2 = Math.hypot(e2x, e2z) || 1;

    let nx = -(e1z / l1) - e2z / l2;
    let nz = e1x / l1 + e2x / l2;
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl;
    nz /= nl;
    out.push({ x: nx, z: nz });
  }
  return out;
}
