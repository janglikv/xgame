import { Vector3, type ArcRotateCamera, type Engine, type Scene } from '@babylonjs/core';
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
import { Minion, type MinionAppearance } from '../Minion';
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
  LEVEL1_PAD_X,
  LEVEL1_PAD_Z,
  clampLevel1Position,
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
  /** 落地动画由外部 WarpLanding 驱动时回调 */
  onRequestLandingWarp?: (
    minion: Minion,
    phys: MinionPhysicsProxy,
    x: number,
    z: number,
  ) => void;
}

/**
 * 第一关：20×20 场地 + 双小队敌军 + 回程传送阵。
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
  readonly floor: Floor;
  readonly spatialAxesGrid: SpatialAxesGrid;
  readonly teleportPad: TeleportPad;

  private readonly onRequestLandingWarp?: CreateLevel1WorldOptions['onRequestLandingWarp'];
  private wasMoving = false;
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
    floor: Floor,
    spatialAxesGrid: SpatialAxesGrid,
    teleportPad: TeleportPad,
    onRequestLandingWarp?: CreateLevel1WorldOptions['onRequestLandingWarp'],
  ) {
    this.scene = scene;
    this.camera = camera;
    this.minion = minion;
    this.minionPhys = minionPhys;
    this.playerHealthBar = playerHealthBar;
    this.deathOverlay = deathOverlay;
    this.enemies = enemies;
    this.spellSystem = spellSystem;
    this.floor = floor;
    this.spatialAxesGrid = spatialAxesGrid;
    this.teleportPad = teleportPad;
    this.onRequestLandingWarp = onRequestLandingWarp;
  }

  static async create(
    engine: Engine,
    options: CreateLevel1WorldOptions,
  ): Promise<Level1World> {
    const scene = createDarkScene(engine, { start: 28, end: 48 });
    await initPhysics(scene);

    const half = LEVEL1_MAP_HALF;
    const shadowHalf = half + LEVEL1_FLOOR_EXTEND + 4;
    const { shadowGen } = addStandardLighting(scene, {
      half: shadowHalf,
      mapSize: 1024,
    });

    const floor = new Floor(scene, shadowGen, {
      surface: 'cyberGrid',
      halfX: half,
      halfZ: half,
      extend: LEVEL1_FLOOR_EXTEND,
      centerWallSize: 3,
      addLWall: true,
    });
    buildArenaColliders(scene, {
      includeFloor: true,
      halfX: half,
      halfZ: half,
      centerWallSize: 3,
      addLWall: true,
    });
    const spatialAxesGrid = new SpatialAxesGrid(scene, {
      extentX: half,
      extentZ: half,
    });

    const teleportPad = new TeleportPad(scene, LEVEL1_PAD_X, LEVEL1_PAD_Z);

    let spawn = clampLevel1Position(
      options.initialX ?? LEVEL1_LANDING_X,
      options.initialZ ?? LEVEL1_LANDING_Z,
    );
    if (Math.abs(spawn.x) < 2.2 && Math.abs(spawn.z) < 2.2) {
      spawn = { x: LEVEL1_LANDING_X, z: LEVEL1_LANDING_Z };
    }

    const appearance = options.appearance;
    const minion = new Minion(scene, spawn.x, spawn.z, {
      facePositiveX: true,
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
    const topGroupState = { isGroupAggroLocked: false };
    const bottomGroupState = { isGroupAggroLocked: false };

    const enemyConfigs = [
      { spawnX: -2.4, spawnZ: 7.0, groupState: topGroupState, rotY: Math.PI },
      { spawnX: -0.8, spawnZ: 7.0, groupState: topGroupState, rotY: Math.PI },
      { spawnX: 0.8, spawnZ: 7.0, groupState: topGroupState, rotY: Math.PI },
      { spawnX: 2.4, spawnZ: 7.0, groupState: topGroupState, rotY: Math.PI },
      { spawnX: -2.4, spawnZ: -7.0, groupState: bottomGroupState, rotY: 0 },
      { spawnX: -0.8, spawnZ: -7.0, groupState: bottomGroupState, rotY: 0 },
      { spawnX: 0.8, spawnZ: -7.0, groupState: bottomGroupState, rotY: 0 },
      { spawnX: 2.4, spawnZ: -7.0, groupState: bottomGroupState, rotY: 0 },
    ];

    const enemies: Level1Enemy[] = enemyConfigs.map((cfg) => {
      const eMinion = new Minion(scene, cfg.spawnX, cfg.spawnZ, {
        facePositiveX: false,
        shadowGenerator: shadowGen,
        face: 'fierce',
        bodyColor: 0x28262a,
        hat: 'horns',
        staff: 'flame',
        formation: null,
      });
      eMinion.root.rotation.y = cfg.rotY;

      const ePhys = new MinionPhysicsProxy(scene, eMinion.root, {
        mode: 'pushable',
        radius: 0.14,
        height: 0.42,
        mass: 3.0,
      });
      ePhys.teleportToTarget();

      const eAI = new EnemyAI(eMinion, ePhys, spellSystem, {
        spawnX: cfg.spawnX,
        spawnZ: cfg.spawnZ,
        patrolRadius: 1.0,
        moveSpeed: 1.2,
        patrolAxis: 'x',
        initialAttackRange: 4.0,
        retainedAttackRange: 5.0,
        forcedPatrolDuration: 0.5,
        attackCooldown: 1.8,
        spellStyle: 'flame',
        groupState: cfg.groupState,
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

    const level1World = new Level1World(
      scene,
      camera,
      minion,
      minionPhys,
      playerHealthBar,
      deathOverlay,
      enemies,
      spellSystem,
      floor,
      spatialAxesGrid,
      teleportPad,
      options.onRequestLandingWarp,
    );

    deathOverlay.onRespawnClick = () => {
      level1World.respawnNearPad();
    };

    minion.onTakeDamage = (amount) => {
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
    const p = this.teleportPad.getLandingXZ(yaw);
    return clampLevel1Position(p.x, p.z);
  }

  activate(opts: WorldActivateOptions): void {
    if (opts.appearance) {
      this.applyAppearance(opts.appearance);
    }
    this.setGridVisible(opts.showGrid);

    if (opts.spawnYaw !== undefined) {
      this.minion.setRotationY(opts.spawnYaw);
    }

    // 默认落在阵前方一点，避免 activate 时仍站在阵心
    const raw = opts.spawn ?? this.teleportPad.getLandingXZ(opts.spawnYaw);
    const spawn = clampLevel1Position(raw.x, raw.z);

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
    this.playerHealthBar.update(dt);

    this.spellSystem.update(dt);

    if (!isMoving && this.wasMoving) {
      this.onPlayerStopped?.();
    }
    this.wasMoving = isMoving;

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
