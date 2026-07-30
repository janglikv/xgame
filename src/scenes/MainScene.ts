import * as THREE from 'three';
import { GroundCastIndicator } from '../effects/GroundCastIndicator';
import { ProjectileManager } from '../effects/ProjectileManager';
import { CircleBody } from '../world/collision/CircleBody';
import { clampBodiesToFloor } from '../world/collision/clampBodiesToFloor';
import { resolveCircleCollisions } from '../world/collision/resolveCircleCollisions';
import type { CombatUnit } from '../world/combat/CombatUnit';
import { createSceneLights } from '../world/createSceneLights';
import { DefenseTower } from '../world/DefenseTower';
import { DirtFloor } from '../world/DirtFloor';
import { MissFortune } from '../world/champions/MissFortune';
import { MinionWaveSpawner } from '../world/MinionWaveSpawner';
import { NexusCrystal } from '../world/NexusCrystal';
import { SpatialAxesGrid } from '../world/SpatialAxesGrid';

/**
 * 主场景：灯光 + 地板 + 坐标辅助 + 基地水晶 + 防御塔 + AI 发兵 + 弹道战斗 + 地面圆碰撞。
 */
export class MainScene extends THREE.Scene {
  /** 主场景背景与远景雾化颜色 */
  private static readonly FOG_COLOR = 0x0b0f14;
  /** 远景雾化起始距离（米）：保持近处战斗核心区域清晰 */
  private static readonly FOG_NEAR = 22;
  /** 远景雾化完全遮挡距离（米）：超越此距离完全融入背景，隐去地图边界 */
  private static readonly FOG_FAR = 45;

  /** 时间快进固定步长（秒），保证战斗/发兵逻辑稳定 */
  private static readonly SKIP_STEP = 1 / 30;
  /** 门牙塔相对水晶沿兵线朝中路的偏移（米） */
  private static readonly NEXUS_TOWER_FORWARD = 1.55;
  /** 门牙塔左右半间距（米，±Z） */
  private static readonly NEXUS_TOWER_HALF_Z = 1.15;

  private readonly floor: DirtFloor;
  private readonly axesGrid: SpatialAxesGrid;
  private readonly nexusCrystals: NexusCrystal[];
  private readonly defenseTowers: DefenseTower[];
  private readonly minionSpawner: MinionWaveSpawner;
  private readonly projectiles: ProjectileManager;
  /** 第一个英雄：厄运小姐（独立模型；锁定视角下可点地移动） */
  private readonly missFortune: MissFortune;
  /** 技能地面选点指示（E 枪林弹雨） */
  private readonly castIndicator: GroundCastIndicator;

  private axesVisible = true;
  private colliderMarkersVisible = true;
  /** 当前地面技能选点：'E' | null */
  private targetingSkill: 'E' | null = null;
  /** 最近一次鼠标地面落点（选点中跟随英雄时用） */
  private aimX = 0;
  private aimZ = 0;

  /** 待快进的游戏时间（秒） */
  private skipGameLeft = 0;
  /** 对应消耗的真实时间（秒） */
  private skipRealLeft = 0;

  constructor() {
    super();
    this.name = 'MainScene';
    const fogColor = MainScene.FOG_COLOR;
    this.background = new THREE.Color(fogColor);
    this.fog = new THREE.Fog(fogColor, MainScene.FOG_NEAR, MainScene.FOG_FAR);

    this.add(createSceneLights());

    this.floor = new DirtFloor();
    this.add(this.floor);

    this.axesGrid = new SpatialAxesGrid();
    this.add(this.axesGrid);

    // 基地水晶：蓝 -18 / 红 +18（八边形平台内；小兵从此诞生）
    const blueNexusX = MinionWaveSpawner.BLUE_NEXUS_X;
    const redNexusX = MinionWaveSpawner.RED_NEXUS_X;
    this.nexusCrystals = [
      new NexusCrystal(blueNexusX),
      new NexusCrystal(redNexusX),
    ];
    for (const nexus of this.nexusCrystals) {
      this.add(nexus);
    }

    // 防御塔：
    // - 兵线塔 ±3m、±7m
    // - 双方水晶前各两座门牙塔（朝中路前移 + 左右张开）
    const nexusTowerForward = MainScene.NEXUS_TOWER_FORWARD;
    const nexusTowerHalfZ = MainScene.NEXUS_TOWER_HALF_Z;
    this.defenseTowers = [
      new DefenseTower(3),
      new DefenseTower(7),
      new DefenseTower(-3),
      new DefenseTower(-7),
      // 蓝方门牙塔（水晶前）
      new DefenseTower(blueNexusX + nexusTowerForward, nexusTowerHalfZ),
      new DefenseTower(blueNexusX + nexusTowerForward, -nexusTowerHalfZ),
      // 红方门牙塔（水晶前）
      new DefenseTower(redNexusX - nexusTowerForward, nexusTowerHalfZ),
      new DefenseTower(redNexusX - nexusTowerForward, -nexusTowerHalfZ),
    ];
    for (const tower of this.defenseTowers) {
      this.add(tower);
    }

    // AI 发兵 + 锁定弹道
    this.minionSpawner = new MinionWaveSpawner(this);
    this.projectiles = new ProjectileManager(this);

    // 第一个角色：厄运小姐 @ x=0（独立模型、粉帽、三倍体型，无 AI）
    this.missFortune = new MissFortune(0, 0);
    this.add(this.missFortune);

    this.castIndicator = new GroundCastIndicator(
      MissFortune.BOLT_COLOR,
      MissFortune.BOLT_EMISSIVE,
    );
    this.castIndicator.configure(
      MissFortune.E_CAST_RANGE,
      MissFortune.E_RADIUS,
    );
    this.add(this.castIndicator);
  }

  get showAxes(): boolean {
    return this.axesVisible;
  }

  get showColliderMarkers(): boolean {
    return this.colliderMarkersVisible;
  }

  /** 可操控英雄（镜头跟随 / 点地移动目标） */
  get hero(): MissFortune {
    return this.missFortune;
  }

  /**
   * 英雄点地移动：右键落点（世界 XZ）。
   * Z 限制在兵线走廊内（考虑碰撞半径）；X 放宽到含两端平台。
   * 会取消当前普攻锁定。
   */
  commandHeroMoveTo(x: number, z: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    if (!this.missFortune.isAlive) return;
    const r = this.missFortune.collider.radius;
    const halfZ = DirtFloor.HALF_Z;
    // 走廊 + 两端八边形大致可达：水晶在 ±18 附近
    const maxX = 20;
    const clampedX = THREE.MathUtils.clamp(x, -maxX + r, maxX - r);
    const clampedZ = THREE.MathUtils.clamp(z, -halfZ + r, halfZ - r);
    this.missFortune.moveTo(clampedX, clampedZ);
  }

  /**
   * 英雄 WASD 连续移动（世界 XZ 方向向量，未归一化亦可）。
   * 零向量 = 松开；有输入时取消普攻与点地目标。
   */
  commandHeroMoveInput(dirX: number, dirZ: number): void {
    if (!this.missFortune.isAlive) {
      this.missFortune.setMoveInput(0, 0);
      return;
    }
    this.missFortune.setMoveInput(dirX, dirZ);
  }

  /** 英雄普攻：锁定敌方单位（射程内开火，外追击） */
  commandHeroAttack(target: CombatUnit): void {
    if (!this.missFortune.isAlive) return;
    this.missFortune.setAttackTarget(target);
  }

  /** 是否处于技能地面选点状态 */
  get isSkillTargeting(): boolean {
    return this.targetingSkill != null;
  }

  get skillTargetingSlot(): 'E' | null {
    return this.targetingSkill;
  }

  /** 按 E：进入/取消「枪林弹雨」选点 */
  beginHeroSkillE(): boolean {
    if (!this.missFortune.canCastE()) return false;
    if (this.targetingSkill === 'E') {
      this.cancelSkillTargeting();
      return true;
    }
    this.targetingSkill = 'E';
    this.castIndicator.configure(
      MissFortune.E_CAST_RANGE,
      MissFortune.E_RADIUS,
    );
    this.castIndicator.setActive(true);
    // 初始贴在英雄脚下
    this.updateSkillTargeting(
      this.missFortune.position.x,
      this.missFortune.position.z,
    );
    return true;
  }

  /** 取消技能选点 */
  cancelSkillTargeting(): void {
    this.targetingSkill = null;
    this.castIndicator.setActive(false);
  }

  /**
   * 更新选点指示位置（鼠标地面落点）。
   * 超距时落点圈仍跟鼠标，颜色变红提示；施放时会钳到最大距离。
   */
  updateSkillTargeting(aimX: number, aimZ: number): void {
    if (this.targetingSkill !== 'E') return;
    if (!Number.isFinite(aimX) || !Number.isFinite(aimZ)) return;
    this.aimX = aimX;
    this.aimZ = aimZ;
    this.refreshCastIndicator();
  }

  private refreshCastIndicator(): void {
    if (this.targetingSkill !== 'E') return;
    const hx = this.missFortune.position.x;
    const hz = this.missFortune.position.z;
    const dist = Math.hypot(this.aimX - hx, this.aimZ - hz);
    const inRange = dist <= MissFortune.E_CAST_RANGE + 1e-4;
    this.castIndicator.setPose(hx, hz, this.aimX, this.aimZ, inRange);
  }

  /**
   * 确认施放当前选中技能（左键）。
   * @returns 是否成功施放
   */
  confirmSkillTarget(aimX: number, aimZ: number): boolean {
    if (this.targetingSkill !== 'E') return false;
    const ok = this.commandHeroCastE(aimX, aimZ);
    this.cancelSkillTargeting();
    return ok;
  }

  /** 直接施放 E（不经选点 UI 时也可调用） */
  commandHeroCastE(aimX: number, aimZ: number): boolean {
    if (!this.missFortune.isAlive) return false;
    const result = this.missFortune.castE(
      aimX,
      aimZ,
      this.projectiles,
      () => this.collectEnemyCombatUnits(this.missFortune.team),
    );
    return result != null;
  }

  /**
   * 在地面落点附近点选敌方单位（供右键攻击）。
   * 优先最近圆心；点击半径 ≈ 碰撞半径 + slack。
   */
  pickEnemyNear(x: number, z: number, slack = 0.45): CombatUnit | null {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    const hero = this.missFortune;
    if (!hero.isAlive) return null;

    let best: CombatUnit | null = null;
    let bestDist = Infinity;

    for (const unit of this.collectEnemyCombatUnits(hero.team)) {
      const dx = unit.collider.x - x;
      const dz = unit.collider.z - z;
      const d = Math.hypot(dx, dz);
      const pickR = unit.collider.radius + slack;
      if (d > pickR) continue;
      if (d < bestDist) {
        best = unit;
        bestDist = d;
      }
    }
    return best;
  }

  /** 存活敌方：小兵 + 塔 + 水晶 */
  private collectEnemyCombatUnits(team: CombatUnit['team']): CombatUnit[] {
    const out: CombatUnit[] = [];
    for (const n of this.nexusCrystals) {
      if (n.isAlive && n.team !== team) out.push(n);
    }
    for (const t of this.defenseTowers) {
      if (t.isAlive && t.team !== team) out.push(t);
    }
    for (const m of this.minionSpawner.activeMinions) {
      if (m.isAlive && m.team !== team) out.push(m);
    }
    return out;
  }

  /** 开关坐标参考线（XYZ 轴 / 网格 / 刻度） */
  setAxesVisible(visible: boolean): void {
    this.axesVisible = visible;
    this.axesGrid.visible = visible;
  }

  /** 开关所有碰撞体积白圈（含之后新生成的单位） */
  setColliderMarkersVisible(visible: boolean): void {
    this.colliderMarkersVisible = visible;
    CircleBody.markersVisible = visible;
    for (const body of this.collectColliderBodies()) {
      body.setMarkerVisible(visible);
    }
  }

  /** 开关英雄无敌 */
  setHeroInvincible(invincible: boolean): void {
    this.missFortune.setInvincible(invincible);
  }

  /** 开关双方小兵刷出 */
  setMinionSpawnEnabled(enabled: boolean): void {
    this.minionSpawner.setSpawnEnabled(enabled);
  }

  /** 开关防御塔无敌 */
  setTowerInvincible(invincible: boolean): void {
    for (const tower of this.defenseTowers) {
      tower.setInvincible(invincible);
    }
  }

  /**
   * 在真实时间 realSeconds 内平滑推进 gameSeconds 游戏时间（可叠加）。
   * 例：快进 1 分钟 → skipTime(60, 1)；快进 3 分钟 → skipTime(180, 3)。
   */
  skipTime(gameSeconds: number, realSeconds: number): void {
    if (!(gameSeconds > 0) || !(realSeconds > 0)) return;
    if (!Number.isFinite(gameSeconds) || !Number.isFinite(realSeconds)) return;
    this.skipGameLeft += gameSeconds;
    this.skipRealLeft += realSeconds;
  }

  get isSkipping(): boolean {
    return this.skipRealLeft > 0 && this.skipGameLeft > 0;
  }

  /**
   * 每帧更新。
   * @param realDelta 真实流逝时间（秒）；内部若处于快进会按倍率推进游戏时间
   */
  update(realDelta: number): void {
    if (!(realDelta > 0) || !Number.isFinite(realDelta)) return;

    let realLeft = realDelta;

    // 快进：把真实帧时间按倍率换成游戏时间，分摊在 realSeconds 内完成
    if (this.skipRealLeft > 0 && this.skipGameLeft > 0) {
      const realStep = Math.min(realLeft, this.skipRealLeft);
      const rate = this.skipGameLeft / this.skipRealLeft;
      const gameStep = realStep * rate;
      this.simulate(gameStep);
      this.skipGameLeft = Math.max(0, this.skipGameLeft - gameStep);
      this.skipRealLeft = Math.max(0, this.skipRealLeft - realStep);
      if (this.skipRealLeft <= 1e-8 || this.skipGameLeft <= 1e-8) {
        if (this.skipGameLeft > 1e-6) this.simulate(this.skipGameLeft);
        this.skipGameLeft = 0;
        this.skipRealLeft = 0;
      }
      realLeft -= realStep;
    }

    // 快进结束后（或本帧未快进）按正常 1x 推进
    if (realLeft > 1e-8) {
      this.simulate(realLeft);
    }
  }

  /** 以固定小步长推进游戏逻辑，避免单帧游戏 delta 过大 */
  private simulate(gameDelta: number): void {
    if (!(gameDelta > 0) || !Number.isFinite(gameDelta)) return;

    const step = MainScene.SKIP_STEP;
    let remaining = gameDelta;
    // 单次 simulate 最多约 4s 游戏时间用小步；余量一次吃掉
    const maxSubsteps = 120;
    let n = 0;
    while (remaining > step + 1e-8 && n < maxSubsteps) {
      this.tick(step);
      remaining -= step;
      n += 1;
    }
    if (remaining > 1e-8) this.tick(remaining);
  }

  /** 单步游戏逻辑（游戏时间 delta） */
  private tick(delta: number): void {
    // 本帧开战前的存活单位（水晶 + 塔 + 小兵 + 英雄），供双方索敌
    const structures = [
      ...this.nexusCrystals.filter((n) => n.isAlive),
      ...this.defenseTowers.filter((t) => t.isAlive),
    ];
    const combatUnits: CombatUnit[] = [
      ...structures,
      ...this.minionSpawner.activeMinions.filter((m) => m.isAlive),
    ];
    if (this.missFortune.isAlive) {
      combatUnits.push(this.missFortune);
    }

    // 基地水晶：悬浮脉动动画
    for (const nexus of this.nexusCrystals) {
      nexus.update(delta);
    }

    // 防御塔 AI：范围内锁定敌方，水晶发射追踪弹
    for (const tower of this.defenseTowers) {
      tower.update(delta, combatUnits, this.projectiles);
    }

    // 英雄：意图 → 位移 → 限速转向 → 对准后从枪口开火
    this.missFortune.update(delta, this.projectiles);

    // 选点中：施法距离圈跟着英雄走；死亡则取消
    if (this.targetingSkill) {
      if (!this.missFortune.isAlive) {
        this.cancelSkillTargeting();
      } else {
        this.refreshCastIndicator();
      }
    }

    // 小兵 AI：索敌建筑 + 英雄 + 互打；前摇结束只发射弹道
    const minionHostiles: CombatUnit[] = [...structures];
    if (this.missFortune.isAlive) minionHostiles.push(this.missFortune);
    this.minionSpawner.update(delta, minionHostiles, this.projectiles);

    // 弹道追踪与命中结算（命中才 takeDamage）
    this.projectiles.update(delta);
    this.minionSpawner.pruneDead();

    // 移动后再做地面圆碰撞（死兵已 prune；死塔/死水晶仍挡路；英雄挡路）
    const bodies = this.collectColliderBodies();
    resolveCircleCollisions(bodies);
    // 兵线两侧夹紧：圆心+半径不得超出地板 Z 范围
    clampBodiesToFloor(bodies, { halfZ: DirtFloor.HALF_Z });
  }

  /** 窗口尺寸变化时由外部调用 */
  resize(_width: number, _height: number): void {
    // no-op
  }

  dispose(): void {
    this.floor.dispose();
    for (const nexus of this.nexusCrystals) {
      nexus.dispose();
    }
    for (const tower of this.defenseTowers) {
      tower.dispose();
    }
    this.remove(this.castIndicator);
    this.castIndicator.dispose();
    this.remove(this.missFortune);
    this.missFortune.dispose();
    this.minionSpawner.dispose();
    this.projectiles.dispose();
  }

  private collectColliderBodies(): CircleBody[] {
    return [
      ...this.nexusCrystals.map((n) => n.collider),
      ...this.defenseTowers.map((t) => t.collider),
      ...this.minionSpawner.activeMinions
        .filter((m) => m.isAlive)
        .map((m) => m.collider),
      this.missFortune.collider,
    ];
  }
}
