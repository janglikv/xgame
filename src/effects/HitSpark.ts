import * as THREE from 'three';
import type { TeamId } from '../world/combat/CombatUnit';

/**
 * 命中瞬间的短促光爆（共享 Geometry & Material 优化）
 */
export class HitSpark extends THREE.Group {
  static readonly DURATION = 0.18;

  private static readonly sparkGeo = new THREE.SphereGeometry(0.08 / 10, 10, 8);
  private static readonly blueMat = new THREE.MeshBasicMaterial({
    color: 0x93c5fd,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  private static readonly redMat = new THREE.MeshBasicMaterial({
    color: 0xfca5a5,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });

  private readonly mesh: THREE.Mesh;
  private readonly mat: THREE.MeshBasicMaterial;
  private age = 0;
  private _alive = true;

  constructor(position: THREE.Vector3, team: TeamId) {
    super();
    this.name = 'HitSpark';
    this.position.copy(position);

    // 复制材质属性以供透明度动画使用，但几何体完全共享
    this.mat = (team === 'blue' ? HitSpark.blueMat : HitSpark.redMat).clone();
    this.mesh = new THREE.Mesh(HitSpark.sparkGeo, this.mat);
    this.add(this.mesh);
  }

  get alive(): boolean {
    return this._alive;
  }

  update(delta: number): boolean {
    if (!this._alive) return false;
    this.age += delta;
    const t = this.age / HitSpark.DURATION;
    if (t >= 1) {
      this._alive = false;
      return false;
    }
    const s = 1 + t * 2.2;
    this.mesh.scale.setScalar(s);
    this.mat.opacity = 0.85 * (1 - t);
    return true;
  }

  dispose(): void {
    this.mat.dispose();
  }
}

