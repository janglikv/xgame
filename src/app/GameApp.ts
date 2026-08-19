import { Color3, Engine, Scene, StandardMaterial, Vector3 } from '@babylonjs/core';
import {
  loadCameraState,
  saveCameraState,
  saveFixedRadius,
  type CameraStateSnapshot,
} from '../storage/cameraState';
import { saveMinionAppearanceState } from '../storage/minionAppearanceState';
import { saveMinionState } from '../storage/minionState';
import {
  applyLiveShadowQuality,
  getGraphicsPreset,
  type GraphicsQuality,
} from '../storage/graphicsQuality';
import {
  FIXED_CAMERA,
  loadSettingsState,
  saveSettingsState,
  type BulletBounceCount,
  type CameraMode,
} from '../storage/settingsState';
import { loadWorldState, saveWorldState } from '../storage/worldState';
import { FadeOverlay } from '../ui/FadeOverlay';
import { FpsOverlay } from '../ui/FpsOverlay';
import { SettingsPanel } from '../ui/SettingsPanel';
import type { WorldTransition } from '../world/GameWorld';
import { CameraFollow } from './CameraFollow';
import { MoveInput } from './MoveInput';
import { PlayerCombatController } from './PlayerCombatController';
import { TeleportFlow } from './TeleportFlow';
import { WarpLanding } from './WarpLanding';
import { BgmPlayer, HUB_BGM, LEVEL1_BGM, LEVEL2_BGM } from '../audio/BgmPlayer';
import { setHitSfxId, type HitSfxId } from '../audio/hitSfx';
import { WorldRouter } from './WorldRouter';

const MOVE_SPEED = 2;

/**
 * 游戏总编排：启动、输入、tick、设置。
 * 世界切换 → WorldRouter；传送黑场 → TeleportFlow。
 */
export class GameApp {
  private engine!: Engine;
  private canvas!: HTMLCanvasElement;
  private router!: WorldRouter;

  private cameraMode: CameraMode = 'fixed';
  private allowZoomOut = false;
  private showFps = true;
  private showGrid = true;
  private showColliders = false;
  private isInvincible = false;
  private bulletBounceCount: BulletBounceCount = 0;
  private bgmEnabled = true;
  private graphicsQuality: GraphicsQuality = 'medium';
  private hitSfxId: HitSfxId = 'original';
  private readonly bgm = new BgmPlayer();

  private readonly moveInput = new MoveInput();
  private readonly combat = new PlayerCombatController();
  private readonly cameraFollow = new CameraFollow();
  private readonly warpLanding = new WarpLanding();

  private settingsPanel!: SettingsPanel;
  private fpsOverlay!: FpsOverlay;
  private fadeOverlay!: FadeOverlay;
  private teleportFlow!: TeleportFlow;

  private camSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private fixedCamSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private minionSaveTimer: ReturnType<typeof setTimeout> | null = null;

  async start(container: HTMLElement): Promise<void> {
    this.canvas = document.createElement('canvas');
    this.canvas.style.display = 'block';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    container.appendChild(this.canvas);

    this.engine = new Engine(this.canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
      adaptToDeviceRatio: true,
    });
    const settings = loadSettingsState();
    this.cameraMode = settings.cameraMode;
    this.allowZoomOut = settings.allowZoomOut;
    this.showFps = settings.showFps;
    this.showGrid = settings.showGrid;
    this.showColliders = settings.showColliders;
    this.isInvincible = settings.isInvincible;
    this.bulletBounceCount = settings.bulletBounceCount;
    // 正式包没有调试入口：关掉网格/无敌/自由镜头/超广角拉远/子弹反弹，避免沿用本地存档
    if (!import.meta.env.DEV) {
      this.cameraMode = 'fixed';
      this.allowZoomOut = false;
      this.showGrid = false;
      this.showColliders = false;
      this.isInvincible = false;
      this.bulletBounceCount = 0;
    }
    this.cameraFollow.setAllowZoomOut(this.allowZoomOut);
    this.bgmEnabled = settings.bgmEnabled;
    this.graphicsQuality = settings.graphicsQuality;
    this.hitSfxId = settings.hitSfxId;
    setHitSfxId(this.hitSfxId);
    this.applyHardwareScale();
    this.bgm.setEnabled(this.bgmEnabled);
    this.bgm.armUnlock();

    const savedCam = loadCameraState();
    if (savedCam?.fixedRadius !== undefined) {
      this.cameraFollow.setRadius(savedCam.fixedRadius);
    }
    this.cameraFollow.setOnRadiusChanged((radius) => {
      this.scheduleSaveFixedRadius(radius);
    });

    const savedWorld = loadWorldState();

    this.router = new WorldRouter({
      engine: this.engine,
      canvas: this.canvas,
      getCameraMode: () => this.cameraMode,
      getMenuOpen: () => this.settingsPanel?.isOpen() ?? false,
      getShowGrid: () => this.showGrid,
      getIsInvincible: () => this.isInvincible,
      onLandingWarp: (m, p, x, z) => this.warpLanding.trigger(m, p, x, z),
      onPlayerMoved: () => this.scheduleSaveMinion(),
      onPlayerStopped: () => {
        saveMinionState(this.router.snapshotMinion());
        saveWorldState(this.router.activeWorldId);
      },
      onCameraChanged: () => this.scheduleSaveCamera(),
      cameraFollow: this.cameraFollow,
      onAfterActivate: (world, meta) => {
        this.settingsPanel.rebind(world.scene);
        this.fpsOverlay.rebind(world.scene);
        applyCollidersVisibility(world.scene, this.showColliders);
        world.getSpellSystem().setBounceCount(this.bulletBounceCount);
        this.bgm.setTrack(
          world.id === 'hub' || world.id === 'debugWarehouse'
            ? HUB_BGM
            : world.id === 'level2'
              ? LEVEL2_BGM
              : LEVEL1_BGM,
        );
        if (meta.isInitialLoad) {
          this.teleportFlow.rebindScene(world.scene, false);
        }
      },
    });
    this.router.loadSpawnsFromSave();
    const hubSpawn = this.router.getSpawn('hub');

    const hub = await this.router.bootstrapHub({
      cameraMode: this.cameraMode,
      spawnX: hubSpawn.x,
      spawnZ: hubSpawn.z,
      freeCamera: savedCam
        ? {
            alpha: savedCam.alpha,
            beta: savedCam.beta,
            radius: savedCam.radius,
          }
        : undefined,
      onAppearanceChanged: (a) => saveMinionAppearanceState(a),
    });

    hub.getSpellSystem().setBounceCount(this.bulletBounceCount);
    applyCollidersVisibility(hub.scene, this.showColliders);

    if (this.cameraMode === 'free') {
      hub.attachCamera(this.canvas);
    }

    this.fpsOverlay = new FpsOverlay(hub.scene);
    this.fpsOverlay.setVisible(this.showFps);
    this.fadeOverlay = new FadeOverlay(hub.scene);
    this.teleportFlow = new TeleportFlow(this.fadeOverlay);

    this.settingsPanel = new SettingsPanel(hub.scene, {
      getShowFps: () => this.showFps,
      setShowFps: (show) => {
        this.showFps = show;
        this.fpsOverlay.setVisible(show);
        this.persistSettings();
      },
      getShowGrid: () => this.showGrid,
      setShowGrid: (show) => {
        this.showGrid = show;
        this.router.forEach((w) => w.setGridVisible(show));
        this.persistSettings();
      },
      getShowColliders: () => this.showColliders,
      setShowColliders: (show) => {
        this.showColliders = show;
        this.router.forEach((w) => applyCollidersVisibility(w.scene, show));
        this.persistSettings();
      },
      getIsInvincible: () => this.isInvincible,
      setIsInvincible: (invincible) => {
        this.isInvincible = invincible;
        if (invincible) {
          const activeWorld = this.router.active as { playerHealthBar?: { setHp: (hp: number) => void; getMaxHp: () => number } };
          if (activeWorld.playerHealthBar) {
            activeWorld.playerHealthBar.setHp(activeWorld.playerHealthBar.getMaxHp());
          }
        }
        this.persistSettings();
      },
      getBulletBounceCount: () => this.bulletBounceCount,
      setBulletBounceCount: (count) => {
        this.bulletBounceCount = count;
        this.applyBulletBounceConfig();
        this.persistSettings();
      },
      getBgmEnabled: () => this.bgmEnabled,
      setBgmEnabled: (enabled) => {
        this.bgmEnabled = enabled;
        this.bgm.setEnabled(enabled);
        this.persistSettings();
      },
      getGraphicsQuality: () => this.graphicsQuality,
      setGraphicsQuality: (quality) => this.setGraphicsQuality(quality),
      getCameraMode: () => this.cameraMode,
      setCameraMode: (mode) => this.setCameraMode(mode),
      getAllowZoomOut: () => this.allowZoomOut,
      setAllowZoomOut: (allow) => {
        this.allowZoomOut = allow;
        this.cameraFollow.setAllowZoomOut(allow);
        this.persistSettings();
        saveFixedRadius(this.cameraFollow.getRadius());
      },
      getHitSfxId: () => this.hitSfxId,
      setHitSfxId: (id) => {
        this.hitSfxId = id;
        setHitSfxId(id);
        this.persistSettings();
      },
      getCameraInfo: () => {
        const cam = this.router.active.camera;
        return {
          alpha: cam.alpha,
          beta: cam.beta,
          radius: cam.radius,
          targetX: cam.target.x,
          targetY: cam.target.y,
          targetZ: cam.target.z,
        };
      },
      onInstantKillAll: () => {
        this.router.active.defeatAllEnemies?.();
      },
      onOpenChange: (open) => this.onMenuOpenChange(open),
    });

    this.combat.bindCanvas(this.canvas);
    this.cameraFollow.bindCanvas(
      this.canvas,
      () => this.settingsPanel.isOpen() || this.cameraMode !== 'fixed',
    );
    this.bindInput();

    {
      const focus = new Vector3();
      const active = this.router.active;
      active.getPlayer().getFocusPoint(focus);
      active.camera.setTarget(focus);
      this.cameraFollow.snapTo(
        (out) => active.getPlayer().getFocusPoint(out),
        this.cameraMode,
      );
    }

    if (
      savedWorld === 'level1' ||
      savedWorld === 'level2' ||
      savedWorld === 'debugWarehouse'
    ) {
      await this.router.goto(savedWorld, {
        restorePosition: true,
        isInitialLoad: true,
      });
    }

    this.bindLifecycle();
    this.engine.runRenderLoop(() => this.tick());
  }

  private bindInput(): void {
    window.addEventListener('keydown', (e) => {
      const key = e.key.toLowerCase();
      if (e.repeat) return;
      if (this.settingsPanel.isOpen()) return;
      if (isTypingTarget(e.target)) return;

      if (e.code === 'Space' || key === ' ' || key === 'spacebar') {
        e.preventDefault();
        this.resetZoom();
        return;
      }

      if (key === 'e' || key === 'r') {
        const warehouse = this.router.getDebugWarehouse();
        if (!warehouse || this.router.activeWorldId !== 'debugWarehouse') return;
        const mode = key === 'e' ? 'partial' : 'full';
        if (warehouse.tryApplyHoverAppearance(mode)) e.preventDefault();
        return;
      }

      if (!this.moveInput.isMoveKey(key)) return;
      this.moveInput.setKey(key, true);
      e.preventDefault();
    });

    window.addEventListener('keyup', (e) => {
      const key = e.key.toLowerCase();
      if (!this.moveInput.isMoveKey(key)) return;
      this.moveInput.setKey(key, false);
    });

    window.addEventListener('blur', () => this.moveInput.clear());

    this.canvas.addEventListener('pointermove', () => {
      if (this.settingsPanel.isOpen()) return;
      const warehouse = this.router.getDebugWarehouse();
      if (warehouse && this.router.activeWorldId === 'debugWarehouse') {
        warehouse.hoverOutline.updateFromScenePick(warehouse.scene);
      }
    });
  }

  private resetZoom(): void {
    if (this.cameraMode === 'fixed') {
      this.cameraFollow.resetZoom();
    } else {
      const cam = this.router.active.camera;
      cam.radius = FIXED_CAMERA.radius;
      this.scheduleSaveCamera();
    }
  }

  private bindLifecycle(): void {
    window.addEventListener('beforeunload', () => {
      if (this.camSaveTimer !== null) clearTimeout(this.camSaveTimer);
      if (this.minionSaveTimer !== null) clearTimeout(this.minionSaveTimer);
      if (this.cameraMode === 'free') {
        saveCameraState(this.snapshotCamera());
      }
      saveMinionState(this.router.snapshotMinion());
      saveWorldState(this.router.activeWorldId);
      this.persistSettings();
    });

    window.addEventListener('resize', () => this.engine.resize());
  }

  private setCameraMode(mode: CameraMode): void {
    if (mode === this.cameraMode) return;

    if (
      this.cameraMode === 'free' &&
      mode === 'fixed' &&
      this.router.activeWorldId === 'hub'
    ) {
      saveCameraState(this.snapshotCamera());
    }

    this.cameraMode = mode;
    const menuOpen = this.settingsPanel.isOpen();
    this.router.active.setCameraMode(mode, this.canvas, menuOpen);

    if (mode === 'free' && this.router.activeWorldId === 'hub') {
      this.router.getHub()?.restoreFreeCameraAngles();
    }

    this.persistSettings();
  }

  private onMenuOpenChange(open: boolean): void {
    this.moveInput.clear();
    this.router.getDebugWarehouse()?.setHoverEnabled(
      !open && this.router.activeWorldId === 'debugWarehouse',
    );
    if (open) {
      this.router.active.detachCamera();
    } else if (this.cameraMode === 'free') {
      this.router.active.attachCamera(this.canvas);
    }
  }

  private tick(): void {
    const dt = Math.min(this.engine.getDeltaTime() / 1000, 0.05);
    const menuOpen = this.settingsPanel.isOpen();
    const world = this.router.active;
    const lock = this.teleportFlow.locksInput;

    this.combat.update(dt, {
      scene: world.scene,
      camera: world.camera,
      player: world.getPlayer(),
      spellSystem: world.getSpellSystem(),
      menuOpen: menuOpen || lock,
      cameraFollow: this.cameraFollow,
    });

    this.warpLanding.update(dt);

    const moveWish = lock
      ? { moving: false, wishX: 0, wishZ: 0, dirX: 0, dirZ: 0 }
      : this.moveInput.readWish(world.camera, MOVE_SPEED, menuOpen);

    const transition = world.update({
      dt,
      menuOpen: menuOpen || lock,
      cameraMode: this.cameraMode,
      moveWish,
      pointerOverCanvas: lock ? false : this.combat.isOverCanvas,
    });

    this.cameraFollow.update(
      world.camera,
      (out) => world.getPlayer().getFocusPoint(out),
      dt,
      this.cameraMode,
    );

    this.handleTeleport(dt, transition);

    const isPlayerDead = world.getPlayer().isDead();
    this.bgm.setDucked(isPlayerDead);

    if (this.showFps) this.fpsOverlay.update();
    this.settingsPanel.update();
    world.scene.render();
  }

  private handleTeleport(dt: number, transition: WorldTransition): void {
    const world = this.router.active;

    if (this.teleportFlow.canAcceptTransition && transition) {
      void this.teleportFlow.runTransition(async () => {
        await this.router.goto(transition.world, {
          restorePosition: transition.restorePosition === true,
          isInitialLoad: false,
        });
        return this.router.active.scene;
      });
    }

    this.teleportFlow.update(dt, world.getTeleportCharge01());
  }

  private snapshotCamera(): CameraStateSnapshot {
    const cam = this.router.active.camera;
    return {
      alpha: cam.alpha,
      beta: cam.beta,
      radius: cam.radius,
      fixedRadius: this.cameraFollow.getRadius(),
      targetX: cam.target.x,
      targetY: cam.target.y,
      targetZ: cam.target.z,
    };
  }

  private scheduleSaveFixedRadius(radius: number): void {
    if (this.fixedCamSaveTimer !== null) clearTimeout(this.fixedCamSaveTimer);
    this.fixedCamSaveTimer = setTimeout(() => {
      this.fixedCamSaveTimer = null;
      saveFixedRadius(radius);
    }, 200);
  }

  private scheduleSaveCamera(): void {
    if (this.cameraMode !== 'free') return;
    if (this.camSaveTimer !== null) clearTimeout(this.camSaveTimer);
    this.camSaveTimer = setTimeout(() => {
      this.camSaveTimer = null;
      if (this.cameraMode === 'free') {
        saveCameraState(this.snapshotCamera());
      }
    }, 200);
  }

  private scheduleSaveMinion(): void {
    if (this.minionSaveTimer !== null) clearTimeout(this.minionSaveTimer);
    this.minionSaveTimer = setTimeout(() => {
      this.minionSaveTimer = null;
      saveMinionState(this.router.snapshotMinion());
      saveWorldState(this.router.activeWorldId);
    }, 200);
  }

  private persistSettings(): void {
    saveSettingsState({
      showFps: this.showFps,
      showGrid: this.showGrid,
      showColliders: this.showColliders,
      isInvincible: this.isInvincible,
      bulletBounceCount: this.bulletBounceCount,
      cameraMode: this.cameraMode,
      allowZoomOut: this.allowZoomOut,
      bgmEnabled: this.bgmEnabled,
      graphicsQuality: this.graphicsQuality,
      hitSfxId: this.hitSfxId,
    });
  }

  private applyBulletBounceConfig(): void {
    this.router.forEach((w) => w.getSpellSystem().setBounceCount(this.bulletBounceCount));
  }

  private setGraphicsQuality(quality: GraphicsQuality): void {
    if (this.graphicsQuality === quality) return;
    this.graphicsQuality = quality;
    this.applyHardwareScale();
    this.router.forEach((w) => applyLiveShadowQuality(w.scene, quality));
    this.router.dropInactive();
    this.persistSettings();
  }

  private applyHardwareScale(): void {
    const cap = getGraphicsPreset(this.graphicsQuality).dprCap;
    this.engine.setHardwareScalingLevel(
      1 / Math.min(window.devicePixelRatio || 1, cap),
    );
  }
}

function applyCollidersVisibility(scene: Scene, show: boolean): void {
  for (const mesh of scene.meshes) {
    if (!mesh) continue;
    const name = mesh.name;
    // 真实的 3D 视觉墙 Mesh 永远保持渲染可见
    if (name.startsWith('RenderWall') || mesh.metadata?.isRenderWall === true) {
      mesh.isVisible = true;
      continue;
    }

    // 独立物理碰撞代理盒 Mesh
    if (
      name.startsWith('Phys') ||
      name.includes('PhysProxy') ||
      mesh.metadata?.isColliderMesh === true
    ) {
      mesh.isVisible = show;
      if (show) {
        if (!mesh.material) {
          const mat = new StandardMaterial(`debug_coll_mat_${name}`, scene);
          mat.wireframe = true;
          mat.emissiveColor = Color3.FromHexString('#ff3344');
          mesh.material = mat;
        } else if (mesh.material instanceof StandardMaterial) {
          mesh.material.wireframe = true;
          mesh.material.emissiveColor = Color3.FromHexString('#ff3344');
        }
      }
    }
  }
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return (
    t.tagName === 'INPUT' ||
    t.tagName === 'TEXTAREA' ||
    t.isContentEditable
  );
}
