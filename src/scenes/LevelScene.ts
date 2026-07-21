import { Container, Graphics, Rectangle, Text } from 'pixi.js';
import {
  BLAST_KNOCK_SPEED,
  BLAST_MAX_DAMAGE,
  BLAST_RADIUS,
  BombProjectile,
  BOMB_MAX_RANGE,
  loadBombTextures,
} from '../entities/BombProjectile';
import { FrostArcher } from '../entities/FrostArcher';
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
/** 击退速度指数衰减（越小滑得越远） */
const KNOCK_DRAG = 2.6;
/** 击退很强时削弱 WASD 控制 */
const KNOCK_CONTROL_SOFTEN = 220;

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
  /** 被炸飞的世界速度（像素/秒） */
  private knockVelX = 0;
  private knockVelY = 0;
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
    await Promise.all([this.archer.load(), loadBombTextures()]);
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

    // 被炸飞：先施加击退位移
    const knockSpeed = Math.hypot(this.knockVelX, this.knockVelY);
    if (knockSpeed > 4) {
      this.worldX += this.knockVelX * dt;
      this.worldY += this.knockVelY * dt;
      const damp = Math.exp(-KNOCK_DRAG * dt);
      this.knockVelX *= damp;
      this.knockVelY *= damp;
      if (Math.hypot(this.knockVelX, this.knockVelY) < 12) {
        this.knockVelX = 0;
        this.knockVelY = 0;
      }
      moved = true;
    }

    // WASD：击退中控制变钝
    const moving = x !== 0 || y !== 0;
    if (moving) {
      this.archer.setFacingFromMoveX(x);
      const control =
        knockSpeed > KNOCK_CONTROL_SOFTEN
          ? Math.max(0.2, 1 - knockSpeed / (KNOCK_CONTROL_SOFTEN * 3))
          : 1;
      this.worldX += x * MOVE_SPEED * control * dt;
      this.worldY += y * MOVE_SPEED * control * dt;
      moved = true;
    }

    if (moved) this.redrawWorld(false);

    this.archer.update(deltaMS, moving && knockSpeed < 80);
    this.healthBar.update(deltaMS);
    this.syncHealthBar();
    this.updateBombs(deltaMS);
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
      const wasFlying = bomb.getPhase() === 'flying';
      const phase = bomb.update(deltaMS);
      bomb.syncToScreen(this.worldX, this.worldY, cx, cy);

      // 落地瞬间结算爆炸伤害 / 击退（可炸到自己）
      if (wasFlying && phase === 'exploding') {
        this.applyExplosionAt(bomb.groundX, bomb.groundY);
      }

      if (phase === 'done') {
        this.projectileLayer.removeChild(bomb);
        bomb.destroy({ children: true });
        this.bombs.splice(i, 1);
      }
    }
  }

  /**
   * 爆炸结算：范围内扣血；方向为远离爆心，把自己崩飞。
   */
  private applyExplosionAt(blastX: number, blastY: number): void {
    const dx = this.worldX - blastX;
    const dy = this.worldY - blastY;
    const dist = Math.hypot(dx, dy);

    if (dist > BLAST_RADIUS) return;

    // 边缘仍有一定伤害；中心最强
    const falloff = 1 - dist / BLAST_RADIUS;
    const strength = falloff * falloff; // 靠近中心更猛
    const damage = Math.max(6, Math.round(BLAST_MAX_DAMAGE * (0.35 + 0.65 * strength)));
    this.healthBar.applyDelta(-damage);

    // 击退方向：远离爆心；脚踩爆心时用面朝反方向顶开
    let nx: number;
    let ny: number;
    if (dist < 6) {
      // 几乎贴脸：朝当前面朝的反方向崩（scale.x 正 = 朝右）
      const face = this.archer.scale.x >= 0 ? 1 : -1;
      nx = -face;
      ny = -0.35;
      const inv = 1 / Math.hypot(nx, ny);
      nx *= inv;
      ny *= inv;
    } else {
      nx = dx / dist;
      ny = dy / dist;
    }

    const impulse = BLAST_KNOCK_SPEED * (0.45 + 0.55 * strength);
    this.knockVelX += nx * impulse;
    this.knockVelY += ny * impulse;

    this.archer.playBlastKnock(0.55 + 0.7 * strength, nx);
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
    this.archer.position.set(this.viewWidth / 2, this.viewHeight / 2);
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
