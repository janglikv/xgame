import * as THREE from 'three';
import type { TeamId } from '../world/combat/CombatUnit';

/**
 * 命中瞬间的短促光爆。
 */
export class HitSpark extends THREE.Group {
  static readonly DURATION = 0.18;

  private readonly mesh: THREE.Mesh;
  private readonly mat: THREE.MeshBasicMaterial;
  private age = 0;
  private _alive = true;

  constructor(position: THREE.Vector3, team: TeamId) {
    super();
    this.name = 'HitSpark';
    this.position.copy(position);

    const color = team === 'blue' ? 0x93c5fd : 0xfca5a5;
    this.mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(0.08 / 10, 10, 8), this.mat);
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
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
