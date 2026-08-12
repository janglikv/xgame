import {
  type AbstractMesh,
  Color3,
  Mesh,
  MeshBuilder,
  Ray,
  type Scene,
  StandardMaterial,
  Vector3,
} from '@babylonjs/core';
import type { Minion } from './Minion';
import type { StaffStyle } from './minion/staff';

/**
 * 各法杖类型对应的纯鲜艳颜色
 */
const STYLE_COLORS: Record<StaffStyle, Color3> = {
  arcane: Color3.FromHexString('#b545ff'), // 奥术紫
  flame: Color3.FromHexString('#ff5500'),  // 烈焰橙
  frost: Color3.FromHexString('#00c8ff'),  // 冰霜蓝
  nature: Color3.FromHexString('#20e040'), // 自然绿
  void: Color3.FromHexString('#8811ee'),   // 虚空紫
  storm: Color3.FromHexString('#00e5ff'),  // 风暴青
  holy: Color3.FromHexString('#ffcc00'),   // 圣光黄
};

interface Bullet {
  mesh: Mesh;
  position: Vector3;
  direction: Vector3;
  speed: number;
  age: number;
  maxAge: number;
  shooter?: Minion;
}

/**
 * 高性能纯色圆形子弹系统：支持命中墙体与小人敌人，小人受击触发闪白与反弹效果，子弹命中即消失。
 */
export class SpellProjectileSystem {
  private readonly scene: Scene;
  private readonly matMap = new Map<StaffStyle, StandardMaterial>();
  private readonly bullets: Bullet[] = [];

  constructor(scene: Scene) {
    this.scene = scene;
  }

  private getMaterial(style: StaffStyle): StandardMaterial {
    let m = this.matMap.get(style);
    if (m) return m;

    const col = STYLE_COLORS[style] ?? STYLE_COLORS.arcane;
    m = new StandardMaterial(`bullet_solid_mat_${style}`, this.scene);
    m.diffuseColor = col;
    m.emissiveColor = col;
    m.disableLighting = true;
    m.backFaceCulling = false;

    this.matMap.set(style, m);
    return m;
  }

  /**
   * 发射一枚极简纯色圆形子弹
   */
  spawnOrb(
    spawnPos: Vector3,
    direction: Vector3,
    style: StaffStyle = 'arcane',
    shooter?: Minion,
  ): void {
    const dir =
      direction.lengthSquared() > 1e-6
        ? direction.normalizeToNew()
        : new Vector3(0, 0, 1);

    // 面向摄像机的纯色圆形 Disc Mesh (半径 0.04)
    const disc = MeshBuilder.CreateDisc(
      'bullet',
      { radius: 0.04, tessellation: 32 },
      this.scene,
    );
    disc.material = this.getMaterial(style);
    disc.billboardMode = Mesh.BILLBOARDMODE_ALL;
    disc.isPickable = false;
    disc.position.copyFrom(spawnPos);

    this.bullets.push({
      mesh: disc,
      position: spawnPos.clone(),
      direction: dir,
      speed: 7.2,
      age: 0,
      maxAge: 2.8,
      shooter,
    });
  }

  update(dt: number): void {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i]!;
      b.age += dt;

      const step = b.speed * dt;

      // 碰墙、出界或命中 Minion 小人检测
      if (b.age >= 0.03) {
        const hitRes = this.tryHit(b.position, b.direction, step, b.shooter, b.age);
        const outOfBounds =
          Math.abs(b.position.x) >= 19.8 || Math.abs(b.position.z) >= 19.8;

        if (hitRes.hit || outOfBounds) {
          b.mesh.dispose();
          this.bullets.splice(i, 1);
          continue;
        }
      }

      b.position.addInPlace(b.direction.scale(step));
      b.mesh.position.copyFrom(b.position);

      if (b.age >= b.maxAge) {
        b.mesh.dispose();
        this.bullets.splice(i, 1);
      }
    }
  }

  clear(): void {
    for (const b of this.bullets) {
      if (!b.mesh.isDisposed) b.mesh.dispose();
    }
    this.bullets.length = 0;
  }

  dispose(): void {
    this.clear();
    for (const m of this.matMap.values()) m.dispose();
    this.matMap.clear();
  }

  private tryHit(
    origin: Vector3,
    direction: Vector3,
    stepDist: number,
    shooter?: Minion,
    age: number = 0,
  ): { hit: boolean; hitMinion?: Minion } {
    const ray = new Ray(origin, direction, stepDist + 0.35);
    const pick = this.scene.pickWithRay(ray, (mesh) => this.isHitTarget(mesh));
    if (!pick?.hit || !pick.pickedMesh) return { hit: false };

    // 尝试识别是否命中 Minion 小人
    const targetMinion = pick.pickedMesh.metadata?.minion as Minion | undefined;
    if (targetMinion) {
      // 避免初始 0.12 秒内判定打中发射者自己
      if (targetMinion === shooter && age < 0.12) {
        return { hit: false };
      }
      return { hit: true, hitMinion: targetMinion };
    }

    // 检查墙体
    const normal = pick.getNormal(true);
    const isWall = !normal || Math.abs(normal.y) <= 0.85;
    return { hit: isWall };
  }

  private isHitTarget(mesh: AbstractMesh): boolean {
    if (!mesh.isEnabled()) return false;
    const name = mesh.name.toLowerCase();

    // 排除子弹自身
    if (name.includes('bullet') || name.includes('spell')) {
      return false;
    }

    // 允许判定任何带 minion metadata 的部件
    if (mesh.metadata?.minion) {
      return true;
    }

    // 排除地面
    if (
      (name.includes('floor') && !name.includes('wall')) ||
      name.includes('ground') ||
      name.includes('grid') ||
      name.includes('axes') ||
      name.includes('pad')
    ) {
      return false;
    }

    return (
      name.includes('wall') ||
      name.includes('obstacle') ||
      name.includes('pillar') ||
      name.includes('podium') ||
      name.includes('barrier') ||
      name.includes('collider') ||
      name.includes('arena')
    );
  }
}
