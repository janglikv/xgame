import { Vector3, type ArcRotateCamera, type Engine, type Scene } from '@babylonjs/core';
import { playPlayerHitSfx } from '../../audio/hitSfx';
import { getGraphicsPreset } from '../../storage/graphicsQuality';
import { loadSettingsState, type CameraMode } from '../../storage/settingsState';
import { DeathOverlay } from '../../ui/DeathOverlay';
import type {
  GameWorld,
  WorldActivateOptions,
  WorldFrameContext,
  WorldTransition,
} from '../GameWorld';
import { Floor } from '../Floor';
import { HealthBar } from '../HealthBar';
import { Minion, type MinionAppearance } from '../Minion';
import {
  buildArenaColliders,
  initPhysics,
  MinionPhysicsProxy,
} from '../physics';
import {
  addStandardLighting,
  applyCameraMode,
  createDarkScene,
  createFollowCamera,
  defaultFocusY,
} from '../shared/sceneBasics';
import { SpatialAxesGrid } from '../SpatialAxesGrid';
import { SpellProjectileSystem } from '../SpellProjectileSystem';
import { TeleportPad, TeleportPairTheme } from '../TeleportPad';
import {
  LEVEL2_FLOOR_EXTEND,
  LEVEL2_LANDING_X,
  LEVEL2_LANDING_Z,
  LEVEL2_MAP_HALF,
  LEVEL2_PAD_X,
  LEVEL2_PAD_Z,
  LEVEL2_X_MAX,
  LEVEL2_X_MIN,
  LEVEL2_Z_MAX,
  LEVEL2_Z_MIN,
  clampLevel2Position,
} from './config';

export interface CreateLevel2WorldOptions {
  appearance: MinionAppearance;
  cameraMode: CameraMode;
  initialX?: number;
  initialZ?: number;
  getIsInvincible?: () => boolean;
  onRequestLandingWarp?: (
    minion: Minion,
    phys: MinionPhysicsProxy,
    x: number,
    z: number,
  ) => void;
}

/**
 * 第二关：暂时只有空场地 + 回第一关的传送阵。
 */
export class Level2World implements GameWorld {
  readonly id = 'level2' as const;

  readonly scene: Scene;
  readonly camera: ArcRotateCamera;
  readonly minion: Minion;
  readonly minionPhys: MinionPhysicsProxy;
  readonly playerHealthBar: HealthBar;
  readonly deathOverlay: DeathOverlay;
  readonly spellSystem: SpellProjectileSystem;
  readonly floor: Floor;
  readonly spatialAxesGrid: SpatialAxesGrid;
  readonly teleportPad: TeleportPad;

  private readonly onRequestLandingWarp?: CreateLevel2WorldOptions['onRequestLandingWarp'];
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
    spellSystem: SpellProjectileSystem,
    floor: Floor,
    spatialAxesGrid: SpatialAxesGrid,
    teleportPad: TeleportPad,
    onRequestLandingWarp?: CreateLevel2WorldOptions['onRequestLandingWarp'],
    getIsInvincible?: () => boolean,
  ) {
    this.scene = scene;
    this.camera = camera;
    this.minion = minion;
    this.minionPhys = minionPhys;
    this.playerHealthBar = playerHealthBar;
    this.deathOverlay = deathOverlay;
    this.spellSystem = spellSystem;
    this.floor = floor;
    this.spatialAxesGrid = spatialAxesGrid;
    this.teleportPad = teleportPad;
    this.onRequestLandingWarp = onRequestLandingWarp;
    this.getIsInvincible = getIsInvincible;
  }

  static async create(
    engine: Engine,
    options: CreateLevel2WorldOptions,
  ): Promise<Level2World> {
    const scene = createDarkScene(engine, { start: 160, end: 350 });
    await initPhysics(scene);

    const half = LEVEL2_MAP_HALF;
    const gfx = getGraphicsPreset(loadSettingsState().graphicsQuality);
    const { shadowGen } = addStandardLighting(scene, {
      half: half + LEVEL2_FLOOR_EXTEND + 4,
      mapSize: gfx.shadowMapSize,
    });

    const floor = new Floor(scene, shadowGen, {
      surface: 'cyberGrid',
      halfX: half,
      halfZ: half,
      extend: LEVEL2_FLOOR_EXTEND,
    });
    buildArenaColliders(scene, {
      includeFloor: true,
      halfX: half,
      halfZ: half,
    });
    const spatialAxesGrid = new SpatialAxesGrid(scene, {
      extentX: half,
      extentZ: half,
    });

    const teleportPad = new TeleportPad(
      scene,
      LEVEL2_PAD_X,
      LEVEL2_PAD_Z,
      TeleportPad.RADIUS,
      { theme: TeleportPairTheme.level1Level2 },
    );
    teleportPad.disarmUntilLeave();

    const spawn = clampLevel2Position(
      options.initialX ?? LEVEL2_LANDING_X,
      options.initialZ ?? LEVEL2_LANDING_Z,
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
      minX: LEVEL2_X_MIN,
      maxX: LEVEL2_X_MAX,
      minZ: LEVEL2_Z_MIN,
      maxZ: LEVEL2_Z_MAX,
    });

    const focusTarget = new Vector3(
      spawn.x,
      defaultFocusY(appearance.scaleMultiplier),
      spawn.z,
    );
    const camera = createFollowCamera(scene, {
      name: 'level2Cam',
      mode: options.cameraMode,
      target: focusTarget,
    });

    const deathOverlay = new DeathOverlay(scene);

    const world = new Level2World(
      scene,
      camera,
      minion,
      minionPhys,
      playerHealthBar,
      deathOverlay,
      spellSystem,
      floor,
      spatialAxesGrid,
      teleportPad,
      options.onRequestLandingWarp,
      options.getIsInvincible,
    );

    deathOverlay.onRespawnClick = () => {
      world.pendingRespawnToHub = true;
    };

    minion.onTakeDamage = (amount) => {
      playPlayerHitSfx();
      if (options.getIsInvincible?.()) return;
      playerHealthBar.takeDamage(amount);
      if (playerHealthBar.isDead() && !minion.isDead()) {
        minion.setDead(true);
        deathOverlay.show();
      }
    };

    return world;
  }

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
    const c = clampLevel2Position(x, z);
    this.minion.root.position.set(c.x, 0, c.z);
    this.minion.root.computeWorldMatrix(true);
    this.minionPhys.teleportToTarget();
    const focus = new Vector3();
    this.minion.getFocusPoint(focus);
    this.camera.setTarget(focus);
  }

  getTeleportCharge01(): number {
    return this.teleportPad.getVisualCharge01();
  }

  getDefaultLandingXZ(yaw?: number): { x: number; z: number } {
    if (yaw === undefined) {
      return { x: LEVEL2_LANDING_X, z: LEVEL2_LANDING_Z };
    }
    const p = this.teleportPad.getLandingXZ(yaw);
    return clampLevel2Position(p.x, p.z);
  }

  activate(opts: WorldActivateOptions): void {
    this.minion.setDead(false);
    this.playerHealthBar.setHp(this.playerHealthBar.getMaxHp());
    this.deathOverlay.hide();

    if (opts.appearance) this.applyAppearance(opts.appearance);
    this.setGridVisible(opts.showGrid);

    const spawnYaw = opts.spawnYaw ?? Math.PI;
    this.minion.setRotationY(spawnYaw);

    const raw = opts.spawn ?? this.teleportPad.getLandingXZ(spawnYaw);
    const spawn = clampLevel2Position(raw.x, raw.z);

    if (opts.playLandingWarp && this.onRequestLandingWarp) {
      this.onRequestLandingWarp(this.minion, this.minionPhys, spawn.x, spawn.z);
    } else {
      this.teleportPlayer(spawn.x, spawn.z);
    }

    this.setCameraMode(opts.cameraMode, opts.canvas, opts.menuOpen);
    {
      const focus = new Vector3();
      this.minion.getFocusPoint(focus);
      this.camera.setTarget(focus);
    }
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

    if (isMoving) {
      this.minion.faceToward(moveWish.dirX, moveWish.dirZ);
      this.onPlayerMoved?.();
    }
    this.minionPhys.setHorizontalVelocity(
      isMoving ? moveWish.wishX : 0,
      isMoving ? moveWish.wishZ : 0,
    );
    this.minion.update(dt, isMoving);
    if (
      this.getIsInvincible?.() &&
      !isDead &&
      this.playerHealthBar.getHp() < this.playerHealthBar.getMaxHp()
    ) {
      this.playerHealthBar.setHp(this.playerHealthBar.getMaxHp());
    }
    this.playerHealthBar.update(dt);
    this.spellSystem.update(dt, [this.minion], this.minion);

    if (!isMoving && this.wasMoving) this.onPlayerStopped?.();
    this.wasMoving = isMoving;

    if (this.pendingRespawnToHub) {
      this.pendingRespawnToHub = false;
      return { type: 'goto', world: 'hub', restorePosition: false };
    }

    if (!isDead) {
      const p = this.minion.root.position;
      const onPad = this.teleportPad.contains(p.x, p.z);
      if (this.teleportPad.update(dt, onPad && !menuOpen)) {
        return { type: 'goto', world: 'level1' };
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
    this.scene.dispose();
  }
}
