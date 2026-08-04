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
 * 防御塔静态共享资源池（所有防御塔共用一套 Geometry 与 Material，零重复开销）
 */
class DefenseTowerAssets {
  private static instance: DefenseTowerAssets | null = null;

  // 共享材质
  readonly stoneDarkMat: THREE.MeshStandardMaterial;
  readonly stoneMidMat: THREE.MeshStandardMaterial;
  readonly stoneMat: THREE.MeshStandardMaterial;
  readonly stoneBrokenMat: THREE.MeshStandardMaterial;
  readonly metalDarkMat: THREE.MeshStandardMaterial;
  readonly metalMat: THREE.MeshStandardMaterial;
  readonly crystalBlueMat: THREE.MeshStandardMaterial;
  readonly crystalCoreBlueMat: THREE.MeshStandardMaterial;
  readonly crystalRedMat: THREE.MeshStandardMaterial;
  readonly crystalCoreRedMat: THREE.MeshStandardMaterial;
  readonly crystalBrokenMat: THREE.MeshStandardMaterial;

  // 共享几何体 - 完整塔模型
  readonly baseBottomGeo: THREE.CylinderGeometry;
  readonly baseMidGeo: THREE.CylinderGeometry;
  readonly baseTopGeo: THREE.CylinderGeometry;
  readonly ringBottomGeo: THREE.TorusGeometry;
  readonly runeGeo: THREE.BoxGeometry;
  readonly lowerShaftGeo: THREE.CylinderGeometry;
  readonly ringLowerGeo: THREE.TorusGeometry;
  readonly ringMidGeo: THREE.TorusGeometry;
  readonly midShaftGeo: THREE.CylinderGeometry;
  readonly collarGeo: THREE.CylinderGeometry;
  readonly upperShaftGeo: THREE.CylinderGeometry;
  readonly crownGeo: THREE.CylinderGeometry;
  readonly ringCrownGeo: THREE.TorusGeometry;
  readonly clawGeo: THREE.BoxGeometry;
  readonly pedestalGeo: THREE.CylinderGeometry;
  readonly crystalGeo: THREE.OctahedronGeometry;
  readonly crystalCoreGeo: THREE.IcosahedronGeometry;

  // 共享几何体 - 被破坏残骸模型 (Broken Model)
  readonly brokenBaseGeo: THREE.CylinderGeometry;
  readonly brokenStumpGeo: THREE.CylinderGeometry;
  readonly rubbleBoxGeo: THREE.BoxGeometry;
  readonly rubblePolyGeo: THREE.DodecahedronGeometry;
  readonly brokenCrystalGeo: THREE.OctahedronGeometry;

  private constructor() {
    // 石质材质
    this.stoneDarkMat = new THREE.MeshStandardMaterial({
      color: 0x3a4654,
      roughness: 0.9,
      metalness: 0.05,
    });
    this.stoneMidMat = new THREE.MeshStandardMaterial({
      color: 0x4d5c6b,
      roughness: 0.9,
      metalness: 0.05,
    });
    this.stoneMat = new THREE.MeshStandardMaterial({
      color: 0x5c6b7a,
      roughness: 0.9,
      metalness: 0.05,
    });
    this.stoneBrokenMat = new THREE.MeshStandardMaterial({
      color: 0x333d47,
      roughness: 0.95,
      metalness: 0.02,
    });

    // 金属材质
    this.metalDarkMat = new THREE.MeshStandardMaterial({
      color: 0x8a7020,
      roughness: 0.45,
      metalness: 0.75,
    });
    this.metalMat = new THREE.MeshStandardMaterial({
      color: 0xc4a035,
      roughness: 0.45,
      metalness: 0.75,
    });

    // 蓝/红方水晶材质
    this.crystalBlueMat = new THREE.MeshStandardMaterial({
      color: 0x4fc3f7,
      emissive: 0x4fc3f7,
      emissiveIntensity: 0.85,
      roughness: 0.2,
      metalness: 0.15,
      transparent: true,
      opacity: 0.92,
    });
    this.crystalCoreBlueMat = new THREE.MeshStandardMaterial({
      color: 0xe0f7ff,
      emissive: 0xe0f7ff,
      emissiveIntensity: 1.2,
      roughness: 0.15,
      metalness: 0.1,
    });
    this.crystalRedMat = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      emissive: 0xef4444,
      emissiveIntensity: 0.85,
      roughness: 0.2,
      metalness: 0.15,
      transparent: true,
      opacity: 0.92,
    });
    this.crystalCoreRedMat = new THREE.MeshStandardMaterial({
      color: 0xffe4e6,
      emissive: 0xffe4e6,
      emissiveIntensity: 1.2,
      roughness: 0.15,
      metalness: 0.1,
    });
    this.crystalBrokenMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      emissive: 0x0f172a,
      emissiveIntensity: 0.05,
      roughness: 0.85,
      metalness: 0.1,
      transparent: true,
      opacity: 0.65,
    });

    // 几何体 - 完整防御塔
    this.baseBottomGeo = new THREE.CylinderGeometry(0.55, 0.62, 0.12, 8);
    this.baseMidGeo = new THREE.CylinderGeometry(0.46, 0.52, 0.14, 8);
    this.baseTopGeo = new THREE.CylinderGeometry(0.38, 0.42, 0.1, 8);
    this.ringBottomGeo = new THREE.TorusGeometry(0.4, 0.03, 8, 20);
    this.runeGeo = new THREE.BoxGeometry(0.08, 0.1, 0.05);
    this.lowerShaftGeo = new THREE.CylinderGeometry(0.28, 0.36, 0.85, 8);
    this.ringLowerGeo = new THREE.TorusGeometry(0.3, 0.025, 8, 20);
    this.ringMidGeo = new THREE.TorusGeometry(0.29, 0.022, 8, 20);
    this.midShaftGeo = new THREE.CylinderGeometry(0.24, 0.28, 0.55, 8);
    this.collarGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.1, 8);
    this.upperShaftGeo = new THREE.CylinderGeometry(0.22, 0.26, 0.5, 8);
    this.crownGeo = new THREE.CylinderGeometry(0.34, 0.3, 0.12, 8);
    this.ringCrownGeo = new THREE.TorusGeometry(0.33, 0.02, 8, 20);
    this.clawGeo = new THREE.BoxGeometry(0.06, 0.38, 0.08);
    this.pedestalGeo = new THREE.CylinderGeometry(0.08, 0.12, 0.16, 8);
    this.crystalGeo = new THREE.OctahedronGeometry(0.22, 0);
    this.crystalCoreGeo = new THREE.IcosahedronGeometry(0.1, 0);

    // 几何体 - 被破坏残骸
    this.brokenBaseGeo = new THREE.CylinderGeometry(0.52, 0.62, 0.16, 8);
    this.brokenStumpGeo = new THREE.CylinderGeometry(0.34, 0.44, 0.38, 7);
    this.rubbleBoxGeo = new THREE.BoxGeometry(0.18, 0.14, 0.16);
    this.rubblePolyGeo = new THREE.DodecahedronGeometry(0.13, 0);
    this.brokenCrystalGeo = new THREE.OctahedronGeometry(0.14, 0);
  }

  static get get(): DefenseTowerAssets {
    if (!DefenseTowerAssets.instance) {
      DefenseTowerAssets.instance = new DefenseTowerAssets();
    }
    return DefenseTowerAssets.instance;
  }
}

/**
 * 防御塔类（LoL 风格防御塔）
 * 特征：
 * 1. 模型复用：共享全局单例 Geometry 与 Material 资源，8座防御塔零重复创建。
 * 2. 双模型分离：独立构建“完整状态模型 (fullModel)”与“被破坏残骸模型 (brokenModel)”，摧毁时无缝瞬间切换。
 */
export class DefenseTower extends THREE.Group implements CombatUnit {
  private static readonly SCALE_XZ = 0.65;
  private static readonly SCALE_Y = 0.48;
  static readonly COLLIDER_RADIUS = 0.42;
  static readonly MAX_HP = 520;
  static readonly COMBAT_PRIORITY = 1;
  static readonly ATTACK_RANGE = 2.0;
  static readonly ATTACK_DAMAGE = 55;
  static readonly ATTACK_INTERVAL = 1.85;
  static readonly WINDUP = 0.22;
  static readonly BOLT_SCALE = 5;

  /** 完整状态模型 */
  readonly fullModel: THREE.Group;
  /** 被破坏状态模型（废墟残骸） */
  private readonly brokenModel: THREE.Group;

  private readonly crystal: THREE.Mesh;
  private readonly crystalGroup: THREE.Group;
  private readonly crystalLight: THREE.PointLight;
  private readonly healthBar: HealthBar;
  private readonly rangeMarker: THREE.Group;

  private elapsed = 0;
  private target: CombatUnit | null = null;
  private attackCd = 0;
  private windupElapsed = -1;
  private readonly muzzleWorld = new THREE.Vector3();

  readonly team: TeamId;
  readonly collider: CircleBody;
  readonly combatPriority = DefenseTower.COMBAT_PRIORITY;
  readonly maxHp = DefenseTower.MAX_HP;
  hp = DefenseTower.MAX_HP;

  constructor(x: number, z = 0) {
    super();
    this.name = `DefenseTower_${x}_${z}`;
    this.position.set(x, 0, z);
    this.team = x > 0 ? 'red' : 'blue';

    this.scale.set(
      DefenseTower.SCALE_XZ,
      DefenseTower.SCALE_Y,
      DefenseTower.SCALE_XZ,
    );
    this.collider = new CircleBody(this, DefenseTower.COLLIDER_RADIUS, {
      isStatic: true,
    });

    const assets = DefenseTowerAssets.get;
    const isRed = this.team === 'red';

    // ==========================================
    // 1. 构建【完整状态模型 (fullModel)】
    // ==========================================
    this.fullModel = new THREE.Group();
    this.fullModel.name = 'TowerFullModel';
    this.add(this.fullModel);

    // --- 底座 ---
    this.fullModel.add(mesh(assets.baseBottomGeo, assets.stoneDarkMat, 0.06));
    this.fullModel.add(mesh(assets.baseMidGeo, assets.stoneMidMat, 0.19));
    this.fullModel.add(mesh(assets.baseTopGeo, assets.stoneMat, 0.31));
    this.fullModel.add(ring(assets.ringBottomGeo, assets.metalDarkMat, 0.36));

    // 底部一圈小符文石
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const rune = new THREE.Mesh(assets.runeGeo, assets.metalMat);
      rune.position.set(Math.cos(a) * 0.48, 0.28, Math.sin(a) * 0.48);
      rune.rotation.y = -a;
      rune.castShadow = true;
      this.fullModel.add(rune);
    }

    // --- 塔身 ---
    this.fullModel.add(mesh(assets.lowerShaftGeo, assets.stoneMat, 0.36 + 0.425));
    this.fullModel.add(ring(assets.ringLowerGeo, assets.metalMat, 0.55));
    this.fullModel.add(ring(assets.ringMidGeo, assets.metalMat, 1.05));
    this.fullModel.add(mesh(assets.midShaftGeo, assets.stoneMidMat, 1.21 + 0.275));
    this.fullModel.add(mesh(assets.collarGeo, assets.metalMat, 1.55));
    this.fullModel.add(mesh(assets.upperShaftGeo, assets.stoneMat, 1.6 + 0.25));
    this.fullModel.add(mesh(assets.crownGeo, assets.stoneDarkMat, 2.16));
    this.fullModel.add(ring(assets.ringCrownGeo, assets.metalMat, 2.23));

    // 四爪支撑
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const claw = new THREE.Mesh(assets.clawGeo, assets.metalDarkMat);
      claw.position.set(Math.cos(a) * 0.22, 2.38, Math.sin(a) * 0.22);
      claw.lookAt(0, 2.7, 0);
      claw.castShadow = true;
      this.fullModel.add(claw);
    }

    // 短柱
    this.fullModel.add(mesh(assets.pedestalGeo, assets.metalMat, 2.3));

    // --- 能量水晶 ---
    this.crystalGroup = new THREE.Group();
    this.crystalGroup.position.y = 2.55;
    this.fullModel.add(this.crystalGroup);

    const crystalMat = isRed ? assets.crystalRedMat : assets.crystalBlueMat;
    const crystalCoreMat = isRed ? assets.crystalCoreRedMat : assets.crystalCoreBlueMat;

    this.crystal = new THREE.Mesh(assets.crystalGeo, crystalMat);
    this.crystal.castShadow = true;
    this.crystalGroup.add(this.crystal);

    const core = new THREE.Mesh(assets.crystalCoreGeo, crystalCoreMat);
    this.crystalGroup.add(core);

    const crystalColor = isRed ? 0xef4444 : 0x4fc3f7;
    this.crystalLight = new THREE.PointLight(crystalColor, 1.1, 6, 2);
    this.crystalLight.position.set(0, 0, 0);
    this.crystalGroup.add(this.crystalLight);

    // ==========================================
    // 2. 构建【被破坏状态模型 (brokenModel)】
    // ==========================================
    this.brokenModel = new THREE.Group();
    this.brokenModel.name = 'TowerBrokenModel';
    this.add(this.brokenModel);

    // 破损开裂底座
    const brokenBase = mesh(assets.brokenBaseGeo, assets.stoneBrokenMat, 0.08);
    this.brokenModel.add(brokenBase);

    // 倾斜断塌的残柱
    const brokenStump = mesh(assets.brokenStumpGeo, assets.stoneDarkMat, 0.25);
    brokenStump.rotation.z = 0.18;
    brokenStump.rotation.x = -0.12;
    this.brokenModel.add(brokenStump);

    // 散落周边的几块破损石块 (Rubble)
    const rubblePositions = [
      { x: 0.38, y: 0.08, z: 0.25, rx: 0.4, ry: 0.2, rz: 0.6 },
      { x: -0.42, y: 0.07, z: -0.18, rx: 0.2, ry: 0.8, rz: -0.3 },
      { x: 0.22, y: 0.06, z: -0.45, rx: -0.5, ry: 0.3, rz: 0.1 },
      { x: -0.28, y: 0.09, z: 0.36, rx: 0.3, ry: -0.4, rz: 0.7 },
    ];
    for (const r of rubblePositions) {
      const rubble = new THREE.Mesh(assets.rubbleBoxGeo, assets.stoneBrokenMat);
      rubble.position.set(r.x, r.y, r.z);
      rubble.rotation.set(r.rx, r.ry, r.rz);
      rubble.castShadow = true;
      this.brokenModel.add(rubble);
    }

    const polyRubble = new THREE.Mesh(assets.rubblePolyGeo, assets.stoneMidMat);
    polyRubble.position.set(0.12, 0.1, 0.32);
    polyRubble.rotation.set(0.5, 0.5, 0.2);
    polyRubble.castShadow = true;
    this.brokenModel.add(polyRubble);

    // 跌落在残骸旁、熄灭破裂的水晶渣
    const brokenCrystal = new THREE.Mesh(assets.brokenCrystalGeo, assets.crystalBrokenMat);
    brokenCrystal.position.set(-0.25, 0.12, 0.2);
    brokenCrystal.rotation.set(0.8, 0.3, 1.2);
    brokenCrystal.scale.set(0.9, 0.5, 0.8);
    this.brokenModel.add(brokenCrystal);

    // 初始状态：显示完整模型，隐藏破损模型
    this.fullModel.visible = true;
    this.brokenModel.visible = false;

    // ==========================================
    // 3. UI 元素（血条与攻击范围圈）
    //    悬停外轮廓由主循环 OutlinePass 后处理绘制（选中 fullModel）
    // ==========================================
    this.healthBar = new HealthBar({
      width: 0.55 / DefenseTower.SCALE_XZ,
      height: 0.05 / DefenseTower.SCALE_Y,
      yOffset: 3.05,
      team: this.team,
    });
    this.add(this.healthBar);
    this.healthBar.setHp(this.hp, this.maxHp);

    this.rangeMarker = createAttackRangeMarker(
      this.team,
      DefenseTower.ATTACK_RANGE,
      DefenseTower.SCALE_XZ,
      DefenseTower.SCALE_Y,
    );
    this.add(this.rangeMarker);
  }

  private invincible = false;

  get isInvincible(): boolean {
    return this.invincible;
  }

  setInvincible(invincible: boolean): void {
    this.invincible = invincible;
  }

  get isAlive(): boolean {
    return this.hp > 0;
  }

  takeDamage(amount: number): void {
    if (this.invincible || !this.isAlive || amount <= 0) return;
    this.hp = Math.max(0, this.hp - amount);
    this.healthBar.setHp(this.hp, this.maxHp);
    if (!this.isAlive) {
      this.onDestroyed();
    }
  }

  getHitPoint(out: THREE.Vector3): THREE.Vector3 {
    out.set(
      this.position.x,
      this.position.y + 1.5 * DefenseTower.SCALE_Y,
      this.position.z,
    );
    return out;
  }

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

  /**
   * 相机更新后调用：血条贴近视口安全区，尽量完整显示。
   */
  updateHealthBarViewport(camera: THREE.Camera): void {
    if (!this.isAlive) {
      this.healthBar.resetViewportFit();
      return;
    }
    this.healthBar.updateViewportFit(camera);
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
    if (isValidTarget(this, this.target)) {
      const d = distXZ(this.collider, this.target.collider);
      if (d > DefenseTower.ATTACK_RANGE) {
        this.clearTarget();
      }
    } else {
      this.clearTarget();
    }

    if (!this.target) {
      this.target = pickEnemyTarget(
        this,
        units,
        DefenseTower.ATTACK_RANGE,
      );
      this.windupElapsed = -1;
    }

    if (!this.target) return;

    if (this.attackCd > 0 && this.windupElapsed < 0) {
      return;
    }

    if (this.windupElapsed < 0) {
      this.windupElapsed = 0;
    }
    this.windupElapsed += delta;

    if (this.windupElapsed < DefenseTower.WINDUP) return;

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
        { hitSfx: 'tower' },
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

  /**
   * 被摧毁时：无缝瞬间做模型替换（隐藏 fullModel，显示 brokenModel）
   */
  private onDestroyed(): void {
    this.fullModel.visible = false;
    this.brokenModel.visible = true;
    this.crystalLight.intensity = 0;
    this.rangeMarker.visible = false;
    this.healthBar.resetViewportFit();
    this.healthBar.visible = false;
    this.clearTarget();
  }

  /**
   * 启动 GPU 预热：同时显示完整塔 + 残骸，供 renderer.compile 编译材质/上传几何。
   * 结束后必须调用 restoreAfterGpuWarmup()。
   */
  prepareGpuWarmup(): void {
    this.fullModel.visible = true;
    this.brokenModel.visible = true;
    // 预热时关掉点光，避免 compile 路径里额外处理光源变化
    this.crystalLight.visible = false;
  }

  /** 预热结束后恢复到与存活状态一致的显示 */
  restoreAfterGpuWarmup(): void {
    const alive = this.isAlive;
    this.fullModel.visible = alive;
    this.brokenModel.visible = !alive;
    this.crystalLight.visible = alive;
    this.crystalLight.intensity = alive ? 0.85 : 0;
    this.rangeMarker.visible = alive;
    this.healthBar.visible = alive;
  }

  dispose(): void {
    // Geometry 与 Material 为全局共享，此处仅清理节点引用
  }
}

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
      opacity: 0.03,
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

  const segments = 96;
  const positions = new Float32Array((segments + 1) * 3);
  for (let i = 0; i <= segments; i += 1) {
    const a = (i / segments) * Math.PI * 2;
    const i3 = i * 3;
    positions[i3] = Math.cos(a) * localR;
    positions[i3 + 1] = 0;
    positions[i3 + 2] = Math.sin(a) * localR;
  }
  const edgeGeo = new THREE.BufferGeometry();
  edgeGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const edge = new THREE.LineLoop(
    edgeGeo,
    new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    }),
  );
  edge.position.y = yRing;
  edge.renderOrder = 2;
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
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  y: number,
): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.rotation.x = Math.PI / 2;
  m.position.y = y;
  m.castShadow = true;
  return m;
}
