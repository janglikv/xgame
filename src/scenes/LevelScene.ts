import { Container, Graphics, Rectangle, Text } from 'pixi.js';
import {
  BombProjectile,
  BOMB_MAX_RANGE,
  loadBombTextures,
  type BombProjectileOptions,
} from '../entities/BombProjectile';
import { BombGirl } from '../entities/BombGirl';
import { IceRanger } from '../entities/IceRanger';
import type { PlayerCharacterBase } from '../entities/PlayerCharacterBase';
import {
  loadSpearTexture,
  SpearProjectile,
} from '../entities/SpearProjectile';
import type { CharacterId } from '../entities/types';
import {
  applyKnockImpulse,
  createKnockArcState,
  stepKnockArc,
  type KnockArcState,
} from '../entities/knockArc';
import { loadSpiderTexture, Spider } from '../entities/Spider';
import { Keyboard } from '../input/Keyboard';
import { HealthBar } from '../ui/HealthBar';
import { getThemeBackground, NightOverlay } from '../world/NightOverlay';
import {
  circlesOverlap,
  pushCircleOut,
  pushCircleOutMany,
} from '../world/circleBody';
import {
  GRID,
  islandCenter,
  MAP_SIZE,
  MAP_WORLD_HALF,
  WorldMap,
} from '../world/WorldMap';
import type { GameScene, LevelTheme } from './types';

/** 黑夜松树冷色 tint（环境变暗，不盖角色） */
const NIGHT_TREE_TINT = 0x6a7f9e;
/** 选角阶段：地面 / 树大幅压暗，角色保持原色 */
const SELECT_MAP_TINT = 0x6a7088;
const SELECT_TREE_TINT = 0x5a6278;
const SELECT_SPIDER_ALPHA = 0.55;
/** 选角站位：相对出生点左右间距（世界像素） */
const SELECT_SPACING = 120;
/** 选角点击热区（本地像素，贴图未缩放） */
const SELECT_HIT = { w: 520, h: 900 } as const;

const MOVE_SPEED = 220;
/**
 * 脚底圆形 solid 半径（地面占位，圆心 = worldX/Y）。
 * 用于挡树、人怪互挡；武器命中另见矛/炸弹逻辑。
 */
const PLAYER_BODY_R = 18;
const SPIDER_BODY_R = 20;
/** 实体圆互推后与树区再解析的次数 */
const BODY_SOLID_ITERS = 2;
/** 点太近不扔（屏幕像素） */
const THROW_MIN_DIST = 12;
/** 玩家 HUD 血条尺寸 / 底边边距（屏幕像素） */
const HUD_HP_WIDTH = 240;
const HUD_HP_HEIGHT = 14;
const HUD_HP_MARGIN_BOTTOM = 28;
const PLAYER_MAX_HP = 100;
/** 击退很强时削弱 WASD 控制（水平速度） */
const KNOCK_CONTROL_SOFTEN = 220;
/** 蜘蛛对击飞的接收倍率（目标抗性，非炸弹属性） */
const SPIDER_KNOCK_SCALE = 0.85;

const SPIDER_SCALE = 0.1;

/** 默认出生：九宫格下方正中岛中心（非地图原点） */
const PLAYER_SPAWN = islandCenter(1, GRID - 1);

/** 镜头缩放：默认 / 最大；最小随窗口动态算（刚好看全图） */
const ZOOM_DEFAULT = 1;
const ZOOM_MAX = 1;
/** 按住 +/- 时的缩放速度（每秒倍率） */
const ZOOM_KEY_RATE = 1.35;
/** 滚轮单次倍率 */
const ZOOM_WHEEL_STEP = 1.12;
/** 镜头位置跟随（指数趋近，越大越贴） */
const CAM_FOLLOW_LAMBDA = 12;
/** 缩放过渡 */
const CAM_ZOOM_LAMBDA = 9;
/** 选角确认后短暂加快镜头收束 */
const CAM_CONFIRM_BOOST_LAMBDA = 16;
const CAM_CONFIRM_BOOST_TIME = 0.55;

export type LevelSceneOptions = {
  theme: LevelTheme;
  onBack: () => void;
  onBackground?: (color: number) => void;
};

type PauseButton = {
  root: Container;
  bg: Graphics;
  width: number;
  height: number;
  baseColor: number;
  hoverColor: number;
};

type CharacterCandidate = {
  id: CharacterId;
  entity: PlayerCharacterBase;
  worldX: number;
  worldY: number;
  pedestal: Graphics;
  hovered: boolean;
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
  private readonly spiders: Spider[] = [];
  private readonly bombs: BombProjectile[] = [];
  private readonly spears: SpearProjectile[] = [];
  private readonly keyboard = new Keyboard();
  private readonly pauseLayer: Container;
  private readonly pauseVeil: Graphics;
  private readonly pausePanel: Graphics;
  private readonly pauseTitle: Text;
  private readonly pauseButtons: PauseButton[] = [];
  private readonly theme: LevelTheme;
  private readonly onBack: () => void;
  private readonly onBackground?: (color: number) => void;

  private viewWidth: number;
  private viewHeight: number;
  /** 玩家世界坐标 */
  private worldX = PLAYER_SPAWN.x;
  private worldY = PLAYER_SPAWN.y;
  /** 镜头对准的世界坐标（边界处可与玩家分离）— 实际渲染值 */
  private camX = PLAYER_SPAWN.x;
  private camY = PLAYER_SPAWN.y;
  /** 镜头目标（平滑趋近） */
  private camTargetX = PLAYER_SPAWN.x;
  private camTargetY = PLAYER_SPAWN.y;
  /** 镜头缩放（1 = 默认）— 实际渲染值 */
  private zoom = ZOOM_DEFAULT;
  /** 缩放目标（平滑趋近） */
  private zoomTarget = ZOOM_DEFAULT;
  /** 选角确认后的加速跟随剩余时间（秒） */
  private camBoostTime = 0;
  /** 被炸飞：地面平面速度 + 高度抛物线 */
  private readonly knock: KnockArcState = createKnockArcState();
  private paused = false;
  /** true = 尚未选角，禁止移动 / 攻击 */
  private selectingCharacter = true;
  private selectPulse = 0;
  private escWasDown = false;
  private fitWasDown = false;
  private resetZoomWasDown = false;
  private treesMounted = false;

  constructor(width: number, height: number, options: LevelSceneOptions) {
    super();
    this.label = `LevelScene:${options.theme}`;
    this.theme = options.theme;
    this.onBack = options.onBack;
    this.onBackground = options.onBackground;
    this.viewWidth = width;
    this.viewHeight = height;

    // 全屏可点：选角后点击落点扔炸弹
    this.eventMode = 'static';
    this.cursor = 'default';
    this.hitArea = new Rectangle(0, 0, width, height);
    this.on('pointertap', this.onPointerTap);

    this.worldRoot = new Container();
    this.worldRoot.label = 'WorldRoot';
    this.addChild(this.worldRoot);

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

    // 暂停层（默认隐藏）
    this.pauseLayer = new Container();
    this.pauseLayer.label = 'PauseLayer';
    this.pauseLayer.visible = false;
    this.pauseLayer.eventMode = 'static';
    this.addChild(this.pauseLayer);

    this.pauseVeil = new Graphics();
    this.pauseLayer.addChild(this.pauseVeil);

    this.pausePanel = new Graphics();
    this.pauseLayer.addChild(this.pausePanel);

    this.pauseTitle = new Text({
      text: '暂停',
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 32,
        fontWeight: '700',
        fill: 0xffffff,
      },
    });
    this.pauseTitle.anchor.set(0.5);
    this.pauseLayer.addChild(this.pauseTitle);

    this.pauseButtons.push(
      this.createPauseButton('继续', 0x4caf50, 0x66c96a, () => this.setPaused(false)),
      this.createPauseButton('返回主场景', 0x5a6a8a, 0x7a8ab0, () => this.onBack()),
    );

    this.applySelectAtmosphere(true);
    this.stepCamera(0, true);
    this.syncWorldActors();
    this.layoutHealthHud();
    this.layoutPauseMenu();
  }

  /** 出发岛左右摆放可选角色 + 脚底光环 */
  private mountCharacterCandidates(): void {
    const roster: Array<{ id: CharacterId; entity: PlayerCharacterBase; offsetX: number }> = [
      { id: 'bomb-girl', entity: new BombGirl(0.07), offsetX: -SELECT_SPACING },
      { id: 'ice-ranger', entity: new IceRanger(0.066), offsetX: SELECT_SPACING },
    ];

    for (const entry of roster) {
      const worldX = PLAYER_SPAWN.x + entry.offsetX;
      const worldY = PLAYER_SPAWN.y;

      const pedestal = new Graphics();
      pedestal.label = `Pedestal:${entry.id}`;
      pedestal.eventMode = 'none';
      this.paintPedestal(pedestal, false, 0);

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

  private paintPedestal(g: Graphics, hovered: boolean, pulse: number): void {
    const breathe = 1 + pulse * 0.08;
    const rx = 48 * breathe;
    const ry = 18 * breathe;
    const core = hovered ? 0xffffff : 0x9ee8ff;
    const glow = hovered ? 0xc8f4ff : 0x5ec8ff;
    g.clear();
    g.ellipse(0, 0, rx * 1.35, ry * 1.35).fill({
      color: glow,
      alpha: 0.16 + pulse * 0.08,
    });
    g.ellipse(0, 0, rx, ry).fill({
      color: core,
      alpha: 0.22 + pulse * 0.1,
    });
    g.ellipse(0, 0, rx * 0.92, ry * 0.92).stroke({
      width: hovered ? 3.5 : 2.5,
      color: core,
      alpha: 0.9,
    });
  }

  /** 选角确认：操控所选角色；未选中的留在原地待机，清掉光环 / 点击 */
  private confirmCharacter(id: CharacterId): void {
    if (!this.selectingCharacter) return;
    const chosen = this.candidates.find((c) => c.id === id);
    if (!chosen) return;

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
    this.cursor = this.player.canRangedAttack ? 'crosshair' : 'default';
    this.sortLayer.eventMode = 'none';

    this.applySelectAtmosphere(false);
    // 镜头从选角构图平滑收束到所选角色，不瞬切
    this.camBoostTime = CAM_CONFIRM_BOOST_TIME;
    this.refreshCameraTargets();
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

  private createPauseButton(
    text: string,
    baseColor: number,
    hoverColor: number,
    onClick: () => void,
  ): PauseButton {
    const width = 220;
    const height = 52;
    const root = new Container();
    root.eventMode = 'static';
    root.cursor = 'pointer';

    const bg = new Graphics();
    this.paintButton(bg, width, height, baseColor);
    root.addChild(bg);

    const label = new Text({
      text,
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 20,
        fontWeight: '600',
        fill: 0xffffff,
      },
    });
    label.anchor.set(0.5);
    label.position.set(width / 2, height / 2);
    root.addChild(label);

    root.on('pointerover', () => {
      this.paintButton(bg, width, height, hoverColor);
      root.scale.set(1.04);
    });
    root.on('pointerout', () => {
      this.paintButton(bg, width, height, baseColor);
      root.scale.set(1);
    });
    root.on('pointertap', (e) => {
      e.stopPropagation();
      onClick();
    });

    this.pauseLayer.addChild(root);
    return { root, bg, width, height, baseColor, hoverColor };
  }

  private paintButton(
    g: Graphics,
    w: number,
    h: number,
    color: number,
  ): void {
    g.clear();
    g.roundRect(3, 4, w, h, 14).fill({ color: 0x000000, alpha: 0.25 });
    g.roundRect(0, 0, w, h, 14).fill({ color });
    g.roundRect(8, 6, w - 16, 10, 6).fill({ color: 0xffffff, alpha: 0.15 });
  }

  async init(): Promise<void> {
    this.onBackground?.(getThemeBackground(this.theme));
    this.keyboard.bind();
    window.addEventListener('wheel', this.onWheel, { passive: false });

    const loads: Promise<void>[] = [
      this.worldMap.load(),
      ...this.candidates.map((c) => c.entity.load()),
      loadBombTextures(),
      loadSpearTexture(),
    ];
    if (this.spiders.length > 0) {
      loads.push(loadSpiderTexture());
    }
    await Promise.all(loads);

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

  /** 黑夜关：九宫格四角岛各一只蜘蛛，出生时朝向中心 */
  private spawnCornerSpiders(): void {
    const last = GRID - 1;
    const corners: Array<[number, number]> = [
      [0, 0],
      [last, 0],
      [0, last],
      [last, last],
    ];

    for (const [ix, iy] of corners) {
      const { x: wx, y: wy } = islandCenter(ix, iy);
      const spider = new Spider(wx, wy, { scale: SPIDER_SCALE });
      spider.faceToward(0, 0);
      this.sortLayer.addChild(spider);
      this.spiders.push(spider);
    }
  }

  /** 镜头：worldRoot 缩放 + 平移，使 cam 落在屏幕中心 */
  private applyCamera(): void {
    const z = this.zoom;
    this.worldRoot.scale.set(z);
    this.worldRoot.position.set(
      this.viewWidth / 2 - this.camX * z,
      this.viewHeight / 2 - this.camY * z,
    );
  }

  /** 指数趋近（帧率无关） */
  private static expApproach(
    current: number,
    target: number,
    lambda: number,
    dt: number,
  ): number {
    if (dt <= 0 || lambda <= 0) return target;
    return current + (target - current) * (1 - Math.exp(-lambda * dt));
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

  /** 根据焦点刷新 camTarget（用 zoomTarget 算视口，避免缩放动画中目标抖动） */
  private refreshCameraTargets(): void {
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
    }

    const focus = this.selectingCharacter
      ? this.getSelectFocus()
      : { x: this.worldX, y: this.worldY };

    const z = Math.max(this.zoomTarget, 1e-4);
    const cam = WorldMap.clampCamera(
      focus.x,
      focus.y,
      this.viewWidth / z,
      this.viewHeight / z,
    );
    this.camTargetX = cam.x;
    this.camTargetY = cam.y;
  }

  /**
   * 平滑推进镜头到目标。
   * snap=true：立刻对齐（初始化 / 改窗口）。
   * @returns 镜头是否发生可见位移（用于裁剪树）
   */
  private stepCamera(dt: number, snap = false): boolean {
    this.refreshCameraTargets();

    const prevX = this.camX;
    const prevY = this.camY;
    const prevZ = this.zoom;

    if (snap) {
      this.camX = this.camTargetX;
      this.camY = this.camTargetY;
      this.zoom = this.zoomTarget;
      this.camBoostTime = 0;
    } else {
      // 选角中镜头目标固定，无需跟焦；确认后 / 游玩中再平滑跟随
      let posLambda = this.selectingCharacter ? 0 : CAM_FOLLOW_LAMBDA;
      if (this.camBoostTime > 0) {
        posLambda = CAM_CONFIRM_BOOST_LAMBDA;
        this.camBoostTime = Math.max(0, this.camBoostTime - dt);
      }

      if (posLambda > 0) {
        this.camX = LevelScene.expApproach(
          this.camX,
          this.camTargetX,
          posLambda,
          dt,
        );
        this.camY = LevelScene.expApproach(
          this.camY,
          this.camTargetY,
          posLambda,
          dt,
        );
      } else {
        this.camX = this.camTargetX;
        this.camY = this.camTargetY;
      }
      this.zoom = LevelScene.expApproach(
        this.zoom,
        this.zoomTarget,
        CAM_ZOOM_LAMBDA,
        dt,
      );

      // 足够近时吸附，避免浮点残差
      if (Math.abs(this.camX - this.camTargetX) < 0.05) this.camX = this.camTargetX;
      if (Math.abs(this.camY - this.camTargetY) < 0.05) this.camY = this.camTargetY;
      if (Math.abs(this.zoom - this.zoomTarget) < 0.0004) this.zoom = this.zoomTarget;
    }

    // 用当前缩放钳制，防止过渡中露图外
    const z = Math.max(this.zoom, 1e-4);
    const clamped = WorldMap.clampCamera(
      this.camX,
      this.camY,
      this.viewWidth / z,
      this.viewHeight / z,
    );
    this.camX = clamped.x;
    this.camY = clamped.y;

    this.applyCamera();

    return (
      Math.abs(this.camX - prevX) > 0.01 ||
      Math.abs(this.camY - prevY) > 0.01 ||
      Math.abs(this.zoom - prevZ) > 0.0002
    );
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
    for (const bomb of this.bombs) {
      bomb.syncToWorld();
    }
    for (const spear of this.spears) {
      spear.syncToWorld();
    }
  }

  /** 视口外松树不渲染（仍保留在 sortLayer） */
  private cullTrees(): void {
    const z = Math.max(this.zoom, 1e-4);
    const pad = 140;
    const hw = this.viewWidth / (2 * z) + pad;
    const hh = this.viewHeight / (2 * z) + pad;
    const cx = this.camX;
    const cy = this.camY;
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
   * 应用本帧位移：树区 + 挤开停场角色 + 脚底圆 vs 蜘蛛 + 地图边界。
   * 停场角色可被挤走；蜘蛛仍为硬障碍。from = 移动前，用于轴分离滑墙。
   */
  private applyPlayerSolid(fromX: number, fromY: number): void {
    let px = this.worldX;
    let py = this.worldY;
    let prevX = fromX;
    let prevY = fromY;

    for (let i = 0; i < BODY_SOLID_ITERS; i++) {
      const tree = WorldMap.resolveSolid(prevX, prevY, px, py, PLAYER_BODY_R);
      px = tree.x;
      py = tree.y;

      // 先把重叠的停场角色挤开（优先动对方）
      this.shoveParkedFrom(px, py, PLAYER_BODY_R);

      // 蜘蛛：硬墙，推自己
      const hard = this.collectHardBodyObstacles({
        includePlayer: false,
        spiderSkipIndex: -1,
      });
      let body = pushCircleOutMany(px, py, PLAYER_BODY_R, hard, 2);
      // 对方被树卡住时，残留重叠再把自己挤开
      body = this.pushOutOfParked(body.x, body.y, PLAYER_BODY_R);

      const settled =
        body.x === px &&
        body.y === py &&
        !this.overlapsAnyParked(body.x, body.y, PLAYER_BODY_R);
      if (settled) {
        this.worldX = body.x;
        this.worldY = body.y;
        return;
      }

      prevX = px;
      prevY = py;
      px = body.x;
      py = body.y;
    }

    const finalTree = WorldMap.resolveSolid(prevX, prevY, px, py, PLAYER_BODY_R);
    this.worldX = finalTree.x;
    this.worldY = finalTree.y;
  }

  /**
   * 蜘蛛本帧落点：树区 + 挤开停场角色 + vs 玩家/其他蜘蛛 + 边界。
   * 玩家与其它蜘蛛为硬障碍；停场角色可被挤走。
   */
  private applySpiderSolid(
    spider: Spider,
    fromX: number,
    fromY: number,
    spiderIndex: number,
  ): void {
    let sx = spider.worldX;
    let sy = spider.worldY;
    let prevX = fromX;
    let prevY = fromY;

    for (let i = 0; i < BODY_SOLID_ITERS; i++) {
      const tree = WorldMap.resolveSolid(prevX, prevY, sx, sy, SPIDER_BODY_R);
      sx = tree.x;
      sy = tree.y;

      this.shoveParkedFrom(sx, sy, SPIDER_BODY_R);

      const hard = this.collectHardBodyObstacles({
        includePlayer: true,
        spiderSkipIndex: spiderIndex,
      });
      let body = pushCircleOutMany(sx, sy, SPIDER_BODY_R, hard, 2);
      body = this.pushOutOfParked(body.x, body.y, SPIDER_BODY_R);

      if (
        body.x === sx &&
        body.y === sy &&
        !this.overlapsAnyParked(body.x, body.y, SPIDER_BODY_R)
      ) {
        spider.worldX = body.x;
        spider.worldY = body.y;
        return;
      }

      prevX = sx;
      prevY = sy;
      sx = body.x;
      sy = body.y;
    }

    const finalTree = WorldMap.resolveSolid(prevX, prevY, sx, sy, SPIDER_BODY_R);
    spider.worldX = finalTree.x;
    spider.worldY = finalTree.y;
  }

  /**
   * 以 pusher 为轴，把所有重叠的停场角色挤开，再解析他们的树/硬障碍。
   * 优先移动停场角色（可被挤走），而不是挡住推动者。
   */
  private shoveParkedFrom(
    pusherX: number,
    pusherY: number,
    pusherR: number,
  ): void {
    if (this.parkedCharacters.length === 0) return;

    for (let n = 0; n < BODY_SOLID_ITERS; n++) {
      let any = false;
      for (let i = 0; i < this.parkedCharacters.length; i++) {
        const parked = this.parkedCharacters[i]!;
        if (
          !circlesOverlap(
            pusherX,
            pusherY,
            pusherR,
            parked.worldX,
            parked.worldY,
            PLAYER_BODY_R,
          )
        ) {
          continue;
        }

        const fromX = parked.worldX;
        const fromY = parked.worldY;
        // 只动停场角色：从推动者圆心推出
        const shoved = pushCircleOut(
          parked.worldX,
          parked.worldY,
          PLAYER_BODY_R,
          pusherX,
          pusherY,
          pusherR,
        );
        parked.worldX = shoved.x;
        parked.worldY = shoved.y;
        this.resolveParkedSolid(parked, fromX, fromY, i);
        any = true;
      }
      if (!any) break;
    }
  }

  /**
   * 停场角色被挤后的落点：树区 + 蜘蛛/其他停场（硬）+ 地图边界。
   * 不把推动者算进硬障碍，避免立刻把人又推回推动者体内。
   */
  private resolveParkedSolid(
    parked: ParkedCharacter,
    fromX: number,
    fromY: number,
    parkedIndex: number,
  ): void {
    let x = parked.worldX;
    let y = parked.worldY;
    let prevX = fromX;
    let prevY = fromY;

    for (let i = 0; i < BODY_SOLID_ITERS; i++) {
      const tree = WorldMap.resolveSolid(prevX, prevY, x, y, PLAYER_BODY_R);
      x = tree.x;
      y = tree.y;

      const hard: Array<{ x: number; y: number; r: number }> = [];
      // 操作中的玩家：硬挡（被炸飞时不穿进玩家）
      if (this.player && !this.selectingCharacter) {
        hard.push({ x: this.worldX, y: this.worldY, r: PLAYER_BODY_R });
      }
      for (const s of this.spiders) {
        if (!s.isAlive) continue;
        hard.push({ x: s.worldX, y: s.worldY, r: SPIDER_BODY_R });
      }
      for (let j = 0; j < this.parkedCharacters.length; j++) {
        if (j === parkedIndex) continue;
        const o = this.parkedCharacters[j]!;
        hard.push({ x: o.worldX, y: o.worldY, r: PLAYER_BODY_R });
      }

      const body = pushCircleOutMany(x, y, PLAYER_BODY_R, hard, 2);
      if (body.x === x && body.y === y) {
        parked.worldX = x;
        parked.worldY = y;
        return;
      }
      prevX = x;
      prevY = y;
      x = body.x;
      y = body.y;
    }

    const finalTree = WorldMap.resolveSolid(prevX, prevY, x, y, PLAYER_BODY_R);
    parked.worldX = finalTree.x;
    parked.worldY = finalTree.y;
  }

  /** 推动者仍与某停场角色重叠时，把自己挤开（对方已贴墙推不动） */
  private pushOutOfParked(
    x: number,
    y: number,
    radius: number,
  ): { x: number; y: number } {
    const obstacles = this.parkedCharacters.map((p) => ({
      x: p.worldX,
      y: p.worldY,
      r: PLAYER_BODY_R,
    }));
    return pushCircleOutMany(x, y, radius, obstacles, 2);
  }

  private overlapsAnyParked(x: number, y: number, radius: number): boolean {
    for (const p of this.parkedCharacters) {
      if (
        circlesOverlap(x, y, radius, p.worldX, p.worldY, PLAYER_BODY_R)
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * 硬障碍脚底圆：玩家、蜘蛛（停场角色可被挤，不在此列）。
   */
  private collectHardBodyObstacles(options: {
    includePlayer: boolean;
    spiderSkipIndex: number;
  }): Array<{ x: number; y: number; r: number }> {
    const out: Array<{ x: number; y: number; r: number }> = [];

    if (options.includePlayer && this.player && !this.selectingCharacter) {
      out.push({ x: this.worldX, y: this.worldY, r: PLAYER_BODY_R });
    }

    for (let i = 0; i < this.spiders.length; i++) {
      if (i === options.spiderSkipIndex) continue;
      const s = this.spiders[i]!;
      if (!s.isAlive) continue;
      out.push({ x: s.worldX, y: s.worldY, r: SPIDER_BODY_R });
    }

    return out;
  }

  /** 当前窗口下能看全地图的最小缩放 */
  private getMinZoom(): number {
    if (this.viewWidth <= 0 || this.viewHeight <= 0) return 0.15;
    return Math.min(this.viewWidth / MAP_SIZE, this.viewHeight / MAP_SIZE) * 0.92;
  }

  /** 设置缩放目标（由 stepCamera 平滑过渡） */
  private setZoom(next: number): void {
    const min = this.getMinZoom();
    const z = Math.min(ZOOM_MAX, Math.max(min, next));
    if (Math.abs(z - this.zoomTarget) < 1e-4) return;
    this.zoomTarget = z;
  }

  /** 缩到刚好看全图：平滑拉远并回中心（目标由 clamp 在 minZoom 下自然居中） */
  private fitOverview(): void {
    this.zoomTarget = this.getMinZoom();
  }

  private readonly onWheel = (e: WheelEvent): void => {
    if (this.paused) return;
    e.preventDefault();
    const dir = e.deltaY > 0 ? 1 / ZOOM_WHEEL_STEP : ZOOM_WHEEL_STEP;
    this.setZoom(this.zoom * dir);
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

    for (let si = 0; si < this.spiders.length; si++) {
      const spider = this.spiders[si]!;
      if (!spider.isAlive) continue;
      const sFromX = spider.worldX;
      const sFromY = spider.worldY;
      const result = spider.update(deltaMS, this.worldX, this.worldY);
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
    this.updateBombs(deltaMS);
    this.updateSpears(deltaMS);
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
      this.resolveParkedSolid(parked, fromX, fromY, i);
    }
  }

  /**
   * 武器命中停场角色：击飞 + 姿态 / 转圈，**不扣血**。
   * 与玩家自身被炸逻辑一致。
   */
  private applyParkedHitFx(
    parked: ParkedCharacter,
    hit: {
      knockVelX: number;
      knockVelY: number;
      dirX: number;
      poseStrength: number;
      airSpinTurns?: number;
    },
    knockScale = 1,
  ): void {
    applyKnockImpulse(
      parked.knock,
      hit.knockVelX,
      hit.knockVelY,
      knockScale,
    );
    parked.entity.playBlastKnock(
      hit.poseStrength,
      hit.dirX,
      hit.airSpinTurns ?? 0,
    );
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

    this.selectPulse = (this.selectPulse + (deltaMS / 1000) * 2.2) % (Math.PI * 2);
    const pulse = 0.5 + 0.5 * Math.sin(this.selectPulse);

    for (const c of this.candidates) {
      this.paintPedestal(c.pedestal, c.hovered, pulse);
      // 轻微待机晃动，悬停时更明显
      c.entity.update(deltaMS, c.hovered);
      c.entity.alpha = c.hovered ? 1 : 0.92 + pulse * 0.08;
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
    this.refreshCameraTargets();
    this.syncWorldActors();
    this.sortDepth();
  }

  resize(width: number, height: number): void {
    this.viewWidth = width;
    this.viewHeight = height;
    this.hitArea = new Rectangle(0, 0, width, height);
    this.zoomTarget = Math.min(
      ZOOM_MAX,
      Math.max(this.getMinZoom(), this.zoomTarget),
    );
    // 改窗口尺寸时直接对齐，避免过渡穿帮
    this.stepCamera(0, true);
    this.syncWorldActors();
    this.cullTrees();
    this.sortDepth();
    this.layoutHealthHud();
    // 夜色层按地图尺寸铺在地面，不随视口改
    this.layoutPauseMenu();
  }

  private handleZoomKeys(dt: number): void {
    const fitDown =
      this.keyboard.isDown('KeyF') || this.keyboard.isDown('KeyM');
    if (fitDown && !this.fitWasDown) {
      this.fitOverview();
    }
    this.fitWasDown = fitDown;

    const resetDown =
      this.keyboard.isDown('Digit0') || this.keyboard.isDown('Numpad0');
    if (resetDown && !this.resetZoomWasDown) {
      this.setZoom(ZOOM_DEFAULT);
    }
    this.resetZoomWasDown = resetDown;

    const zoomIn =
      this.keyboard.isDown('Equal') ||
      this.keyboard.isDown('NumpadAdd');
    const zoomOut =
      this.keyboard.isDown('Minus') ||
      this.keyboard.isDown('NumpadSubtract');
    if (zoomIn === zoomOut) return;

    const factor = Math.pow(ZOOM_KEY_RATE, dt);
    this.setZoom(this.zoomTarget * (zoomIn ? factor : 1 / factor));
  }

  private readonly onPointerTap = (e: {
    global: { x: number; y: number };
  }): void => {
    if (this.paused || this.selectingCharacter) return;
    const player = this.player;
    if (!player) return;
    if (player instanceof BombGirl) {
      this.throwBombAtScreen(e.global.x, e.global.y);
    } else if (player instanceof IceRanger) {
      this.throwSpearAtScreen(e.global.x, e.global.y);
    }
  };

  /** 屏幕点击相对玩家的世界方向（未归一化）；过近返回 null */
  private screenAimWorldDelta(
    screenX: number,
    screenY: number,
  ): { dx: number; dy: number } | null {
    const z = this.zoom;
    const playerSx = this.viewWidth / 2 + (this.worldX - this.camX) * z;
    const playerSy = this.viewHeight / 2 + (this.worldY - this.camY) * z;
    const screenDx = screenX - playerSx;
    const screenDy = screenY - playerSy;
    if (Math.hypot(screenDx, screenDy) < THROW_MIN_DIST) return null;
    return { dx: screenDx / z, dy: screenDy / z };
  }

  /**
   * 以角色屏幕位置为起点抛物线扔炸弹。
   * 射程内落点 = 点击位置；超出则钳到最远方向。
   */
  private throwBombAtScreen(screenX: number, screenY: number): void {
    const player = this.player;
    if (!(player instanceof BombGirl)) return;

    const aim = this.screenAimWorldDelta(screenX, screenY);
    if (!aim) return;

    let landDx = aim.dx;
    let landDy = aim.dy;
    const worldDist = Math.hypot(landDx, landDy);
    if (worldDist > BOMB_MAX_RANGE) {
      const s = BOMB_MAX_RANGE / worldDist;
      landDx *= s;
      landDy *= s;
    }

    const endX = this.worldX + landDx;
    const endY = this.worldY + landDy;

    // 先转身再取出手点（持弹手随朝向镜像）
    player.setFacingFromMoveX(endX - this.worldX);
    player.playThrowRecoil();

    // 起点 = 角色持弹手（地面投影 + 离地高度）
    const origin = player.getThrowOrigin(this.worldX, this.worldY);
    const bombOptions: BombProjectileOptions = {
      originHeight: origin.height,
    };
    const bomb = new BombProjectile(
      origin.x,
      origin.y,
      endX,
      endY,
      bombOptions,
    );
    this.sortLayer.addChild(bomb);
    this.bombs.push(bomb);
    bomb.syncToWorld();
    this.sortDepth();
  }

  /**
   * 冰霜游侠：朝点击方向直线投矛，飞到命中敌人或墙体为止。
   */
  private throwSpearAtScreen(screenX: number, screenY: number): void {
    const player = this.player;
    if (!(player instanceof IceRanger)) return;

    const aim = this.screenAimWorldDelta(screenX, screenY);
    if (!aim) return;

    player.setFacingFromMoveX(aim.dx);
    player.playThrowRecoil();

    const origin = player.getThrowOrigin(this.worldX, this.worldY);
    const spear = new SpearProjectile(origin.x, origin.y, aim.dx, aim.dy, {
      originHeight: origin.height,
    });
    this.sortLayer.addChild(spear);
    this.spears.push(spear);
    spear.syncToWorld();
    this.sortDepth();
  }

  private updateBombs(deltaMS: number): void {
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const bomb = this.bombs[i]!;
      const phase = bomb.update(deltaMS);
      bomb.syncToWorld();

      // 落地瞬间：用该炸弹自身的 blast 属性结算伤害 / 击飞
      if (bomb.consumeBlastResolve()) {
        this.applyBombBlast(bomb);
      }

      if (phase === 'done') {
        this.sortLayer.removeChild(bomb);
        bomb.destroy({ children: true });
        this.bombs.splice(i, 1);
      }
    }
  }

  /**
   * 直线长矛：飞行中检测蜘蛛 / 停场角色；撞墙由投射物内部处理。
   * 停场角色：击飞 + 姿态，不扣血。
   */
  private updateSpears(deltaMS: number): void {
    let needSync = false;

    for (let i = this.spears.length - 1; i >= 0; i--) {
      const spear = this.spears[i]!;

      // 先位移（内部检测树墙），再测目标，避免同帧漏检
      let phase = spear.update(deltaMS);

      if (phase === 'flying') {
        let stuck = false;

        for (let s = this.spiders.length - 1; s >= 0; s--) {
          const spider = this.spiders[s]!;
          if (!spider.isAlive) continue;
          if (!spear.hitsTarget(spider.worldX, spider.worldY, SPIDER_BODY_R)) {
            continue;
          }

          const hit = spear.buildHit();
          const alive = spider.applyBlastHit(hit, SPIDER_KNOCK_SCALE);
          if (!alive) {
            this.sortLayer.removeChild(spider);
            spider.destroy({ children: true });
            this.spiders.splice(s, 1);
          }
          spear.stick();
          phase = spear.getPhase();
          needSync = true;
          stuck = true;
          break;
        }

        if (!stuck) {
          for (const parked of this.parkedCharacters) {
            if (
              !spear.hitsTarget(
                parked.worldX,
                parked.worldY,
                PLAYER_BODY_R,
              )
            ) {
              continue;
            }
            const hit = spear.buildHit();
            this.applyParkedHitFx(parked, hit, 1);
            spear.stick();
            phase = spear.getPhase();
            needSync = true;
            break;
          }
        }
      }

      spear.syncToWorld();

      if (phase === 'done') {
        this.sortLayer.removeChild(spear);
        spear.destroy({ children: true });
        this.spears.splice(i, 1);
      }
    }

    if (needSync) {
      this.syncWorldActors();
    }
  }

  /**
   * 场景只负责把炸弹算出的命中结果接到目标上。
   * 半径 / 伤害 / 击飞速度等全部读 bomb.blast。
   * 玩家 / 停场角色：保留击飞 / 姿态，不扣血。
   */
  private applyBombBlast(bomb: BombProjectile): void {
    const player = this.player;
    if (player) {
      const face = player.facingDir;
      const playerHit = bomb.evaluateHit(this.worldX, this.worldY, face);
      if (playerHit) {
        applyKnockImpulse(
          this.knock,
          playerHit.knockVelX,
          playerHit.knockVelY,
        );
        player.playBlastKnock(
          playerHit.poseStrength,
          playerHit.dirX,
          playerHit.airSpinTurns,
        );
      }
    }

    let anyFx = false;
    for (const parked of this.parkedCharacters) {
      const hit = bomb.evaluateHit(
        parked.worldX,
        parked.worldY,
        parked.worldX >= bomb.groundX ? 1 : -1,
      );
      if (!hit) continue;
      this.applyParkedHitFx(parked, hit, 1);
      anyFx = true;
    }

    for (let i = this.spiders.length - 1; i >= 0; i--) {
      const spider = this.spiders[i]!;
      if (!spider.isAlive) continue;

      const hit = bomb.evaluateHit(
        spider.worldX,
        spider.worldY,
        spider.worldX >= bomb.groundX ? 1 : -1,
      );
      if (!hit) continue;

      anyFx = true;
      const alive = spider.applyBlastHit(hit, SPIDER_KNOCK_SCALE);
      if (!alive) {
        this.sortLayer.removeChild(spider);
        spider.destroy({ children: true });
        this.spiders.splice(i, 1);
      }
    }
    if (anyFx) {
      this.syncWorldActors();
      this.sortDepth();
    }
  }

  private setPaused(value: boolean): void {
    this.paused = value;
    this.pauseLayer.visible = value;
    // 清掉按键，避免继续后突然冲刺
    this.keyboard.clear();
  }

  /** 玩家血条 HUD：固定在屏幕底部居中 */
  private layoutHealthHud(): void {
    this.healthBar.position.set(
      this.viewWidth / 2,
      this.viewHeight - HUD_HP_MARGIN_BOTTOM,
    );
  }

  private layoutPauseMenu(): void {
    const w = this.viewWidth;
    const h = this.viewHeight;

    this.pauseVeil
      .clear()
      .rect(0, 0, w, h)
      .fill({ color: 0x000000, alpha: 0.5 });

    const panelW = 300;
    const panelH = 240;
    const px = (w - panelW) / 2;
    const py = (h - panelH) / 2;

    this.pausePanel
      .clear()
      .roundRect(px + 4, py + 6, panelW, panelH, 20)
      .fill({ color: 0x000000, alpha: 0.3 })
      .roundRect(px, py, panelW, panelH, 20)
      .fill({ color: 0x1e2838, alpha: 0.95 })
      .roundRect(px + 2, py + 2, panelW - 4, panelH - 4, 18)
      .stroke({ width: 2, color: 0xffffff, alpha: 0.12 });

    this.pauseTitle.position.set(w / 2, py + 40);

    const gap = 14;
    const totalBtnH =
      this.pauseButtons.reduce((s, b) => s + b.height, 0) +
      gap * (this.pauseButtons.length - 1);
    let y = py + 90;

    // 垂直居中按钮组
    const startY = py + (panelH - 50 - totalBtnH) / 2 + 50;
    y = startY;

    for (const btn of this.pauseButtons) {
      btn.root.pivot.set(btn.width / 2, btn.height / 2);
      btn.root.position.set(w / 2, y + btn.height / 2);
      y += btn.height + gap;
    }
  }

}
