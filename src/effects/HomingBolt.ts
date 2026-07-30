import * as THREE from 'three';
import type { CombatUnit, TeamId } from '../world/combat/CombatUnit';

export interface HomingBoltSpawn {
  origin: THREE.Vector3;
  target: CombatUnit;
  damage: number;
  team: TeamId;
  /** 视觉与命中半径缩放，默认 1（小兵弹） */
  scale?: number;
}

/**
 * 锁定追踪弹道：飞向目标当前位置，命中碰撞半径后才结算伤害。
 */
export class HomingBolt extends THREE.Group {
  static readonly SPEED = 0.5;
  /** 与身体落点的命中半径（世界单位，scale=1） */
  static readonly BODY_HIT_RADIUS = 0.08;
  /** 更慢弹速，略放宽寿命避免中途超时 */
  static readonly MAX_LIFE = 2.8 * 3;

  readonly team: TeamId;
  private readonly target: CombatUnit;
  private readonly damage: number;
  private readonly hitRadius: number;
  private readonly core: THREE.Mesh;
  private readonly glow: THREE.Mesh;
  private age = 0;
  private _alive = true;
  private _didHit = false;
  private readonly aim = new THREE.Vector3();

  constructor(spawn: HomingBoltSpawn) {
    super();
    this.name = 'HomingBolt';
    this.team = spawn.team;
    this.target = spawn.target;
    this.damage = spawn.damage;
    this.position.copy(spawn.origin);

    const scale = Math.max(0.1, spawn.scale ?? 1);
    this.hitRadius = HomingBolt.BODY_HIT_RADIUS * Math.min(scale, 2.5);

    const color = spawn.team === 'blue' ? 0x93c5fd : 0xfca5a5;
    const emissive = spawn.team === 'blue' ? 0x3b82f6 : 0xef4444;

    this.core = new THREE.Mesh(
      new THREE.SphereGeometry((0.055 / 10) * scale, 12, 10),
      new THREE.MeshStandardMaterial({
        color,
        emissive,
        emissiveIntensity: 1.4,
        roughness: 0.15,
        metalness: 0.05,
      }),
    );
    this.add(this.core);

    this.glow = new THREE.Mesh(
      new THREE.SphereGeometry((0.095 / 10) * scale, 10, 8),
      new THREE.MeshBasicMaterial({
        color: emissive,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
      }),
    );
    this.add(this.glow);
  }

  get alive(): boolean {
    return this._alive;
  }

  /** 是否因命中目标而结束（超时/目标死亡消散为 false） */
  get didHit(): boolean {
    return this._didHit;
  }

  /**
   * @returns 是否仍存活；false 表示应移除
   */
  update(delta: number): boolean {
    if (!this._alive) return false;

    this.age += delta;
    if (this.age > HomingBolt.MAX_LIFE) {
      this.kill();
      return false;
    }

    // 目标已死：弹道消散，不造成伤害
    if (!this.target.isAlive) {
      this.kill();
      return false;
    }

    // 锁定目标身体落点（小兵身体球 / 塔身中段）
    this.target.getHitPoint(this.aim);

    const dx = this.aim.x - this.position.x;
    const dy = this.aim.y - this.position.y;
    const dz = this.aim.z - this.position.z;
    const dist = Math.hypot(dx, dy, dz);

    if (dist <= this.hitRadius) {
      this.applyHit();
      return false;
    }

    const step = HomingBolt.SPEED * delta;
    if (step >= dist) {
      this.position.copy(this.aim);
      this.applyHit();
      return false;
    }

    const inv = 1 / dist;
    this.position.x += dx * inv * step;
    this.position.y += dy * inv * step;
    this.position.z += dz * inv * step;

    // 轻微脉动
    const pulse = 1 + Math.sin(this.age * 18) * 0.08;
    this.core.scale.setScalar(pulse);
    this.glow.scale.setScalar(pulse);
    this.core.rotation.y += delta * 10;

    return true;
  }

  private applyHit(): void {
    if (this.target.isAlive) {
      this.target.takeDamage(this.damage);
      this._didHit = true;
    }
    this.kill();
  }

  kill(): void {
    this._alive = false;
  }

  dispose(): void {
    this.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material;
      if (!mat) return;
      const list = Array.isArray(mat) ? mat : [mat];
      for (const m of list) m.dispose();
    });
  }
}
