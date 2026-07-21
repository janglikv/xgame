import { Assets, Container, Sprite, Texture } from 'pixi.js';

const BOMB_URL = '/assets/bomb/bomb.png';
const EXPLOSION_URL = '/assets/bomb/explosion.png';

/** 最远投掷距离（世界像素） */
export const BOMB_MAX_RANGE = 280;
/** 爆炸伤害 / 击退半径（世界像素） */
export const BLAST_RADIUS = 96;
/** 中心最大伤害 */
export const BLAST_MAX_DAMAGE = 28;
/** 中心最大击退初速度（像素/秒） */
export const BLAST_KNOCK_SPEED = 920;

const ARC_PEAK = 100;
/** 出手点相对脚底抬高（屏幕像素），略高于腰部 */
const THROW_ORIGIN_HEIGHT = 32;
const MIN_FLIGHT = 0.32;
const MAX_FLIGHT = 0.65;
const EXPLOSION_LIFE = 0.42;
/** 出手时最小、落地时最大 */
const BOMB_SCALE_START = 0.028;
const BOMB_SCALE_END = 0.095;
const EXPLOSION_SCALE = 0.14;

export type BombPhase = 'flying' | 'exploding' | 'done';

let sharedBomb: Texture | null = null;
let sharedExplosion: Texture | null = null;

export async function loadBombTextures(): Promise<void> {
  if (sharedBomb && sharedExplosion) return;
  const [bomb, explosion] = await Promise.all([
    Assets.load(BOMB_URL),
    Assets.load(EXPLOSION_URL),
  ]);
  sharedBomb = bomb;
  sharedExplosion = explosion;
}

/**
 * 抛物线投出的炸弹：沿地面插值飞向落点，视觉上抬起再落下，落地后播爆炸。
 * 位置用世界坐标存储，由外部按摄像机同步到屏幕。
 */
export class BombProjectile extends Container {
  private readonly bomb: Sprite;
  private readonly explosion: Sprite;
  private readonly startX: number;
  private readonly startY: number;
  private readonly endX: number;
  private readonly endY: number;
  private readonly flightDuration: number;

  private phase: BombPhase = 'flying';
  private elapsed = 0;
  private explodeElapsed = 0;

  /** 地面投影世界坐标 */
  groundX: number;
  groundY: number;
  /** 抛物线抬升高度（屏幕向上为正，勿用 height 以免与 Container 冲突） */
  arcHeight = 0;

  constructor(startX: number, startY: number, endX: number, endY: number) {
    super();
    this.label = 'BombProjectile';

    if (!sharedBomb || !sharedExplosion) {
      throw new Error('Bomb textures not loaded — call loadBombTextures() first');
    }

    this.startX = startX;
    this.startY = startY;
    this.endX = endX;
    this.endY = endY;
    this.groundX = startX;
    this.groundY = startY;
    this.arcHeight = THROW_ORIGIN_HEIGHT;

    const dist = Math.hypot(endX - startX, endY - startY);
    const t = Math.min(1, dist / BOMB_MAX_RANGE);
    this.flightDuration = MIN_FLIGHT + (MAX_FLIGHT - MIN_FLIGHT) * t;

    this.bomb = new Sprite(sharedBomb);
    this.bomb.anchor.set(0.5, 0.7);
    this.bomb.scale.set(BOMB_SCALE_START);
    this.bomb.label = 'BombSprite';
    this.addChild(this.bomb);

    this.explosion = new Sprite(sharedExplosion);
    this.explosion.anchor.set(0.5, 0.55);
    this.explosion.scale.set(0);
    this.explosion.visible = false;
    this.explosion.label = 'ExplosionSprite';
    this.addChild(this.explosion);
  }

  getPhase(): BombPhase {
    return this.phase;
  }

  /**
   * @returns 当前阶段；外部在 `done` 时销毁实例
   */
  update(deltaMS: number): BombPhase {
    const dt = deltaMS / 1000;

    if (this.phase === 'flying') {
      this.elapsed += dt;
      const raw = this.elapsed / this.flightDuration;
      const u = Math.min(1, raw);
      this.sampleFlight(u);

      // 飞行中轻微自旋
      this.bomb.rotation += dt * 8;

      if (u >= 1) {
        this.beginExplosion();
      }
    } else if (this.phase === 'exploding') {
      this.explodeElapsed += dt;
      const p = Math.min(1, this.explodeElapsed / EXPLOSION_LIFE);
      // 先快速弹开，再淡出
      const pop = p < 0.25 ? p / 0.25 : 1;
      const fade = p < 0.45 ? 1 : 1 - (p - 0.45) / 0.55;
      const scale = EXPLOSION_SCALE * (0.55 + 0.55 * pop);
      this.explosion.scale.set(scale);
      this.explosion.alpha = fade;
      // 轻微上浮
      this.arcHeight = 12 * (1 - p);

      if (p >= 1) {
        this.phase = 'done';
      }
    }

    return this.phase;
  }

  /**
   * 按当前摄像机把世界坐标写到屏幕位置。
   * 玩家固定在屏幕中心，摄像机原点 = 玩家世界坐标。
   */
  syncToScreen(
    cameraWorldX: number,
    cameraWorldY: number,
    screenCenterX: number,
    screenCenterY: number,
  ): void {
    this.position.set(
      this.groundX - cameraWorldX + screenCenterX,
      this.groundY - cameraWorldY + screenCenterY - this.arcHeight,
    );
  }

  private sampleFlight(u: number): void {
    this.groundX = this.startX + (this.endX - this.startX) * u;
    this.groundY = this.startY + (this.endY - this.startY) * u;
    // 从胸口高度落到地面，中间再叠抛物线抬升
    const fromHand = THROW_ORIGIN_HEIGHT * (1 - u);
    const arc = 4 * ARC_PEAK * u * (1 - u);
    this.arcHeight = fromHand + arc;
    // 飞行全程由小到大（ease-out，落地时接近最大）
    const grow = 1 - (1 - u) * (1 - u);
    const s = BOMB_SCALE_START + (BOMB_SCALE_END - BOMB_SCALE_START) * grow;
    this.bomb.scale.set(s);
  }

  private beginExplosion(): void {
    this.phase = 'exploding';
    this.explodeElapsed = 0;
    this.groundX = this.endX;
    this.groundY = this.endY;
    this.arcHeight = 8;
    this.bomb.visible = false;
    this.explosion.visible = true;
    this.explosion.alpha = 1;
    this.explosion.scale.set(EXPLOSION_SCALE * 0.55);
  }
}
