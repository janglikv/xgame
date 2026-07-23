import { Container, Graphics, Rectangle } from 'pixi.js';
import { preloadLevelAssets } from '../assets/preload';
import { BombGirl } from '../entities/BombGirl';
import { IceRanger } from '../entities/IceRanger';
import type { PlayerCharacterBase } from '../entities/PlayerCharacterBase';
import type { CharacterId } from '../entities/types';
import {
  applyKnockImpulse,
  createKnockArcState,
  stepKnockArc,
  type KnockArcState,
} from '../entities/knockArc';
import { Spider } from '../entities/Spider';
import { Keyboard } from '../input/Keyboard';
import {
  CombatSystem,
  PLAYER_HURT_R,
  type CombatWorld,
} from '../systems/CombatSystem';
import {
  PLAYER_BODY_R,
  SolidResolver,
  type SolidContext,
} from '../systems/SolidResolver';
import { HealthBar } from '../ui/HealthBar';
import { PauseMenu } from '../ui/PauseMenu';
import { SpearAmmoHud } from '../ui/SpearAmmoHud';
import { getThemeBackground, NightOverlay } from '../world/NightOverlay';
import {
  GRID,
  islandCenter,
  MAP_SIZE,
  MAP_WORLD_HALF,
  WorldMap,
} from '../world/WorldMap';
import { LevelCamera } from './LevelCamera';
import type { GameScene, LevelTheme } from './types';

/** 黑夜松树冷色 tint（环境变暗，不盖角色） */
const NIGHT_TREE_TINT = 0x6a7f9e;
/** 选角阶段：地面 / 树大幅压暗，角色保持原色 */
const SELECT_MAP_TINT = 0x6a7088;
const SELECT_TREE_TINT = 0x5a6278;
const SELECT_SPIDER_ALPHA = 0.55;
/** 选角站位：相对出生点左右间距（世界像素，配合双倍关卡空间） */
const SELECT_SPACING = 240;
/** 选角点击热区（本地像素，贴图未缩放） */
const SELECT_HIT = { w: 520, h: 900 } as const;

const MOVE_SPEED = 220;
/** 玩家 HUD 血条尺寸 / 底边边距（屏幕像素） */
const HUD_HP_WIDTH = 240;
const HUD_HP_HEIGHT = 14;
const HUD_HP_MARGIN_BOTTOM = 28;
/** 飞剑数量相对血条上沿再上移（屏幕像素） */
const HUD_SPEAR_GAP = 22;
const PLAYER_MAX_HP = 100;
/** 击退很强时削弱 WASD 控制（水平速度） */
const KNOCK_CONTROL_SOFTEN = 220;

const SPIDER_SCALE = 0.1;

/** 默认出生：九宫格下方正中岛中心（非地图原点） */
const PLAYER_SPAWN = islandCenter(1, GRID - 1);

export type LevelSceneOptions = {
  theme: LevelTheme;
  onBack: () => void;
  onBackground?: (color: number) => void;
  /** 上次选角（默认高亮）；缺省 bomb-girl */
  getLastCharacter?: () => CharacterId;
  /** 确认选角后写入存档 */
  setLastCharacter?: (id: CharacterId) => void;
};

type CharacterCandidate = {
  id: CharacterId;
  entity: PlayerCharacterBase;
  worldX: number;
  worldY: number;
  pedestal: Graphics;
  hovered: boolean;
  isDefault: boolean;
};

/** 选角后留在场上的未选角色（可被挤走；可吃武器击飞但不掉血） */
type ParkedCharacter = {
  entity: PlayerCharacterBase;
  worldX: number;
  worldY: number;
  /** 本帧逻辑开始时的脚底坐标（用于被挤位移 → 走路动画） */
  frameStartX: number;
  frameStartY: number;
  /** 被炸/被矛的地面击飞抛物线（无 HP） */
  knock: KnockArcState;
};

/**
 * 可玩关卡：白天 / 黑夜地图，WASD 移动，点击抛物线扔炸弹，Esc 暂停。
 * 出发地先选角色才能操作；选角时环境压暗、角色高亮。
 * 滚轮 / +/- 缩放，0 复位，F 看全景。
 * 纵深：worldRoot 镜头变换 + sortLayer 按脚底 Y 排序（树/角色/炸弹互遮）。
 * 黑夜 = 白天地图 + NightOverlay 叠加，不单独换色盘。
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
  private readonly nightOverlay: NightOverlay | null;
  /** 选角时盖在地面上的暗幕（树另用 tint 压暗） */
  private readonly selectGroundVeil: Graphics;
  private player: PlayerCharacterBase | null = null;
  private readonly candidates: CharacterCandidate[] = [];
  /** 未选中的角色，选角结束后仍站在出生岛原地 */
  private readonly parkedCharacters: ParkedCharacter[] = [];
  private readonly healthBar: HealthBar;
  private readonly spearAmmoHud: SpearAmmoHud;
  private readonly spiders: Spider[] = [];
  private readonly keyboard = new Keyboard();
  private readonly solid = new SolidResolver();
  private readonly combat: CombatSystem;
  private readonly pauseMenu: PauseMenu;
  private readonly camera: LevelCamera;
  private readonly theme: LevelTheme;
  private readonly onBack: () => void;
  private readonly onBackground?: (color: number) => void;
  private readonly getLastCharacter: () => CharacterId;
  private readonly setLastCharacter?: (id: CharacterId) => void;

  /** 玩家世界坐标 */
  private worldX = PLAYER_SPAWN.x;
  private worldY = PLAYER_SPAWN.y;
  /** 被炸飞：地面平面速度 + 高度抛物线 */
  private readonly knock: KnockArcState = createKnockArcState();
  private paused = false;
  /** true = 尚未选角，禁止移动 / 攻击 */
  private selectingCharacter = true;
  private selectPulse = 0;
  private escWasDown = false;
  private fitWasDown = false;
  private resetZoomWasDown = false;
  private confirmWasDown = false;
  private treesMounted = false;

  constructor(width: number, height: number, options: LevelSceneOptions) {
    super();
    this.label = `LevelScene:${options.theme}`;
    this.theme = options.theme;
    this.onBack = options.onBack;
    this.onBackground = options.onBackground;
    this.getLastCharacter =
      options.getLastCharacter ?? (() => 'bomb-girl' as CharacterId);
    this.setLastCharacter = options.setLastCharacter;

    // 全屏可点：选角后点击落点扔炸弹
    this.eventMode = 'static';
    this.cursor = 'default';
    this.hitArea = new Rectangle(0, 0, width, height);
    this.on('pointertap', this.onPointerTap);

    this.worldRoot = new Container();
    this.worldRoot.label = 'WorldRoot';
    this.addChild(this.worldRoot);

    this.camera = new LevelCamera({
      worldRoot: this.worldRoot,
      spawnX: PLAYER_SPAWN.x,
      spawnY: PLAYER_SPAWN.y,
      viewWidth: width,
      viewHeight: height,
    });

    this.worldMap = new WorldMap();
    this.worldRoot.addChild(this.worldMap);

    // 夜色只压在地面（草坪）上，不进 sortLayer，避免角色/怪/爆炸变黑
    this.nightOverlay =
      options.theme === 'night' ? new NightOverlay() : null;
    if (this.nightOverlay) {
      this.nightOverlay.position.set(-MAP_WORLD_HALF, -MAP_WORLD_HALF);
      this.nightOverlay.layout(MAP_SIZE, MAP_SIZE);
      this.worldRoot.addChild(this.nightOverlay);
    }

    // 选角暗幕：盖住地面 / 夜色，不盖 sortLayer 里的角色
    this.selectGroundVeil = new Graphics();
    this.selectGroundVeil.label = 'SelectGroundVeil';
    this.selectGroundVeil
      .rect(-MAP_WORLD_HALF, -MAP_WORLD_HALF, MAP_SIZE, MAP_SIZE)
      .fill({ color: 0x000000, alpha: 0.28 });
    this.worldRoot.addChild(this.selectGroundVeil);

    this.sortLayer = new Container();
    this.sortLayer.label = 'SortLayer';
    this.sortLayer.sortableChildren = true;
    // 选角阶段候选角色需要接收点击
    this.sortLayer.eventMode = 'static';
    this.worldRoot.addChild(this.sortLayer);

    this.combat = new CombatSystem(this.sortLayer, {
      sortDepth: () => this.sortDepth(),
      syncWorldActors: () => this.syncWorldActors(),
      onSpearAmmoChanged: (snap) => this.spearAmmoHud.setAmmo(snap),
    });

    if (options.theme === 'night') {
      this.spawnCornerSpiders();
    }

    this.mountCharacterCandidates();

    // 玩家血条 HUD：选角完成前隐藏
    this.healthBar = new HealthBar({
      maxHp: PLAYER_MAX_HP,
      width: HUD_HP_WIDTH,
      height: HUD_HP_HEIGHT,
    });
    this.healthBar.setHealth(PLAYER_MAX_HP);
    this.healthBar.visible = false;
    this.addChild(this.healthBar);

    // 飞剑数量：叠在血条之上，仅 IceRanger 显示
    this.spearAmmoHud = new SpearAmmoHud();
    this.spearAmmoHud.visible = false;
    this.addChild(this.spearAmmoHud);

    this.pauseMenu = new PauseMenu({
      onResume: () => this.setPaused(false),
      onBack: () => this.onBack(),
    });
    this.addChild(this.pauseMenu);

    this.applySelectAtmosphere(true);
    this.stepCamera(0, true);
    this.syncWorldActors();
    this.layoutHealthHud();
    this.pauseMenu.layout(width, height);
  }

  /** 出发岛左右摆放可选角色 + 脚底光环 */
  private mountCharacterCandidates(): void {
    const defaultCharId = this.getLastCharacter();
    const roster: Array<{ id: CharacterId; entity: PlayerCharacterBase; offsetX: number }> = [
      { id: 'bomb-girl', entity: new BombGirl(0.07), offsetX: -SELECT_SPACING },
      { id: 'ice-ranger', entity: new IceRanger(0.066), offsetX: SELECT_SPACING },
    ];

    for (const entry of roster) {
      const worldX = PLAYER_SPAWN.x + entry.offsetX;
      const worldY = PLAYER_SPAWN.y;
      const isDefault = entry.id === defaultCharId;

      const pedestal = new Graphics();
      pedestal.label = `Pedestal:${entry.id}`;
      pedestal.eventMode = 'none';
      this.paintPedestal(pedestal, false, isDefault, 0);

      const entity = entry.entity;
      entity.eventMode = 'static';
      entity.cursor = 'pointer';
      entity.hitArea = new Rectangle(
        -SELECT_HIT.w / 2,
        -SELECT_HIT.h * 0.92,
        SELECT_HIT.w,
        SELECT_HIT.h,
      );

      const candidate: CharacterCandidate = {
        id: entry.id,
        entity,
        worldX,
        worldY,
        pedestal,
        hovered: false,
        isDefault,
      };

      entity.on('pointerover', () => {
        if (!this.selectingCharacter) return;
        candidate.hovered = true;
        entity.alpha = 1;
      });
      entity.on('pointerout', () => {
        candidate.hovered = false;
      });
      entity.on('pointertap', (e) => {
        e.stopPropagation();
        if (!this.selectingCharacter || this.paused) return;
        this.confirmCharacter(entry.id);
      });

      this.sortLayer.addChild(pedestal, entity);
      this.candidates.push(candidate);
    }
  }

  private paintPedestal(
    g: Graphics,
    hovered: boolean,
    isDefault: boolean,
    pulse: number,
  ): void {
    const breathe = 1 + pulse * 0.08;
    const rx = 48 * breathe;
    const ry = 18 * breathe;
    const core = hovered ? 0xffffff : isDefault ? 0xffd700 : 0x9ee8ff;
    const glow = hovered ? 0xc8f4ff : isDefault ? 0xffea79 : 0x5ec8ff;
    g.clear();
    g.ellipse(0, 0, rx * 1.45, ry * 1.45).fill({
      color: glow,
      alpha: (isDefault ? 0.26 : 0.16) + pulse * 0.08,
    });
    g.ellipse(0, 0, rx, ry).fill({
      color: core,
      alpha: (isDefault ? 0.32 : 0.22) + pulse * 0.1,
    });
    g.ellipse(0, 0, rx * 0.92, ry * 0.92).stroke({
      width: hovered || isDefault ? 3.5 : 2.5,
      color: core,
      alpha: 0.9,
    });
  }

  /** 选角确认：操控所选角色；未选中的留在原地待机，清掉光环 / 点击 */
  private confirmCharacter(id: CharacterId): void {
    if (!this.selectingCharacter) return;
    const chosen = this.candidates.find((c) => c.id === id);
    if (!chosen) return;

    this.setLastCharacter?.(id);

    this.player = chosen.entity;
    this.worldX = chosen.worldX;
    this.worldY = chosen.worldY;

    for (const c of this.candidates) {
      c.entity.off('pointerover');
      c.entity.off('pointerout');
      c.entity.off('pointertap');
      c.entity.eventMode = 'none';
      c.entity.cursor = 'default';
      c.entity.hitArea = null;
      c.entity.alpha = 1;

      this.sortLayer.removeChild(c.pedestal);
      c.pedestal.destroy();

      if (c.id !== id) {
        // 未选中角色仍站在出生位，不销毁
        this.parkedCharacters.push({
          entity: c.entity,
          worldX: c.worldX,
          worldY: c.worldY,
          frameStartX: c.worldX,
          frameStartY: c.worldY,
          knock: createKnockArcState(),
        });
      }
    }
    this.candidates.length = 0;

    this.selectingCharacter = false;
    this.selectGroundVeil.visible = false;
    this.healthBar.visible = true;
    this.spearAmmoHud.visible = this.player instanceof IceRanger;
    if (this.player instanceof IceRanger) {
      this.spearAmmoHud.setAmmo(this.player.spearAmmo);
    }
    this.cursor = this.player.canRangedAttack ? 'crosshair' : 'default';
    this.sortLayer.eventMode = 'none';

    this.applySelectAtmosphere(false);
    // 镜头从选角构图平滑收束到所选角色，不瞬切
    this.camera.setSelecting(false);
    this.camera.boostFollow();
    this.stepCamera(0, false);
    this.syncWorldActors();
    this.sortDepth();
  }

  /**
   * 选角气氛：地面暗幕 + 地图/树 tint + 蜘蛛压暗；
   * 角色保持原色高亮。
   */
  private applySelectAtmosphere(active: boolean): void {
    this.selectGroundVeil.visible = active;
    this.worldMap.tint = active ? SELECT_MAP_TINT : 0xffffff;

    if (this.treesMounted) {
      const treeTint = active
        ? SELECT_TREE_TINT
        : this.theme === 'night'
          ? NIGHT_TREE_TINT
          : 0xffffff;
      for (const tree of this.worldMap.getTrees()) {
        tree.tint = treeTint;
      }
    }

    for (const spider of this.spiders) {
      spider.alpha = active ? SELECT_SPIDER_ALPHA : 1;
    }
  }

  async init(): Promise<void> {
    this.onBackground?.(getThemeBackground(this.theme));
    this.keyboard.bind();
    window.addEventListener('wheel', this.onWheel, { passive: false });

    await preloadLevelAssets({
      loadMap: () => this.worldMap.load(),
      loadCharacters: this.candidates.map((c) => () => c.entity.load()),
      spiders: this.spiders.length > 0,
    });

    this.mountTrees();
    // 树挂载后再刷一遍选角压暗（mountTrees 时 treesMounted 才为 true）
    if (this.selectingCharacter) {
      this.applySelectAtmosphere(true);
    }
    this.stepCamera(0, true);
    await Promise.all(this.spiders.map((s) => s.load()));
    if (this.selectingCharacter) {
      for (const spider of this.spiders) {
        spider.alpha = SELECT_SPIDER_ALPHA;
      }
    }
    this.syncWorldActors();
    this.cullTrees();
    this.sortDepth();
  }

  /** 把地图生成的松树挂到 sortLayer，参与 Y-sort */
  private mountTrees(): void {
    if (this.treesMounted) return;
    this.treesMounted = true;
    for (const tree of this.worldMap.getTrees()) {
      // 选角中统一深暗；否则黑夜冷色 / 白天原色
      if (this.selectingCharacter) {
        tree.tint = SELECT_TREE_TINT;
      } else if (this.theme === 'night') {
        tree.tint = NIGHT_TREE_TINT;
      }
      this.sortLayer.addChild(tree);
    }
  }

  /** 黑夜关：九宫格上方角落岛各一只蜘蛛，出生时朝向中心 */
  private spawnCornerSpiders(): void {
    const last = GRID - 1;
    const corners: Array<[number, number]> = [
      [0, 0],
      [last, 0],
    ];

    for (const [ix, iy] of corners) {
      const { x: wx, y: wy } = islandCenter(ix, iy);
      const spider = new Spider(wx, wy, { scale: SPIDER_SCALE });
      spider.faceToward(0, 0);
      this.sortLayer.addChild(spider);
      this.spiders.push(spider);
    }
  }

  /**
   * 选角时镜头焦点固定在候选中点。
   * 不跟悬停角色走：镜头一动会把角色移出指针下，pointerover/out 来回触发导致闪烁。
   */
  private getSelectFocus(): { x: number; y: number } {
    if (this.candidates.length === 0) {
      return { x: this.worldX, y: this.worldY };
    }
    let sx = 0;
    let sy = 0;
    for (const c of this.candidates) {
      sx += c.worldX;
      sy += c.worldY;
    }
    const n = this.candidates.length;
    return { x: sx / n, y: sy / n };
  }

  /**
   * 镜头焦点：游玩时顺带把玩家脚底钉在合法 solid 上；
   * 选角时用候选中点。
   */
  private getCameraFocus(): { x: number; y: number } {
    if (!this.selectingCharacter) {
      const solid = WorldMap.resolveSolid(
        this.worldX,
        this.worldY,
        this.worldX,
        this.worldY,
        PLAYER_BODY_R,
      );
      this.worldX = solid.x;
      this.worldY = solid.y;
      return { x: this.worldX, y: this.worldY };
    }
    return this.getSelectFocus();
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
    if (this.selectingCharacter) {
      for (const c of this.candidates) {
        c.pedestal.position.set(c.worldX, c.worldY);
        c.pedestal.zIndex = c.worldY - 0.5;
        c.entity.position.set(c.worldX, c.worldY);
        c.entity.zIndex = c.worldY;
      }
    } else if (this.player) {
      this.player.position.set(this.worldX, this.worldY - this.knock.height);
      this.player.zIndex = this.worldY;
      for (const parked of this.parkedCharacters) {
        parked.entity.position.set(
          parked.worldX,
          parked.worldY - parked.knock.height,
        );
        parked.entity.zIndex = parked.worldY;
      }
    }
    for (const spider of this.spiders) {
      spider.syncToWorld();
    }
    this.combat.syncProjectiles();
  }

  /** 武器结算用的世界快照（与 solid 共用 spiders / parked 引用） */
  private combatWorld(): CombatWorld {
    return {
      player:
        this.player && !this.selectingCharacter
          ? {
              entity: this.player,
              worldX: this.worldX,
              worldY: this.worldY,
              knock: this.knock,
            }
          : null,
      parked: this.parkedCharacters,
      spiders: this.spiders,
    };
  }

  /** 视口外松树不渲染（仍保留在 sortLayer） */
  private cullTrees(): void {
    const z = Math.max(this.camera.currentZoom, 1e-4);
    const pad = 140;
    const hw = this.camera.width / (2 * z) + pad;
    const hh = this.camera.height / (2 * z) + pad;
    const cx = this.camera.x;
    const cy = this.camera.y;
    for (const tree of this.worldMap.getTrees()) {
      tree.renderable =
        Math.abs(tree.worldX - cx) <= hw && Math.abs(tree.worldY - cy) <= hh;
    }
  }

  /** 按 zIndex（脚底 Y）重排 sortLayer */
  private sortDepth(): void {
    this.sortLayer.sortChildren();
  }

  /**
   * solid 用的世界快照。
   * parked / spiders 直接引用实体，可被 resolver 原地改坐标。
   */
  private solidContext(): SolidContext {
    return {
      player:
        this.player && !this.selectingCharacter
          ? { worldX: this.worldX, worldY: this.worldY }
          : null,
      parked: this.parkedCharacters,
      spiders: this.spiders,
    };
  }

  /**
   * 应用本帧位移：树区 + 挤开停场角色 + 脚底圆 vs 蜘蛛 + 地图边界。
   * 停场角色可被挤走；蜘蛛仍为硬障碍。from = 移动前，用于轴分离滑墙。
   */
  private applyPlayerSolid(fromX: number, fromY: number): void {
    const ctx = this.solidContext();
    // 玩家坐标在场景字段上：用临时 foot，解析后再写回
    const foot = { worldX: this.worldX, worldY: this.worldY };
    ctx.player = foot;
    this.solid.resolvePlayer(foot, fromX, fromY, ctx);
    this.worldX = foot.worldX;
    this.worldY = foot.worldY;
  }

  /**
   * 蜘蛛本帧落点：树区 + 挤开停场角色 + vs 玩家/其他蜘蛛 + 边界。
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

    // 缩放快捷键在暂停时也可用（方便看全景）
    this.handleZoomKeys(dt);

    if (this.selectingCharacter) {
      this.updateCharacterSelect(deltaMS);
      if (this.stepCamera(dt)) {
        this.cullTrees();
      }
      return;
    }

    const player = this.player;
    if (!player) return;

    if (this.paused) {
      // 暂停时角色回正、不处理移动；炸弹也冻结；镜头仍可平滑缩放
      player.update(deltaMS, false);
      for (const parked of this.parkedCharacters) {
        parked.entity.update(deltaMS, false);
      }
      if (this.stepCamera(dt)) {
        this.cullTrees();
      }
      return;
    }

    // 帧初快照：供停场角色被挤后算位移（须在 solid 之前）
    for (const parked of this.parkedCharacters) {
      parked.frameStartX = parked.worldX;
      parked.frameStartY = parked.worldY;
    }

    const { x, y } = this.keyboard.getMoveAxis();
    let moved = false;
    const fromX = this.worldX;
    const fromY = this.worldY;

    // 被炸飞：抛物线（地面推开 + 高度起落）
    const knockStep = stepKnockArc(this.knock, dt);
    if (knockStep.moved) {
      this.worldX += knockStep.dx;
      this.worldY += knockStep.dy;
      moved = true;
    }
    const knockSpeed = Math.hypot(this.knock.velX, this.knock.velY);
    const airborne = knockStep.airborne;

    // WASD：空中几乎失控；贴地时强击退会变钝
    const moving = x !== 0 || y !== 0;
    if (moving) {
      player.setFacingFromMoveX(x);
      let control = 1;
      if (airborne) {
        control = 0.08;
      } else if (knockSpeed > KNOCK_CONTROL_SOFTEN) {
        control = Math.max(0.2, 1 - knockSpeed / (KNOCK_CONTROL_SOFTEN * 3));
      }
      this.worldX += x * MOVE_SPEED * control * dt;
      this.worldY += y * MOVE_SPEED * control * dt;
      moved = true;
    }

    // 树区 + 脚底圆互挡（即使本帧没位移，也可能被怪挤占，统一走 solid）
    this.applyPlayerSolid(fromX, fromY);

    const camMoved = this.stepCamera(dt);
    if (moved || camMoved) {
      this.cullTrees();
    }

    this.syncWorldActors();
    player.update(deltaMS, moving && !airborne && knockSpeed < 80);
    this.healthBar.update(deltaMS);
    if (player instanceof IceRanger) {
      player.tickSpearAmmo(deltaMS);
      this.spearAmmoHud.setAmmo(player.spearAmmo);
    }

    for (let si = 0; si < this.spiders.length; si++) {
      const spider = this.spiders[si]!;
      if (!spider.isAlive) continue;
      const sFromX = spider.worldX;
      const sFromY = spider.worldY;
      const result = spider.update(
        deltaMS,
        this.worldX,
        this.worldY,
        PLAYER_HURT_R,
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

    // 停场角色：击飞积分（上一帧武器命中）+ 被挤/击飞动画
    this.stepParkedKnock(dt);
    this.combat.update(deltaMS, this.combatWorld());
    this.updateParkedCharacters(deltaMS);
    this.sortDepth();
  }

  /**
   * 推进停场角色击飞抛物线，并做树区 / 实体 solid。
   * 须在武器结算前调用（本帧新命中的冲量下帧才积分，避免同帧双跳）。
   */
  private stepParkedKnock(dt: number): void {
    for (let i = 0; i < this.parkedCharacters.length; i++) {
      const parked = this.parkedCharacters[i]!;
      const fromX = parked.worldX;
      const fromY = parked.worldY;
      const knockStep = stepKnockArc(parked.knock, dt);
      if (!knockStep.moved) continue;
      parked.worldX += knockStep.dx;
      parked.worldY += knockStep.dy;
      this.solid.resolveParked(parked, fromX, fromY, i, this.solidContext());
    }
  }

  /**
   * 停场角色动画：本帧 world 相对帧初有位移则视为走路；
   * 击飞姿态由 playBlastKnock + update 处理。
   * 须在 solid / 武器结算之后调用。
   */
  private updateParkedCharacters(deltaMS: number): void {
    /** 低于此位移不算走（世界像素²），避免浮点微抖 */
    const moveEpsSq = 0.35 * 0.35;

    for (const parked of this.parkedCharacters) {
      const dx = parked.worldX - parked.frameStartX;
      const dy = parked.worldY - parked.frameStartY;
      const distSq = dx * dx + dy * dy;
      const knockSpeed = Math.hypot(parked.knock.velX, parked.knock.velY);
      const airborne = parked.knock.height > 0.5;
      // 贴地被挤 / 轻推：走路晃；空中或高速击飞：只播受击姿态
      const walking = distSq > moveEpsSq && !airborne && knockSpeed < 80;
      if (distSq > moveEpsSq && !airborne) {
        parked.entity.setFacingFromMoveX(dx);
      }
      parked.entity.update(deltaMS, walking);
      parked.entity.position.set(
        parked.worldX,
        parked.worldY - parked.knock.height,
      );
      parked.entity.zIndex = parked.worldY;
    }
  }

  /** 选角阶段：仅呼吸光环 / 待机晃动，冻结战斗与移动 */
  private updateCharacterSelect(deltaMS: number): void {
    if (this.paused) {
      for (const c of this.candidates) {
        c.entity.update(deltaMS, false);
      }
      return;
    }

    const confirmPressed =
      this.keyboard.isDown('Enter') ||
      this.keyboard.isDown('Space') ||
      this.keyboard.isDown('KeyJ');
    if (confirmPressed && !this.confirmWasDown) {
      const defaultCand =
        this.candidates.find((c) => c.isDefault) || this.candidates[0];
      if (defaultCand) {
        this.confirmWasDown = true;
        this.confirmCharacter(defaultCand.id);
        return;
      }
    }
    this.confirmWasDown = confirmPressed;

    this.selectPulse = (this.selectPulse + (deltaMS / 1000) * 2.2) % (Math.PI * 2);
    const pulse = 0.5 + 0.5 * Math.sin(this.selectPulse);

    for (const c of this.candidates) {
      this.paintPedestal(c.pedestal, c.hovered, c.isDefault, pulse);
      // 轻微待机晃动，悬停或默认选中时更明显
      c.entity.update(deltaMS, c.hovered || c.isDefault);
      c.entity.alpha = c.hovered || c.isDefault ? 1 : 0.82 + pulse * 0.1;
    }

    this.syncWorldActors();
    this.sortDepth();
  }

  /** 蜘蛛扑咬命中：扣血 + 轻击退 + 姿态反馈 */
  private applySpiderAttack(hit: {
    damage: number;
    dirX: number;
    dirY: number;
    knockImpulse: number;
  }): void {
    if (!this.player) return;
    this.healthBar.applyDelta(-Math.abs(hit.damage));
    applyKnockImpulse(
      this.knock,
      hit.dirX * hit.knockImpulse,
      hit.dirY * hit.knockImpulse,
    );
    // 轻伤姿态（不转圈）
    this.player.playBlastKnock(0.45, hit.dirX, 0);
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
    // 夜色层按地图尺寸铺在地面，不随视口改
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
    if (this.paused || this.selectingCharacter) return;
    const player = this.player;
    if (!player) return;
    this.combat.tryRangedAtScreen(
      player,
      () => ({ x: this.worldX, y: this.worldY }),
      this.knock,
      e.global.x,
      e.global.y,
      {
        x: this.camera.x,
        y: this.camera.y,
        zoom: this.camera.currentZoom,
        width: this.camera.width,
        height: this.camera.height,
      },
    );
  };

  private setPaused(value: boolean): void {
    this.paused = value;
    this.pauseMenu.setOpen(value);
    // 清掉按键，避免继续后突然冲刺
    this.keyboard.clear();
  }

  /** 玩家血条 + 飞剑数量 HUD：底部居中，飞剑在血条之上并与血条左对齐 */
  private layoutHealthHud(): void {
    const cx = this.camera.width / 2;
    const hpY = this.camera.height - HUD_HP_MARGIN_BOTTOM;
    this.healthBar.position.set(cx, hpY);
    // 血条以中心为原点 → 左缘 cx - width/2；飞剑 HUD 原点在左缘
    const hpLeft = cx - HUD_HP_WIDTH / 2;
    this.spearAmmoHud.position.set(
      hpLeft,
      hpY - HUD_HP_HEIGHT / 2 - HUD_SPEAR_GAP,
    );
  }
}
