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
import { CartoonGrass } from '../world/CartoonGrass';
import { getThemeBackground, NightOverlay } from '../world/NightOverlay';
import type { GameScene, LevelTheme } from './types';

const MOVE_SPEED = 220;
/** 点太近不扔 */
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

/**
 * 黑夜关卡场地半宽/半高（世界像素，原点在玩家出生点）。
 * 四角蜘蛛放在 (±halfW, ±halfH)。
 */
const NIGHT_ARENA_HALF_W = 420;
const NIGHT_ARENA_HALF_H = 300;
const SPIDER_SCALE = 0.1;

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
 * 可玩关卡：白天 / 黑夜草地，WASD 移动，点击抛物线扔炸弹，Esc 暂停。
 * 黑夜 = 白天草地 + NightOverlay 叠加，不单独换色盘。
 */
export class LevelScene extends Container implements GameScene {
  /** 世界层：草地 + 可选夜景叠加（角色在此层之上） */
  private readonly worldLayer: Container;
  private readonly grass: CartoonGrass;
  private readonly nightOverlay: NightOverlay | null;
  private readonly archer: FrostArcher;
  private readonly healthBar: HealthBar;
  /** 怪物层（草地/夜色之上，角色之下） */
  private readonly entityLayer: Container;
  private readonly spiders: Spider[] = [];
  /** 飞行炸弹 / 爆炸特效层（在角色之上，暂停层之下） */
  private readonly projectileLayer: Container;
  private readonly bombs: BombProjectile[] = [];
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
  private worldX = 0;
  private worldY = 0;
  /** 被炸飞：地面平面速度 + 高度抛物线 */
  private readonly knock: KnockArcState = createKnockArcState();
  private paused = false;
  private escWasDown = false;

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

    this.worldLayer = new Container();
    this.worldLayer.label = 'WorldLayer';
    this.addChild(this.worldLayer);

    // 两关共用同一套白天草地绘制
    this.grass = new CartoonGrass(options.theme === 'night' ? 99 : 42);
    this.worldLayer.addChild(this.grass);

    this.nightOverlay =
      options.theme === 'night' ? new NightOverlay() : null;
    if (this.nightOverlay) {
      this.worldLayer.addChild(this.nightOverlay);
      this.nightOverlay.layout(width, height);
    }

    // 实体层：蜘蛛等世界单位（夜景之上、玩家之下）
    this.entityLayer = new Container();
    this.entityLayer.label = 'EntityLayer';
    this.entityLayer.eventMode = 'none';
    this.addChild(this.entityLayer);

    if (options.theme === 'night') {
      this.spawnCornerSpiders();
    }

    this.archer = new FrostArcher(0.07);
    this.addChild(this.archer);

    // 血条独立挂载，不随角色左右翻转
    this.healthBar = new HealthBar({ maxHp: PLAYER_MAX_HP, width: 50, height: 5 });
    this.healthBar.setHealth(PLAYER_MAX_HP);
    this.addChild(this.healthBar);

    this.projectileLayer = new Container();
    this.projectileLayer.label = 'ProjectileLayer';
    this.projectileLayer.eventMode = 'none';
    this.addChild(this.projectileLayer);

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

    this.centerArcher();
    this.syncHealthBar();
    this.layoutPauseMenu();
    this.redrawWorld(true);
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

    const loads: Promise<void>[] = [this.archer.load(), loadBombTextures()];
    if (this.spiders.length > 0) {
      loads.push(loadSpiderTexture());
    }
    await Promise.all(loads);

    await Promise.all(this.spiders.map((s) => s.load()));
    this.syncAllSpidersToScreen();
  }

  /** 黑夜关：场地四角各一只蜘蛛，出生时朝向中心 */
  private spawnCornerSpiders(): void {
    const hw = NIGHT_ARENA_HALF_W;
    const hh = NIGHT_ARENA_HALF_H;
    const corners: Array<[number, number]> = [
      [-hw, -hh],
      [hw, -hh],
      [-hw, hh],
      [hw, hh],
    ];

    for (const [wx, wy] of corners) {
      const spider = new Spider(wx, wy, { scale: SPIDER_SCALE });
      spider.faceToward(0, 0);
      this.entityLayer.addChild(spider);
      this.spiders.push(spider);
    }
  }

  private syncAllSpidersToScreen(): void {
    const cx = this.viewWidth / 2;
    const cy = this.viewHeight / 2;
    for (const spider of this.spiders) {
      spider.syncToScreen(this.worldX, this.worldY, cx, cy);
    }
  }

  destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.off('pointertap', this.onPointerTap);
    this.keyboard.unbind();
    super.destroy(options);
  }

  update(deltaMS: number): void {
    const escDown = this.keyboard.isDown('Escape');
    if (escDown && !this.escWasDown) {
      this.setPaused(!this.paused);
    }
    this.escWasDown = escDown;

    if (this.paused) {
      // 暂停时角色回正、不处理移动；炸弹也冻结
      this.archer.update(deltaMS, false);
      return;
    }

    const dt = deltaMS / 1000;
    const { x, y } = this.keyboard.getMoveAxis();
    let moved = false;

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

    // 玩家固定屏幕中心，高度用竖直抬升表现
    this.centerArcher();

    if (moved) {
      this.redrawWorld(false);
      this.syncAllSpidersToScreen();
    }

    this.archer.update(deltaMS, moving && !airborne && knockSpeed < 80);
    this.healthBar.update(deltaMS);
    this.syncHealthBar();

    let spidersMoved = false;
    for (const spider of this.spiders) {
      if (!spider.isAlive) continue;
      const result = spider.update(deltaMS, this.worldX, this.worldY);
      if (result.moved) spidersMoved = true;
      if (result.attackHit) {
        this.applySpiderAttack(result.attackHit);
      }
    }
    if (spidersMoved) this.syncAllSpidersToScreen();

    this.updateBombs(deltaMS);
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
    this.centerArcher();
    this.syncHealthBar();
  }

  resize(width: number, height: number): void {
    this.viewWidth = width;
    this.viewHeight = height;
    this.hitArea = new Rectangle(0, 0, width, height);
    this.centerArcher();
    this.syncHealthBar();
    this.nightOverlay?.layout(width, height);
    this.layoutPauseMenu();
    this.redrawWorld(true);
    this.syncAllBombsToScreen();
    this.syncAllSpidersToScreen();
  }

  private readonly onPointerTap = (e: {
    global: { x: number; y: number };
  }): void => {
    if (this.paused) return;
    this.throwBombAtScreen(e.global.x, e.global.y);
  };

  /**
   * 以角色（屏幕中心 / 世界原点）为起点抛物线扔炸弹。
   * 射程内落点 = 点击位置；超出则钳到最远方向。
   */
  private throwBombAtScreen(screenX: number, screenY: number): void {
    const cx = this.viewWidth / 2;
    const cy = this.viewHeight / 2;
    const dx = screenX - cx;
    const dy = screenY - cy;
    const dist = Math.hypot(dx, dy);

    if (dist < THROW_MIN_DIST) return;

    let landDx = dx;
    let landDy = dy;
    if (dist > BOMB_MAX_RANGE) {
      const s = BOMB_MAX_RANGE / dist;
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
    this.projectileLayer.addChild(bomb);
    this.bombs.push(bomb);
    bomb.syncToScreen(this.worldX, this.worldY, cx, cy);
  }

  private updateBombs(deltaMS: number): void {
    const cx = this.viewWidth / 2;
    const cy = this.viewHeight / 2;

    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const bomb = this.bombs[i]!;
      const phase = bomb.update(deltaMS);
      bomb.syncToScreen(this.worldX, this.worldY, cx, cy);

      // 落地瞬间：用该炸弹自身的 blast 属性结算伤害 / 击飞
      if (bomb.consumeBlastResolve()) {
        this.applyBombBlast(bomb);
      }

      if (phase === 'done') {
        this.projectileLayer.removeChild(bomb);
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
        this.entityLayer.removeChild(spider);
        spider.destroy({ children: true });
        this.spiders.splice(i, 1);
      }
    }
    if (anySpider) this.syncAllSpidersToScreen();
  }

  private syncAllBombsToScreen(): void {
    const cx = this.viewWidth / 2;
    const cy = this.viewHeight / 2;
    for (const bomb of this.bombs) {
      bomb.syncToScreen(this.worldX, this.worldY, cx, cy);
    }
  }

  private setPaused(value: boolean): void {
    this.paused = value;
    this.pauseLayer.visible = value;
    // 清掉按键，避免继续后突然冲刺
    this.keyboard.clear();
  }

  private centerArcher(): void {
    // 击飞高度：屏幕向上抬（世界 Y 是地面平面，高度单独叠）
    this.archer.position.set(
      this.viewWidth / 2,
      this.viewHeight / 2 - this.knock.height,
    );
  }

  /** 血条钉在角色头顶（脚底原点向上） */
  private syncHealthBar(): void {
    this.healthBar.position.set(
      this.archer.x,
      this.archer.y - HP_BAR_OFFSET_Y,
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

  private redrawWorld(force: boolean): void {
    this.grass.draw(
      this.viewWidth,
      this.viewHeight,
      this.worldX,
      this.worldY,
      force,
    );
  }
}
