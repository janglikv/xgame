import { Container, Rectangle } from 'pixi.js';
import { preloadLevelAssets } from '../assets/preload';
import type { EntranceContext } from '../entities/CharacterEntrance';
import type { AmmoHudModel } from '../entities/CharacterResources';
import type { PlayerCharacterBase } from '../entities/PlayerCharacterBase';
import type { CharacterId } from '../entities/types';
import {
  applyKnockImpulse,
  stepKnockArc,
} from '../entities/knockArc';
import type {
  CreatureEcologyContext,
  Spider,
} from '../entities/Spider';
import { EdgeKeys } from '../input/EdgeKeys';
import { Keyboard } from '../input/Keyboard';
import {
  CharacterRoster,
} from '../systems/CharacterRoster';
import {
  CombatSystem,
  type CombatWorld,
} from '../systems/CombatSystem';
import { spawnEnemiesInto } from '../systems/EnemySpawner';
import { GodModeController } from '../systems/GodModeController';
import { HarvestWorld } from '../systems/HarvestWorld';
import { Inventory } from '../systems/Inventory';
import {
  SolidResolver,
  type SolidContext,
} from '../systems/SolidResolver';
import { DebugOverlay } from '../systems/DebugOverlay';
import { CharacterSwitchHud } from '../ui/CharacterSwitchHud';
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

const MOVE_SPEED = 220;
/** 玩家 HUD 血条尺寸 / 底边边距（屏幕像素） */
const HUD_HP_WIDTH = 240;
const HUD_HP_HEIGHT = 14;
const HUD_HP_MARGIN_BOTTOM = 28;
/** 弹药数量相对血条上沿再上移（屏幕像素） */
const HUD_AMMO_GAP = 22;
/** 炸药 HUD 相对血条左缘再左移（屏幕像素） */
const HUD_BOMB_AMMO_NUDGE_X = -6;
/** 炸药 HUD 相对弹药基线再下移（屏幕像素） */
const HUD_BOMB_AMMO_NUDGE_Y = 8;
const PLAYER_MAX_HP = 100;
/** 击退很强时削弱 WASD 控制（水平速度） */
const KNOCK_CONTROL_SOFTEN = 220;
/** 镜头朝指针方向偏移的比例 */
const CAMERA_POINTER_LEAD = 0.5;
/** 镜头指针偏移上限（世界像素） */
const CAMERA_POINTER_LEAD_MAX = 320;

export type LevelSceneOptions = {
  /** 本关地图；缺省 LEVEL_1 */
  mapDef?: LevelMapDef;
  onBack: () => void;
  onBackground?: (color: number) => void;
  /** 上次操控角色；缺省 bomb-girl */
  getLastCharacter?: () => CharacterId;
  /** 切换角色后写入存档 */
  setLastCharacter?: (id: CharacterId) => void;
};

/**
 * 可玩关卡（默认黑夜）：编排输入、系统与 HUD。
 * 玩法细节见 CharacterRoster / HarvestWorld / GodModeController / CombatSystem。
 *
 * 操作：WASD 移动 · 点击远程 · Tab 切换 · Esc 暂停 · G 上帝模式
 * · Q 特技 · E 闪现 · R 砍树 · 滚轮/+/-/0/F 缩放
 */
export class LevelScene extends Container implements GameScene {
  private readonly worldRoot: Container;
  private readonly worldMap: WorldMap;
  private readonly sortLayer: Container;
  private readonly nightOverlay: NightOverlay;

  private readonly roster = new CharacterRoster();
  private readonly healthBar: HealthBar;
  private readonly spearAmmoHud: SpearAmmoHud;
  private readonly bombAmmoHud: BombAmmoHud;
  private readonly characterHud: CharacterSwitchHud;
  private readonly inventoryHud: InventoryHud;
  private readonly spiders: Spider[] = [];
  private readonly harvest: HarvestWorld;
  private readonly inventory: Inventory;
  private readonly keyboard = new Keyboard();
  private readonly edges = new EdgeKeys();
  private readonly solid = new SolidResolver();
  private readonly combat: CombatSystem;
  private readonly debugOverlay: DebugOverlay;
  private readonly pauseMenu: PauseMenu;
  private readonly godHud: GodModeHud;
  private readonly god: GodModeController;
  private readonly camera: LevelCamera;

  private readonly mapDef: LevelMapDef;
  private spawn: { x: number; y: number };
  private readonly onBack: () => void;
  private readonly onBackground?: (color: number) => void;
  private readonly getLastCharacter: () => CharacterId;
  private readonly setLastCharacter?: (id: CharacterId) => void;

  private paused = false;
  private pointerScreenX = 0;
  private pointerScreenY = 0;
  private pointerSeen = false;

  constructor(width: number, height: number, options: LevelSceneOptions) {
    super();
    this.mapDef = cloneLevelDef(options.mapDef ?? LEVEL_1);
    this.spawn = { ...this.mapDef.spawn };
    this.label = `LevelScene:${this.mapDef.id}`;
    this.onBack = options.onBack;
    this.onBackground = options.onBackground;
    this.getLastCharacter =
      options.getLastCharacter ?? (() => 'bomb-girl' as CharacterId);
    this.setLastCharacter = options.setLastCharacter;

    this.eventMode = 'static';
    this.cursor = 'default';
    this.hitArea = new Rectangle(0, 0, width, height);
    this.on('pointertap', this.onPointerTap);
    this.on('pointermove', this.onPointerMove);

    this.worldRoot = new Container();
    this.worldRoot.label = 'WorldRoot';
    this.addChild(this.worldRoot);

    this.camera = new LevelCamera({
      worldRoot: this.worldRoot,
      spawnX: this.spawn.x,
      spawnY: this.spawn.y,
      viewWidth: width,
      viewHeight: height,
    });

    setActiveMapDef(this.mapDef);
    this.worldMap = new WorldMap(this.mapDef);
    this.worldRoot.addChild(this.worldMap);

    this.sortLayer = new Container();
    this.sortLayer.label = 'SortLayer';
    this.sortLayer.sortableChildren = true;
    this.sortLayer.eventMode = 'none';
    this.worldRoot.addChild(this.sortLayer);

    this.inventoryHud = new InventoryHud();
    this.inventory = new Inventory({
      slotCount: 8,
      onChange: () => this.inventoryHud.setSlots(this.inventory.getSlots()),
    });
    this.inventoryHud.setSlots(this.inventory.getSlots());

    this.harvest = new HarvestWorld({
      sortLayer: this.sortLayer,
      inventory: this.inventory,
      getMapDef: () => this.mapDef,
      persistMapDraft: () => this.persistMapDraft(),
      afterWorldChange: () => {
        this.syncWorldActors();
        this.sortDepth();
      },
    });

    this.combat = new CombatSystem(this.sortLayer, {
      sortDepth: () => this.sortDepth(),
      syncWorldActors: () => this.syncWorldActors(),
      onAmmoHudChanged: (model) => this.applyAmmoHudModel(model),
      onHarvestTreeDestroyed: (tree) => this.harvest.onTreeDestroyed(tree),
    });

    this.debugOverlay = new DebugOverlay();
    this.worldRoot.addChild(this.debugOverlay);

    spawnEnemiesInto(this.mapDef, this.spawn, this.sortLayer, this.spiders);
    this.harvest.spawnFromMap(this.mapDef);

    this.nightOverlay = new NightOverlay();
    this.nightOverlay.layout(width, height);
    this.addChild(this.nightOverlay);

    this.healthBar = new HealthBar({
      maxHp: PLAYER_MAX_HP,
      width: HUD_HP_WIDTH,
      height: HUD_HP_HEIGHT,
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

    this.characterHud = new CharacterSwitchHud({
      onSelect: (id) => this.switchCharacter(id),
    });
    this.addChild(this.characterHud);

    this.pauseMenu = new PauseMenu({
      onResume: () => this.setPaused(false),
      onBack: () => this.onBack(),
    });
    this.addChild(this.pauseMenu);

    this.godHud = new GodModeHud({
      onSelectBrush: (brush) => this.god.setBrush(brush),
    });
    this.addChild(this.godHud);

    this.god = new GodModeController({
      getMapDef: () => this.mapDef,
      getSpawn: () => this.spawn,
      setSpawn: (x, y) => {
        this.spawn = { x, y };
      },
      getPlayer: () => this.roster.player,
      sortLayer: this.sortLayer,
      spiders: this.spiders,
      harvest: this.harvest,
      camera: this.camera,
      hud: this.godHud,
      syncWorldActors: () => this.syncWorldActors(),
      sortDepth: () => this.sortDepth(),
      persistMapDraft: () => this.persistMapDraft(),
    });
    this.godHud.setBrush(this.god.brush);

    this.roster.mount();
    this.roster.activate(
      this.getLastCharacter(),
      this.sortLayer,
      {
        worldX: this.spawn.x,
        worldY: this.spawn.y,
        facing: 1,
        persist: false,
      },
      {
        setLastCharacter: this.setLastCharacter,
        onActivated: (p) => this.onPlayerActivated(p),
      },
    );
    if (this.roster.player) {
      this.characterHud.setActive(this.roster.player.characterId);
    }

    this.stepCamera(0, true);
    this.syncWorldActors();
    this.layoutHealthHud();
    this.nightOverlay.layout(width, height);
    this.inventoryHud.layout(width, height);
    this.characterHud.layout(width, height);
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

  private switchCharacter(id: CharacterId): void {
    this.roster.trySwitch(id, this.sortLayer, {
      paused: this.paused,
      combat: this.combat,
      entranceContext: () => this.entranceContext(),
      characterHud: this.characterHud,
      camera: this.camera,
      syncWorldActors: () => this.syncWorldActors(),
      sortDepth: () => this.sortDepth(),
      setLastCharacter: this.setLastCharacter,
      onActivated: (p) => this.onPlayerActivated(p),
    });
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

  private entranceContext(): EntranceContext {
    return {
      addWorldFx: (node, zIndex) => {
        node.zIndex = zIndex;
        this.sortLayer.addChild(node);
      },
      combat: {
        fireFreeAutoAimSpearVolley: (player, targets, count) => {
          this.combat.fireFreeAutoAimSpearVolley(player, targets, count);
        },
        throwBombBurst: (player, landings, options, onFirstBlast) => {
          this.combat.throwBombBurst(
            player,
            landings,
            options,
            onFirstBlast,
          );
        },
        cancelScriptedAttacks: (player) => {
          this.combat.cancelScriptedAttacks(player);
        },
      },
      getTargets: () => this.spiders,
    };
  }

  async init(): Promise<void> {
    this.onBackground?.(getNightBackground());
    this.keyboard.bind();
    window.addEventListener('wheel', this.onWheel, { passive: false });

    const rosterLoads = [...this.roster.values()].map(
      (entity) => () => entity.load(),
    );

    await Promise.all([
      preloadLevelAssets({
        loadMap: () => this.worldMap.load(),
        loadCharacters: rosterLoads,
        spiders: this.spiders.length > 0,
      }),
      this.characterHud.load(),
    ]);

    this.stepCamera(0, true);
    await Promise.all(this.spiders.map((s) => s.load()));
    if (this.player) this.syncAmmoHud(this.player);
    this.syncWorldActors();
    this.sortDepth();
  }

  private getCameraFocus(): { x: number; y: number } {
    const player = this.player;
    if (!player) {
      return { x: this.spawn.x, y: this.spawn.y };
    }
    if (!this.pointerSeen) {
      return { x: player.worldX, y: player.worldY };
    }

    const zoom = Math.max(this.camera.currentZoom, 1e-4);
    let offsetX =
      ((this.pointerScreenX - this.camera.width / 2) / zoom) *
      CAMERA_POINTER_LEAD;
    let offsetY =
      ((this.pointerScreenY - this.camera.height / 2) / zoom) *
      CAMERA_POINTER_LEAD;
    const offsetLength = Math.hypot(offsetX, offsetY);
    if (offsetLength > CAMERA_POINTER_LEAD_MAX) {
      const scale = CAMERA_POINTER_LEAD_MAX / offsetLength;
      offsetX *= scale;
      offsetY *= scale;
    }
    return {
      x: player.worldX + offsetX,
      y: player.worldY + offsetY,
    };
  }

  private stepCamera(dt: number, snap = false): boolean {
    const focus = this.getCameraFocus();
    return this.camera.step(dt, focus.x, focus.y, snap);
  }

  private syncWorldActors(): void {
    this.player?.syncToWorld();
    for (const spider of this.spiders) {
      spider.syncToWorld();
    }
    this.harvest.syncToWorld();
    this.combat.syncProjectiles();
  }

  private combatWorld(): CombatWorld {
    return {
      player: this.player,
      spiders: this.spiders,
      harvestTrees: this.harvest.trees,
    };
  }

  /** 猪 / 牛 / 马等生物的觅食上下文（每帧重建） */
  private buildEcologyContext(): CreatureEcologyContext {
    return {
      pickups: this.harvest.pickups,
      grasses: this.harvest.grasses,
      trees: this.harvest.trees.map((t) => ({
        worldX: t.worldX,
        worldY: t.worldY,
        kind: t.treeKind,
        isAlive: t.isAlive,
      })),
      creatures: this.spiders,
      consumePickup: (p) => {
        const found = this.harvest.pickups.find((item) => item === p);
        if (found) this.harvest.consumePickup(found);
      },
      consumeGrass: (g) => {
        this.harvest.consumeGrass(g);
      },
      removeCreature: (creature) => {
        this.removeCreatureEntity(creature);
      },
    };
  }

  /** 生态捕食 / 死亡移除（不写回地图草稿） */
  private removeCreatureEntity(creature: Spider): void {
    const idx = this.spiders.indexOf(creature);
    if (idx < 0) return;
    creature.parent?.removeChild(creature);
    creature.destroy({ children: true });
    this.spiders.splice(idx, 1);
  }

  private sortDepth(): void {
    this.sortLayer.sortChildren();
  }

  private solidContext(): SolidContext {
    return {
      player: this.player,
      spiders: this.spiders,
    };
  }

  private applyPlayerSolid(fromX: number, fromY: number): void {
    const player = this.player;
    if (!player) return;
    this.solid.resolvePlayer(player, fromX, fromY, this.solidContext());
  }

  private applySpiderSolid(
    spider: Spider,
    fromX: number,
    fromY: number,
    spiderIndex: number,
  ): void {
    if (spider.immovable) return;
    this.solid.resolveSpider(
      spider,
      fromX,
      fromY,
      spiderIndex,
      this.solidContext(),
    );
  }

  private readonly onWheel = (e: WheelEvent): void => {
    if (this.paused) return;
    e.preventDefault();
    this.camera.applyWheel(e.deltaY);
  };

  destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.off('pointertap', this.onPointerTap);
    this.off('pointermove', this.onPointerMove);
    window.removeEventListener('wheel', this.onWheel);
    this.keyboard.unbind();
    super.destroy(options);
  }

  update(deltaMS: number): void {
    const dt = deltaMS / 1000;
    this.pollModeKeys();
    this.pollAbilityKeys();
    this.handleZoomKeys(dt);

    const player = this.player;
    this.debugOverlay.update({
      player,
      spiders: this.spiders,
      bombs: this.combat.getBombs(),
      spears: this.combat.getSpears(),
    });

    if (!player) return;

    if (this.paused) {
      player.update(deltaMS, false);
      this.stepCamera(dt);
      return;
    }

    this.roster.tickCooldown(dt, this.characterHud);
    this.stepPlayerFrame(deltaMS, dt, player);
  }

  /** Esc / G / Tab */
  private pollModeKeys(): void {
    if (this.edges.pressed('Escape', this.keyboard.isDown('Escape'))) {
      this.setPaused(!this.paused);
    }
    if (this.edges.pressed('KeyG', this.keyboard.isDown('KeyG'))) {
      this.setGodMode(!this.god.enabled);
    }
    if (
      this.edges.pressed('Tab', this.keyboard.isDown('Tab')) &&
      !this.paused &&
      !this.god.enabled
    ) {
      this.switchCharacter(this.characterHud.getNextCharacterId());
    }
  }

  /** Q 特技 / E 闪现 / R 砍树 */
  private pollAbilityKeys(): void {
    if (this.paused || this.god.enabled) {
      // 仍推进边沿状态，避免退出暂停/上帝后连发
      this.edges.pressed('KeyQ', this.keyboard.isDown('KeyQ'));
      this.edges.pressed('KeyE', this.keyboard.isDown('KeyE'));
      this.edges.pressed('KeyR', this.keyboard.isDown('KeyR'));
      return;
    }

    const p = this.player;
    if (
      this.edges.pressed('KeyQ', this.keyboard.isDown('KeyQ')) &&
      p &&
      !p.entranceLocks.attack
    ) {
      const aim = this.aimFromPointer(p);
      if (
        p.trySpecialAbility(
          this.combat.rangedServices(),
          this.entranceContext(),
          aim ?? undefined,
        )
      ) {
        this.syncWorldActors();
      }
    }

    if (
      this.edges.pressed('KeyE', this.keyboard.isDown('KeyE')) &&
      p &&
      !p.entranceLocks.move
    ) {
      const fromX = p.worldX;
      const fromY = p.worldY;
      const aim = this.aimFromPointer(p);
      if (
        p.tryMobilityAbility(this.entranceContext(), aim ?? undefined)
      ) {
        this.applyPlayerSolid(fromX, fromY);
        this.syncWorldActors();
      }
    }

    if (this.edges.pressed('KeyR', this.keyboard.isDown('KeyR')) && p) {
      this.harvest.tryMelee(p);
    }
  }

  private aimFromPointer(player: PlayerCharacterBase) {
    if (!this.pointerSeen) return null;
    return this.combat.aimFromScreen(
      player.worldX,
      player.worldY,
      this.pointerScreenX,
      this.pointerScreenY,
      {
        x: this.camera.x,
        y: this.camera.y,
        zoom: this.camera.currentZoom,
        width: this.camera.width,
        height: this.camera.height,
      },
    );
  }

  /** 移动 / 击退 / 出场 / 战斗 / 收割帧步进 */
  private stepPlayerFrame(
    deltaMS: number,
    dt: number,
    player: PlayerCharacterBase,
  ): void {
    const { x, y } = this.keyboard.getMoveAxis();
    const fromX = player.worldX;
    const fromY = player.worldY;
    const god = this.god.enabled;

    const knockStep = god
      ? { moved: false, dx: 0, dy: 0, airborne: false, justLanded: false }
      : stepKnockArc(player.knock, dt);
    if (knockStep.moved) {
      player.worldX += knockStep.dx;
      player.worldY += knockStep.dy;
    }
    const knockSpeed = god
      ? 0
      : Math.hypot(player.knock.velX, player.knock.velY);
    const airborne = knockStep.airborne;
    const locks = player.entranceLocks;

    const moving = x !== 0 || y !== 0;
    if (moving && (god || !locks.move)) {
      let control = 1;
      if (god) {
        control = 1.6;
      } else if (airborne) {
        control = 0.08;
      } else if (knockSpeed > KNOCK_CONTROL_SOFTEN) {
        control = Math.max(0.2, 1 - knockSpeed / (KNOCK_CONTROL_SOFTEN * 3));
      }
      player.worldX += x * MOVE_SPEED * control * dt;
      player.worldY += y * MOVE_SPEED * control * dt;
    }

    if (!god) {
      this.applyPlayerSolid(fromX, fromY);
    }

    if (this.pointerSeen) {
      const z = Math.max(this.camera.currentZoom, 1e-4);
      const playerSx =
        this.camera.width / 2 + (player.worldX - this.camera.x) * z;
      const screenDx = this.pointerScreenX - playerSx;
      player.setFacingFromMoveX(screenDx);
    }
    player.updateEntrance(
      dt,
      this.entranceContext(),
      knockStep.justLanded,
    );

    this.stepCamera(dt);

    this.syncWorldActors();
    player.update(
      deltaMS,
      moving && !locks.move && !airborne && knockSpeed < 80,
    );
    this.healthBar.update(deltaMS);
    player.tickResources(deltaMS);
    this.syncAmmoHud(player);
    this.worldMap.update(deltaMS);

    if (!god) {
      const ecology = this.buildEcologyContext();
      // 快照：生态可能中途 removeCreature（吃鸡 / 饿死），避免下标错位
      const tickList = this.spiders.slice();
      for (const spider of tickList) {
        if (!spider.isAlive || !this.spiders.includes(spider)) continue;
        const sFromX = spider.worldX;
        const sFromY = spider.worldY;
        const result = spider.update(
          deltaMS,
          player.worldX,
          player.worldY,
          player.bodyProfileId,
          ecology,
        );
        const si = this.spiders.indexOf(spider);
        if (si < 0 || !spider.isAlive) continue;
        this.applySpiderSolid(spider, sFromX, sFromY, si);
        if (result.attackHit) {
          this.applySpiderAttack(result.attackHit);
        }
      }
      for (const spider of this.spiders) {
        spider.syncToWorld();
      }
      this.combat.update(deltaMS, this.combatWorld());
    } else {
      for (const spider of this.spiders) {
        spider.syncToWorld();
      }
    }

    this.harvest.tickTrees(deltaMS);
    this.harvest.update(deltaMS, player.worldX, player.worldY);
    this.sortDepth();
  }

  private applySpiderAttack(hit: {
    damage: number;
    dirX: number;
    dirY: number;
    knockImpulse: number;
  }): void {
    const player = this.player;
    if (!player) return;
    this.healthBar.applyDelta(-Math.abs(hit.damage));
    applyKnockImpulse(
      player.knock,
      hit.dirX * hit.knockImpulse,
      hit.dirY * hit.knockImpulse,
    );
    player.playBlastKnock(0.45, hit.dirX, 0);
    this.stepCamera(0, false);
    this.syncWorldActors();
    this.sortDepth();
  }

  resize(width: number, height: number): void {
    this.hitArea = new Rectangle(0, 0, width, height);
    this.camera.resize(width, height);
    this.stepCamera(0, true);
    this.syncWorldActors();
    this.sortDepth();
    this.layoutHealthHud();
    this.nightOverlay.layout(width, height);
    this.inventoryHud.layout(width, height);
    this.characterHud.layout(width, height);
    this.pauseMenu.layout(width, height);
    this.godHud.layout(width, height);
  }

  private handleZoomKeys(dt: number): void {
    // 合成键名：多物理键映射同一动作时只计一次边沿
    const fitDown =
      this.keyboard.isDown('KeyF') || this.keyboard.isDown('KeyM');
    if (this.edges.pressed('__fitOverview', fitDown)) {
      this.camera.fitOverview();
    }

    const resetDown =
      this.keyboard.isDown('Digit0') || this.keyboard.isDown('Numpad0');
    if (this.edges.pressed('__resetZoom', resetDown)) {
      this.camera.resetZoom();
    }

    const zoomIn =
      this.keyboard.isDown('Equal') ||
      this.keyboard.isDown('NumpadAdd');
    const zoomOut =
      this.keyboard.isDown('Minus') ||
      this.keyboard.isDown('NumpadSubtract');
    this.camera.applyZoomKeyHold(zoomIn, zoomOut, dt);
  }

  private readonly onPointerMove = (e: {
    global: { x: number; y: number };
  }): void => {
    this.pointerScreenX = e.global.x;
    this.pointerScreenY = e.global.y;
    this.pointerSeen = true;
  };

  private readonly onPointerTap = (e: {
    global: { x: number; y: number };
  }): void => {
    this.pointerScreenX = e.global.x;
    this.pointerScreenY = e.global.y;
    this.pointerSeen = true;
    if (this.paused) return;

    if (this.god.enabled) {
      this.god.handleClick(e.global.x, e.global.y);
      return;
    }

    const player = this.player;
    if (!player) return;
    if (player.entranceLocks.attack) return;
    this.combat.tryRangedAtScreen(player, e.global.x, e.global.y, {
      x: this.camera.x,
      y: this.camera.y,
      zoom: this.camera.currentZoom,
      width: this.camera.width,
      height: this.camera.height,
    });
  };

  private setPaused(value: boolean): void {
    this.paused = value;
    this.pauseMenu.setOpen(value);
    this.keyboard.clear();
    this.edges.clear();
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
    const cx = this.camera.width / 2;
    const hpY = this.camera.height - HUD_HP_MARGIN_BOTTOM;
    this.healthBar.position.set(cx, hpY);
    const hpLeft = cx - HUD_HP_WIDTH / 2;
    const ammoY = hpY - HUD_HP_HEIGHT / 2 - HUD_AMMO_GAP;
    this.spearAmmoHud.position.set(hpLeft, ammoY);
    this.bombAmmoHud.position.set(
      hpLeft + HUD_BOMB_AMMO_NUDGE_X,
      ammoY + HUD_BOMB_AMMO_NUDGE_Y,
    );
  }
}
