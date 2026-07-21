import { Assets, Container, Sprite, Texture } from 'pixi.js';

const BOMB_URL = '/assets/bomb/bomb.png';
const EXPLOSION_URL = '/assets/bomb/explosion.png';

/** 最远投掷距离（世界像素） */
export const BOMB_MAX_RANGE = 280;

/**
 * 炸弹爆炸属性：伤害 + 击飞都由炸弹持有，方便后续调参 / 做不同炸弹类型。
 * 距离衰减：strength = (1 - dist/radius)²，中心 1、边缘 0。
 */
export type BombBlastStats = {
  /** 伤害 / 击退半径（世界像素） */
  radius: number;
  /** 中心最大伤害 */
  maxDamage: number;
  /** 边缘保底伤害 */
  minDamage: number;
  /**
   * 伤害混合：damage = maxDamage * (damageFloor + (1-damageFloor) * strength)
   * 再 clamp 到 minDamage。
   */
  damageFloor: number;
  /** 中心最大击飞初速度（像素/秒） */
  knockSpeed: number;
  /**
   * 击飞混合：impulse = knockSpeed * (knockFloor + (1-knockFloor) * strength)
   */
  knockFloor: number;
  /** 姿态反馈基准（0~1+），最终 pose = poseBase + poseGain * strength */
  poseBase: number;
  poseGain: number;
};

/** 满尺寸时的基准爆炸配置（再乘 sizeScale） */
export const DEFAULT_BOMB_BLAST: Readonly<BombBlastStats> = {
  radius: 96,
  maxDamage: 28,
  minDamage: 6,
  damageFloor: 0.35,
  knockSpeed: 920,
  knockFloor: 0.45,
  poseBase: 0.55,
  poseGain: 0.7,
};

/**
 * 默认稳定性 0~1。
 * 1 = 始终满尺寸；越低越容易随机扔出缩小版炸弹。
 */
export const DEFAULT_BOMB_STABILITY = 0.4;

/**
 * 稳定性为 0 时，随机尺寸下限（相对满尺寸）。
 * 再低会几乎看不见且数值过废。
 */
export const BOMB_MIN_SIZE_SCALE = 0.35;

/**
 * 尺寸 ≥ 此值视为“大弹”：额外击飞加成 + 被炸目标空中旋转两圈。
 * （相对满尺寸 sizeScale）
 */
export const BOMB_SPIN_SIZE_THRESHOLD = 0.88;

/** 大弹在阈值处起算的额外击飞倍率上限（size=1 时再乘这么多） */
export const BOMB_LARGE_KNOCK_BONUS = 0.4;

/** 大弹空中旋转圈数 */
export const BOMB_AIR_SPIN_TURNS = 2;

/** 对某个目标的一次爆炸结算结果（由炸弹算出，场景只负责应用） */
export type BlastHit = {
  /** 0~1，越近越大（已平方衰减） */
  strength: number;
  damage: number;
  /** 击飞初速度向量（世界像素/秒，远离爆心） */
  knockVelX: number;
  knockVelY: number;
  /** 单位方向（远离爆心） */
  dirX: number;
  dirY: number;
  /** 建议姿态强度 */
  poseStrength: number;
  /**
   * 空中旋转圈数；大弹为 2，普通弹为 0。
   * 目标侧负责播放旋转动画。
   */
  airSpinTurns: number;
};

// 兼容旧导出名
export const BLAST_RADIUS = DEFAULT_BOMB_BLAST.radius;
export const BLAST_MAX_DAMAGE = DEFAULT_BOMB_BLAST.maxDamage;
export const BLAST_KNOCK_SPEED = DEFAULT_BOMB_BLAST.knockSpeed;

const ARC_PEAK = 100;
const THROW_ORIGIN_HEIGHT = 32;
const MIN_FLIGHT = 0.32;
const MAX_FLIGHT = 0.65;
const EXPLOSION_LIFE = 0.42;
/** 满尺寸视觉缩放 */
const BOMB_SCALE_START = 0.028;
const BOMB_SCALE_END = 0.095;
const EXPLOSION_SCALE = 0.14;

export type BombPhase = 'flying' | 'exploding' | 'done';

export type BombProjectileOptions = {
  /** 覆盖满尺寸基准爆炸属性（再被 sizeScale 缩放） */
  blast?: Partial<BombBlastStats>;
  /**
   * 稳定性 0~1。
   * 越低，扔出时尺寸越可能随机缩小；缩小后范围 / 伤害 / 击飞同步变弱。
   */
  stability?: number;
  /**
   * 固定尺寸倍率（调试用）。不传则按 stability 随机 roll。
   */
  sizeScale?: number;
};

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

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * 按稳定性 roll 出本颗炸弹尺寸 0~1（相对满尺寸）。
 * - stability = 1 → 恒为 1
 * - stability = 0 → 均匀落在 [BOMB_MIN_SIZE_SCALE, 1]
 * - 中间：下限随稳定性抬高，仍可随机偏小
 */
export function rollBombSizeScale(stability: number, rng: () => number = Math.random): number {
  const s = clamp01(stability);
  const minSize = BOMB_MIN_SIZE_SCALE + (1 - BOMB_MIN_SIZE_SCALE) * s;
  // minSize..1 上均匀；s=1 时 minSize=1 → 恒 1
  return minSize + (1 - minSize) * rng();
}

/** 满尺寸 blast 按尺寸倍率缩放（范围 / 伤害 / 击飞） */
export function scaleBlastStats(
  base: BombBlastStats,
  sizeScale: number,
): BombBlastStats {
  const t = Math.max(0.05, sizeScale);
  return {
    radius: Math.max(20, base.radius * t),
    maxDamage: Math.max(1, Math.round(base.maxDamage * t)),
    minDamage: Math.max(1, Math.round(base.minDamage * t)),
    damageFloor: base.damageFloor,
    knockSpeed: base.knockSpeed * t,
    knockFloor: base.knockFloor,
    poseBase: base.poseBase * (0.65 + 0.35 * t),
    poseGain: base.poseGain * (0.65 + 0.35 * t),
  };
}

/**
 * 抛物线投出的炸弹：沿地面插值飞向落点，视觉上抬起再落下，落地后播爆炸。
 * 稳定性 → 随机尺寸；尺寸越小，视觉与爆炸范围 / 威力 / 击飞越弱。
 */
export class BombProjectile extends Container {
  private readonly bomb: Sprite;
  private readonly explosion: Sprite;
  private readonly startX: number;
  private readonly startY: number;
  private readonly endX: number;
  private readonly endY: number;
  private readonly flightDuration: number;
  private readonly bombScaleStart: number;
  private readonly bombScaleEnd: number;
  private readonly explosionScale: number;

  /** 本颗炸弹的爆炸 / 击飞配置（已含尺寸缩放） */
  readonly blast: BombBlastStats;
  /** 扔出时的稳定性 0~1 */
  readonly stability: number;
  /** 本颗实际尺寸倍率（相对满尺寸），越小越弱 */
  readonly sizeScale: number;

  private phase: BombPhase = 'flying';
  private elapsed = 0;
  private explodeElapsed = 0;
  private blastResolved = false;

  groundX: number;
  groundY: number;
  arcHeight = 0;

  constructor(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    options: BombProjectileOptions = {},
  ) {
    super();
    this.label = 'BombProjectile';

    if (!sharedBomb || !sharedExplosion) {
      throw new Error('Bomb textures not loaded — call loadBombTextures() first');
    }

    this.stability = clamp01(options.stability ?? DEFAULT_BOMB_STABILITY);
    this.sizeScale =
      options.sizeScale !== undefined
        ? Math.max(BOMB_MIN_SIZE_SCALE * 0.5, options.sizeScale)
        : rollBombSizeScale(this.stability);

    const baseBlast: BombBlastStats = {
      ...DEFAULT_BOMB_BLAST,
      ...options.blast,
    };
    this.blast = scaleBlastStats(baseBlast, this.sizeScale);

    this.bombScaleStart = BOMB_SCALE_START * this.sizeScale;
    this.bombScaleEnd = BOMB_SCALE_END * this.sizeScale;
    this.explosionScale = EXPLOSION_SCALE * this.sizeScale;

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
    this.bomb.scale.set(this.bombScaleStart);
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
   * 对世界坐标上的目标做一次爆炸命中检测与数值结算。
   * 半径 / 伤害 / 击飞均来自本实例已缩放的 blast。
   */
  evaluateHit(
    targetX: number,
    targetY: number,
    fallbackFace: 1 | -1 = 1,
  ): BlastHit | null {
    const dx = targetX - this.groundX;
    const dy = targetY - this.groundY;
    const dist = Math.hypot(dx, dy);
    const { radius } = this.blast;

    if (dist > radius) return null;

    const falloff = 1 - dist / radius;
    const strength = falloff * falloff;

    const {
      maxDamage,
      minDamage,
      damageFloor,
      knockSpeed,
      knockFloor,
      poseBase,
      poseGain,
    } = this.blast;

    const damage = Math.max(
      minDamage,
      Math.round(maxDamage * (damageFloor + (1 - damageFloor) * strength)),
    );
    let impulse = knockSpeed * (knockFloor + (1 - knockFloor) * strength);

    // 大弹：额外推远 + 空中转圈
    let airSpinTurns = 0;
    if (this.sizeScale >= BOMB_SPIN_SIZE_THRESHOLD) {
      const span = Math.max(1e-6, 1 - BOMB_SPIN_SIZE_THRESHOLD);
      const largeT = Math.min(1, (this.sizeScale - BOMB_SPIN_SIZE_THRESHOLD) / span);
      impulse *= 1 + BOMB_LARGE_KNOCK_BONUS * largeT;
      airSpinTurns = BOMB_AIR_SPIN_TURNS;
    }

    let dirX: number;
    let dirY: number;
    if (dist < 6) {
      dirX = -fallbackFace;
      dirY = -0.35;
      const inv = 1 / Math.hypot(dirX, dirY);
      dirX *= inv;
      dirY *= inv;
    } else {
      dirX = dx / dist;
      dirY = dy / dist;
    }

    return {
      strength,
      damage,
      knockVelX: dirX * impulse,
      knockVelY: dirY * impulse,
      dirX,
      dirY,
      poseStrength: poseBase + poseGain * strength,
      airSpinTurns,
    };
  }

  update(deltaMS: number): BombPhase {
    const dt = deltaMS / 1000;

    if (this.phase === 'flying') {
      this.elapsed += dt;
      const raw = this.elapsed / this.flightDuration;
      const u = Math.min(1, raw);
      this.sampleFlight(u);
      this.bomb.rotation += dt * 8;

      if (u >= 1) {
        this.beginExplosion();
      }
    } else if (this.phase === 'exploding') {
      this.explodeElapsed += dt;
      const p = Math.min(1, this.explodeElapsed / EXPLOSION_LIFE);
      const pop = p < 0.25 ? p / 0.25 : 1;
      const fade = p < 0.45 ? 1 : 1 - (p - 0.45) / 0.55;
      const scale = this.explosionScale * (0.55 + 0.55 * pop);
      this.explosion.scale.set(scale);
      this.explosion.alpha = fade;
      this.arcHeight = 12 * (1 - p) * this.sizeScale;

      if (p >= 1) {
        this.phase = 'done';
      }
    }

    return this.phase;
  }

  consumeBlastResolve(): boolean {
    if (this.phase !== 'exploding' || this.blastResolved) return false;
    this.blastResolved = true;
    return true;
  }

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
    const fromHand = THROW_ORIGIN_HEIGHT * (1 - u);
    const arc = 4 * ARC_PEAK * u * (1 - u);
    this.arcHeight = fromHand + arc;
    const grow = 1 - (1 - u) * (1 - u);
    const s =
      this.bombScaleStart + (this.bombScaleEnd - this.bombScaleStart) * grow;
    this.bomb.scale.set(s);
  }

  private beginExplosion(): void {
    this.phase = 'exploding';
    this.explodeElapsed = 0;
    this.groundX = this.endX;
    this.groundY = this.endY;
    this.arcHeight = 8 * this.sizeScale;
    this.bomb.visible = false;
    this.explosion.visible = true;
    this.explosion.alpha = 1;
    this.explosion.scale.set(this.explosionScale * 0.55);
  }
}
