import * as THREE from 'three';
import type { ProjectileManager } from '../effects/ProjectileManager';
import { CircleBody } from './collision/CircleBody';
import type { CombatUnit, TeamId } from './combat/CombatUnit';
import {
  distXZ,
  isValidTarget,
  pickEnemyTarget,
} from './combat/combatMath';
import { HealthBar } from './ui/HealthBar';

/**
 * 防御塔（LoL 风格示意，非官方素材）。
 * 特征：厚重基座、分段石塔身、金属箍、顶部能量水晶。
 * 战斗：范围内锁定敌方单位，从水晶发射追踪弹。
 */
export class DefenseTower extends THREE.Group implements CombatUnit {
  /** 水平缩放 */
  private static readonly SCALE_XZ = 0.65;
  /** 高度缩放（更矮） */
  private static readonly SCALE_Y = 0.48;
  /** 地面圆形碰撞半径（世界单位，约贴合基座） */
  static readonly COLLIDER_RADIUS = 0.42;
  static readonly MAX_HP = 520;
  /** 索敌优先级：低于小兵，小兵优先互打再推塔 */
  static readonly COMBAT_PRIORITY = 1;
  /** 攻击范围（世界单位，圆心距） */
  static readonly ATTACK_RANGE = 2.0;
  /** 单发伤害（约两发清一个小兵） */
  static readonly ATTACK_DAMAGE = 55;
  /** 攻击间隔（秒，含前摇）——比小兵更慢 */
  static readonly ATTACK_INTERVAL = 1.85;
  /** 出手前摇（秒） */
  static readonly WINDUP = 0.22;
  /** 塔弹视觉缩放（相对小兵弹） */
  static readonly BOLT_SCALE = 5;

  // 召唤师峡谷蓝方气质配色
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
  private readonly crystalLight: THREE.PointLight;
  private readonly crystalGroup: THREE.Group;
  private readonly healthBar: HealthBar;
  private readonly rangeMarker: THREE.Group;
  private elapsed = 0;

  /** 当前锁定目标（出范围或死亡后清空） */
  private target: CombatUnit | null = null;
  /** 攻击冷却：>0 时不能开始新前摇 */
  private attackCd = 0;
  /** 前摇计时；<0 表示不在前摇 */
  private windupElapsed = -1;
  private readonly muzzleWorld = new THREE.Vector3();

  readonly team: TeamId;
  readonly collider: CircleBody;
  readonly combatPriority = DefenseTower.COMBAT_PRIORITY;
  readonly maxHp = DefenseTower.MAX_HP;
  hp = DefenseTower.MAX_HP;

  /**
   * @param x 世界 X；x > 0 为红方水晶，x < 0 为蓝方水晶
   */
  constructor(x: number, z = 0) {
    super();
    this.name = `DefenseTower_${x}_${z}`;
    this.position.set(x, 0, z);
    this.team = x > 0 ? 'red' : 'blue';

    const isRed = this.team === 'red';
    const crystalColor = isRed
      ? DefenseTower.CRYSTAL_RED
      : DefenseTower.CRYSTAL_BLUE;
    const crystalCore = isRed
      ? DefenseTower.CRYSTAL_RED_CORE
      : DefenseTower.CRYSTAL_BLUE_CORE;
    this.scale.set(
      DefenseTower.SCALE_XZ,
      DefenseTower.SCALE_Y,
      DefenseTower.SCALE_XZ,
    );
    this.collider = new CircleBody(this, DefenseTower.COLLIDER_RADIUS, {
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

    // —— 基座（多层台阶，LoL 塔底座很“沉”）——
    const baseBottom = mesh(
      new THREE.CylinderGeometry(0.55, 0.62, 0.12, 8),
      stone(DefenseTower.STONE_DARK),
      0.06,
    );
    this.add(baseBottom);

    const baseMid = mesh(
      new THREE.CylinderGeometry(0.46, 0.52, 0.14, 8),
      stone(DefenseTower.STONE_MID),
      0.19,
    );
    this.add(baseMid);

    const baseTop = mesh(
      new THREE.CylinderGeometry(0.38, 0.42, 0.1, 8),
      stone(DefenseTower.STONE),
      0.31,
    );
    this.add(baseTop);

    // 底座金边
    this.add(
      ring(0.4, 0.03, DefenseTower.METAL_DARK, 0.36, metal(DefenseTower.METAL_DARK)),
    );

    // —— 下塔身（粗）——
    const lowerShaft = mesh(
      new THREE.CylinderGeometry(0.28, 0.36, 0.85, 8),
      stone(DefenseTower.STONE),
      0.36 + 0.425,
    );
    this.add(lowerShaft);

    // 下段金属箍
    this.add(ring(0.3, 0.025, DefenseTower.METAL, 0.55, metal(DefenseTower.METAL)));
    this.add(ring(0.29, 0.022, DefenseTower.METAL, 1.05, metal(DefenseTower.METAL)));

    // —— 中段收腰 ——
    const midShaft = mesh(
      new THREE.CylinderGeometry(0.24, 0.28, 0.55, 8),
      stone(DefenseTower.STONE_MID),
      1.21 + 0.275,
    );
    this.add(midShaft);

    // 中段饰带
    const collar = mesh(
      new THREE.CylinderGeometry(0.32, 0.32, 0.1, 8),
      metal(DefenseTower.METAL),
      1.55,
    );
    this.add(collar);

    // —— 上塔身 ——
    const upperShaft = mesh(
      new THREE.CylinderGeometry(0.22, 0.26, 0.5, 8),
      stone(DefenseTower.STONE),
      1.6 + 0.25,
    );
    this.add(upperShaft);

    // —— 顶部平台（托住水晶）——
    const crown = mesh(
      new THREE.CylinderGeometry(0.34, 0.3, 0.12, 8),
      stone(DefenseTower.STONE_DARK),
      2.16,
    );
    this.add(crown);
    this.add(ring(0.33, 0.02, DefenseTower.METAL, 2.23, metal(DefenseTower.METAL)));

    // 托架“爪”：四根斜撑，类似塔顶金属支架
    const clawMat = metal(DefenseTower.METAL_DARK);
    const clawGeo = new THREE.BoxGeometry(0.06, 0.38, 0.08);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const claw = new THREE.Mesh(clawGeo, clawMat);
      claw.position.set(Math.cos(a) * 0.22, 2.38, Math.sin(a) * 0.22);
      claw.lookAt(0, 2.7, 0);
      claw.castShadow = true;
      this.add(claw);
    }

    // 短柱支撑水晶
    const pedestal = mesh(
      new THREE.CylinderGeometry(0.08, 0.12, 0.16, 8),
      metal(DefenseTower.METAL),
      2.3,
    );
    this.add(pedestal);

    // —— 能量水晶（LoL 塔核心识别点）——
    this.crystalGroup = new THREE.Group();
    this.crystalGroup.position.y = 2.55;
    this.add(this.crystalGroup);

    const crystalMat = new THREE.MeshStandardMaterial({
      color: crystalColor,
      emissive: crystalColor,
      emissiveIntensity: 0.85,
      roughness: 0.2,
      metalness: 0.15,
      transparent: true,
      opacity: 0.92,
    });
    this.crystal = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.22, 0),
      crystalMat,
    );
    this.crystal.castShadow = true;
    this.crystalGroup.add(this.crystal);

    // 内核高亮
    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.1, 0),
      new THREE.MeshStandardMaterial({
        color: crystalCore,
        emissive: crystalCore,
        emissiveIntensity: 1.2,
        roughness: 0.15,
        metalness: 0.1,
      }),
    );
    this.crystalGroup.add(core);

    // 水晶光晕
    this.crystalLight = new THREE.PointLight(crystalColor, 1.1, 6, 2);
    this.crystalLight.position.set(0, 0, 0);
    this.crystalGroup.add(this.crystalLight);

    // 底部一圈小符文石（装饰）
    const runeMat = metal(DefenseTower.METAL);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const rune = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.1, 0.05),
        runeMat,
      );
      rune.position.set(Math.cos(a) * 0.48, 0.28, Math.sin(a) * 0.48);
      rune.rotation.y = -a;
      this.add(rune);
    }

    // 塔顶血条：补偿父级非均匀 scale，约 0.55×0.05 世界单位
    this.healthBar = new HealthBar({
      width: 0.55 / DefenseTower.SCALE_XZ,
      height: 0.05 / DefenseTower.SCALE_Y,
      yOffset: 3.05,
      team: this.team,
    });
    this.add(this.healthBar);
    this.healthBar.setHp(this.hp, this.maxHp);

    // 攻击范围地面标记（半径补偿父级 XZ 缩放）
    this.rangeMarker = createAttackRangeMarker(
      this.team,
      DefenseTower.ATTACK_RANGE,
      DefenseTower.SCALE_XZ,
      DefenseTower.SCALE_Y,
    );
    this.add(this.rangeMarker);
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

  /** 弹道落点：中段塔身中心（本地 y≈1.5，再乘高度缩放） */
  getHitPoint(out: THREE.Vector3): THREE.Vector3 {
    out.set(
      this.position.x,
      this.position.y + 1.5 * DefenseTower.SCALE_Y,
      this.position.z,
    );
    return out;
  }

  /**
   * 水晶动画 + 索敌攻击。
   * 范围内优先小兵，锁定后持续输出直至死亡或离开范围。
   */
  update(
    delta: number,
    units: readonly CombatUnit[],
    projectiles: ProjectileManager,
  ): void {
    if (!this.isAlive) return;

    this.elapsed += delta;
    this.animateCrystal(delta);

    if (this.attackCd > 0) {
      this.attackCd = Math.max(0, this.attackCd - delta);
    }

    this.tickCombat(delta, units, projectiles);
  }

  private animateCrystal(_delta: number): void {
    this.crystal.rotation.y += _delta * 0.6;
    this.crystal.rotation.x = Math.sin(this.elapsed * 0.8) * 0.08;

    const pulse = 0.75 + Math.sin(this.elapsed * 2.4) * 0.25;
    this.crystalLight.intensity = 0.85 + pulse * 0.45;
    const mat = this.crystal.material as THREE.MeshStandardMaterial;
    mat.emissiveIntensity = 0.65 + pulse * 0.45;

    this.crystalGroup.position.y = 2.55 + Math.sin(this.elapsed * 1.6) * 0.03;
  }

  private tickCombat(
    delta: number,
    units: readonly CombatUnit[],
    projectiles: ProjectileManager,
  ): void {
    // 已锁定目标：校验存活与范围
    if (isValidTarget(this, this.target)) {
      const d = distXZ(this.collider, this.target.collider);
      if (d > DefenseTower.ATTACK_RANGE) {
        this.clearTarget();
      }
    } else {
      this.clearTarget();
    }

    // 无目标时重新索敌（优先小兵）
    if (!this.target) {
      this.target = pickEnemyTarget(
        this,
        units,
        DefenseTower.ATTACK_RANGE,
      );
      this.windupElapsed = -1;
    }

    if (!this.target) return;

    // 冷却中且不在前摇：等待
    if (this.attackCd > 0 && this.windupElapsed < 0) {
      return;
    }

    // 开始 / 继续前摇
    if (this.windupElapsed < 0) {
      this.windupElapsed = 0;
    }
    this.windupElapsed += delta;

    if (this.windupElapsed < DefenseTower.WINDUP) return;

    // 出手：从水晶世界坐标发射锁定弹
    if (
      isValidTarget(this, this.target) &&
      distXZ(this.collider, this.target.collider) <= DefenseTower.ATTACK_RANGE
    ) {
      this.crystalGroup.getWorldPosition(this.muzzleWorld);
      projectiles.fireAt(
        this.muzzleWorld,
        this.target,
        DefenseTower.ATTACK_DAMAGE,
        this.team,
        DefenseTower.BOLT_SCALE,
      );
    }

    this.windupElapsed = -1;
    this.attackCd = Math.max(
      0,
      DefenseTower.ATTACK_INTERVAL - DefenseTower.WINDUP,
    );
  }

  private clearTarget(): void {
    this.target = null;
    this.windupElapsed = -1;
  }

  private onDestroyed(): void {
    this.crystalGroup.visible = false;
    this.crystalLight.intensity = 0;
    this.rangeMarker.visible = false;
    this.clearTarget();
  }

  dispose(): void {
    this.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const material = mesh.material;
      if (!material) return;
      const list = Array.isArray(material) ? material : [material];
      for (const m of list) m.dispose();
    });
  }
}

/**
 * 地面攻击范围：淡色填充圆 + 边缘环。
 * 几何半径按父级 SCALE_XZ 反向补偿，使世界半径 = attackRange。
 */
function createAttackRangeMarker(
  team: TeamId,
  attackRange: number,
  scaleXZ: number,
  scaleY: number,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'AttackRangeMarker';

  const color = team === 'red' ? 0xef4444 : 0x3b82f6;
  const localR = attackRange / scaleXZ;
  const yFill = 0.018 / scaleY;
  const yRing = 0.022 / scaleY;

  const fill = new THREE.Mesh(
    new THREE.CircleGeometry(localR, 64),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.07,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  fill.rotation.x = -Math.PI / 2;
  fill.position.y = yFill;
  fill.renderOrder = 1;
  fill.receiveShadow = false;
  fill.castShadow = false;
  group.add(fill);

  const edge = new THREE.Mesh(
    new THREE.RingGeometry(localR * 0.98, localR, 64),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  edge.rotation.x = -Math.PI / 2;
  edge.position.y = yRing;
  edge.renderOrder = 2;
  edge.receiveShadow = false;
  edge.castShadow = false;
  group.add(edge);

  return group;
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
  _color: number,
  y: number,
  material: THREE.Material,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 8, 20), material);
  m.rotation.x = Math.PI / 2;
  m.position.y = y;
  m.castShadow = true;
  return m;
}
