import * as THREE from 'three';

/**
 * 纯灰色地板：水平放置在 XZ 平面上，Y = 0。
 */
export class DirtFloor extends THREE.Mesh {
  /** X 方向总长度（米），±10 */
  private static readonly SIZE_X = 20;
  /** Z 方向总长度（米），±2 */
  private static readonly SIZE_Z = 4;

  private readonly mapsDispose: () => void;

  readonly sizeX: number;
  readonly sizeZ: number;

  constructor() {
    const sizeX = DirtFloor.SIZE_X;
    const sizeZ = DirtFloor.SIZE_Z;

    const material = new THREE.MeshStandardMaterial({
      color: 0x1e2022,
      roughness: 0.45,
      metalness: 0.2,
      envMapIntensity: 0.8,
    });

    super(new THREE.PlaneGeometry(sizeX, sizeZ), material);

    this.sizeX = sizeX;
    this.sizeZ = sizeZ;
    this.mapsDispose = () => {};

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
