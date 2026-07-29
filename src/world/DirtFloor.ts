import * as THREE from 'three';
import { createProceduralDirtMaterial } from '../textures/proceduralDirt';

/**
 * 泥土地板：水平放置在 XZ 平面上，Y = 0。
 * 尺寸与程序化泥土参数内聚在类内，不对外传参。
 */
export class DirtFloor extends THREE.Mesh {
  /** X 方向总长度（米），±10 */
  private static readonly SIZE_X = 20;
  /** Z 方向总长度（米），±2 */
  private static readonly SIZE_Z = 4;
  /** 程序化贴图分辨率 */
  private static readonly DIRT_RESOLUTION = 512;
  /** 噪声种子 */
  private static readonly DIRT_SEED = 42;
  /** 单张贴图覆盖米数（平铺单元） */
  private static readonly DIRT_TILE_METERS = 2;

  private readonly mapsDispose: () => void;

  readonly sizeX: number;
  readonly sizeZ: number;

  constructor() {
    const sizeX = DirtFloor.SIZE_X;
    const sizeZ = DirtFloor.SIZE_Z;

    const { material, maps } = createProceduralDirtMaterial(sizeX, sizeZ, {
      resolution: DirtFloor.DIRT_RESOLUTION,
      seed: DirtFloor.DIRT_SEED,
      tileMeters: DirtFloor.DIRT_TILE_METERS,
    });

    super(new THREE.PlaneGeometry(sizeX, sizeZ), material);

    this.sizeX = sizeX;
    this.sizeZ = sizeZ;
    this.mapsDispose = maps.dispose;

    this.name = 'DirtFloor';
    this.rotation.x = -Math.PI / 2;
    this.position.y = 0;
    this.receiveShadow = true;
  }

  dispose(): void {
    this.mapsDispose();
    this.geometry.dispose();
    const { material } = this;
    if (Array.isArray(material)) {
      material.forEach((m) => m.dispose());
    } else {
      material.dispose();
    }
  }
}
