import { Container, Rectangle } from 'pixi.js';
import { preloadLevelAssets } from '../assets/preload';
import type { AmmoHudModel } from '../entities/CharacterResources';
import type { PlayerCharacterBase } from '../entities/PlayerCharacterBase';
import type { WorldCreature } from '../entities/WorldCreature';
import { InputManager } from '../input/InputManager';
import { CharacterRoster } from '../systems/CharacterRoster';
import { CombatSystem } from '../systems/CombatSystem';
import { spawnEnemiesInto } from '../systems/EnemySpawner';
import { createEnemyAt } from '../systems/enemyFactory';
import { GodModeController } from '../systems/GodModeController';
import { HarvestWorld } from '../systems/HarvestWorld';
import { canSpawnNaturalAnimal } from '../systems/ecologySpawn';
import { Inventory } from '../systems/Inventory';
import { SolidResolver } from '../systems/SolidResolver';
import { DebugOverlay } from '../systems/DebugOverlay';

import { HealthBar } from '../ui/HealthBar';
import { InventoryHud } from '../ui/InventoryHud';
import { PauseMenu } from '../ui/PauseMenu';
import { BombAmmoHud } from '../ui/BombAmmoHud';
import { SpearAmmoHud } from '../ui/SpearAmmoHud';
import { GodModeHud } from '../ui/GodModeHud';
import {
  LEVEL_1,
  cloneLevelDef,
  normalizeTrees,
  saveMapDraft,
  setActiveMapDef,
  type LevelMapDef,
} from '../data/maps';
import { getNightBackground, NightOverlay } from '../world/NightOverlay';
import { WorldMap } from '../world/WorldMap';
import { LevelCamera } from './LevelCamera';
import type { GameScene } from './types';
import { LevelHudLayout } from '../ui/LevelHudLayout';
import { LevelInputRouter } from './level/LevelInputRouter';
import { LevelLandRedraw } from './level/LevelLandRedraw';
import { LevelServices } from './level/LevelServices';
import { LevelSimulation } from './level/LevelSimulation';
import { LevelWorldLayers } from './level/LevelWorldLayers';

const PLAYER_MAX_HP = 100;

export type LevelSceneOptions = {
  /** 本关地图；缺省 LEVEL_1 */
  mapDef?: LevelMapDef;
  onBack: () => void;
  onBackground?: (color: number) => void;
};

/**
 * 可玩关卡（默认黑夜）：编排输入、系统与 HUD。
 * 帧模拟见 LevelSimulation；输入见 LevelInputRouter；图层见 LevelWorldLayers。
 * 玩法细节见 CharacterRoster / HarvestWorld / GodModeController / CombatSystem。
 *
 * 操作：WASD 移动 · 点击远程 · Esc 暂停 · G 上帝模式
 * · Q 特技 · E 闪现 · R 砍树 · 滚轮/+/-/0/F 缩放
 */
export class LevelScene extends Container implements GameScene {
  private readonly layers = new LevelWorldLayers();
  private readonly worldMap: WorldMap;
  private readonly nightOverlay: NightOverlay;
  private readonly landRedraw: LevelLandRedraw;

  private readonly roster = new CharacterRoster();
  private readonly healthBar: HealthBar;
  private readonly spearAmmoHud: SpearAmmoHud;
  private readonly bombAmmoHud: BombAmmoHud;
  private readonly inventoryHud: InventoryHud;
  private readonly hudLayout: LevelHudLayout;
  /** 场上全部生物（蜘蛛/农场动物/狼等），非仅蜘蛛 */
  private readonly creatures: WorldCreature[] = [];
  private readonly harvest: HarvestWorld;
  private readonly inventory: Inventory;
  private readonly input = new InputManager();
  private readonly solid = new SolidResolver();
  private readonly combat: CombatSystem;
  private readonly debugOverlay: DebugOverlay;
  private readonly pauseMenu: PauseMenu;
  private readonly godHud: GodModeHud;
  private readonly god: GodModeController;
  private readonly camera: LevelCamera;
  private readonly services: LevelServices;
  private readonly inputRouter: LevelInputRouter;
  private readonly simulation: LevelSimulation;

  private readonly mapDef: LevelMapDef;
  private spawn: { x: number; y: number };
  private readonly onBack: () => void;
  private readonly onBackground?: (color: number) => void;

  private paused = false;

  constructor(width: number, height: number, options: LevelSceneOptions) {
    super();
    this.mapDef = cloneLevelDef(options.mapDef ?? LEVEL_1);
    this.spawn = { ...this.mapDef.spawn };
    this.label = `LevelScene:${this.mapDef.id}`;
    this.onBack = options.onBack;
    this.onBackground = options.onBackground;

    this.eventMode = 'static';
    this.cursor = 'default';
    this.hitArea = new Rectangle(0, 0, width, height);

    this.addChild(this.layers.worldRoot);

    this.camera = new LevelCamera({
      worldRoot: this.layers.worldRoot,
      spawnX: this.spawn.x,
      spawnY: this.spawn.y,
      viewWidth: width,
      viewHeight: height,
    });

    setActiveMapDef(this.mapDef);
    this.worldMap = new WorldMap(this.mapDef);
    this.layers.worldRoot.addChildAt(this.worldMap, 0);

    this.inventoryHud = new InventoryHud();
    this.inventory = new Inventory({
      slotCount: 8,
      onChange: () => this.inventoryHud.setSlots(this.inventory.getSlots()),
    });
    this.inventoryHud.setSlots(this.inventory.getSlots());

    this.harvest = new HarvestWorld({
      sortLayer: this.layers.sortLayer,
      grassFarLayer: this.layers.grassFarLayer,
      treeBackLayer: this.layers.treeBackLayer,
      treeFrontLayer: this.layers.treeFrontLayer,
      getDepthRefY: () => this.player?.worldY ?? this.spawn.y,
      inventory: this.inventory,
      getMapDef: () => this.mapDef,
      persistMapDraft: () => this.persistMapDraft(),
      afterWorldChange: (opts) => {
        this.syncWorldActors();
        this.layers.sortDepth();
        if (opts?.redrawLand) {
          this.landRedraw.schedule();
        }
      },
      onSpawnNaturalAnimal: (kind, x, y) => {
        if (!canSpawnNaturalAnimal(kind, this.creatures)) return;

        const creature = createEnemyAt(kind, x, y);
        if (!creature) return;
        this.layers.sortLayer.addChild(creature);
        this.creatures.push(creature);
        void creature.load();
        this.syncWorldActors();
        this.layers.sortDepth();
      },
    });

    this.landRedraw = new LevelLandRedraw(this.worldMap, this.harvest);

    this.combat = new CombatSystem(this.layers.sortLayer, {
      sortDepth: () => this.layers.sortDepth(),
      syncWorldActors: () => this.syncWorldActors(),
      onAmmoHudChanged: (model) => this.applyAmmoHudModel(model),
      onHarvestTreeDestroyed: (tree) => this.harvest.onTreeDestroyed(tree),
    });

    this.services = new LevelServices({
      sortLayer: this.layers.sortLayer,
      combat: this.combat,
      getCreatures: () => this.creatures,
    });

    this.debugOverlay = new DebugOverlay();
    this.layers.worldRoot.addChild(this.debugOverlay);

    spawnEnemiesInto(
      this.mapDef,
      this.spawn,
      this.layers.sortLayer,
      this.creatures,
    );
    this.harvest.spawnFromMap(this.mapDef);

    this.nightOverlay = new NightOverlay();
    this.nightOverlay.layout(width, height);
    this.addChild(this.nightOverlay);

    this.healthBar = new HealthBar({
      maxHp: PLAYER_MAX_HP,
      width: LevelHudLayout.HUD_HP_WIDTH,
      height: LevelHudLayout.HUD_HP_HEIGHT,
    });
    this.healthBar.setHealth(PLAYER_MAX_HP);
    this.addChild(this.healthBar);

    this.spearAmmoHud = new SpearAmmoHud();
    this.spearAmmoHud.visible = false;
    this.addChild(this.spearAmmoHud);

    this.bombAmmoHud = new BombAmmoHud();
    this.bombAmmoHud.visible = false;
    this.addChild(this.bombAmmoHud);

    this.addChild(this.inventoryHud);

    this.hudLayout = new LevelHudLayout({
      healthBar: this.healthBar,
      spearAmmoHud: this.spearAmmoHud,
      bombAmmoHud: this.bombAmmoHud,
      inventoryHud: this.inventoryHud,
    });

    this.pauseMenu = new PauseMenu({
      onResume: () => this.setPaused(false),
      onBack: () => this.onBack(),
      onClearScene: () => this.clearScene(),
    });
    this.addChild(this.pauseMenu);

    this.godHud = new GodModeHud({
      onSelectBrush: (brush) => this.god.setBrush(brush),
      onClearScene: () => this.clearScene(),
    });
    this.addChild(this.godHud);

    this.god = new GodModeController({
      getMapDef: () => this.mapDef,
      getSpawn: () => this.spawn,
      setSpawn: (x, y) => {
        this.spawn = { x, y };
      },
      getPlayer: () => this.roster.player,
      sortLayer: this.layers.sortLayer,
      creatures: this.creatures,
      harvest: this.harvest,
      camera: this.camera,
      hud: this.godHud,
      syncWorldActors: () => this.syncWorldActors(),
      sortDepth: () => this.layers.sortDepth(),
      persistMapDraft: () => this.persistMapDraft(),
      afterWorldChange: () => this.landRedraw.schedule(),
    });
    this.godHud.setBrush(this.god.brush);

    this.simulation = new LevelSimulation({
      input: this.input,
      getPlayer: () => this.player,
      creatures: this.creatures,
      mapDef: this.mapDef,
      solid: this.solid,
      combat: this.combat,
      harvest: this.harvest,
      god: this.god,
      camera: this.camera,
      healthBar: this.healthBar,
      worldMap: this.worldMap,
      layers: this.layers,
      landRedraw: this.landRedraw,
      getPointer: () => this.inputRouter.pointer,
      entranceContext: () => this.services.entranceContext(),
      syncWorldActors: () => this.syncWorldActors(),
      stepCamera: (dt, snap) => this.stepCamera(dt, snap),
      syncAmmoHud: (p) => this.syncAmmoHud(p),
    });

    this.inputRouter = new LevelInputRouter({
      input: this.input,
      camera: this.camera,
      combat: this.combat,
      harvest: this.harvest,
      god: this.god,
      getPlayer: () => this.player,
      isPaused: () => this.paused,
      setPaused: (v) => this.setPaused(v),
      setGodMode: (on) => this.setGodMode(on),
      entranceContext: () => this.services.entranceContext(),
      syncWorldActors: () => this.syncWorldActors(),
      applyPlayerSolid: (fromX, fromY) =>
        this.simulation.applyPlayerSolid(fromX, fromY),
    });

    this.on('pointertap', this.inputRouter.onPointerTap);
    this.on('pointermove', this.inputRouter.onPointerMove);

    this.roster.mount();
    this.roster.activate(
      'ice-ranger',
      this.layers.sortLayer,
      {
        worldX: this.spawn.x,
        worldY: this.spawn.y,
        facing: 1,
        persist: false,
      },
      {
        onActivated: (p) => this.onPlayerActivated(p),
      },
    );

    this.stepCamera(0, true);
    this.syncWorldActors();
    this.layoutHealthHud();
    this.nightOverlay.layout(width, height);
    this.inventoryHud.layout(width, height);
    this.pauseMenu.layout(width, height);
    this.godHud.layout(width, height);
  }

  private get player(): PlayerCharacterBase | null {
    return this.roster.player;
  }

  private onPlayerActivated(player: PlayerCharacterBase): void {
    this.syncAmmoHud(player);
    this.cursor = this.god.enabled
      ? 'crosshair'
      : player.canRangedAttack
        ? 'crosshair'
        : 'default';
  }

  private syncAmmoHud(player: PlayerCharacterBase): void {
    this.applyAmmoHudModel(player.getAmmoHud());
  }

  /** 按 AmmoHudModel 切换飞剑 / 炸药 HUD（只认 kind） */
  private applyAmmoHudModel(model: AmmoHudModel): void {
    this.spearAmmoHud.visible = model.kind === 'spear';
    this.bombAmmoHud.visible = model.kind === 'bomb';
    if (model.kind === 'spear') {
      this.spearAmmoHud.setAmmo(model.snap);
    } else if (model.kind === 'bomb') {
      this.bombAmmoHud.setAmmo(model.snap);
    }
  }

  async init(): Promise<void> {
    this.onBackground?.(getNightBackground());
    this.input.bind();
    window.addEventListener('wheel', this.inputRouter.onWheel, {
      passive: false,
    });

    const rosterLoads = [...this.roster.values()].map(
      (entity) => () => entity.load(),
    );

    await preloadLevelAssets({
      loadMap: () => this.worldMap.load(),
      loadCharacters: rosterLoads,
      spiders: this.creatures.length > 0,
    });

    this.stepCamera(0, true);
    await Promise.all(this.creatures.map((s) => s.load()));
    if (this.player) this.syncAmmoHud(this.player);
    this.syncWorldActors();
    this.layers.sortDepth();
  }

  private stepCamera(dt: number, snap = false): boolean {
    const player = this.player;
    const focus = player
      ? this.camera.computeFocus(
          player.worldX,
          player.worldY,
          this.inputRouter.pointer,
        )
      : { x: this.spawn.x, y: this.spawn.y };
    return this.camera.step(dt, focus.x, focus.y, snap);
  }

  private syncWorldActors(): void {
    this.player?.syncToWorld();
    for (const spider of this.creatures) {
      spider.syncToWorld();
    }
    this.harvest.syncToWorld();
    this.combat.syncProjectiles();
  }

  destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.off('pointertap', this.inputRouter.onPointerTap);
    this.off('pointermove', this.inputRouter.onPointerMove);
    window.removeEventListener('wheel', this.inputRouter.onWheel);
    this.input.unbind();
    super.destroy(options);
  }

  update(deltaMS: number): void {
    const dt = deltaMS / 1000;
    this.inputRouter.poll(dt);

    const player = this.player;
    this.debugOverlay.update({
      player,
      creatures: this.creatures,
      bombs: this.combat.getBombs(),
      spears: this.combat.getSpears(),
    });

    if (!player) return;

    if (this.paused) {
      player.update(deltaMS, false);
      this.stepCamera(dt);
      return;
    }

    this.simulation.step(deltaMS, dt, player);
  }

  resize(width: number, height: number): void {
    this.hitArea = new Rectangle(0, 0, width, height);
    this.camera.resize(width, height);
    this.stepCamera(0, true);
    this.syncWorldActors();
    this.layers.sortDepth();
    this.layoutHealthHud();
    this.nightOverlay.layout(width, height);
    this.inventoryHud.layout(width, height);
    this.pauseMenu.layout(width, height);
    this.godHud.layout(width, height);
  }

  private setPaused(value: boolean): void {
    this.paused = value;
    this.pauseMenu.setOpen(value);
    this.input.clear();
  }

  private setGodMode(on: boolean): void {
    this.god.setEnabled(on);
    this.cursor = on
      ? 'crosshair'
      : this.player?.canRangedAttack
        ? 'crosshair'
        : 'default';
  }

  private persistMapDraft(): void {
    this.mapDef.trees = normalizeTrees(this.mapDef);
    this.mapDef.spawn = { ...this.spawn };
    saveMapDraft(this.mapDef);
    setActiveMapDef(this.mapDef);
  }

  private layoutHealthHud(): void {
    const width = this.camera.width;
    const height = this.camera.height;
    if (width <= 0 || height <= 0) return;
    this.hudLayout.updateLayout(width, height);
  }

  private clearScene(): void {
    this.god.clearScene();
    this.landRedraw.redrawNow([]);
  }
}
