import type { Engine } from '@babylonjs/core';
import { Vector3 } from '@babylonjs/core';
import { loadCameraState } from '../storage/cameraState';
import {
  loadMinionState,
  saveMinionState,
  type MinionStateSnapshot,
} from '../storage/minionState';
import type { CameraMode } from '../storage/settingsState';
import { saveWorldState } from '../storage/worldState';
import type {
  GameWorld,
  WorldId,
  WorldActivateOptions,
} from '../world/GameWorld';
import { HubWorld } from '../world/hub/HubWorld';
import { Level1World } from '../world/level1/Level1World';
import {
  LEVEL1_LANDING_X,
  LEVEL1_LANDING_Z,
  clampLevel1Position,
} from '../world/level1/config';
import { DebugWarehouseWorld } from '../world/debugWarehouse/DebugWarehouseWorld';
import { Level2World } from '../world/level2/Level2World';
import { LEVEL2_LANDING_X, LEVEL2_LANDING_Z } from '../world/level2/config';
import { TeleportPad } from '../world/TeleportPad';
import type { Minion, MinionAppearance } from '../world/Minion';
import type { MinionPhysicsProxy } from '../world/physics/MinionPhysicsProxy';
import { lockFixedOrbit } from '../world/shared/sceneBasics';
import type { CameraFollow } from './CameraFollow';

export interface WorldRouterContext {
  engine: Engine;
  canvas: HTMLCanvasElement;
  getCameraMode: () => CameraMode;
  getMenuOpen: () => boolean;
  getShowGrid: () => boolean;
  getIsInvincible?: () => boolean;
  onLandingWarp: (
    minion: Minion,
    phys: MinionPhysicsProxy,
    x: number,
    z: number,
  ) => void;
  onPlayerMoved: () => void;
  onPlayerStopped: () => void;
  onCameraChanged: () => void;
  /** 切换完成后：rebind UI、snap 镜头等 */
  onAfterActivate: (
    world: GameWorld,
    meta: { isInitialLoad: boolean; from: WorldId | null },
  ) => void;
  cameraFollow: CameraFollow;
}

export interface GotoWorldOptions {
  /** 恢复该世界上次坐标（首屏读档） */
  restorePosition?: boolean;
  /** 首屏恢复：不播落地动画、可恢复自由镜头 */
  isInitialLoad?: boolean;
}

/**
 * 世界注册表 + 切换。
 * GameApp 只调 goto / active，不再写 hub↔level1 分支细节。
 */
export class WorldRouter {
  private readonly worlds = new Map<WorldId, GameWorld>();
  private activeId: WorldId = 'hub';
  private busy = false;

  /** 各世界上次离开时的站位（存档同步） */
  private readonly spawns: Record<WorldId, { x: number; z: number }> = {
    hub: { x: 0, z: -5.4 },
    level1: { x: LEVEL1_LANDING_X, z: LEVEL1_LANDING_Z },
    level2: { x: LEVEL2_LANDING_X, z: LEVEL2_LANDING_Z },
    debugWarehouse: {
      x: TeleportPad.DEFAULT_X,
      z: TeleportPad.DEFAULT_Z + TeleportPad.LANDING_DISTANCE,
    },
  };

  constructor(private readonly ctx: WorldRouterContext) {}

  /** 丢掉未激活世界，下次进入会按当前画质重建 */
  dropInactive(): void {
    for (const [id, world] of this.worlds) {
      if (id === this.activeId) continue;
      this.worlds.delete(id);
      world.dispose();
    }
  }

  get active(): GameWorld {
    const w = this.worlds.get(this.activeId);
    if (!w) throw new Error(`WorldRouter: active world missing (${this.activeId})`);
    return w;
  }

  get activeWorldId(): WorldId {
    return this.activeId;
  }

  get isBusy(): boolean {
    return this.busy;
  }

  get(id: WorldId): GameWorld | undefined {
    return this.worlds.get(id);
  }

  /** 某世界记住的站位（存档 / 切走时更新） */
  getSpawn(id: WorldId): { x: number; z: number } {
    return { ...this.spawns[id] };
  }

  /** 枢纽专属 API（换装等） */
  getHub(): HubWorld | null {
    const w = this.worlds.get('hub');
    return w instanceof HubWorld ? w : null;
  }

  getDebugWarehouse(): DebugWarehouseWorld | null {
    const w = this.worlds.get('debugWarehouse');
    return w instanceof DebugWarehouseWorld ? w : null;
  }

  /** 对所有已创建世界执行（网格开关等） */
  forEach(fn: (world: GameWorld) => void): void {
    for (const w of this.worlds.values()) fn(w);
  }

  /**
   * 启动时创建枢纽并设为 active。
   */
  async bootstrapHub(options: {
    cameraMode: CameraMode;
    spawnX: number;
    spawnZ: number;
    freeCamera?: { alpha: number; beta: number; radius: number };
    onAppearanceChanged?: (a: MinionAppearance) => void;
  }): Promise<HubWorld> {
    this.spawns.hub = { x: options.spawnX, z: options.spawnZ };

    const hub = await HubWorld.create(this.ctx.engine, {
      cameraMode: options.cameraMode,
      spawnX: options.spawnX,
      spawnZ: options.spawnZ,
      freeCamera: options.freeCamera,
      getIsInvincible: this.ctx.getIsInvincible,
      onAppearanceChanged: options.onAppearanceChanged,
      onRequestLandingWarp: this.ctx.onLandingWarp,
    });

    this.wireWorld(hub);
    this.worlds.set('hub', hub);
    this.activeId = 'hub';
    hub.setGridVisible(this.ctx.getShowGrid());
    return hub;
  }

  /**
   * 切换到目标世界（懒创建 level1 等）。
   * 同源 id 时 no-op。
   */
  async goto(target: WorldId, opts: GotoWorldOptions = {}): Promise<void> {
    if (this.busy) return;
    if (this.activeId === target && this.worlds.has(target)) return;

    this.busy = true;
    const fromId: WorldId | null = this.worlds.has(this.activeId)
      ? this.activeId
      : null;

    try {
      const from = fromId ? this.worlds.get(fromId) ?? null : null;
      const appearance = from?.getAppearance();

      // 离开前记住站位与朝向
      let playerYaw: number | undefined;
      if (from) {
        this.spawns[from.id] = from.getPlayerXZ();
        playerYaw = from.getPlayer().getRotationY();
      }

      const world = await this.ensureWorld(target, appearance);

      const spawn = this.resolveSpawn(
        world,
        opts.restorePosition === true,
        playerYaw,
        fromId,
      );

      from?.deactivate();

      // 如果是从 level1 死亡重置回 hub (restorePosition === false)
      if (fromId === 'level1' && target === 'hub' && opts.restorePosition === false) {
        this.spawns.level1 = { x: LEVEL1_LANDING_X, z: LEVEL1_LANDING_Z };
        const oldLevel1 = this.worlds.get('level1');
        if (oldLevel1) {
          this.worlds.delete('level1');
          oldLevel1.dispose();
        }
      }

      const activateOpts: WorldActivateOptions = {
        canvas: this.ctx.canvas,
        cameraMode: this.ctx.getCameraMode(),
        menuOpen: this.ctx.getMenuOpen(),
        showGrid: this.ctx.getShowGrid(),
        appearance: appearance ?? world.getAppearance(),
        spawn,
        spawnYaw: playerYaw,
        playLandingWarp: !opts.isInitialLoad,
      };
      world.activate(activateOpts);

      // 首屏恢复自由镜头角度（仅 level1 历史行为）
      if (
        opts.isInitialLoad &&
        target === 'level1' &&
        this.ctx.getCameraMode() === 'free'
      ) {
        const savedCam = loadCameraState();
        if (savedCam) {
          world.camera.alpha = savedCam.alpha;
          world.camera.beta = savedCam.beta;
          world.camera.radius = savedCam.radius;
        }
      }

      this.activeId = target;
      this.snapCamera(world);

      this.ctx.onAfterActivate(world, {
        isInitialLoad: opts.isInitialLoad === true,
        from: fromId,
      });

      saveWorldState(target);
      saveMinionState(this.snapshotMinion());
    } finally {
      this.busy = false;
    }
  }

  /** 当前活动世界玩家站位写入 spawns 并生成存档快照 */
  snapshotMinion(): MinionStateSnapshot {
    const pos = this.active.getPlayerXZ();
    this.spawns[this.activeId] = { x: pos.x, z: pos.z };
    const prev = loadMinionState();
    const hub = this.spawns.hub;
    const level1 = this.spawns.level1;
    const level2 = this.spawns.level2;
    const warehouse = this.spawns.debugWarehouse;
    const isLevel1 = this.activeId === 'level1';
    const isLevel2 = this.activeId === 'level2';
    const isWarehouse = this.activeId === 'debugWarehouse';
    const isHub = this.activeId === 'hub';

    return {
      x: pos.x,
      z: pos.z,
      hubX: isHub ? pos.x : (prev?.hubX ?? hub.x),
      hubZ: isHub ? pos.z : (prev?.hubZ ?? hub.z),
      level1X: isLevel1 ? pos.x : (prev?.level1X ?? level1.x),
      level1Z: isLevel1 ? pos.z : (prev?.level1Z ?? level1.z),
      level2X: isLevel2 ? pos.x : (prev?.level2X ?? level2.x),
      level2Z: isLevel2 ? pos.z : (prev?.level2Z ?? level2.z),
      debugWarehouseX: isWarehouse
        ? pos.x
        : (prev?.debugWarehouseX ?? warehouse.x),
      debugWarehouseZ: isWarehouse
        ? pos.z
        : (prev?.debugWarehouseZ ?? warehouse.z),
    };
  }

  /** 从存档灌入 spawns（bootstrap 前调用） */
  loadSpawnsFromSave(): void {
    const saved = loadMinionState();
    if (!saved) return;
    this.spawns.hub = {
      x: saved.hubX ?? saved.x ?? 1,
      z: saved.hubZ ?? saved.z ?? 0,
    };
    const l1 = clampLevel1Position(
      saved.level1X ?? saved.blankX ?? LEVEL1_LANDING_X,
      saved.level1Z ?? saved.blankZ ?? LEVEL1_LANDING_Z,
    );
    this.spawns.level1 = l1;
    if (saved.level2X !== undefined && saved.level2Z !== undefined) {
      this.spawns.level2 = {
        x: saved.level2X,
        z: saved.level2Z,
      };
    }
    if (
      saved.debugWarehouseX !== undefined &&
      saved.debugWarehouseZ !== undefined
    ) {
      this.spawns.debugWarehouse = {
        x: saved.debugWarehouseX,
        z: saved.debugWarehouseZ,
      };
    }
  }

  private resolveSpawn(
    world: GameWorld,
    restore: boolean,
    yaw?: number,
    from?: WorldId | null,
  ): { x: number; z: number } {
    if (restore) {
      return this.spawns[world.id] ?? world.getDefaultLandingXZ(yaw, from ?? undefined);
    }
    return world.getDefaultLandingXZ(yaw, from ?? undefined);
  }

  private async ensureWorld(
    id: WorldId,
    appearance: MinionAppearance | undefined,
  ): Promise<GameWorld> {
    const existing = this.worlds.get(id);
    if (existing) return existing;

    if (id === 'hub') {
      throw new Error('WorldRouter: hub must be created via bootstrapHub');
    }

    if (id === 'level2') {
      const hub = this.getHub();
      const app =
        appearance ?? hub?.getAppearance() ?? defaultAppearanceFallback();
      const spawn = this.spawns.level2;
      const level2 = await Level2World.create(this.ctx.engine, {
        appearance: app,
        cameraMode: this.ctx.getCameraMode(),
        initialX: spawn.x,
        initialZ: spawn.z,
        getIsInvincible: this.ctx.getIsInvincible,
        onRequestLandingWarp: this.ctx.onLandingWarp,
      });
      this.wireWorld(level2);
      this.worlds.set('level2', level2);
      return level2;
    }

    if (id === 'debugWarehouse') {
      const hub = this.getHub();
      const app =
        appearance ?? hub?.getAppearance() ?? defaultAppearanceFallback();
      const spawn = this.spawns.debugWarehouse;
      const warehouse = await DebugWarehouseWorld.create(this.ctx.engine, {
        appearance: app,
        cameraMode: this.ctx.getCameraMode(),
        initialX: spawn.x,
        initialZ: spawn.z,
        getIsInvincible: this.ctx.getIsInvincible,
        onAppearanceChanged: hub?.getPlayer().onAppearanceChanged,
        onRequestLandingWarp: this.ctx.onLandingWarp,
      });
      this.wireWorld(warehouse);
      this.worlds.set('debugWarehouse', warehouse);
      return warehouse;
    }

    if (id === 'level1') {
      const hub = this.getHub();
      const app =
        appearance ?? hub?.getAppearance() ?? defaultAppearanceFallback();
      const spawn = this.spawns.level1;
      const level1 = await Level1World.create(this.ctx.engine, {
        appearance: app,
        cameraMode: this.ctx.getCameraMode(),
        initialX: spawn.x,
        initialZ: spawn.z,
        getIsInvincible: this.ctx.getIsInvincible,
        onRequestLandingWarp: this.ctx.onLandingWarp,
      });
      this.wireWorld(level1);
      this.worlds.set('level1', level1);
      return level1;
    }

    throw new Error(`WorldRouter: unknown world id: ${String(id)}`);
  }

  private wireWorld(world: GameWorld): void {
    if (
      world instanceof HubWorld ||
      world instanceof Level1World ||
      world instanceof Level2World ||
      world instanceof DebugWarehouseWorld
    ) {
      world.setMovePersistenceHandlers({
        onMoved: this.ctx.onPlayerMoved,
        onStopped: this.ctx.onPlayerStopped,
      });
    }
    world.camera.onViewMatrixChangedObservable.add(() =>
      this.ctx.onCameraChanged(),
    );
  }

  private snapCamera(world: GameWorld): void {
    const focus = new Vector3();
    world.getPlayer().getFocusPoint(focus);
    world.camera.setTarget(focus);
    this.ctx.cameraFollow.snapTo(
      (out) => world.getPlayer().getFocusPoint(out),
      this.ctx.getCameraMode(),
    );
    if (this.ctx.getCameraMode() === 'fixed') {
      lockFixedOrbit(world.camera, this.ctx.cameraFollow.getRadius());
    }
  }
}

function defaultAppearanceFallback(): MinionAppearance {
  return {
    face: 'fierce',
    mosaicFace: false,
    bodyColor: 0x222222,
    hat: 'wizard',
    staff: 'arcane',
    scaleMultiplier: 0.5,
    lowPolyFlat: false,
    formation: null,
  };
}
