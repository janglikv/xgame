import { Vector3, type ArcRotateCamera, type Engine, type Scene } from '@babylonjs/core';
import { playSfx } from '../../audio/Sfx';
import type { CameraMode } from '../../storage/settingsState';
import type {
  GameWorld,
  WorldActivateOptions,
  WorldFrameContext,
  WorldTransition,
} from '../GameWorld';
import { EnemyAI } from '../EnemyAI';
import { Floor } from '../Floor';
import { HealthBar } from '../HealthBar';
import { HealthPackSystem } from '../HealthPackSystem';
import { Minion, type MinionAppearance, type StaffStyle } from '../Minion';
import type { FormationStyle } from '../FootRingBuff';
import {
  buildArenaColliders,
  initPhysics,
  MinionPhysicsProxy,
} from '../physics';
import {
  applyCameraMode,
  addStandardLighting,
  createDarkScene,
  createFollowCamera,
  defaultFocusY,
} from '../shared/sceneBasics';
import { SpatialAxesGrid } from '../SpatialAxesGrid';
import { SpellProjectileSystem } from '../SpellProjectileSystem';
import { TeleportPad } from '../TeleportPad';
import { DeathOverlay } from '../../ui/DeathOverlay';
import {
  LEVEL1_FLOOR_EXTEND,
  LEVEL1_LANDING_X,
  LEVEL1_LANDING_Z,
  LEVEL1_MAP_HALF,
  LEVEL1_X_MAX,
  LEVEL1_X_MIN,
  LEVEL1_Z_MAX,
  LEVEL1_Z_MIN,
  LEVEL1_PAD_X,
  LEVEL1_PAD_Z,
  clampLevel1Position,
  clampLevel1Spawn,
} from './config';

export interface Level1Enemy {
  minion: Minion;
  phys: MinionPhysicsProxy;
  ai: EnemyAI;
}

export interface CreateLevel1WorldOptions {
  appearance: MinionAppearance;
  cameraMode: CameraMode;
  initialX?: number;
  initialZ?: number;
  getIsInvincible?: () => boolean;
  /** 落地动画由外部 WarpLanding 驱动时回调 */
  onRequestLandingWarp?: (
    minion: Minion,
    phys: MinionPhysicsProxy,
    x: number,
    z: number,
  ) => void;
}

/**
 * 第一关：20×20 场地，+Z 再扩 10m Boss 区 + 双小队敌军 + 回程传送阵。
 * 实现 GameWorld，由 GameApp 统一驱动。
 */
export class Level1World implements GameWorld {
  readonly id = 'level1' as const;

  readonly scene: Scene;
  readonly camera: ArcRotateCamera;
  readonly minion: Minion;
  readonly minionPhys: MinionPhysicsProxy;
  readonly playerHealthBar: HealthBar;
  readonly deathOverlay: DeathOverlay;
  readonly enemies: Level1Enemy[];
  readonly spellSystem: SpellProjectileSystem;
  readonly healthPackSystem: HealthPackSystem;
  readonly floor: Floor;
  readonly spatialAxesGrid: SpatialAxesGrid;
  readonly teleportPad: TeleportPad;

  private readonly onRequestLandingWarp?: CreateLevel1WorldOptions['onRequestLandingWarp'];
  private readonly getIsInvincible?: () => boolean;
  private wasMoving = false;
  private pendingRespawnToHub = false;
  private onPlayerMoved: (() => void) | null = null;
  private onPlayerStopped: (() => void) | null = null;

  private constructor(
    scene: Scene,
    camera: ArcRotateCamera,
    minion: Minion,
    minionPhys: MinionPhysicsProxy,
    playerHealthBar: HealthBar,
    deathOverlay: DeathOverlay,
    enemies: Level1Enemy[],
    spellSystem: SpellProjectileSystem,
    healthPackSystem: HealthPackSystem,
    floor: Floor,
    spatialAxesGrid: SpatialAxesGrid,
    teleportPad: TeleportPad,
    onRequestLandingWarp?: CreateLevel1WorldOptions['onRequestLandingWarp'],
    getIsInvincible?: () => boolean,
  ) {
    this.scene = scene;
    this.camera = camera;
    this.minion = minion;
    this.minionPhys = minionPhys;
    this.playerHealthBar = playerHealthBar;
    this.deathOverlay = deathOverlay;
    this.enemies = enemies;
    this.spellSystem = spellSystem;
    this.healthPackSystem = healthPackSystem;
    this.floor = floor;
    this.spatialAxesGrid = spatialAxesGrid;
    this.teleportPad = teleportPad;
    this.onRequestLandingWarp = onRequestLandingWarp;
    this.getIsInvincible = getIsInvincible;
  }

  static async create(
    engine: Engine,
    options: CreateLevel1WorldOptions,
  ): Promise<Level1World> {
    const scene = createDarkScene(engine, { start: 28, end: 48 });
    await initPhysics(scene);

    const half = LEVEL1_MAP_HALF;
    const shadowHalf =
      Math.max(LEVEL1_X_MAX, LEVEL1_Z_MAX) + LEVEL1_FLOOR_EXTEND + 4;
    const { shadowGen } = addStandardLighting(scene, {
      half: shadowHalf,
      mapSize: 1024,
    });

    const floor = new Floor(scene, shadowGen, {
      surface: 'cyberGrid',
      halfX: half,
      halfZ: half,
      minX: LEVEL1_X_MIN,
      maxX: LEVEL1_X_MAX,
      minZ: LEVEL1_Z_MIN,
      maxZ: LEVEL1_Z_MAX,
      extend: LEVEL1_FLOOR_EXTEND,
      centerWallSize: 3,
      addLWall: true,
    });
    buildArenaColliders(scene, {
      includeFloor: true,
      halfX: half,
      halfZ: half,
      minX: LEVEL1_X_MIN,
      maxX: LEVEL1_X_MAX,
      minZ: LEVEL1_Z_MIN,
      maxZ: LEVEL1_Z_MAX,
      centerWallSize: 3,
      addLWall: true,
    });
    const spatialAxesGrid = new SpatialAxesGrid(scene, {
      extentX: half,
      extentZ: LEVEL1_Z_MAX,
    });

    const teleportPad = new TeleportPad(scene, LEVEL1_PAD_X, LEVEL1_PAD_Z);
    teleportPad.disarmUntilLeave();

    const spawn = clampLevel1Spawn(
      options.initialX ?? LEVEL1_LANDING_X,
      options.initialZ ?? LEVEL1_LANDING_Z,
    );

    const appearance = options.appearance;
    const minion = new Minion(scene, spawn.x, spawn.z, {
      facePositiveX: false,
      shadowGenerator: shadowGen,
      face: appearance.face,
      mosaicFace: appearance.mosaicFace,
      bodyColor: appearance.bodyColor,
      hat: appearance.hat ?? undefined,
      staff: appearance.staff ?? undefined,
      scaleMultiplier: appearance.scaleMultiplier,
      lowPolyFlat: appearance.lowPolyFlat,
      formation: appearance.formation,
    });
    const scaleMul = appearance.scaleMultiplier ?? 1;
    const playerHealthBar = new HealthBar(scene, minion.root, {
      maxHp: 100,
      offsetY: 1.55 * scaleMul,
      theme: 'green',
    });

    const minionPhys = new MinionPhysicsProxy(scene, minion.root, {
      mode: 'player',
      radius: 0.13,
      height: 0.38,
      mass: 2.6,
    });
    minionPhys.teleportToTarget();

    const spellSystem = new SpellProjectileSystem(scene);
    spellSystem.setBounds({
      minX: LEVEL1_X_MIN,
      maxX: LEVEL1_X_MAX,
      minZ: LEVEL1_Z_MIN,
      maxZ: LEVEL1_Z_MAX,
    });
    const wizardGroupState = { isGroupAggroLocked: false };

    // 敌军分布：2 名远程法术敌军 (共享组仇恨)，4 名近战肉搏敌军 (仇恨独立，不共享)
    const enemyConfigs: {
      spawnX: number;
      spawnZ: number;
      groupState?: { isGroupAggroLocked: boolean };
      rotY: number;
      staff: StaffStyle | null;
      scale?: number;
      formation?: FormationStyle | null;
      maxHp?: number;
      patrolRadius?: number;
      patrolAxis?: 'x' | 'z';
      attackRange?: number;
      burstCount?: number;
    }[] = [
      // 1. 远程法术敌军 (共 2 名，左右各 1 名)
      { spawnX: -5.5, spawnZ: 3.0, groupState: wizardGroupState, rotY: Math.PI, staff: 'flame' },
      { spawnX: 5.5, spawnZ: 3.0, groupState: wizardGroupState, rotY: Math.PI, staff: 'flame' },

      // 2. 近战肉搏敌军 (共 4 名，无法杖，每个敌人仇恨独立，不共享)
      { spawnX: -2.5, spawnZ: 1.8, groupState: undefined, rotY: Math.PI, staff: null },
      { spawnX: 2.5, spawnZ: 1.8, groupState: undefined, rotY: Math.PI, staff: null },
      { spawnX: -1.8, spawnZ: 5.5, groupState: undefined, rotY: Math.PI, staff: null },
      { spawnX: 1.8, spawnZ: 5.5, groupState: undefined, rotY: Math.PI, staff: null },

      // 3. Boss：+Z 区，远程造型，体型 ×2 + 阵法
      {
        spawnX: 0,
        spawnZ: 15,
        rotY: Math.PI,
        staff: 'flame',
        scale: 2,
        formation: 'void',
        maxHp: 400,
        patrolRadius: 1.6,
        patrolAxis: 'x',
        attackRange: 10,
        burstCount: 3,
      },
    ];

    // 4. Boss 周围一圈 12 名缩小远程小兵
    {
      const ringR = 3.4;
      const addScale = 0.55;
      for (let i = 0; i < 12; i++) {
        const ang = (i * Math.PI) / 6;
        enemyConfigs.push({
          spawnX: Math.sin(ang) * ringR,
          spawnZ: 15 + Math.cos(ang) * ringR,
          rotY: Math.PI,
          staff: 'flame',
          scale: addScale,
          maxHp: 60,
          patrolRadius: 0.35,
          patrolAxis: 'x',
          attackRange: 8,
        });
      }
    }

    const enemies: Level1Enemy[] = enemyConfigs.map((cfg) => {
      const scale = cfg.scale ?? 1;
      const eMinion = new Minion(scene, cfg.spawnX, cfg.spawnZ, {
        facePositiveX: false,
        shadowGenerator: shadowGen,
        face: 'fierce',
        bodyColor: 0x6e1b2b,
        hat: null,
        staff: cfg.staff,
        formation: cfg.formation ?? null,
        scaleMultiplier: scale,
        combatTeam: 'enemy',
      });
      eMinion.setRotationY(cfg.rotY);

      const ePhys = new MinionPhysicsProxy(scene, eMinion.root, {
        mode: 'pushable',
        radius: 0.14 * scale,
        height: 0.42 * scale,
        mass: 3.0 * scale,
      });
      ePhys.teleportToTarget();

      const eAI = new EnemyAI(eMinion, ePhys, spellSystem, {
        spawnX: cfg.spawnX,
        spawnZ: cfg.spawnZ,
        patrolRadius: cfg.patrolRadius ?? 2.0,
        moveSpeed: 1.2,
        chaseSpeed: 2.2,
        patrolAxis: cfg.patrolAxis ?? 'z',
        initialAttackRange: cfg.attackRange ?? 2.8,
        retainedAttackRange: cfg.attackRange ? cfg.attackRange + 2 : 4.0,
        forcedPatrolDuration: 0.5,
        attackCooldown: cfg.staff ? 1.8 : 0.9,
        spellStyle: 'flame',
        groupState: cfg.groupState,
        maxHp: cfg.maxHp,
        healthBarOffsetY: 1.55 * scale,
        burstCount: cfg.burstCount,
      });

      return { minion: eMinion, phys: ePhys, ai: eAI };
    });

    const focusTarget = new Vector3(spawn.x, defaultFocusY(appearance.scaleMultiplier), spawn.z);
    const camera = createFollowCamera(scene, {
      name: 'level1Cam',
      mode: options.cameraMode,
      target: focusTarget,
    });

    const deathOverlay = new DeathOverlay(scene);
    const healthPackSystem = new HealthPackSystem(scene);

    const level1World = new Level1World(
      scene,
      camera,
      minion,
      minionPhys,
      playerHealthBar,
      deathOverlay,
      enemies,
      spellSystem,
      healthPackSystem,
      floor,
      spatialAxesGrid,
      teleportPad,
      options.onRequestLandingWarp,
      options.getIsInvincible,
    );

    deathOverlay.onRespawnClick = () => {
      level1World.pendingRespawnToHub = true;
    };

    minion.onFootstep = () => {
      playSfx('/audio/player_walk.mp3', 0.16, 80);
    };
    minion.onTakeDamage = (amount) => {
      playSfx('/audio/player_hit.mp3', 0.55);
      if (options.getIsInvincible?.()) return;
      playerHealthBar.takeDamage(amount);
      if (playerHealthBar.isDead() && !minion.isDead()) {
        minion.setDead(true);
        deathOverlay.show();
      }
    };

    return level1World;
  }

  /** 移动开始/停止时由 App 挂钩存档节流 */
  setMovePersistenceHandlers(handlers: {
    onMoved?: () => void;
    onStopped?: () => void;
  }): void {
    this.onPlayerMoved = handlers.onMoved ?? null;
    this.onPlayerStopped = handlers.onStopped ?? null;
  }

  getPlayer(): Minion {
    return this.minion;
  }

  getPlayerPhys(): MinionPhysicsProxy {
    return this.minionPhys;
  }

  getSpellSystem(): SpellProjectileSystem {
    return this.spellSystem;
  }

  attachCamera(canvas: HTMLCanvasElement): void {
    this.camera.attachControl(canvas, true);
  }

  detachCamera(): void {
    this.camera.detachControl();
  }

  setCameraMode(
    mode: CameraMode,
    canvas: HTMLCanvasElement,
    menuOpen: boolean,
  ): void {
    applyCameraMode(this.camera, mode, canvas, !menuOpen && mode === 'free');
  }

  setGridVisible(visible: boolean): void {
    this.spatialAxesGrid.setVisible(visible);
  }

  getAppearance(): MinionAppearance {
    return this.minion.getAppearance();
  }

  applyAppearance(appearance: MinionAppearance): void {
    this.minion.applyPatch(appearance);
  }

  getPlayerXZ(): { x: number; z: number } {
    const p = this.minion.root.position;
    return { x: p.x, z: p.z };
  }

  teleportPlayer(x: number, z: number): void {
    const c = clampLevel1Position(x, z);
    this.minion.root.position.set(c.x, 0, c.z);
    this.minion.root.computeWorldMatrix(true);
    this.minionPhys.teleportToTarget();
    const focus = new Vector3();
    this.minion.getFocusPoint(focus);
    this.camera.setTarget(focus);
  }

  /** 在回程传送阵前方落点复活：回满血、站起、瞬移，并 disarm 防止刚落地又回枢纽。 */
  respawnNearPad(): void {
    const landing = this.getDefaultLandingXZ();
    this.teleportPlayer(landing.x, landing.z);
    this.teleportPad.disarmUntilLeave();
    this.playerHealthBar.setHp(this.playerHealthBar.getMaxHp());
    this.minion.setDead(false);
  }

  getTeleportCharge01(): number {
    return this.teleportPad.getVisualCharge01();
  }

  getDefaultLandingXZ(yaw?: number): { x: number; z: number } {
    if (yaw === undefined) {
      return { x: LEVEL1_LANDING_X, z: LEVEL1_LANDING_Z };
    }
    const p = this.teleportPad.getLandingXZ(yaw);
    return clampLevel1Spawn(p.x, p.z);
  }

  activate(opts: WorldActivateOptions): void {
    // 重新进入关卡：确保存活、满血。hide() 必须立即关 UI，不可走重生转场，
    // 否则首屏恢复时 TeleportFlow 空闲，会把人传回大厅。
    this.minion.setDead(false);
    this.playerHealthBar.setHp(this.playerHealthBar.getMaxHp());
    this.deathOverlay.hide();

    // 唤醒并重置关卡中活着的敌军 AI，使其立即识别新到的玩家
    for (const e of this.enemies) {
      if (!e.ai.isDefeated()) {
        e.ai.resetForPlayer();
      }
    }

    if (opts.appearance) {
      this.applyAppearance(opts.appearance);
    }
    this.setGridVisible(opts.showGrid);

    const spawnYaw = opts.spawnYaw ?? Math.PI;
    this.minion.setRotationY(spawnYaw);

    // 默认落在 3×3 方围开口内侧，避免站上阵心或卡进墙
    const raw =
      opts.spawn ??
      this.teleportPad.getLandingXZ(spawnYaw);
    const spawn = clampLevel1Spawn(raw.x, raw.z);

    if (opts.playLandingWarp && this.onRequestLandingWarp) {
      this.onRequestLandingWarp(
        this.minion,
        this.minionPhys,
        spawn.x,
        spawn.z,
      );
    } else {
      this.teleportPlayer(spawn.x, spawn.z);
    }

    this.setCameraMode(opts.cameraMode, opts.canvas, opts.menuOpen);
    {
      const focus = new Vector3();
      this.minion.getFocusPoint(focus);
      this.camera.setTarget(focus);
    }
    // 出生在阵上：须先离开再站上才重新蓄力
    this.teleportPad.disarmUntilLeave();
  }

  deactivate(): void {
    this.detachCamera();
    this.teleportPad.resetCharge();
  }

  update(ctx: WorldFrameContext): WorldTransition {
    const { dt, menuOpen, moveWish } = ctx;

    this.deathOverlay.update(dt);

    const isDead = this.minion.isDead();
    const isMoving = !isDead && moveWish.moving;

    this.minionPhys.syncToTarget();

    const living = this.enemies.filter((e) => !e.ai.isDefeated());
    const allEnemyMinions = living.map((e) => e.minion);
    for (const e of living) {
      e.phys.syncToTarget();
      e.ai.update(dt, this.minion, allEnemyMinions);
    }

    if (isMoving) {
      this.minion.faceToward(moveWish.dirX, moveWish.dirZ);
      this.onPlayerMoved?.();
    }
    this.minionPhys.setHorizontalVelocity(
      isMoving ? moveWish.wishX : 0,
      isMoving ? moveWish.wishZ : 0,
    );
    this.minion.update(dt, isMoving);
    if (this.getIsInvincible?.() && !isDead && this.playerHealthBar.getHp() < this.playerHealthBar.getMaxHp()) {
      this.playerHealthBar.setHp(this.playerHealthBar.getMaxHp());
    }
    this.playerHealthBar.update(dt);

    const targetMinions = [this.minion, ...allEnemyMinions];
    this.spellSystem.update(dt, targetMinions, this.minion);
    this.healthPackSystem.update(dt, this.minion, this.playerHealthBar);

    if (!isMoving && this.wasMoving) {
      this.onPlayerStopped?.();
    }
    this.wasMoving = isMoving;

    if (this.pendingRespawnToHub) {
      this.pendingRespawnToHub = false;
      return { type: 'goto', world: 'hub', restorePosition: false };
    }

    if (!isDead) {
      const p = this.minion.root.position;
      const onPad = this.teleportPad.contains(p.x, p.z);
      if (this.teleportPad.update(dt, onPad && !menuOpen)) {
        return { type: 'goto', world: 'hub' };
      }
    }

    return null;
  }

  dispose(): void {
    this.deathOverlay.dispose();
    this.playerHealthBar.dispose();
    this.spellSystem.dispose();
    this.healthPackSystem.dispose();
    this.teleportPad.dispose();
    this.minionPhys.dispose();
    for (const e of this.enemies) {
      e.phys.dispose();
      e.ai.dispose();
    }
    this.scene.dispose();
  }
}

/** 工厂别名，便于调用方使用函数式 API */
export async function createLevel1World(
  engine: Engine,
  options: CreateLevel1WorldOptions,
): Promise<Level1World> {
  return Level1World.create(engine, options);
}
