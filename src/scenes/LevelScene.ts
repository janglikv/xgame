import { Container, Graphics, Rectangle, Text } from 'pixi.js';
import {
  BombProjectile,
  BOMB_MAX_RANGE,
  DEFAULT_BOMB_STABILITY,
  loadBombTextures,
} from '../entities/BombProjectile';
import { FrostArcher } from '../entities/FrostArcher';
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
import { GRID, islandCenter, MAP_SIZE, WorldMap } from '../world/WorldMap';
import type { GameScene, LevelTheme } from './types';

const MOVE_SPEED = 220;
/** 玩家脚底碰撞半径 */
const PLAYER_BODY_R = 18;
/** 蜘蛛碰撞半径 */
const SPIDER_BODY_R = 20;
/** 点太近不扔（屏幕像素） */
const THROW_MIN_DIST = 12;
/** 血条相对脚底向上的偏移（屏幕像素） */
const HP_BAR_OFFSET_Y = 86;
const PLAYER_MAX_HP = 100;
/** 击退很强时削弱 WASD 控制（水平速度） */
const KNOCK_CONTROL_SOFTEN = 220;
/** 蜘蛛对击飞的接收倍率（目标抗性，非炸弹属性） */
const SPIDER_KNOCK_SCALE = 0.85;
/**
 * 玩家手雷稳定性 0~1。
 * 越低越容易扔出随机缩小的弱弹（范围 / 伤害 / 击飞一起变小）。
 */
const PLAYER_BOMB_STABILITY = DEFAULT_BOMB_STABILITY;

const SPIDER_SCALE = 0.1;

/** 默认出生：九宫格下方正中岛中心（非地图原点） */
const PLAYER_SPAWN = islandCenter(1, GRID - 1);

/** 镜头缩放：默认 / 最大；最小随窗口动态算（刚好看全图） */
const ZOOM_DEFAULT = 1;
const ZOOM_MAX = 1.75;
/** 按住 +/- 时的缩放速度（每秒倍率） */
const ZOOM_KEY_RATE = 1.35;
/** 滚轮单次倍率 */
const ZOOM_WHEEL_STEP = 1.12;

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

/**
 * 可玩关卡：白天 / 黑夜地图，WASD 移动，点击抛物线扔炸弹，Esc 暂停。
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
  private readonly archer: FrostArcher;
  private readonly healthBar: HealthBar;
  private readonly spiders: Spider[] = [];
  private readonly bombs: BombProjectile[] = [];
  private readonly keyboard = new Keyboard();
  private readonly pauseLayer: Container;
  private readonly pauseVeil: Graphics;
  private readonly pausePanel: Graphics;
  private readonly pauseTitle: Text;
  private readonly pauseButtons: PauseButton[] = [];
  private readonly zoomHud: Text;
  private readonly theme: LevelTheme;
  private readonly onBack: () => void;
  private readonly onBackground?: (color: number) => void;

  private viewWidth: number;
  private viewHeight: number;
  /** 玩家世界坐标 */
  private worldX = PLAYER_SPAWN.x;
  private worldY = PLAYER_SPAWN.y;
  /** 镜头对准的世界坐标（边界处可与玩家分离） */
  private camX = PLAYER_SPAWN.x;
  private camY = PLAYER_SPAWN.y;
  /** 镜头缩放（1 = 默认） */
  private zoom = ZOOM_DEFAULT;
  /** 被炸飞：地面平面速度 + 高度抛物线 */
  private readonly knock: KnockArcState = createKnockArcState();
  private paused = false;
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

    // 全屏可点：点击落点扔炸弹
    this.eventMode = 'static';
    this.cursor = 'crosshair';
    this.hitArea = new Rectangle(0, 0, width, height);
    this.on('pointertap', this.onPointerTap);

    this.worldRoot = new Container();
    this.worldRoot.label = 'WorldRoot';
    this.addChild(this.worldRoot);

    this.worldMap = new WorldMap();
    this.worldRoot.addChild(this.worldMap);

    this.sortLayer = new Container();
    this.sortLayer.label = 'SortLayer';
    this.sortLayer.sortableChildren = true;
    this.sortLayer.eventMode = 'none';
    this.worldRoot.addChild(this.sortLayer);

    this.nightOverlay =
      options.theme === 'night' ? new NightOverlay() : null;
    if (this.nightOverlay) {
      // 屏幕空间叠在世界之上、UI 之下
      this.addChild(this.nightOverlay);
      this.nightOverlay.layout(width, height);
    }

    if (options.theme === 'night') {
      this.spawnCornerSpiders();
    }

    this.archer = new FrostArcher(0.07);
    this.sortLayer.addChild(this.archer);

    // 血条在屏幕空间，不进 sortLayer（避免被树/角色遮挡 UI）
    this.healthBar = new HealthBar({ maxHp: PLAYER_MAX_HP, width: 50, height: 5 });
    this.healthBar.setHealth(PLAYER_MAX_HP);
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

    this.zoomHud = new Text({
      text: '',
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 13,
        fontWeight: '500',
        fill: 0xffffff,
      },
    });
    this.zoomHud.alpha = 0.75;
    this.zoomHud.eventMode = 'none';
    this.addChild(this.zoomHud);

    this.updateCameraAndPlayerBounds();
    this.applyCamera();
    this.syncWorldActors();
    this.syncHealthBar();
    this.layoutPauseMenu();
    this.layoutZoomHud();
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
      this.archer.load(),
      loadBombTextures(),
    ];
    if (this.spiders.length > 0) {
      loads.push(loadSpiderTexture());
    }
    await Promise.all(loads);

    this.mountTrees();
    this.applyCamera();
    await Promise.all(this.spiders.map((s) => s.load()));
    this.syncWorldActors();
    this.cullTrees();
    this.sortDepth();
  }

  /** 把地图生成的松树挂到 sortLayer，参与 Y-sort */
  private mountTrees(): void {
    if (this.treesMounted) return;
    this.treesMounted = true;
    for (const tree of this.worldMap.getTrees()) {
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

  /** 角色/蜘蛛/炸弹写到世界坐标，并刷新 zIndex */
  private syncWorldActors(): void {
    this.archer.position.set(this.worldX, this.worldY - this.knock.height);
    this.archer.zIndex = this.worldY;
    for (const spider of this.spiders) {
      spider.syncToWorld();
    }
    for (const bomb of this.bombs) {
      bomb.syncToWorld();
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
   * 应用本帧位移：树区碰撞（轴分离滑动）+ 地图边界。
   * from = 移动前；会写回 worldX/Y。
   */
  private applyPlayerSolid(fromX: number, fromY: number): void {
    const solid = WorldMap.resolveSolid(
      fromX,
      fromY,
      this.worldX,
      this.worldY,
      PLAYER_BODY_R,
    );
    this.worldX = solid.x;
    this.worldY = solid.y;
  }

  /** 玩家限在地图内，镜头跟随并钳到不露图外（视口随 zoom 折算成世界尺寸） */
  private updateCameraAndPlayerBounds(): void {
    // 无位移时也再解析一次，防止击飞/外力后卡在树里
    const solid = WorldMap.resolveSolid(
      this.worldX,
      this.worldY,
      this.worldX,
      this.worldY,
      PLAYER_BODY_R,
    );
    this.worldX = solid.x;
    this.worldY = solid.y;

    const z = Math.max(this.zoom, 1e-4);
    const cam = WorldMap.clampCamera(
      this.worldX,
      this.worldY,
      this.viewWidth / z,
      this.viewHeight / z,
    );
    this.camX = cam.x;
    this.camY = cam.y;
  }

  /** 当前窗口下能看全地图的最小缩放 */
  private getMinZoom(): number {
    if (this.viewWidth <= 0 || this.viewHeight <= 0) return 0.15;
    return Math.min(this.viewWidth / MAP_SIZE, this.viewHeight / MAP_SIZE) * 0.92;
  }

  private setZoom(next: number): void {
    const min = this.getMinZoom();
    const z = Math.min(ZOOM_MAX, Math.max(min, next));
    if (Math.abs(z - this.zoom) < 1e-4) {
      this.layoutZoomHud();
      return;
    }
    this.zoom = z;
    this.updateCameraAndPlayerBounds();
    this.applyCamera();
    this.syncWorldActors();
    this.cullTrees();
    this.sortDepth();
    this.syncHealthBar();
    this.layoutZoomHud();
  }

  /** 缩到刚好看全图，镜头回到地图中心 */
  private fitOverview(): void {
    this.zoom = this.getMinZoom();
    this.camX = 0;
    this.camY = 0;
    this.updateCameraAndPlayerBounds();
    this.applyCamera();
    this.syncWorldActors();
    this.cullTrees();
    this.sortDepth();
    this.syncHealthBar();
    this.layoutZoomHud();
  }

  private readonly onWheel = (e: WheelEvent): void => {
    if (this.paused) return;
    e.preventDefault();
    const dir = e.deltaY > 0 ? 1 / ZOOM_WHEEL_STEP : ZOOM_WHEEL_STEP;
    this.setZoom(this.zoom * dir);
  };

  private layoutZoomHud(): void {
    const pct = Math.round(this.zoom * 100);
    this.zoomHud.text = `缩放 ${pct}%  ·  滚轮/+-  ·  F 全景  ·  0 复位`;
    this.zoomHud.position.set(12, this.viewHeight - 28);
  }

  destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.off('pointertap', this.onPointerTap);
    window.removeEventListener('wheel', this.onWheel);
    this.keyboard.unbind();
    super.destroy(options);
  }

  update(deltaMS: number): void {
    const escDown = this.keyboard.isDown('Escape');
    if (escDown && !this.escWasDown) {
      this.setPaused(!this.paused);
    }
    this.escWasDown = escDown;

    // 缩放快捷键在暂停时也可用（方便看全景）
    this.handleZoomKeys(deltaMS / 1000);

    if (this.paused) {
      // 暂停时角色回正、不处理移动；炸弹也冻结
      this.archer.update(deltaMS, false);
      return;
    }

    const dt = deltaMS / 1000;
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
      this.archer.setFacingFromMoveX(x);
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

    if (moved) {
      this.applyPlayerSolid(fromX, fromY);
      this.updateCameraAndPlayerBounds();
      this.applyCamera();
      this.cullTrees();
    }

    this.syncWorldActors();
    this.archer.update(deltaMS, moving && !airborne && knockSpeed < 80);
    this.healthBar.update(deltaMS);
    this.syncHealthBar();

    for (const spider of this.spiders) {
      if (!spider.isAlive) continue;
      const sFromX = spider.worldX;
      const sFromY = spider.worldY;
      const result = spider.update(deltaMS, this.worldX, this.worldY);
      if (result.moved) {
        const solid = WorldMap.resolveSolid(
          sFromX,
          sFromY,
          spider.worldX,
          spider.worldY,
          SPIDER_BODY_R,
        );
        spider.worldX = solid.x;
        spider.worldY = solid.y;
      }
      if (result.attackHit) {
        this.applySpiderAttack(result.attackHit);
      }
    }

    this.updateBombs(deltaMS);
    this.sortDepth();
  }

  /** 蜘蛛扑咬命中：扣血 + 轻击退 + 姿态反馈 */
  private applySpiderAttack(hit: {
    damage: number;
    dirX: number;
    dirY: number;
    knockImpulse: number;
  }): void {
    this.healthBar.applyDelta(-Math.abs(hit.damage));
    applyKnockImpulse(
      this.knock,
      hit.dirX * hit.knockImpulse,
      hit.dirY * hit.knockImpulse,
    );
    // 轻伤姿态（不转圈）
    this.archer.playBlastKnock(0.45, hit.dirX, 0);
    this.updateCameraAndPlayerBounds();
    this.applyCamera();
    this.syncWorldActors();
    this.syncHealthBar();
    this.sortDepth();
  }

  resize(width: number, height: number): void {
    this.viewWidth = width;
    this.viewHeight = height;
    this.hitArea = new Rectangle(0, 0, width, height);
    this.zoom = Math.min(ZOOM_MAX, Math.max(this.getMinZoom(), this.zoom));
    this.updateCameraAndPlayerBounds();
    this.applyCamera();
    this.syncWorldActors();
    this.cullTrees();
    this.sortDepth();
    this.syncHealthBar();
    this.nightOverlay?.layout(width, height);
    this.layoutPauseMenu();
    this.layoutZoomHud();
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
    this.setZoom(this.zoom * (zoomIn ? factor : 1 / factor));
  }

  private readonly onPointerTap = (e: {
    global: { x: number; y: number };
  }): void => {
    if (this.paused) return;
    this.throwBombAtScreen(e.global.x, e.global.y);
  };

  /**
   * 以角色屏幕位置为起点抛物线扔炸弹。
   * 射程内落点 = 点击位置；超出则钳到最远方向。
   */
  private throwBombAtScreen(screenX: number, screenY: number): void {
    const z = this.zoom;
    const playerSx = this.viewWidth / 2 + (this.worldX - this.camX) * z;
    const playerSy = this.viewHeight / 2 + (this.worldY - this.camY) * z;
    const screenDx = screenX - playerSx;
    const screenDy = screenY - playerSy;
    const screenDist = Math.hypot(screenDx, screenDy);

    if (screenDist < THROW_MIN_DIST) return;

    // 屏幕位移 → 世界位移
    let landDx = screenDx / z;
    let landDy = screenDy / z;
    const worldDist = Math.hypot(landDx, landDy);
    if (worldDist > BOMB_MAX_RANGE) {
      const s = BOMB_MAX_RANGE / worldDist;
      landDx *= s;
      landDy *= s;
    }

    const startX = this.worldX;
    const startY = this.worldY;
    const endX = this.worldX + landDx;
    const endY = this.worldY + landDy;

    // 朝扔出方向转身，并后仰一下
    this.archer.setFacingFromMoveX(endX - startX);
    this.archer.playThrowRecoil();

    const bomb = new BombProjectile(startX, startY, endX, endY, {
      stability: PLAYER_BOMB_STABILITY,
    });
    this.sortLayer.addChild(bomb);
    this.bombs.push(bomb);
    bomb.syncToWorld();
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
   * 场景只负责把炸弹算出的命中结果接到目标上。
   * 半径 / 伤害 / 击飞速度等全部读 bomb.blast。
   */
  private applyBombBlast(bomb: BombProjectile): void {
    const face: 1 | -1 = this.archer.scale.x >= 0 ? 1 : -1;
    const playerHit = bomb.evaluateHit(this.worldX, this.worldY, face);
    if (playerHit) {
      this.healthBar.applyDelta(-playerHit.damage);
      applyKnockImpulse(
        this.knock,
        playerHit.knockVelX,
        playerHit.knockVelY,
      );
      this.archer.playBlastKnock(
        playerHit.poseStrength,
        playerHit.dirX,
        playerHit.airSpinTurns,
      );
    }

    let anySpider = false;
    for (let i = this.spiders.length - 1; i >= 0; i--) {
      const spider = this.spiders[i]!;
      if (!spider.isAlive) continue;

      const hit = bomb.evaluateHit(
        spider.worldX,
        spider.worldY,
        spider.worldX >= bomb.groundX ? 1 : -1,
      );
      if (!hit) continue;

      anySpider = true;
      const alive = spider.applyBlastHit(hit, SPIDER_KNOCK_SCALE);
      if (!alive) {
        this.sortLayer.removeChild(spider);
        spider.destroy({ children: true });
        this.spiders.splice(i, 1);
      }
    }
    if (anySpider) {
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

  /** 血条：世界坐标 → 屏幕坐标，钉在角色头顶 */
  private syncHealthBar(): void {
    const z = this.zoom;
    const sx = this.viewWidth / 2 + (this.worldX - this.camX) * z;
    const sy =
      this.viewHeight / 2 +
      (this.worldY - this.camY) * z -
      this.knock.height * z;
    this.healthBar.position.set(sx, sy - HP_BAR_OFFSET_Y * z);
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
