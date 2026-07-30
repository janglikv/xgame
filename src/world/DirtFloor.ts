import * as THREE from 'three';

/**
 * 灰色地板：中间矩形走廊 + 两端正八边形平台，均在 XZ 平面、Y = 0。
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

  readonly sizeX: number;
  readonly sizeZ: number;

  private readonly meshes: THREE.Mesh[] = [];

  constructor() {
    super();
    this.name = 'DirtFloor';

    const sizeX = DirtFloor.SIZE_X;
    const sizeZ = DirtFloor.SIZE_Z;
    this.sizeX = sizeX;
    this.sizeZ = sizeZ;

    const material = new THREE.MeshStandardMaterial({
      color: 0x1e2022,
      roughness: 0.45,
      metalness: 0.2,
      envMapIntensity: 0.8,
    });

    // 中间矩形走廊
    const corridor = new THREE.Mesh(
      new THREE.PlaneGeometry(sizeX, sizeZ),
      material,
    );
    corridor.name = 'DirtFloorCorridor';
    corridor.rotation.x = -Math.PI / 2;
    corridor.position.y = 0;
    corridor.receiveShadow = true;
    this.add(corridor);
    this.meshes.push(corridor);

    // 两端八边形：一平边贴合走廊端线（平边平行于 Z，朝向 ±X）
    const octSide = DirtFloor.OCT_SIDE;
    const apothem = DirtFloor.OCT_APOTHEM;
    const halfX = DirtFloor.HALF_X;

    // +X 端：内侧平边在 x = +HALF_X，中心再往外偏移 apothem
    this.add(
      this.createOctPlatform(
        material,
        halfX + apothem,
        0,
        octSide,
        'DirtFloorOctPosX',
      ),
    );
    // -X 端
    this.add(
      this.createOctPlatform(
        material,
        -halfX - apothem,
        0,
        octSide,
        'DirtFloorOctNegX',
      ),
    );
  }

  /**
   * 在 XZ 平面上创建正八边形平台（Y 朝上）。
   * 顶点角从 +X 起偏 22.5°，使左右两侧为平边。
   */
  private createOctPlatform(
    material: THREE.Material,
    centerX: number,
    centerZ: number,
    side: number,
    name: string,
  ): THREE.Mesh {
    const geo = createOctagonGeometryXZ(side);
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = name;
    mesh.position.set(centerX, 0, centerZ);
    mesh.receiveShadow = true;
    this.meshes.push(mesh);
    return mesh;
  }

  dispose(): void {
    const disposedMats = new Set<THREE.Material>();
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      const { material } = mesh;
      if (Array.isArray(material)) {
        for (const m of material) {
          if (!disposedMats.has(m)) {
            m.dispose();
            disposedMats.add(m);
          }
        }
      } else if (!disposedMats.has(material)) {
        material.dispose();
        disposedMats.add(material);
      }
    }
    this.meshes.length = 0;
    this.clear();
  }
}

/**
 * 水平正八边形（XZ 平面，法线 +Y）。
 * 边长 = side；角点从 +X 起偏 22.5°，使平边朝 ±X。
 * 贴合走廊时，±X 平边长度 = side，Z 范围恰为 ±side/2。
 */
function createOctagonGeometryXZ(side: number): THREE.BufferGeometry {
  const radius = side / (2 * Math.sin(Math.PI / 8));
  const sides = 8;

  const positions: number[] = [];
  positions.push(0, 0, 0);
  // 8 个角点：22.5° + i·45°（平边朝 ±X）
  for (let i = 0; i < sides; i++) {
    const angle = Math.PI / 8 + (i * Math.PI) / 4;
    positions.push(radius * Math.cos(angle), 0, radius * Math.sin(angle));
  }

  // 绕序保证法线 +Y
  const indices: number[] = [];
  for (let i = 0; i < sides; i++) {
    const a = 1 + i;
    const b = 1 + ((i + 1) % sides);
    indices.push(0, b, a);
  }

  const vertexCount = sides + 1;
  const normals: number[] = [];
  for (let i = 0; i < vertexCount; i++) {
    normals.push(0, 1, 0);
  }

  const uvs: number[] = [];
  const denom = radius * 2;
  for (let i = 0; i < vertexCount; i++) {
    const x = positions[i * 3]!;
    const z = positions[i * 3 + 2]!;
    uvs.push(x / denom + 0.5, z / denom + 0.5);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}
