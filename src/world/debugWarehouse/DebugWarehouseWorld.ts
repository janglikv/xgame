import type {
  ArcRotateCamera,
  Engine,
  Scene,
  ShadowGenerator,
} from '@babylonjs/core';
import { Vector3 } from '@babylonjs/core';
import { playPlayerHitSfx } from '../../audio/hitSfx';
import { loadFloorSurfaceState } from '../../storage/floorState';
import type { CameraMode } from '../../storage/settingsState';
import { DeathOverlay } from '../../ui/DeathOverlay';
import type {
  GameWorld,
  WorldActivateOptions,
  WorldFrameContext,
  WorldTransition,
} from '../GameWorld';
import { Floor, type FloorSurface } from '../Floor';
import { FloorPickerGallery } from '../FloorPickerGallery';
import { HealthBar } from '../HealthBar';
import { HoverOutline } from '../HoverOutline';
import { Minion, type MinionAppearance } from '../Minion';
import { spawnMinionDemoLineup, type DemoLineup } from '../MinionDemoLineup';
import {
  buildArenaColliders,
  initPhysics,
  MinionPhysicsProxy,
} from '../physics';
import { RangeRing } from '../RangeRing';
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

export interface CreateDebugWarehouseOptions {
  appearance: MinionAppearance;
  cameraMode: CameraMode;
  initialX?: number;
  initialZ?: number;
  getIsInvincible?: () => boolean;
  onAppearanceChanged?: (appearance: MinionAppearance) => void;
  onFloorSurfaceChanged?: (surface: FloorSurface) => void;
  onRequestLandingWarp?: (
    minion: Minion,
    phys: MinionPhysicsProxy,
    x: number,
    z: number,
  ) => void;
}

/**
 * 开发调试仓库：展示阵列、地板材质展台、回枢纽传送阵。
 */
export class DebugWarehouseWorld implements GameWorld {
  readonly id = 'debugWarehouse' as const;

  readonly scene: Scene;
  readonly camera: ArcRotateCamera;
  readonly minion: Minion;
  readonly minionPhys: MinionPhysicsProxy;
  readonly playerHealthBar: HealthBar;
  readonly deathOverlay: DeathOverlay;
  readonly spellSystem: SpellProjectileSystem;
  readonly floor: Floor;
  readonly floorPickerGallery: FloorPickerGallery;
  readonly spatialAxesGrid: SpatialAxesGrid;
  readonly teleportPad: TeleportPad;
  readonly hoverOutline: HoverOutline;
  readonly swapRangeRing: RangeRing;
  readonly demoLineup: DemoLineup;
  readonly shadowGen: ShadowGenerator;

  private readonly onRequestLandingWarp?: CreateDebugWarehouseOptions['onRequestLandingWarp'];
  private readonly getIsInvincible?: () => boolean;
  private wasMoving = false;
  private onPlayerMoved: (() => void) | null = null;
  private onPlayerStopped: (() => void) | null = null;
  private readonly swapRange: number;

  private constructor(
    scene: Scene,
    camera: ArcRotateCamera,
    minion: Minion,
    minionPhys: MinionPhysicsProxy,
    playerHealthBar: HealthBar,
    deathOverlay: DeathOverlay,
    spellSystem: SpellProjectileSystem,
    floor: Floor,
    floorPickerGallery: FloorPickerGallery,
    spatialAxesGrid: SpatialAxesGrid,
    teleportPad: TeleportPad,
    hoverOutline: HoverOutline,
    swapRangeRing: RangeRing,
    demoLineup: DemoLineup,
    shadowGen: ShadowGenerator,
    onRequestLandingWarp?: CreateDebugWarehouseOptions['onRequestLandingWarp'],
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
    this.floorPickerGallery = floorPickerGallery;
    this.spatialAxesGrid = spatialAxesGrid;
    this.teleportPad = teleportPad;
    this.hoverOutline = hoverOutline;
    this.swapRangeRing = swapRangeRing;
    this.demoLineup = demoLineup;
    this.shadowGen = shadowGen;
    this.onRequestLandingWarp = onRequestLandingWarp;
    this.getIsInvincible = getIsInvincible;
    this.swapRange = RangeRing.DEFAULT_RADIUS;
  }

  static async create(
    engine: Engine,
    options: CreateDebugWarehouseOptions,
  ): Promise<DebugWarehouseWorld> {
    const scene = createDarkScene(engine, { start: 22, end: 45 });
    await initPhysics(scene);

    const { shadowGen } = addStandardLighting(scene, { half: 32 });

    const floor = new Floor(scene, shadowGen, {
      surface: loadFloorSurfaceState(),
    });
    const floorPickerGallery = new FloorPickerGallery(scene, floor, {
      centerZ: -14,
      onSurfaceChanged: options.onFloorSurfaceChanged,
    });
    buildArenaColliders(scene, {});
    const spatialAxesGrid = new SpatialAxesGrid(scene);

    const teleportPad = new TeleportPad(
      scene,
      TeleportPad.DEFAULT_X,
      TeleportPad.DEFAULT_Z,
      TeleportPad.RADIUS,
      { theme: TeleportPairTheme.hubWarehouse },
    );
    teleportPad.disarmUntilLeave();

    const spawnX = options.initialX ?? teleportPad.getLandingXZ().x;
    const spawnZ = options.initialZ ?? teleportPad.getLandingXZ().z;

    const appearance = options.appearance;
    const minion = new Minion(scene, spawnX, spawnZ, {
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
    if (options.onAppearanceChanged) {
      minion.onAppearanceChanged = options.onAppearanceChanged;
    }

    const scaleMul = minion.getAppearance().scaleMultiplier ?? 1;
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

    const demoLineup = spawnMinionDemoLineup(scene, shadowGen, {
      horizontal: true,
      z0: -2.0,
      rowGap: 1.4,
      colGap: 1.2,
      facePositiveX: false,
      physics: true,
    });

    const hoverOutline = new HoverOutline(scene);
    hoverOutline.registerMinions(demoLineup.minions);
    const swapRangeRing = new RangeRing(scene, RangeRing.DEFAULT_RADIUS);
    const spellSystem = new SpellProjectileSystem(scene);

    const camera = createFollowCamera(scene, {
      name: 'debugWarehouseCam',
      mode: options.cameraMode,
      target: new Vector3(spawnX, defaultFocusY(scaleMul), spawnZ),
    });

    const deathOverlay = new DeathOverlay(scene);

    const world = new DebugWarehouseWorld(
      scene,
      camera,
      minion,
      minionPhys,
      playerHealthBar,
      deathOverlay,
      spellSystem,
      floor,
      floorPickerGallery,
      spatialAxesGrid,
      teleportPad,
      hoverOutline,
      swapRangeRing,
      demoLineup,
      shadowGen,
      options.onRequestLandingWarp,
      options.getIsInvincible,
    );

    deathOverlay.onRespawnClick = () => {
      world.respawnNearPad();
    };

    minion.onTakeDamage = (amount) => {
      playPlayerHitSfx();
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
    this.minion.root.position.set(x, 0, z);
    this.minion.root.computeWorldMatrix(true);
    this.minionPhys.teleportToTarget();
    const focus = new Vector3();
    this.minion.getFocusPoint(focus);
    this.camera.setTarget(focus);
  }

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
    return this.teleportPad.getLandingXZ(yaw);
  }

  tryApplyHoverAppearance(mode: 'partial' | 'full'): boolean {
    const target = this.hoverOutline.getHovered();
    if (!target || target === this.minion) return false;
    if (!this.isInSwapRange(target)) {
      this.swapRangeRing.show(target.root.position);
      return true;
    }
    this.minion.applyFrom(target, mode);
    this.hoverOutline.refreshSelection();
    return true;
  }

  setHoverEnabled(enabled: boolean): void {
    this.hoverOutline.setEnabled(enabled);
    if (!enabled) this.hoverOutline.clear();
  }

  activate(opts: WorldActivateOptions): void {
    if (opts.appearance) this.applyAppearance(opts.appearance);
    this.setGridVisible(opts.showGrid);

    const spawnYaw = opts.spawnYaw ?? Math.PI;
    this.minion.setRotationY(spawnYaw);

    const spawn = opts.spawn ?? this.teleportPad.getLandingXZ(spawnYaw);

    if (opts.playLandingWarp && this.onRequestLandingWarp) {
      this.onRequestLandingWarp(
        this.minion,
        this.minionPhys,
        spawn.x,
        spawn.z,
      );
    } else if (opts.spawn) {
      this.teleportPlayer(spawn.x, spawn.z);
    } else {
      this.minionPhys.teleportToTarget();
    }

    this.setCameraMode(opts.cameraMode, opts.canvas, opts.menuOpen);
    this.setHoverEnabled(!opts.menuOpen);
    {
      const focus = new Vector3();
      this.minion.getFocusPoint(focus);
      this.camera.setTarget(focus);
    }
    this.teleportPad.disarmUntilLeave();
  }

  deactivate(): void {
    this.detachCamera();
    this.hoverOutline.clear();
    this.setHoverEnabled(false);
    this.teleportPad.resetCharge();
  }

  update(ctx: WorldFrameContext): WorldTransition {
    const { dt, menuOpen, moveWish, pointerOverCanvas } = ctx;

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
    const targetMinions = [this.minion, ...this.demoLineup.minions];
    this.spellSystem.update(dt, targetMinions, this.minion);
    this.demoLineup.update(dt);
    this.floorPickerGallery.update(this.minion.root.position);

    if (!isMoving && this.wasMoving) this.onPlayerStopped?.();
    this.wasMoving = isMoving;

    if (!isDead) {
      const p = this.minion.root.position;
      const onPad = this.teleportPad.contains(p.x, p.z);
      if (this.teleportPad.update(dt, onPad && !menuOpen)) {
        return { type: 'goto', world: 'hub' };
      }
    }

    if (!isDead && !menuOpen && pointerOverCanvas) {
      this.hoverOutline.updateFromScenePick(this.scene);
    }
    this.swapRangeRing.update(dt);

    return null;
  }

  dispose(): void {
    this.deathOverlay.dispose();
    this.playerHealthBar.dispose();
    this.spellSystem.dispose();
    this.floorPickerGallery.dispose();
    this.teleportPad.dispose();
    this.minionPhys.dispose();
    this.scene.dispose();
  }

  private isInSwapRange(target: Minion): boolean {
    const a = this.minion.root.position;
    const b = target.root.position;
    return Math.hypot(a.x - b.x, a.z - b.z) <= this.swapRange;
  }
}
