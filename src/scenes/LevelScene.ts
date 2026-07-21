import { Container, Graphics, Rectangle, Text } from 'pixi.js';
import {
  BombProjectile,
  BOMB_MAX_RANGE,
  loadBombTextures,
} from '../entities/BombProjectile';
import { FrostArcher } from '../entities/FrostArcher';
import { Keyboard } from '../input/Keyboard';
import { CartoonGrass } from '../world/CartoonGrass';
import { getThemeBackground, NightOverlay } from '../world/NightOverlay';
import type { GameScene, LevelTheme } from './types';

const MOVE_SPEED = 220;
/** 瞄准圈半径（屏幕像素） */
const AIM_RADIUS = 28;
/** 太近不显示瞄准 / 不扔 */
const AIM_MIN_DIST = 12;

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
  /** 飞行炸弹 / 爆炸特效层（在角色之上，暂停层之下） */
  private readonly projectileLayer: Container;
  private readonly bombs: BombProjectile[] = [];
  /** 实际落点 / 爆炸位置瞄准圈 */
  private readonly aimReticle: Graphics;
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
  private paused = false;
  private escWasDown = false;
  /** 指针屏幕坐标（用于瞄准圈） */
  private pointerX: number;
  private pointerY: number;

  constructor(width: number, height: number, options: LevelSceneOptions) {
    super();
    this.label = `LevelScene:${options.theme}`;
    this.theme = options.theme;
    this.onBack = options.onBack;
    this.onBackground = options.onBackground;
    this.viewWidth = width;
    this.viewHeight = height;
    this.pointerX = width / 2;
    this.pointerY = height / 2;

    // 全屏可点：点击落点扔炸弹；移动更新瞄准圈
    this.eventMode = 'static';
    this.cursor = 'crosshair';
    this.hitArea = new Rectangle(0, 0, width, height);
    this.on('pointertap', this.onPointerTap);
    this.on('pointermove', this.onPointerMove);

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

    // 瞄准圈在草地之上、角色之下，表示地面落点
    this.aimReticle = new Graphics();
    this.aimReticle.label = 'AimReticle';
    this.aimReticle.eventMode = 'none';
    this.aimReticle.visible = false;
    this.drawAimReticle();
    this.addChild(this.aimReticle);

    this.archer = new FrostArcher(0.07);
    this.addChild(this.archer);

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
    await Promise.all([this.archer.load(), loadBombTextures()]);
  }

  destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.off('pointertap', this.onPointerTap);
    this.off('pointermove', this.onPointerMove);
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
      this.aimReticle.visible = false;
      return;
    }

    const { x, y } = this.keyboard.getMoveAxis();
    const moving = x !== 0 || y !== 0;

    if (moving) {
      this.archer.setFacingFromMoveX(x);
      const dt = deltaMS / 1000;
      this.worldX += x * MOVE_SPEED * dt;
      this.worldY += y * MOVE_SPEED * dt;
      this.redrawWorld(false);
    }

    this.archer.update(deltaMS, moving);
    this.updateBombs(deltaMS);
    this.updateAimReticle();
  }

  resize(width: number, height: number): void {
    this.viewWidth = width;
    this.viewHeight = height;
    this.hitArea = new Rectangle(0, 0, width, height);
    this.centerArcher();
    this.nightOverlay?.layout(width, height);
    this.layoutPauseMenu();
    this.redrawWorld(true);
    this.syncAllBombsToScreen();
    this.updateAimReticle();
  }

  private readonly onPointerTap = (e: {
    global: { x: number; y: number };
  }): void => {
    if (this.paused) return;
    this.pointerX = e.global.x;
    this.pointerY = e.global.y;
    this.updateAimReticle();
    this.throwBombAtScreen(e.global.x, e.global.y);
  };

  private readonly onPointerMove = (e: {
    global: { x: number; y: number };
  }): void => {
    this.pointerX = e.global.x;
    this.pointerY = e.global.y;
    if (!this.paused) this.updateAimReticle();
  };

  /**
   * 屏幕指针 → 实际落点（世界坐标 + 屏幕坐标）。
   * 超出最大射程时钳到最远方向；过近返回 null。
   */
  private resolveLanding(
    screenX: number,
    screenY: number,
  ): {
    endX: number;
    endY: number;
    landScreenX: number;
    landScreenY: number;
  } | null {
    const cx = this.viewWidth / 2;
    const cy = this.viewHeight / 2;
    const dx = screenX - cx;
    const dy = screenY - cy;
    const dist = Math.hypot(dx, dy);

    if (dist < AIM_MIN_DIST) return null;

    let landDx = dx;
    let landDy = dy;
    if (dist > BOMB_MAX_RANGE) {
      const s = BOMB_MAX_RANGE / dist;
      landDx *= s;
      landDy *= s;
    }

    return {
      endX: this.worldX + landDx,
      endY: this.worldY + landDy,
      landScreenX: cx + landDx,
      landScreenY: cy + landDy,
    };
  }

  private drawAimReticle(): void {
    const g = this.aimReticle;
    g.clear();
    // 细线红圈，标落点
    g.circle(0, 0, AIM_RADIUS).stroke({
      width: 1.5,
      color: 0xff3333,
      alpha: 0.7,
    });
  }

  /** 瞄准圈跟实际爆炸落点一致（含最大射程钳制） */
  private updateAimReticle(): void {
    if (this.paused) {
      this.aimReticle.visible = false;
      return;
    }

    const land = this.resolveLanding(this.pointerX, this.pointerY);
    if (!land) {
      this.aimReticle.visible = false;
      return;
    }

    this.aimReticle.visible = true;
    this.aimReticle.position.set(land.landScreenX, land.landScreenY);
  }

  /**
   * 以角色（屏幕中心 / 世界原点）为起点抛物线扔炸弹。
   * 落点与瞄准圈一致：射程内点哪落哪，超出钳到最远。
   */
  private throwBombAtScreen(screenX: number, screenY: number): void {
    const land = this.resolveLanding(screenX, screenY);
    if (!land) return;

    const cx = this.viewWidth / 2;
    const cy = this.viewHeight / 2;
    const startX = this.worldX;
    const startY = this.worldY;
    const { endX, endY } = land;

    // 朝扔出方向转身，并后仰一下
    this.archer.setFacingFromMoveX(endX - startX);
    this.archer.playThrowRecoil();

    const bomb = new BombProjectile(startX, startY, endX, endY);
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

      if (phase === 'done') {
        this.projectileLayer.removeChild(bomb);
        bomb.destroy({ children: true });
        this.bombs.splice(i, 1);
      }
    }
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
    if (value) {
      this.aimReticle.visible = false;
    } else {
      this.updateAimReticle();
    }
  }

  private centerArcher(): void {
    this.archer.position.set(this.viewWidth / 2, this.viewHeight / 2);
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
