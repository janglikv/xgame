import type {
  ArcRotateCamera,
  Engine,
  Scene,
  ShadowGenerator,
} from '@babylonjs/core';
import { Vector3 } from '@babylonjs/core';
import { playPlayerHitSfx } from '../../audio/hitSfx';
import {
  loadCameraState,
  type CameraStateSnapshot,
} from '../../storage/cameraState';
import { loadFloorSurfaceState } from '../../storage/floorState';
import { loadMinionAppearanceState } from '../../storage/minionAppearanceState';
import type { CameraMode } from '../../storage/settingsState';
import type {
  GameWorld,
  WorldActivateOptions,
  WorldFrameContext,
  WorldId,
  WorldTransition,
} from '../GameWorld';
import { Floor } from '../Floor';
import { HealthBar } from '../HealthBar';
import { HoverOutline } from '../HoverOutline';
import { Minion, type MinionAppearance } from '../Minion';
import {
  buildArenaColliders,
  initPhysics,
  MinionPhysicsProxy,
} from '../physics';
import { RangeRing } from '../RangeRing';
import {
  applyCameraMode,
  addStandardLighting,
  createDarkScene,
  createFollowCamera,
  defaultFocusY,
} from '../shared/sceneBasics';
import { SpatialAxesGrid } from '../SpatialAxesGrid';
import { SpellProjectileSystem } from '../SpellProjectileSystem';
import { TeleportPad, TeleportPairTheme } from '../TeleportPad';
import { DeathOverlay } from '../../ui/DeathOverlay';

export interface CreateHubWorldOptions {
  cameraMode: CameraMode;
  /** 枢纽出生点 */
  spawnX: number;
  spawnZ: number;
  freeCamera?: { alpha: number; beta: number; radius: number };
  getIsInvincible?: () => boolean;
  onAppearanceChanged?: (appearance: MinionAppearance) => void;
  onRequestLandingWarp?: (
    minion: Minion,
    phys: MinionPhysicsProxy,
    x: number,
    z: number,
  ) => void;
}

/**
 * 枢纽：进关传送阵、开发模式调试仓库入口。
 */
export class HubWorld implements GameWorld {
  readonly id = 'hub' as const;

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
  readonly debugWarehousePad: TeleportPad | null;
  readonly hoverOutline: HoverOutline;
  readonly swapRangeRing: RangeRing;
  readonly shadowGen: ShadowGenerator;

  private readonly onRequestLandingWarp?: CreateHubWorldOptions['onRequestLandingWarp'];
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
    spatialAxesGrid: SpatialAxesGrid,
    teleportPad: TeleportPad,
    debugWarehousePad: TeleportPad | null,
    hoverOutline: HoverOutline,
    swapRangeRing: RangeRing,
    shadowGen: ShadowGenerator,
    onRequestLandingWarp?: CreateHubWorldOptions['onRequestLandingWarp'],
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
    this.debugWarehousePad = debugWarehousePad;
    this.hoverOutline = hoverOutline;
    this.swapRangeRing = swapRangeRing;
    this.shadowGen = shadowGen;
    this.onRequestLandingWarp = onRequestLandingWarp;
    this.getIsInvincible = getIsInvincible;
    this.swapRange = RangeRing.DEFAULT_RADIUS;
  }

  static async create(
    engine: Engine,
    options: CreateHubWorldOptions,
  ): Promise<HubWorld> {
    const scene = createDarkScene(engine, { start: 160, end: 350 });
    await initPhysics(scene);

    const { shadowGen } = addStandardLighting(scene, {
      half: 32,
    });

    const initialFloorSurface = loadFloorSurfaceState();
    const floor = new Floor(scene, shadowGen, {
      surface: initialFloorSurface,
    });
    buildArenaColliders(scene, {});
    const spatialAxesGrid = new SpatialAxesGrid(scene);

    const teleportPad = new TeleportPad(
      scene,
      TeleportPad.DEFAULT_X,
      TeleportPad.DEFAULT_Z,
      TeleportPad.RADIUS,
      { theme: TeleportPairTheme.hubLevel1 },
    );
    const debugWarehousePad = import.meta.env.DEV
      ? new TeleportPad(
          scene,
          3.2,
          TeleportPad.DEFAULT_Z,
          TeleportPad.RADIUS,
          { theme: TeleportPairTheme.hubWarehouse },
        )
      : null;

    let spawnX = options.spawnX;
    let spawnZ = options.spawnZ;
    if (Math.abs(spawnX) < 2.2 && Math.abs(spawnZ) < 2.2) {
      spawnX = 0;
      spawnZ = -5.4;
    }

    const minion = new Minion(scene, spawnX, spawnZ, {
      facePositiveX: false,
      shadowGenerator: shadowGen,
      allBlack: true,
      face: 'fierce',
      redHat: true,
      magicStaff: true,
      scaleMultiplier: 0.5,
      formation: 'crimson',
    });
    const savedAppearance = loadMinionAppearanceState();
    if (savedAppearance) {
      minion.applyPatch(savedAppearance);
    }
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

    const hoverOutline = new HoverOutline(scene);
    const swapRangeRing = new RangeRing(scene, RangeRing.DEFAULT_RADIUS);
    const spellSystem = new SpellProjectileSystem(scene);

    const focusY = defaultFocusY(minion.getAppearance().scaleMultiplier);
    const camera = createFollowCamera(scene, {
      name: 'hubCam',
      mode: options.cameraMode,
      target: new Vector3(spawnX, focusY, spawnZ),
      free: options.freeCamera,
    });

    const deathOverlay = new DeathOverlay(scene);

    const hubWorld = new HubWorld(
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
      debugWarehousePad,
      hoverOutline,
      swapRangeRing,
      shadowGen,
      options.onRequestLandingWarp,
    );

    deathOverlay.onRespawnClick = () => {
      hubWorld.respawnNearPad();
    };

    minion.onTakeDamage = (amount) => {
      playPlayerHitSfx();
      playerHealthBar.takeDamage(amount);
      if (playerHealthBar.isDead() && !minion.isDead()) {
        minion.setDead(true);
        deathOverlay.show();
      }
    };

    return hubWorld;
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

  /** 恢复上次自由镜头角度（切到 free 时由 App 调用） */
  restoreFreeCameraAngles(): void {
    const free = loadCameraState();
    if (!free) return;
    this.camera.alpha = free.alpha;
    this.camera.beta = free.beta;
    this.camera.radius = free.radius;
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

  /** 在传送阵前方落点复活：回满血、站起、瞬移，并 disarm 防止刚落地又传送。 */
  respawnNearPad(): void {
    const landing = this.getDefaultLandingXZ();
    this.teleportPlayer(landing.x, landing.z);
    this.teleportPad.disarmUntilLeave();
    this.playerHealthBar.setHp(this.playerHealthBar.getMaxHp());
    this.minion.setDead(false);
  }

  getTeleportCharge01(): number {
    const a = this.teleportPad.getVisualCharge01();
    const b = this.debugWarehousePad?.getVisualCharge01() ?? 0;
    return Math.max(a, b);
  }

  getDefaultLandingXZ(yaw?: number, from?: WorldId): { x: number; z: number } {
    if (from === 'debugWarehouse' && this.debugWarehousePad) {
      return this.debugWarehousePad.getLandingXZ(yaw);
    }
    return this.teleportPad.getLandingXZ(yaw);
  }

  snapshotCamera(): CameraStateSnapshot {
    return {
      alpha: this.camera.alpha,
      beta: this.camera.beta,
      radius: this.camera.radius,
      targetX: this.camera.target.x,
      targetY: this.camera.target.y,
      targetZ: this.camera.target.z,
    };
  }

  /**
   * 悬停展示目标后：
   * - partial：只拷该行展示槽
   * - full：全量外观
   * @returns 是否消费了按键
   */
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
    if (opts.appearance) {
      this.applyAppearance(opts.appearance);
    }
    this.setGridVisible(opts.showGrid);

    const spawnYaw = opts.spawnYaw ?? Math.PI;
    this.minion.setRotationY(spawnYaw);

    const spawn = opts.spawn ?? this.getDefaultLandingXZ(spawnYaw);

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
    this.debugWarehousePad?.disarmUntilLeave();
  }

  deactivate(): void {
    this.detachCamera();
    this.hoverOutline.clear();
    this.setHoverEnabled(false);
    this.teleportPad.resetCharge();
    this.debugWarehousePad?.resetCharge();
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
    if (this.getIsInvincible?.() && !isDead && this.playerHealthBar.getHp() < this.playerHealthBar.getMaxHp()) {
      this.playerHealthBar.setHp(this.playerHealthBar.getMaxHp());
    }
    this.playerHealthBar.update(dt);
    this.spellSystem.update(dt, [this.minion], this.minion);

    if (!isMoving && this.wasMoving) {
      this.onPlayerStopped?.();
    }
    this.wasMoving = isMoving;

    if (!isDead) {
      const p = this.minion.root.position;
      const onPad = this.teleportPad.contains(p.x, p.z);
      if (this.teleportPad.update(dt, onPad && !menuOpen)) {
        return { type: 'goto', world: 'level1' };
      }
      if (this.debugWarehousePad) {
        const onDebug = this.debugWarehousePad.contains(p.x, p.z);
        if (this.debugWarehousePad.update(dt, onDebug && !menuOpen)) {
          return { type: 'goto', world: 'debugWarehouse' };
        }
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
    this.teleportPad.dispose();
    this.debugWarehousePad?.dispose();
    this.minionPhys.dispose();
    this.scene.dispose();
  }

  private isInSwapRange(target: Minion): boolean {
    const a = this.minion.root.position;
    const b = target.root.position;
    return Math.hypot(a.x - b.x, a.z - b.z) <= this.swapRange;
  }
}

export async function createHubWorld(
  engine: Engine,
  options: CreateHubWorldOptions,
): Promise<HubWorld> {
  return HubWorld.create(engine, options);
}
