import * as THREE from 'three';
import { getGameAudio } from '../audio/GameAudio';
import type { CombatUnit, TeamId } from '../world/combat/CombatUnit';

export interface BulletFanSpawn {
  /** 扇形原点（通常为英雄位置） */
  originX: number;
  originZ: number;
  /** 枪口高度（世界 Y） */
  originY?: number;
  /** 射击方向（世界 XZ，不必归一化） */
  dirX: number;
  dirZ: number;
  /** 扇形最大距离 */
  range: number;
  /** 半锥角（弧度） */
  halfAngle: number;
  team: TeamId;
  damagePerTick: number;
  tickInterval: number;
  duration: number;
  /** 视觉弹波间隔（秒） */
  waveInterval?: number;
  /** 每波子弹数 */
  boltsPerWave?: number;
  color?: number;
  emissive?: number;
  boltScale?: number;
  boltSpeed?: number;
  getEnemyUnits: () => readonly CombatUnit[];
}

interface FanBolt {
  mesh: THREE.Mesh;
  glow: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
}

/**
 * 大杀四方式扇形扫射：从原点朝向持续喷出弹幕，锥内敌方周期性受伤。
 */
export class BulletFan extends THREE.Group {
  private static readonly CORE_R = 0.007;
  private static readonly GLOW_R = 0.012;

  readonly team: TeamId;
  private readonly range: number;
  private readonly halfAngle: number;
  private readonly cosHalf: number;
  private readonly damagePerTick: number;
  private readonly tickInterval: number;
  private readonly duration: number;
  private readonly waveInterval: number;
  private readonly boltsPerWave: number;
  private readonly getEnemyUnits: () => readonly CombatUnit[];
  private readonly color: number;
  private readonly emissive: number;
  private readonly boltScale: number;
  private readonly boltSpeed: number;
  private readonly originY: number;
  private readonly dirX: number;
  private readonly dirZ: number;

  private readonly groundFan: THREE.Mesh;
  private readonly bolts: FanBolt[] = [];

  private age = 0;
  private tickAccum = 0;
  private waveAccum = 0;
  private _alive = true;
  private shotHandRight = true;

  constructor(spawn: BulletFanSpawn) {
    super();
    this.name = 'BulletFan';
    this.team = spawn.team;
    this.range = Math.max(0.5, spawn.range);
    this.halfAngle = Math.max(0.05, spawn.halfAngle);
    this.cosHalf = Math.cos(this.halfAngle);
    this.damagePerTick = Math.max(0, spawn.damagePerTick);
    this.tickInterval = Math.max(0.05, spawn.tickInterval);
    this.duration = Math.max(0.2, spawn.duration);
    this.waveInterval = Math.max(0.04, spawn.waveInterval ?? 0.09);
    this.boltsPerWave = Math.max(1, Math.floor(spawn.boltsPerWave ?? 7));
    this.getEnemyUnits = spawn.getEnemyUnits;
    this.color = spawn.color ?? 0xf9a8d4;
    this.emissive = spawn.emissive ?? 0xec4899;
    this.boltScale = Math.max(0.5, spawn.boltScale ?? 6);
    this.boltSpeed = Math.max(1, spawn.boltSpeed ?? 9);
    this.originY = spawn.originY ?? 0.55;

    let dx = spawn.dirX;
    let dz = spawn.dirZ;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) {
      dx = 1;
      dz = 0;
    } else {
      dx /= len;
      dz /= len;
    }
    this.dirX = dx;
    this.dirZ = dz;

    this.position.set(spawn.originX, 0, spawn.originZ);

    // 地面扇形指示（几何已在 XZ 面，仅 yaw 对准射击方向）
    this.groundFan = new THREE.Mesh(
      createFanGeometry(this.range, this.halfAngle, 28),
      new THREE.MeshBasicMaterial({
        color: this.emissive,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.groundFan.rotation.y = Math.atan2(this.dirX, this.dirZ);
    this.groundFan.position.y = 0.025;
    this.groundFan.renderOrder = 1;
    this.add(this.groundFan);

    // 开场立刻一 tick + 一波弹
    this.applyDamageTick();
    this.spawnWave();
  }

  get alive(): boolean {
    return this._alive;
  }

  /**
   * @returns 是否仍存活
   */
  update(delta: number): boolean {
    if (!this._alive) return false;
    if (!(delta > 0)) return true;

    this.age += delta;

    const lifeFade = THREE.MathUtils.clamp(
      1 - this.age / this.duration,
      0,
      1,
    );
    const pulse = 0.94 + Math.sin(this.age * 14) * 0.06;
    this.groundFan.scale.setScalar(pulse);
    (this.groundFan.material as THREE.MeshBasicMaterial).opacity =
      0.08 + 0.16 * lifeFade;

    // 扫射期间持续出波
    if (this.age <= this.duration) {
      this.waveAccum += delta;
      while (this.waveAccum >= this.waveInterval) {
        this.waveAccum -= this.waveInterval;
        this.spawnWave();
        this.playWaveSfx();
      }

      this.tickAccum += delta;
      while (this.tickAccum >= this.tickInterval) {
        this.tickAccum -= this.tickInterval;
        this.applyDamageTick();
      }
    }

    // 弹丸飞行
    for (let i = this.bolts.length - 1; i >= 0; i -= 1) {
      const b = this.bolts[i];
      b.life += delta;
      b.mesh.position.x += b.vx * delta;
      b.mesh.position.y += b.vy * delta;
      b.mesh.position.z += b.vz * delta;
      b.glow.position.copy(b.mesh.position);
      b.mesh.rotation.x += delta * 16;
      b.mesh.rotation.y += delta * 11;

      const fade = 1 - b.life / b.maxLife;
      if (fade < 0.35) {
        const a = fade / 0.35;
        (b.glow.material as THREE.MeshBasicMaterial).opacity = 0.35 * a;
      }

      if (b.life >= b.maxLife) {
        this.remove(b.mesh);
        this.remove(b.glow);
        b.mesh.geometry.dispose();
        (b.mesh.material as THREE.Material).dispose();
        b.glow.geometry.dispose();
        (b.glow.material as THREE.Material).dispose();
        this.bolts.splice(i, 1);
      }
    }

    if (this.age >= this.duration && this.bolts.length === 0) {
      this.kill();
      return false;
    }
    if (this.age > this.duration + 1.5) {
      this.kill();
      return false;
    }
    return true;
  }

  kill(): void {
    this._alive = false;
  }

  dispose(): void {
    for (const b of this.bolts) {
      this.remove(b.mesh);
      this.remove(b.glow);
      b.mesh.geometry.dispose();
      (b.mesh.material as THREE.Material).dispose();
      b.glow.geometry.dispose();
      (b.glow.material as THREE.Material).dispose();
    }
    this.bolts.length = 0;
    this.groundFan.geometry.dispose();
    (this.groundFan.material as THREE.Material).dispose();
  }

  private applyDamageTick(): void {
    if (this.damagePerTick <= 0) return;
    const ox = this.position.x;
    const oz = this.position.z;
    let hitCount = 0;

    for (const unit of this.getEnemyUnits()) {
      if (!unit.isAlive || unit.team === this.team) continue;
      const ux = unit.collider.x - ox;
      const uz = unit.collider.z - oz;
      const dist = Math.hypot(ux, uz);
      const reach = this.range + unit.collider.radius * 0.4;
      if (dist > reach) continue;
      if (dist > 1e-5) {
        const align = (ux * this.dirX + uz * this.dirZ) / dist;
        if (align < this.cosHalf) continue;
      }
      unit.takeDamage(this.damagePerTick);
      hitCount += 1;
    }

    if (hitCount > 0) {
      getGameAudio().playProjectileHit({
        kind: 'aoe',
        pitch: 1.05 + Math.random() * 0.1,
        gain: Math.min(1, 0.5 + hitCount * 0.1),
      });
    }
  }

  private spawnWave(): void {
    const s = this.boltScale;
    const baseYaw = Math.atan2(this.dirX, this.dirZ);
    const n = this.boltsPerWave;

    for (let i = 0; i < n; i += 1) {
      // 扇形内均匀 + 轻微抖动
      const t = n === 1 ? 0 : i / (n - 1);
      const ang =
        baseYaw - this.halfAngle + t * this.halfAngle * 2 +
        (Math.random() - 0.5) * 0.08;
      const speed = this.boltSpeed * (0.88 + Math.random() * 0.24);
      const vx = Math.sin(ang) * speed;
      const vz = Math.cos(ang) * speed;
      const vy = (Math.random() - 0.35) * 0.35;

      const core = new THREE.Mesh(
        new THREE.SphereGeometry(BulletFan.CORE_R * s, 8, 6),
        new THREE.MeshStandardMaterial({
          color: this.color,
          emissive: this.emissive,
          emissiveIntensity: 1.6,
          roughness: 0.12,
          metalness: 0.05,
        }),
      );
      const glow = new THREE.Mesh(
        new THREE.SphereGeometry(BulletFan.GLOW_R * s, 8, 6),
        new THREE.MeshBasicMaterial({
          color: this.emissive,
          transparent: true,
          opacity: 0.35,
          depthWrite: false,
        }),
      );

      // 本地坐标（相对 Group 原点）
      const startY = this.originY + (Math.random() - 0.5) * 0.12;
      const spread = 0.04 + Math.random() * 0.06;
      core.position.set(
        Math.sin(ang) * spread,
        startY,
        Math.cos(ang) * spread,
      );
      glow.position.copy(core.position);
      this.add(core);
      this.add(glow);

      const maxLife = this.range / speed + 0.05;
      this.bolts.push({
        mesh: core,
        glow,
        vx,
        vy,
        vz,
        life: 0,
        maxLife,
      });
    }
  }

  private playWaveSfx(): void {
    const hand = this.shotHandRight ? 'right' : 'left';
    this.shotHandRight = !this.shotHandRight;
    getGameAudio().playHeroGunshot({
      hand,
      pitch: 0.98 + Math.random() * 0.14,
      gain: 0.42 + Math.random() * 0.18,
    });
  }
}

/** 本地扇形：中轴 +Z，张角 2*halfAngle，半径 range */
function createFanGeometry(
  range: number,
  halfAngle: number,
  segments: number,
): THREE.BufferGeometry {
  const segs = Math.max(4, segments);
  const positions: number[] = [];
  const indices: number[] = [];

  // 顶点 0 = 原点
  positions.push(0, 0, 0);
  for (let i = 0; i <= segs; i += 1) {
    const t = i / segs;
    const a = -halfAngle + t * halfAngle * 2;
    // 本地 XZ 平面：x = sin(a)*r, z = cos(a)*r
    positions.push(Math.sin(a) * range, 0, Math.cos(a) * range);
  }
  for (let i = 0; i < segs; i += 1) {
    indices.push(0, i + 1, i + 2);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}
