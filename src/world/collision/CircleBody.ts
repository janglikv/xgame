import * as THREE from 'three';

/**
 * 地面 XZ 平面上的圆形碰撞体，并用白圈在地面标出实体范围。
 * 半径为世界单位；标记环会按 owner 的 XZ 缩放做本地补偿。
 */
export class CircleBody {
  /** 全局白圈可见性（新创建体也会继承） */
  static markersVisible = true;

  readonly owner: THREE.Object3D;
  /** 世界空间碰撞半径（米） */
  readonly radius: number;
  /** 静态体（如防御塔）不参与位置推开 */
  readonly isStatic: boolean;
  private readonly marker: THREE.LineLoop;

  constructor(
    owner: THREE.Object3D,
    radius: number,
    options: { isStatic?: boolean } = {},
  ) {
    this.owner = owner;
    this.radius = radius;
    this.isStatic = options.isStatic ?? false;
    this.marker = createWhiteGroundRing(owner, radius);
    this.marker.visible = CircleBody.markersVisible;
    owner.add(this.marker);
  }

  get x(): number {
    return this.owner.position.x;
  }

  get z(): number {
    return this.owner.position.z;
  }

  setXZ(x: number, z: number): void {
    this.owner.position.x = x;
    this.owner.position.z = z;
  }

  /** 单独设置本碰撞体白圈可见性 */
  setMarkerVisible(visible: boolean): void {
    this.marker.visible = visible;
  }
}

/** 在 owner 本地生成半径对应世界尺寸的白色地面圆环 */
function createWhiteGroundRing(
  owner: THREE.Object3D,
  worldRadius: number,
): THREE.LineLoop {
  const sx = Math.abs(owner.scale.x) || 1;
  const sy = Math.abs(owner.scale.y) || 1;
  const localR = worldRadius / sx;
  // 略抬离地面，减轻 z-fighting
  const localY = 0.025 / sy;

  const segments = 64;
  const positions = new Float32Array((segments + 1) * 3);
  for (let i = 0; i <= segments; i += 1) {
    const a = (i / segments) * Math.PI * 2;
    const o = i * 3;
    positions[o] = Math.cos(a) * localR;
    positions[o + 1] = localY;
    positions[o + 2] = Math.sin(a) * localR;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  });

  const ring = new THREE.LineLoop(geometry, material);
  ring.name = 'ColliderMarker';
  ring.renderOrder = 2;
  return ring;
}
