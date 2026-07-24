import { Container, Rectangle } from 'pixi.js';
import { preloadLevelAssets } from '../assets/preload';
import type { EntranceContext } from '../entities/CharacterEntrance';
import type { AmmoHudModel } from '../entities/CharacterResources';
import { BombGirl } from '../entities/BombGirl';
import { IceRanger } from '../entities/IceRanger';
import type { PlayerCharacterBase } from '../entities/PlayerCharacterBase';
import type { CharacterId } from '../entities/types';
import {
  applyKnockImpulse,
  stepKnockArc,
} from '../entities/knockArc';
import { Spider } from '../entities/Spider';
import { FlameFlower } from '../entities/FlameFlower';
import { WoodenDummy } from '../entities/WoodenDummy';
import { Keyboard } from '../input/Keyboard';
import {
  CombatSystem,
  type CombatWorld,
} from '../systems/CombatSystem';
import {
  SolidResolver,
  type SolidContext,
} from '../systems/SolidResolver';
import { CharacterSwitchHud } from '../ui/CharacterSwitchHud';
import { HealthBar } from '../ui/HealthBar';
import { PauseMenu } from '../ui/PauseMenu';
import { BombAmmoHud } from '../ui/BombAmmoHud';
import { SpearAmmoHud } from '../ui/SpearAmmoHud';
import { LEVEL_1, type LevelMapDef } from '../data/maps';
import { getNightBackground, NightOverlay } from '../world/NightOverlay';
import { MAP_SIZE, MAP_WORLD_HALF, WorldMap } from '../world/WorldMap';
import { LevelCamera } from './LevelCamera';
import type { GameScene } from './types';
import { DebugOverlay } from '../systems/DebugOverlay';

/** 黑夜松树冷色 tint（环境变暗，不盖角色） */
const NIGHT_TREE_TINT = 0x40516b;

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
/** 切换角色冷却（秒） */
const CHAR_SWITCH_COOLDOWN = 0.3;
/** 击退很强时削弱 WASD 控制（水平速度） */
const KNOCK_CONTROL_SOFTEN = 220;

const SPIDER_SCALE = 0.1;

/** 角色出场缩放 */
const CHAR_SCALE: Record<CharacterId, number> = {
  'bomb-girl': 0.07,
  'ice-ranger': 0.066,
};

export type LevelSceneOptions = {
  /** 本关地图；缺省 LEVEL_1 */
  mapDef?: LevelMapDef;
  onBack: () => void;
  onBackground?: (color: number) => void;
  /** 上次操控角色；缺省 bomb-girl */
  getLastCharacter?: () => CharacterId;
  /** 切换角色后写入存档 */
  setLastCharacter?: (id: CharacterId) => void;
  /**
   * 地图编辑预览：暂停菜单显示「继续编辑」，
   * 并可用 backLabel 覆盖返回文案。
   */
  onEditMap?: () => void;
  backLabel?: string;
};

/**
 * 可玩关卡（默认黑夜）：WASD 移动，点击远程攻击，Esc 暂停。
 * 场上始终只有一名角色；右侧头像点击或 Tab 切换。
 * 滚轮 / +/- 缩放，0 复位，F 看全景。
 * 纵深：worldRoot 镜头变换 + sortLayer 按脚底 Y 排序。
 */
export class LevelScene extends Container implements GameScene {
  /**
   * 世界根：scale=zoom，position 抵消相机。
   * 子节点全部使用世界坐标。
   */
  private readonly worldRoot: Container;
  /** 草坪等地面（不参与 Y-sort） */
  private readonly worldMap: WorldMap;
  /**
   * 纵深层：sortableChildren，zIndex = 脚底 worldY。
   * 含松树、蜘蛛、玩家、炸弹。
   */
  private readonly sortLayer: Container;
  private readonly nightOverlay: NightOverlay;
  /** 全角色池：场上只挂当前操控者，其余离场保留状态（弹药等） */
  private readonly roster = new Map<CharacterId, PlayerCharacterBase>();
  private player: PlayerCharacterBase | null = null;
  private readonly healthBar: HealthBar;
  private readonly spearAmmoHud: SpearAmmoHud;
  private readonly bombAmmoHud: BombAmmoHud;
  private readonly characterHud: CharacterSwitchHud;
  private readonly spiders: Spider[] = [];
  private readonly keyboard = new Keyboard();
  private readonly solid = new SolidResolver();
  private readonly combat: CombatSystem;
  private readonly debugOverlay: DebugOverlay;
  private readonly pauseMenu: PauseMenu;
  private readonly camera: LevelCamera;
  private readonly mapDef: LevelMapDef;
  private readonly spawn: { x: number; y: number };
  private readonly onBack: () => void;
  private readonly onBackground?: (color: number) => void;
  private readonly onEditMap?: () => void;
  private readonly getLastCharacter: () => CharacterId;
  private readonly setLastCharacter?: (id: CharacterId) => void;

  private paused = false;
  private escWasDown = false;
  private tabWasDown = false;
  private fitWasDown = false;
  private resetZoomWasDown = false;
  private treesMounted = false;
  /** 切换角色剩余冷却（秒）；0 表示可切换 */
  private switchCooldownRemaining = 0;

  constructor(width: number, height: number, options: LevelSceneOptions) {
    super();
    this.mapDef = options.mapDef ?? LEVEL_1;
    this.spawn = { ...this.mapDef.spawn };
    this.label = `LevelScene:${this.mapDef.id}`;
    this.onBack = options.onBack;
    this.onBackground = options.onBackground;
    this.onEditMap = options.onEditMap;
    this.getLastCharacter =
      options.getLastCharacter ?? (() => 'bomb-girl' as CharacterId);
    this.setLastCharacter = options.setLastCharacter;

    // 全屏可点：点击落点远程攻击
    this.eventMode = 'static';
    this.cursor = 'default';
    this.hitArea = new Rectangle(0, 0, width, height);
    this.on('pointertap', this.onPointerTap);

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

    this.worldMap = new WorldMap(this.mapDef);
    this.worldRoot.addChild(this.worldMap);

    // 夜色只压在地面（草坪）上，不进 sortLayer，避免角色/怪/爆炸变黑
    this.nightOverlay = new NightOverlay();
    this.nightOverlay.position.set(-MAP_WORLD_HALF, -MAP_WORLD_HALF);
    this.nightOverlay.layout(MAP_SIZE, MAP_SIZE);
    this.worldRoot.addChild(this.nightOverlay);

    this.sortLayer = new Container();
    this.sortLayer.label = 'SortLayer';
    this.sortLayer.sortableChildren = true;
    this.sortLayer.eventMode = 'none';
    this.worldRoot.addChild(this.sortLayer);

    this.combat = new CombatSystem(this.sortLayer, {
      sortDepth: () => this.sortDepth(),
      syncWorldActors: () => this.syncWorldActors(),
      onAmmoHudChanged: (model) => this.applyAmmoHudModel(model),
    });

    this.debugOverlay = new DebugOverlay();
    this.worldRoot.addChild(this.debugOverlay);

    this.spawnEnemies();

    // HUD 须先于 activateCharacter：后者会同步飞剑条 / 光标
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

    this.characterHud = new CharacterSwitchHud({
      onSelect: (id) => this.switchCharacter(id),
    });
    this.addChild(this.characterHud);

    this.pauseMenu = new PauseMenu({
      onResume: () => this.setPaused(false),
      onBack: () => this.onBack(),
      onEditMap: this.onEditMap
        ? () => {
            this.onEditMap?.();
          }
        : undefined,
      backLabel: options.backLabel,
    });
    this.addChild(this.pauseMenu);

    this.mountRoster();
    this.activateCharacter(this.getLastCharacter(), {
      worldX: this.spawn.x,
      worldY: this.spawn.y,
      facing: 1,
      persist: false,
    });
    if (this.player) {
      this.characterHud.setActive(this.player.characterId);
    }

    this.stepCamera(0, true);
    this.syncWorldActors();
    this.layoutHealthHud();
    this.characterHud.layout(width, height);
    this.pauseMenu.layout(width, height);
  }

  /** 创建全角色实体（先不全部挂到 sortLayer） */
  private mountRoster(): void {
    const bombGirl = new BombGirl(CHAR_SCALE['bomb-girl']);
    const iceRanger = new IceRanger(CHAR_SCALE['ice-ranger']);
    bombGirl.eventMode = 'none';
    iceRanger.eventMode = 'none';
    this.roster.set('bomb-girl', bombGirl);
    this.roster.set('ice-ranger', iceRanger);
  }

  /**
   * 把指定角色挂上场：脚底坐标 / 朝向从 prev 继承，清 knock。
   * 场上始终只有一名角色。
   */
  private activateCharacter(
    id: CharacterId,
    options: {
      worldX: number;
      worldY: number;
      facing: 1 | -1;
      persist: boolean;
    },
  ): void {
    const next = this.roster.get(id);
    if (!next) return;

    const prev = this.player;
    if (prev && prev !== next) {
      this.sortLayer.removeChild(prev);
    }

    next.worldX = options.worldX;
    next.worldY = options.worldY;
    next.knock.velX = 0;
    next.knock.velY = 0;
    next.knock.velZ = 0;
    next.knock.height = 0;
    next.setFacingFromMoveX(options.facing);

    if (next.parent !== this.sortLayer) {
      this.sortLayer.addChild(next);
    }

    this.player = next;
    this.syncAmmoHud(next);
    this.cursor = next.canRangedAttack ? 'crosshair' : 'default';

    if (options.persist) {
      this.setLastCharacter?.(id);
    }
  }

  /** 右侧头像 / Tab：同位置切换操控角色（0.3s 冷却） */
  private switchCharacter(id: CharacterId): void {
    if (this.paused) return;
    if (this.switchCooldownRemaining > 0) return;
    const current = this.player;
    if (!current || current.characterId === id) return;
    if (!this.roster.has(id)) return;
    if (current.entranceLocks.switch) return;

    current.cancelEntrance();
    this.combat.cancelScriptedAttacks(current);
    this.activateCharacter(id, {
      worldX: current.worldX,
      worldY: current.worldY,
      facing: current.facingDir,
      persist: true,
    });
    this.player?.startEntrance(this.entranceContext());
    this.characterHud.setActive(id);
    this.switchCooldownRemaining = CHAR_SWITCH_COOLDOWN;
    this.characterHud.setSwitchCooldown(
      this.switchCooldownRemaining,
      CHAR_SWITCH_COOLDOWN,
    );
    this.camera.boostFollow();
    this.syncWorldActors();
    this.sortDepth();
  }

  /** 按角色 getAmmoHud() 刷新弹药 HUD */
  private syncAmmoHud(player: PlayerCharacterBase): void {
    this.applyAmmoHudModel(player.getAmmoHud());
  }

  /**
   * 按 AmmoHudModel 切换飞剑 / 炸药 HUD。
   * 只认数据 kind，不依赖角色类名。
   */
  private applyAmmoHudModel(model: AmmoHudModel): void {
    this.spearAmmoHud.visible = model.kind === 'spear';
    this.bombAmmoHud.visible = model.kind === 'bomb';
    if (model.kind === 'spear') {
      this.spearAmmoHud.setAmmo(model.snap);
    } else if (model.kind === 'bomb') {
      this.bombAmmoHud.setAmmo(model.snap);
    }
  }

  /**
   * 注入给角色出场的上下文：挂特效、战斗能力、索敌。
   * 角色不依赖 LevelScene 类型。
   */
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

  /** 推进切换冷却并同步 HUD 遮罩 */
  private tickSwitchCooldown(dt: number): void {
    if (this.switchCooldownRemaining <= 0) return;
    this.switchCooldownRemaining = Math.max(
      0,
      this.switchCooldownRemaining - dt,
    );
    this.characterHud.setSwitchCooldown(
      this.switchCooldownRemaining,
      CHAR_SWITCH_COOLDOWN,
    );
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

    this.mountTrees();
    this.stepCamera(0, true);
    await Promise.all(this.spiders.map((s) => s.load()));
    // 初始角色资源加载完成后再播放出场（逻辑在角色类内）。
    this.player?.startEntrance(this.entranceContext());
    this.syncWorldActors();
    this.cullTrees();
    this.sortDepth();
  }

  /**
   * 挂载行 chunk 松树到 sortLayer（Y-sort）。
   * 每个 chunk = 同 worldY 上一段合并 Graphics，节点数远小于逐棵树。
   */
  private mountTrees(): void {
    if (this.treesMounted) return;
    this.treesMounted = true;
    for (const chunk of this.worldMap.getTreeChunks()) {
      chunk.tint = NIGHT_TREE_TINT;
      this.sortLayer.addChild(chunk);
    }
  }

  /**
   * 按地图数据刷怪。
   * - 有 `enemies`：按列表放置
   * - 省略字段：兼容旧关卡，出生点两侧各放一只蜘蛛
   */
  private spawnEnemies(): void {
    const list = this.mapDef.enemies;
    if (list === undefined) {
      this.spawnLegacyCornerSpiders();
      return;
    }
    for (const e of list) {
      const solid = WorldMap.resolveSolid(e.x, e.y, e.x, e.y, 16);
      const spider =
        e.kind === 'flame-flower'
          ? new FlameFlower(solid.x, solid.y)
          : e.kind === 'wooden-dummy'
            ? new WoodenDummy(solid.x, solid.y)
            : new Spider(solid.x, solid.y, { scale: SPIDER_SCALE });
      spider.faceToward(this.spawn.x, this.spawn.y);
      this.sortLayer.addChild(spider);
      this.spiders.push(spider);
    }
  }

  /** 旧关卡无 enemies 字段时的默认刷怪 */
  private spawnLegacyCornerSpiders(): void {
    const offsets = [
      { x: -180, y: -160 },
      { x: 180, y: -160 },
    ];
    for (const o of offsets) {
      const tx = this.spawn.x + o.x;
      const ty = this.spawn.y + o.y;
      const solid = WorldMap.resolveSolid(
        this.spawn.x,
        this.spawn.y,
        tx,
        ty,
        16,
      );
      const spider = new Spider(solid.x, solid.y, { scale: SPIDER_SCALE });
      spider.faceToward(this.spawn.x, this.spawn.y);
      this.sortLayer.addChild(spider);
      this.spiders.push(spider);
    }
  }

  /**
   * 镜头焦点：顺带把玩家脚底钉在合法 solid 上。
   */
  private getCameraFocus(): { x: number; y: number } {
    const player = this.player;
    if (player) {
      const solid = WorldMap.resolveSolid(
        player.worldX,
        player.worldY,
        player.worldX,
        player.worldY,
        player.bodyR,
      );
      player.worldX = solid.x;
      player.worldY = solid.y;
      return { x: player.worldX, y: player.worldY };
    }
    return { x: this.spawn.x, y: this.spawn.y };
  }

  /**
   * 平滑推进镜头到焦点。
   * snap=true：立刻对齐（初始化 / 改窗口）。
   * @returns 镜头是否发生可见位移（用于裁剪树）
   */
  private stepCamera(dt: number, snap = false): boolean {
    const focus = this.getCameraFocus();
    return this.camera.step(dt, focus.x, focus.y, snap);
  }

  /** 角色/蜘蛛/炸弹写到世界坐标，并刷新 zIndex */
  private syncWorldActors(): void {
    if (this.player) {
      this.player.syncToWorld();
    }
    for (const spider of this.spiders) {
      spider.syncToWorld();
    }
    this.combat.syncProjectiles();
  }

  /** 武器结算用的世界快照 */
  private combatWorld(): CombatWorld {
    return {
      player: this.player,
      spiders: this.spiders,
    };
  }

  /** 视口外树 chunk 不渲染（仍保留在 sortLayer，节点数已是 O(行×块)） */
  private cullTrees(): void {
    const z = Math.max(this.camera.currentZoom, 1e-4);
    const pad = 140;
    const hw = this.camera.width / (2 * z) + pad;
    const hh = this.camera.height / (2 * z) + pad;
    const left = this.camera.x - hw;
    const right = this.camera.x + hw;
    const top = this.camera.y - hh;
    const bottom = this.camera.y + hh;
    for (const chunk of this.worldMap.getTreeChunks()) {
      chunk.renderable =
        chunk.maxX >= left &&
        chunk.minX <= right &&
        chunk.maxY >= top &&
        chunk.minY <= bottom;
    }
  }

  /** 按 zIndex（脚底 Y）重排 sortLayer */
  private sortDepth(): void {
    this.sortLayer.sortChildren();
  }

  /**
   * solid 用的世界快照。
   * player / spiders 直接引用实体，可被 resolver 原地改坐标。
   */
  private solidContext(): SolidContext {
    return {
      player: this.player,
      spiders: this.spiders,
    };
  }

  /**
   * 应用本帧位移：树区 + 脚底圆 vs 蜘蛛 + 地图边界。
   * from = 移动前，用于轴分离滑墙。
   */
  private applyPlayerSolid(fromX: number, fromY: number): void {
    const player = this.player;
    if (!player) return;
    this.solid.resolvePlayer(player, fromX, fromY, this.solidContext());
  }

  /**
   * 蜘蛛本帧落点：树区 + vs 玩家/其他蜘蛛 + 边界。
   */
  private applySpiderSolid(
    spider: Spider,
    fromX: number,
    fromY: number,
    spiderIndex: number,
  ): void {
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
    window.removeEventListener('wheel', this.onWheel);
    this.keyboard.unbind();
    super.destroy(options);
  }

  update(deltaMS: number): void {
    const dt = deltaMS / 1000;
    const escDown = this.keyboard.isDown('Escape');
    if (escDown && !this.escWasDown) {
      this.setPaused(!this.paused);
    }
    this.escWasDown = escDown;

    // Tab：循环切换操控角色（暂停 / CD 中忽略）
    const tabDown = this.keyboard.isDown('Tab');
    if (tabDown && !this.tabWasDown && !this.paused) {
      this.switchCharacter(this.characterHud.getNextCharacterId());
    }
    this.tabWasDown = tabDown;

    // 缩放快捷键在暂停时也可用（方便看全景）
    this.handleZoomKeys(dt);

    const player = this.player;

    // 刷新碰撞体 & 受击体 DebugOverlay 渲染
    this.debugOverlay.update({
      player,
      spiders: this.spiders,
      bombs: this.combat.getBombs(),
      spears: this.combat.getSpears(),
    });

    if (!player) return;

    if (this.paused) {
      // 暂停时角色回正、不处理移动；炸弹也冻结；镜头仍可平滑缩放
      player.update(deltaMS, false);
      if (this.stepCamera(dt)) {
        this.cullTrees();
      }
      return;
    }

    this.tickSwitchCooldown(dt);

    const { x, y } = this.keyboard.getMoveAxis();
    let moved = false;
    const fromX = player.worldX;
    const fromY = player.worldY;

    // 被炸飞：抛物线（地面推开 + 高度起落）
    const knockStep = stepKnockArc(player.knock, dt);
    if (knockStep.moved) {
      player.worldX += knockStep.dx;
      player.worldY += knockStep.dy;
      moved = true;
    }
    const knockSpeed = Math.hypot(player.knock.velX, player.knock.velY);
    const airborne = knockStep.airborne;
    const locks = player.entranceLocks;

    // 出场锁移动时保持垂直落点；普通空中状态仍保留少量操控。
    const moving = x !== 0 || y !== 0;
    if (moving && !locks.move) {
      player.setFacingFromMoveX(x);
      let control = 1;
      if (airborne) {
        control = 0.08;
      } else if (knockSpeed > KNOCK_CONTROL_SOFTEN) {
        control = Math.max(0.2, 1 - knockSpeed / (KNOCK_CONTROL_SOFTEN * 3));
      }
      player.worldX += x * MOVE_SPEED * control * dt;
      player.worldY += y * MOVE_SPEED * control * dt;
      moved = true;
    }

    // 树区 + 脚底圆互挡（即使本帧没位移，也可能被怪挤占，统一走 solid）
    this.applyPlayerSolid(fromX, fromY);
    player.updateEntrance(
      dt,
      this.entranceContext(),
      knockStep.justLanded,
    );

    const camMoved = this.stepCamera(dt);
    if (moved || camMoved) {
      this.cullTrees();
    }

    this.syncWorldActors();
    player.update(
      deltaMS,
      moving && !locks.move && !airborne && knockSpeed < 80,
    );
    this.healthBar.update(deltaMS);
    player.tickResources(deltaMS);
    this.syncAmmoHud(player);

    for (let si = 0; si < this.spiders.length; si++) {
      const spider = this.spiders[si]!;
      if (!spider.isAlive) continue;
      const sFromX = spider.worldX;
      const sFromY = spider.worldY;
      const result = spider.update(
        deltaMS,
        player.worldX,
        player.worldY,
        player.hurtR,
      );
      this.applySpiderSolid(spider, sFromX, sFromY, si);
      if (result.attackHit) {
        this.applySpiderAttack(result.attackHit);
      }
    }
    // solid 后写回显示位置（sync 在 AI 之前做过，这里补本帧位移）
    for (const spider of this.spiders) {
      spider.syncToWorld();
    }

    this.combat.update(deltaMS, this.combatWorld());
    this.sortDepth();
  }

  /** 蜘蛛扑咬命中：扣血 + 轻击退 + 姿态反馈 */
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
    // 轻伤姿态（不转圈）
    player.playBlastKnock(0.45, hit.dirX, 0);
    this.stepCamera(0, false);
    this.syncWorldActors();
    this.sortDepth();
  }

  resize(width: number, height: number): void {
    this.hitArea = new Rectangle(0, 0, width, height);
    this.camera.resize(width, height);
    // 改窗口尺寸时直接对齐，避免过渡穿帮
    this.stepCamera(0, true);
    this.syncWorldActors();
    this.cullTrees();
    this.sortDepth();
    this.layoutHealthHud();
    this.characterHud.layout(width, height);
    this.pauseMenu.layout(width, height);
  }

  private handleZoomKeys(dt: number): void {
    const fitDown =
      this.keyboard.isDown('KeyF') || this.keyboard.isDown('KeyM');
    if (fitDown && !this.fitWasDown) {
      this.camera.fitOverview();
    }
    this.fitWasDown = fitDown;

    const resetDown =
      this.keyboard.isDown('Digit0') || this.keyboard.isDown('Numpad0');
    if (resetDown && !this.resetZoomWasDown) {
      this.camera.resetZoom();
    }
    this.resetZoomWasDown = resetDown;

    const zoomIn =
      this.keyboard.isDown('Equal') ||
      this.keyboard.isDown('NumpadAdd');
    const zoomOut =
      this.keyboard.isDown('Minus') ||
      this.keyboard.isDown('NumpadSubtract');
    this.camera.applyZoomKeyHold(zoomIn, zoomOut, dt);
  }

  private readonly onPointerTap = (e: {
    global: { x: number; y: number };
  }): void => {
    if (this.paused) return;
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
    // 清掉按键，避免继续后突然冲刺
    this.keyboard.clear();
  }

  /** 玩家血条 + 弹药数量 HUD：底部居中，弹药在血条之上并与血条左对齐 */
  private layoutHealthHud(): void {
    const cx = this.camera.width / 2;
    const hpY = this.camera.height - HUD_HP_MARGIN_BOTTOM;
    this.healthBar.position.set(cx, hpY);
    // 血条以中心为原点 → 左缘 cx - width/2；弹药 HUD 原点在左缘
    const hpLeft = cx - HUD_HP_WIDTH / 2;
    const ammoY = hpY - HUD_HP_HEIGHT / 2 - HUD_AMMO_GAP;
    this.spearAmmoHud.position.set(hpLeft, ammoY);
    this.bombAmmoHud.position.set(
      hpLeft + HUD_BOMB_AMMO_NUDGE_X,
      ammoY + HUD_BOMB_AMMO_NUDGE_Y,
    );
  }
}
