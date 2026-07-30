import * as THREE from 'three';
import { CircleBody } from './collision/CircleBody';
import type { CombatUnit, TeamId } from './combat/CombatUnit';
import { HealthBar } from './ui/HealthBar';

/**
 * 基地水晶（Nexus 示意，非官方素材）。
 * 放置在兵线末端八边形平台上：大能量核心 + 托架底座。
 * 可受伤、挡路；暂不主动攻击。
 */
export class NexusCrystal extends THREE.Group implements CombatUnit {
  /** 地面圆形碰撞半径 */
  static readonly COLLIDER_RADIUS = 0.72;
  static readonly MAX_HP = 1800;
  /** 高于防御塔：小兵优先推水晶 */
  static readonly COMBAT_PRIORITY = 2;

  private static readonly STONE = 0x5c6b7a;
  private static readonly STONE_DARK = 0x3a4654;
  private static readonly STONE_MID = 0x4d5c6b;
  private static readonly METAL = 0xc4a035;
  private static readonly METAL_DARK = 0x8a7020;
  private static readonly CRYSTAL_BLUE = 0x4fc3f7;
  private static readonly CRYSTAL_BLUE_CORE = 0xe0f7ff;
  private static readonly CRYSTAL_RED = 0xef4444;
  private static readonly CRYSTAL_RED_CORE = 0xffe4e6;

  private readonly crystal: THREE.Mesh;
  private readonly crystalCore: THREE.Mesh;
  private readonly crystalGroup: THREE.Group;
  private readonly crystalLight: THREE.PointLight;
  private readonly upperRoot: THREE.Group;
  private readonly healthBar: HealthBar;
  private elapsed = 0;

  readonly team: TeamId;
  readonly collider: CircleBody;
  readonly combatPriority = NexusCrystal.COMBAT_PRIORITY;
  readonly maxHp = NexusCrystal.MAX_HP;
  hp = NexusCrystal.MAX_HP;

  /**
   * @param x 世界 X；x > 0 红方，x < 0 蓝方
   */
  constructor(x: number, z = 0) {
    super();
    this.name = `NexusCrystal_${x}_${z}`;
    this.position.set(x, 0, z);
    this.team = x > 0 ? 'red' : 'blue';

    const isRed = this.team === 'red';
    const crystalColor = isRed
      ? NexusCrystal.CRYSTAL_RED
      : NexusCrystal.CRYSTAL_BLUE;
    const crystalCoreColor = isRed
      ? NexusCrystal.CRYSTAL_RED_CORE
      : NexusCrystal.CRYSTAL_BLUE_CORE;

    this.collider = new CircleBody(this, NexusCrystal.COLLIDER_RADIUS, {
      isStatic: true,
    });

    const stone = (color: number) =>
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.9,
        metalness: 0.05,
      });
    const metal = (color: number) =>
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.45,
        metalness: 0.75,
      });

    this.upperRoot = new THREE.Group();
    this.upperRoot.name = 'NexusUpper';
    this.add(this.upperRoot);

    // —— 多层基座（比防御塔更宽）——
    this.add(
      mesh(
        new THREE.CylinderGeometry(0.95, 1.05, 0.14, 8),
        stone(NexusCrystal.STONE_DARK),
        0.07,
      ),
    );
    this.add(
      mesh(
        new THREE.CylinderGeometry(0.82, 0.9, 0.12, 8),
        stone(NexusCrystal.STONE_MID),
        0.2,
      ),
    );
    this.add(
      mesh(
        new THREE.CylinderGeometry(0.68, 0.76, 0.1, 8),
        stone(NexusCrystal.STONE),
        0.31,
      ),
    );
    this.add(
      ring(
        0.72,
        0.035,
        0.37,
        metal(NexusCrystal.METAL_DARK),
      ),
    );

    // 基座环绕符文柱
    const runeMat = metal(NexusCrystal.METAL);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const pillar = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.28, 0.1),
        runeMat,
      );
      pillar.position.set(Math.cos(a) * 0.78, 0.42, Math.sin(a) * 0.78);
      pillar.castShadow = true;
      this.add(pillar);
    }

    // —— 托架平台 ——
    this.upperRoot.add(
      mesh(
        new THREE.CylinderGeometry(0.55, 0.62, 0.16, 8),
        stone(NexusCrystal.STONE_DARK),
        0.5,
      ),
    );
    this.upperRoot.add(
      ring(0.54, 0.028, 0.58, metal(NexusCrystal.METAL)),
    );

    // 四爪托住水晶
    const clawMat = metal(NexusCrystal.METAL_DARK);
    const clawGeo = new THREE.BoxGeometry(0.08, 0.55, 0.1);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const claw = new THREE.Mesh(clawGeo, clawMat);
      claw.position.set(Math.cos(a) * 0.32, 0.85, Math.sin(a) * 0.32);
      claw.lookAt(0, 1.35, 0);
      claw.castShadow = true;
      this.upperRoot.add(claw);
    }

    // 短柱
    this.upperRoot.add(
      mesh(
        new THREE.CylinderGeometry(0.1, 0.16, 0.2, 8),
        metal(NexusCrystal.METAL),
        0.68,
      ),
    );

    // —— 能量水晶（主体，比塔顶水晶大很多）——
    this.crystalGroup = new THREE.Group();
    this.crystalGroup.position.y = 1.15;
    this.upperRoot.add(this.crystalGroup);

    const crystalMat = new THREE.MeshStandardMaterial({
      color: crystalColor,
      emissive: crystalColor,
      emissiveIntensity: 0.9,
      roughness: 0.18,
      metalness: 0.12,
      transparent: true,
      opacity: 0.92,
    });
    this.crystal = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.48, 0),
      crystalMat,
    );
    this.crystal.castShadow = true;
    this.crystalGroup.add(this.crystal);

    // 外壳碎片感：竖直拉长的第二层八面体
    const shell = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.38, 0),
      new THREE.MeshStandardMaterial({
        color: crystalColor,
        emissive: crystalColor,
        emissiveIntensity: 0.55,
        roughness: 0.25,
        metalness: 0.1,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
      }),
    );
    shell.scale.set(1.15, 1.45, 1.15);
    this.crystalGroup.add(shell);

    this.crystalCore = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.18, 1),
      new THREE.MeshStandardMaterial({
        color: crystalCoreColor,
        emissive: crystalCoreColor,
        emissiveIntensity: 1.35,
        roughness: 0.12,
        metalness: 0.08,
      }),
    );
    this.crystalGroup.add(this.crystalCore);

    this.crystalLight = new THREE.PointLight(crystalColor, 2.2, 12, 2);
    this.crystalLight.position.set(0, 0, 0);
    this.crystalGroup.add(this.crystalLight);

    // 血条
    this.healthBar = new HealthBar({
      width: 1.1,
      height: 0.07,
      yOffset: 2.15,
      team: this.team,
    });
    this.add(this.healthBar);
    this.healthBar.setHp(this.hp, this.maxHp);
  }

  get isAlive(): boolean {
    return this.hp > 0;
  }

  takeDamage(amount: number): void {
    if (!this.isAlive || amount <= 0) return;
    this.hp = Math.max(0, this.hp - amount);
    this.healthBar.setHp(this.hp, this.maxHp);
    if (!this.isAlive) {
      this.onDestroyed();
    }
  }

  getHitPoint(out: THREE.Vector3): THREE.Vector3 {
    out.set(this.position.x, this.position.y + 1.15, this.position.z);
    return out;
  }

  /** 水晶悬浮 / 自转 / 脉动 */
  update(delta: number): void {
    if (!this.isAlive) return;
    this.elapsed += delta;
    this.animateCrystal(delta);
  }

  private animateCrystal(delta: number): void {
    this.crystal.rotation.y += delta * 0.45;
    this.crystalCore.rotation.y -= delta * 0.7;
    this.crystal.rotation.x = Math.sin(this.elapsed * 0.7) * 0.06;

    const pulse = 0.75 + Math.sin(this.elapsed * 2.1) * 0.25;
    this.crystalLight.intensity = 1.6 + pulse * 0.9;
    const mat = this.crystal.material as THREE.MeshStandardMaterial;
    mat.emissiveIntensity = 0.7 + pulse * 0.5;

    this.crystalGroup.position.y = 1.15 + Math.sin(this.elapsed * 1.4) * 0.05;
  }

  private onDestroyed(): void {
    this.upperRoot.visible = false;
    this.crystalLight.intensity = 0;
    this.healthBar.visible = false;
  }

  dispose(): void {
    this.traverse((obj) => {
      const meshObj = obj as THREE.Mesh;
      if (meshObj.geometry) meshObj.geometry.dispose();
      const material = meshObj.material;
      if (!material) return;
      const list = Array.isArray(material) ? material : [material];
      for (const m of list) m.dispose();
    });
  }
}

function mesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  y: number,
): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.position.y = y;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function ring(
  radius: number,
  tube: number,
  y: number,
  material: THREE.Material,
): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.TorusGeometry(radius, tube, 8, 24),
    material,
  );
  m.rotation.x = Math.PI / 2;
  m.position.y = y;
  m.castShadow = true;
  return m;
}
