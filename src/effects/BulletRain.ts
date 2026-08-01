import * as THREE from 'three';
import { getGameAudio } from '../audio/GameAudio';
import type { CombatUnit, TeamId } from '../world/combat/CombatUnit';

export interface BulletRainSpawn {
  centerX: number;
  centerZ: number;
  radius: number;
  team: TeamId;
  /** 单次 tick 伤害（对圈内每个敌方单位） */
  damagePerTick: number;
  /** 伤害 tick 间隔（秒） */
  tickInterval: number;
  /** 整段持续时间（秒） */
  duration: number;
  /** 视觉落弹总数（均匀分布在持续时间内） */
  boltCount: number;
  color?: number;
  emissive?: number;
  /** 视觉缩放，默认 4 */
  boltScale?: number;
  /** 落弹飞行速度倍率，默认 1 */
  boltSpeedScale?: number;
  /** 每帧提供当前可受伤的敌方单位 */
  getEnemyUnits: () => readonly CombatUnit[];
}

interface RainBolt {
  mesh: THREE.Mesh;
  glow: THREE.Mesh;
  landY: number;
  speed: number;
  alive: boolean;
}

/**
 * 枪林弹雨：指定地面圆内持续落下粉色子弹，并对圈内敌方单位周期性造成伤害。
 */
export class BulletRain extends THREE.Group {
  private static readonly CORE_R = 0.006;
  private static readonly GLOW_R = 0.01;

  readonly team: TeamId;
  private readonly radius: number;
  private readonly damagePerTick: number;
  private readonly tickInterval: number;
  private readonly duration: number;
  private readonly getEnemyUnits: () => readonly CombatUnit[];

  private readonly groundRing: THREE.Mesh;
  private readonly groundFill: THREE.Mesh;
  private readonly bolts: RainBolt[] = [];
  private readonly spawnTimes: number[] = [];
  private spawnIndex = 0;

  private age = 0;
  private tickAccum = 0;
  private _alive = true;
  private readonly color: number;
  private readonly emissive: number;
  private readonly boltScale: number;
  private readonly boltSpeedScale: number;

  constructor(spawn: BulletRainSpawn) {
    super();
    this.name = 'BulletRain';
    this.team = spawn.team;
    this.radius = Math.max(0.1, spawn.radius);
    this.damagePerTick = Math.max(0, spawn.damagePerTick);
    this.tickInterval = Math.max(0.05, spawn.tickInterval);
    this.duration = Math.max(0.1, spawn.duration);
    this.getEnemyUnits = spawn.getEnemyUnits;
    this.color = spawn.color ?? (spawn.team === 'blue' ? 0xf9a8d4 : 0xfca5a5);
    this.emissive =
      spawn.emissive ?? (spawn.team === 'blue' ? 0xec4899 : 0xef4444);
    this.boltScale = Math.max(0.5, spawn.boltScale ?? 4);
    this.boltSpeedScale = Math.max(0.1, spawn.boltSpeedScale ?? 1);

    this.position.set(spawn.centerX, 0, spawn.centerZ);

    // 地面范围指示
    this.groundFill = new THREE.Mesh(
      new THREE.CircleGeometry(this.radius, 48),
      new THREE.MeshBasicMaterial({
        color: this.emissive,
        transparent: true,
        opacity: 0.14,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.groundFill.rotation.x = -Math.PI / 2;
    this.groundFill.position.y = 0.02;
    this.groundFill.renderOrder = 1;
    this.add(this.groundFill);

    this.groundRing = new THREE.Mesh(
      new THREE.RingGeometry(this.radius * 0.92, this.radius, 48),
      new THREE.MeshBasicMaterial({
        color: this.color,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.groundRing.rotation.x = -Math.PI / 2;
    this.groundRing.position.y = 0.025;
    this.groundRing.renderOrder = 2;
    this.add(this.groundRing);

    // 预排落弹时刻（轻微抖动，避免完全均匀）
    const count = Math.max(1, Math.floor(spawn.boltCount));
    for (let i = 0; i < count; i += 1) {
      const t = (i / count) * this.duration;
      const jitter = (Math.random() - 0.5) * (this.duration / count) * 0.6;
      this.spawnTimes.push(
        THREE.MathUtils.clamp(t + jitter, 0, this.duration * 0.98),
      );
    }
    this.spawnTimes.sort((a, b) => a - b);

    // 施放瞬间立刻打一 tick，手感更利落
    this.applyDamageTick();
  }

  get alive(): boolean {
    return this._alive;
  }

  /**
   * @returns 是否仍存活；false 表示应移除
   */
  update(delta: number): boolean {
    if (!this._alive) return false;
    if (!(delta > 0)) return true;

    this.age += delta;

    // 地面圈脉动
    const pulse = 0.92 + Math.sin(this.age * 10) * 0.08;
    this.groundRing.scale.setScalar(pulse);
    const lifeFade = THREE.MathUtils.clamp(
      1 - this.age / this.duration,
      0,
      1,
    );
    (this.groundRing.material as THREE.MeshBasicMaterial).opacity =
      0.25 + 0.35 * lifeFade;
    (this.groundFill.material as THREE.MeshBasicMaterial).opacity =
      0.06 + 0.1 * lifeFade;

    // 按时生成落弹
    while (
      this.spawnIndex < this.spawnTimes.length &&
      this.age >= this.spawnTimes[this.spawnIndex]
    ) {
      this.spawnBolt();
      this.spawnIndex += 1;
    }

    // 落弹运动
    for (let i = this.bolts.length - 1; i >= 0; i -= 1) {
      const bolt = this.bolts[i];
      if (!bolt.alive) {
        this.remove(bolt.mesh);
        this.remove(bolt.glow);
        bolt.mesh.geometry.dispose();
        (bolt.mesh.material as THREE.Material).dispose();
        bolt.glow.geometry.dispose();
        (bolt.glow.material as THREE.Material).dispose();
        this.bolts.splice(i, 1);
        continue;
      }

      bolt.mesh.position.y -= bolt.speed * delta;
      bolt.glow.position.copy(bolt.mesh.position);
      // 轻微旋转
      bolt.mesh.rotation.x += delta * 14;
      bolt.mesh.rotation.z += delta * 9;

      if (bolt.mesh.position.y <= bolt.landY) {
        bolt.mesh.position.y = bolt.landY;
        bolt.glow.position.y = bolt.landY;
        bolt.alive = false;
        // 落地闪一下：放大后下帧清理
        bolt.mesh.scale.multiplyScalar(1.8);
        bolt.glow.scale.multiplyScalar(2.2);
        (bolt.glow.material as THREE.MeshBasicMaterial).opacity = 0.55;
      }
    }

    // 伤害 tick（持续到 duration 结束）
    if (this.age <= this.duration) {
      this.tickAccum += delta;
      while (this.tickAccum >= this.tickInterval) {
        this.tickAccum -= this.tickInterval;
        this.applyDamageTick();
      }
    }

    // 持续时间结束且子弹落完 → 结束
    if (this.age >= this.duration && this.bolts.length === 0) {
      this.kill();
      return false;
    }

    // 超时保险：多给 1s 让残余子弹落地
    if (this.age > this.duration + 1.2) {
      this.kill();
      return false;
    }

    return true;
  }

  kill(): void {
    this._alive = false;
  }

  dispose(): void {
    for (const bolt of this.bolts) {
      this.remove(bolt.mesh);
      this.remove(bolt.glow);
      bolt.mesh.geometry.dispose();
      (bolt.mesh.material as THREE.Material).dispose();
      bolt.glow.geometry.dispose();
      (bolt.glow.material as THREE.Material).dispose();
    }
    this.bolts.length = 0;

    this.groundRing.geometry.dispose();
    (this.groundRing.material as THREE.Material).dispose();
    this.groundFill.geometry.dispose();
    (this.groundFill.material as THREE.Material).dispose();
  }

  private applyDamageTick(): void {
    if (this.damagePerTick <= 0) return;
    const cx = this.position.x;
    const cz = this.position.z;
    const r = this.radius;
    let hitCount = 0;
    for (const unit of this.getEnemyUnits()) {
      if (!unit.isAlive || unit.team === this.team) continue;
      // 圆心距 ≤ 半径 + 目标碰撞半径，边缘单位也能吃到
      const d = Math.hypot(unit.collider.x - cx, unit.collider.z - cz);
      if (d <= r + unit.collider.radius * 0.35) {
        unit.takeDamage(this.damagePerTick);
        hitCount += 1;
      }
    }
    // 范围 tick 命中：轻薄连击感（内部有 aoe 节流）
    if (hitCount > 0) {
      getGameAudio().playProjectileHit({
        kind: 'aoe',
        pitch: 1.02 + Math.random() * 0.08,
        gain: Math.min(1, 0.55 + hitCount * 0.12),
      });
    }
  }

  private spawnBolt(): void {
    // 圆盘均匀采样
    const ang = Math.random() * Math.PI * 2;
    const rad = this.radius * Math.sqrt(Math.random()) * 0.96;
    const lx = Math.cos(ang) * rad;
    const lz = Math.sin(ang) * rad;
    const startY = 2.4 + Math.random() * 1.6;
    const landY = 0.04 + Math.random() * 0.06;
    const s = this.boltScale;

    const core = new THREE.Mesh(
      new THREE.SphereGeometry(BulletRain.CORE_R * s, 8, 6),
      new THREE.MeshStandardMaterial({
        color: this.color,
        emissive: this.emissive,
        emissiveIntensity: 1.5,
        roughness: 0.15,
        metalness: 0.05,
      }),
    );
    core.position.set(lx, startY, lz);
    // 略拉长成弹体感
    core.scale.set(0.7, 1.6, 0.7);

    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(BulletRain.GLOW_R * s, 8, 6),
      new THREE.MeshBasicMaterial({
        color: this.emissive,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
      }),
    );
    glow.position.copy(core.position);
    glow.scale.set(0.8, 1.8, 0.8);

    this.add(core);
    this.add(glow);

    this.bolts.push({
      mesh: core,
      glow,
      landY,
      speed: (5.5 + Math.random() * 3.5) * this.boltSpeedScale,
      alive: true,
    });
  }
}
