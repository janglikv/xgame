import { Container, Sprite, Texture } from 'pixi.js';
import {
  applyKnockImpulse,
  createKnockArcState,
  isKnockAirborne,
  stepKnockArc,
  type KnockArcState,
} from './knockArc';
import type { WorldActor } from './WorldActor';
import { MonsterPoseController, type WalkBobConfig } from './MonsterPoseController';
import {
  circleHitsHurt,
  profileHurtOffset,
  profileHurtR,
  profileSolidR,
  type BodyProfileId,
} from '../data/bodyProfiles';
import { HealthBar } from '../ui/HealthBar';
import {
  loadOutlinedTexture,
  OUTLINE_PX_CHARACTER,
  paddedFootAnchorY,
} from '../utils/outlineTexture';
import {
  getRuntimeTreeObstacles,
  isOnGreenLand,
  isOnLand,
  landRectOf,
} from '../data/maps';
import type { CreatureEcologyContext } from './CreatureEcology';

export type {
  CreatureEcologyContext,
  EcologyGrass,
  EcologyTree,
} from './CreatureEcology';

const SPIDER_URL = '/assets/spider/spider.png';

/** 默认相对贴图缩放（与角色 0.07 同量级） */
const DEFAULT_SCALE = 0.1;
/** 默认最大生命 */
const DEFAULT_MAX_HP = 60;
/** 血条相对脚底向上的偏移（未缩放本地像素） */
const HP_BAR_OFFSET_Y = 620;
const HP_BAR_WIDTH = 42;
const HP_BAR_HEIGHT = 5;

/** AI：巡视领地；靠近 / 被打后锁定追击并近战 */
const AI = {
  /** 进入锁定的察觉半径（世界像素） */
  detectRange: 270,
  /**
   * 近战交战距离（AI 停步 / 开咬用，中心距）。
   * 与 attackHitR 分离：前者管 AI，后者管实际咬中。
   */
  attackRange: 40,
  /**
   * 扑咬攻击体半径（从蜘蛛中心算，与 solid BODY 无关）。
   * 实际命中：attackHitR + 目标 hurtbox。
   */
  attackHitR: 32,
  /** 追击移速（略慢于玩家 220） */
  chaseSpeed: 148,
  /** 单次咬伤 */
  attackDamage: 10,
  /** 攻击冷却（秒，从出手算起） */
  attackCooldown: 1.05,
  /** 攻击前摇：停步蓄力 */
  attackWindup: 0.2,
  /** 扑咬前冲时长 */
  attackLunge: 0.14,
  /** 扑咬前冲速度加成 */
  lungeSpeed: 220,
  /** 命中时对玩家的轻微击退冲量 */
  hitKnock: 160,
  /** 被炸飞时 AI 停手的高度阈值 */
  stunHeight: 8,
  /** 领地半径（以出生点为圆心，世界像素） */
  territoryRadius: 125,
  /** 巡视移速（比追击慢，显得在踱步） */
  patrolSpeed: 72,
  /** 到航点视为到达的距离 */
  patrolArrive: 10,
  /** 航点停留最短/最长（秒） */
  patrolPauseMin: 0.55,
  patrolPauseMax: 1.9,
  /**
   * 默认个人空间（世界像素）。
   * 0 = 不启用软分散；农场动物等会调大。
   */
  personalSpace: 0,
  /** 软分散最大移速 */
  separationSpeed: 70,
  /** 选巡视点时多采几次，倾向更空旷处 */
  patrolWaypointSamples: 7,
} as const;

/** 走路晃动默认（局部）；农场动物等可在 options 覆盖 */
import { DEFAULT_WALK_BOB } from './MonsterPoseController';
export type { WalkBobConfig } from './MonsterPoseController';

const WALK = DEFAULT_WALK_BOB;
const ANCHOR_FOOT_Y = 0.88;

type MonsterAppearance = {
  textureUrl: string;
  label: string;
  spriteLabel: string;
  footAnchorY: number;
  hpBarOffsetY: number;
};

type LoadedMonsterTexture = {
  texture: Texture;
  footAnchorY: number;
};

const textureCache = new Map<string, Promise<LoadedMonsterTexture>>();

function bodyProfileIdFromLabel(label: string): BodyProfileId {
  if (label === 'WoodenDummy') return 'wooden-dummy';
  if (label === 'FlameFlower') return 'flame-flower';
  return 'spider';
}

async function loadMonsterTexture(
  textureUrl: string,
  footAnchorY: number,
): Promise<LoadedMonsterTexture> {
  const cached = textureCache.get(textureUrl);
  if (cached) return cached;

  const pending = loadOutlinedTexture(
    textureUrl,
    OUTLINE_PX_CHARACTER,
  ).then((outlined) => ({
    texture: outlined.texture,
    footAnchorY: paddedFootAnchorY(
      footAnchorY,
      outlined.contentHeight,
      outlined.pad,
    ),
  }));
  textureCache.set(textureUrl, pending);
  return pending;
}

export async function loadSpiderTexture(): Promise<void> {
  await loadMonsterTexture(SPIDER_URL, ANCHOR_FOOT_Y);
}

export type SpiderOptions = {
  scale?: number;
  maxHp?: number;
  /** 子类只覆盖外观，沿用蜘蛛的战斗与移动逻辑。 */
  appearance?: Partial<MonsterAppearance>;
  /**
   * 无敌：受击不扣血、永不死亡。
   */
  invincible?: boolean;
  /**
   * 木桩 / 被动：不巡视、不追击、不攻击，不受击退，无受击姿态。
   */
  passive?: boolean;
  /**
   * 绝对固定：solid 不把它挤走（仍作为硬障碍推开玩家/其他怪）。
   * 缺省与 passive 相同。
   */
  immovable?: boolean;
  /**
   * 是否可近战攻击。false 时只巡视/追击，不进入扑咬、不造成伤害。
   * 缺省 true（蜘蛛等）。
   */
  canAttack?: boolean;
  /**
   * 是否因靠近玩家而锁定。false 时只有被打才锁定，平时完全无视玩家。
   * 缺省 true（蜘蛛等）。
   */
  aggroOnDetect?: boolean;
  /**
   * 脱战距离（世界像素）。已锁定时与玩家超过此距离则取消锁定、回巡视。
   * ≤0 表示永不脱战（蜘蛛默认）。
   */
  leashRange?: number;
  /**
   * 巡视领地半径（世界像素）。缺省 AI.territoryRadius。
   */
  territoryRadius?: number;
  /**
   * 个人空间半径（世界像素）。>0 时靠近同伴会软推开，避免挤成一团。
   * 缺省 0（不启用）；农场动物应设为 ~70–100。
   */
  personalSpace?: number;
  /**
   * 软分散最大移速。缺省 AI.separationSpeed。
   */
  separationSpeed?: number;
  /**
   * 走路晃动参数（局部）。缺省 WALK；大体型动物宜加长 period、减小 amp。
   */
  walkBob?: Partial<WalkBobConfig>;
};

/** 蜘蛛 AI 状态 */
export type SpiderAIState = 'patrol' | 'chase' | 'attack';

/** 本帧对玩家造成的攻击结果（由场景结算 HP / 击退） */
export type SpiderAttackHit = {
  damage: number;
  /** 击退方向（单位向量，蜘蛛 → 玩家） */
  dirX: number;
  dirY: number;
  /** 建议击退冲量大小 */
  knockImpulse: number;
};

export type SpiderUpdateResult = {
  /** 世界坐标是否变化（需要刷新屏幕位置） */
  moved: boolean;
  /** 本帧是否命中玩家（至多一次） */
  attackHit: SpiderAttackHit | null;
};

/**
 * 蜘蛛怪物：世界坐标定位，由外部按摄像机同步到屏幕。
 * 原点在身体底部中心；血条为 sibling 子节点，不随朝向翻转。
 * AI：未锁定时巡视出生点领地；靠近或被打后锁定追击，贴近则扑咬。
 * 实现 WorldActor：与玩家同一套 worldX/Y + knock。
 *
 * 生态上下文类型见 CreatureEcology.ts（本文件 re-export 以保持旧 import）。
 */
export class Spider extends Container implements WorldActor {
  private sprite: Sprite | null = null;
  private readonly baseScale: number;
  private readonly healthBar: HealthBar;
  private readonly maxHp: number;
  private readonly appearance: MonsterAppearance;
  /** 无敌：受击不扣血 */
  readonly invincible: boolean;
  /** 被动木桩：不 AI、不击飞、无受击反馈 */
  readonly passive: boolean;
  /** 绝对固定：不被 solid 挤走，每帧钉回出生点 */
  readonly immovable: boolean;
  /** 是否可近战攻击 */
  readonly canAttack: boolean;
  /** 是否因靠近而锁定玩家 */
  readonly aggroOnDetect: boolean;
  /** 脱战距离；≤0 永不脱战 */
  readonly leashRange: number;
  /** 巡视领地半径 */
  protected readonly territoryRadius: number;
  /** 个人空间；0 表示不做软分散 */
  protected readonly personalSpace: number;
  /** 软分散最大移速 */
  protected readonly separationSpeed: number;
  /** 走路晃动参数 */
  private readonly walkBob: WalkBobConfig;
  /** 描边外扩后换算出的实际脚底锚点。 */
  private footAnchorY: number;
  /** 碰撞模板；子类外观决定 id */
  readonly bodyProfileId: BodyProfileId;

  get bodyR(): number {
    return profileSolidR(this.bodyProfileId);
  }

  get hurtR(): number {
    return profileHurtR(this.bodyProfileId);
  }

  get hurtWorldX(): number {
    return this.worldX + profileHurtOffset(this.bodyProfileId).ox;
  }

  get hurtWorldY(): number {
    return this.worldY + profileHurtOffset(this.bodyProfileId).oy;
  }
  /** 1 = 朝右，-1 = 朝左 */
  private facing: 1 | -1 = 1;
  /** 姿态与动作控制器 */
  private readonly poseController = new MonsterPoseController();
  /** 击飞抛物线（地面速度 + 高度） */
  readonly knock: KnockArcState = createKnockArcState();

  /** AI */
  protected aiState: SpiderAIState = 'patrol';
  /** 是否已锁定玩家（察觉 / 被打后保持，直到死亡） */
  protected locked = false;
  /** 攻击冷却计时（秒，>0 不可出手） */
  protected attackCd = 0;
  /** 攻击阶段计时（秒） */
  protected attackT = 0;
  /** 本段攻击是否已结算伤害 */
  protected attackDealt = false;

  /** 攻击姿态 0→1 */
  protected attackPose = 0;

  /** 领地中心（出生点） */
  protected readonly homeX: number;
  protected readonly homeY: number;
  /** 当前巡视航点 */
  protected patrolTargetX: number;
  protected patrolTargetY: number;
  /** 航点停留计时（秒，>0 表示停步观望） */
  protected patrolPause = 0;

  /** 本帧生态上下文（猪觅食等）；update 时注入 */
  protected ecology: CreatureEcologyContext | null = null;

  /** 世界坐标（与玩家 worldX/Y 同一空间） */
  worldX: number;
  worldY: number;

  constructor(worldX: number, worldY: number, options: SpiderOptions = {}) {
    super();
    this.appearance = {
      textureUrl: SPIDER_URL,
      label: 'Spider',
      spriteLabel: 'SpiderSprite',
      footAnchorY: ANCHOR_FOOT_Y,
      hpBarOffsetY: HP_BAR_OFFSET_Y,
      ...options.appearance,
    };
    this.footAnchorY = this.appearance.footAnchorY;
    this.label = this.appearance.label;
    this.bodyProfileId = bodyProfileIdFromLabel(this.appearance.label);
    this.invincible = options.invincible ?? false;
    this.passive = options.passive ?? false;
    this.immovable = options.immovable ?? this.passive;
    this.canAttack = options.canAttack ?? true;
    this.aggroOnDetect = options.aggroOnDetect ?? true;
    this.leashRange = options.leashRange ?? 0;
    this.territoryRadius = options.territoryRadius ?? AI.territoryRadius;
    this.personalSpace = options.personalSpace ?? AI.personalSpace;
    this.separationSpeed = options.separationSpeed ?? AI.separationSpeed;
    this.walkBob = { ...WALK, ...options.walkBob };
    this.worldX = worldX;
    this.worldY = worldY;
    this.homeX = worldX;
    this.homeY = worldY;
    this.patrolTargetX = worldX;
    this.patrolTargetY = worldY;
    this.baseScale = options.scale ?? DEFAULT_SCALE;
    this.maxHp = options.maxHp ?? DEFAULT_MAX_HP;
    this.eventMode = 'none';

    // 血条挂在根节点：只翻转 sprite，血条始终正向
    this.healthBar = new HealthBar({
      maxHp: this.maxHp,
      width: HP_BAR_WIDTH,
      height: HP_BAR_HEIGHT,
    });
    this.healthBar.setHealth(this.maxHp);
    // 屏幕像素尺寸；贴图缩放只作用在 sprite 上
    this.healthBar.position.set(
      0,
      -this.appearance.hpBarOffsetY * this.baseScale,
    );
    // 默认隐藏；受击后再显示（木桩 / 无敌永不显示）
    this.healthBar.visible = false;
    this.addChild(this.healthBar);

    // 开局错开：先短停再走向随机航点，避免四角同步齐步
    // 被动木桩不需要巡视
    if (!this.passive) {
      this.patrolPause = 0.2 + Math.random() * 1.2;
      this.pickPatrolWaypoint();
    }
  }

  get currentHp(): number {
    return this.healthBar.currentHp;
  }

  get maximumHp(): number {
    return this.healthBar.maximumHp;
  }

  get isAlive(): boolean {
    // 无敌单位永远存活（可被命中、结算伤害反馈，但不移除）
    if (this.invincible) return true;
    return this.healthBar.currentHp > 0;
  }

  get isAttacking(): boolean {
    return this.aiState === 'attack';
  }

  get attackHitR(): number {
    return AI.attackHitR;
  }

  get ai(): SpiderAIState {
    return this.aiState;
  }

  get isLockedOnPlayer(): boolean {
    return this.locked;
  }

  async load(): Promise<void> {
    if (this.sprite) return;
    const loaded = await loadMonsterTexture(
      this.appearance.textureUrl,
      this.appearance.footAnchorY,
    );
    this.footAnchorY = loaded.footAnchorY;

    // 脚底略偏下，描边外扩后需重新换算锚点。
    const sprite = new Sprite(loaded.texture);
    sprite.anchor.set(0.5, loaded.footAnchorY);
    sprite.label = this.appearance.spriteLabel;
    this.sprite = sprite;
    this.applyFacingToSprite();
    // 先画蜘蛛，血条在上
    this.addChildAt(sprite, 0);
  }

  /** 预加载变体贴图（吃草等），走同一描边缓存，不替换当前 sprite */
  protected async preloadSpriteTexture(textureUrl: string): Promise<void> {
    await loadMonsterTexture(textureUrl, this.appearance.footAnchorY);
  }

  /**
   * 热切换贴图（吃草姿态等）。
   * 与 load 相同描边/锚点规则；调用方需保证 sprite 已 load。
   */
  protected async setSpriteTexture(textureUrl: string): Promise<void> {
    const sprite = this.sprite;
    if (!sprite || sprite.destroyed) return;
    const loaded = await loadMonsterTexture(
      textureUrl,
      this.appearance.footAnchorY,
    );
    if (!this.sprite || this.sprite.destroyed) return;
    this.footAnchorY = loaded.footAnchorY;
    this.sprite.texture = loaded.texture;
    this.sprite.anchor.set(0.5, loaded.footAnchorY);
    this.applyFacingToSprite();
  }

  /**
   * 写到世界坐标层（父级 worldRoot 负责镜头）。
   * zIndex = 脚底 worldY，参与纵深排序。
   */
  syncToWorld(): void {
    this.position.set(this.worldX, this.worldY - this.knock.height);
    this.zIndex = this.worldY;
  }

  /**
   * 面向某世界点（只翻转贴图，血条不镜像）。
   * 带水平死区：目标几乎在正上/正下或贴身时不翻转，
   * 避免小动物被挤开 / 微抖时左右抽搐。
   */
  faceToward(wx: number, _wy: number): void {
    const dx = wx - this.worldX;
    // 约 10px 内保持原朝向，防止 dx 在 0 附近每帧变号
    if (Math.abs(dx) < 10) return;
    const next: 1 | -1 = dx < 0 ? -1 : 1;
    if (next === this.facing) return;
    this.facing = next;
    this.applyFacingToSprite();
  }

  private applyFacingToSprite(): void {
    const sprite = this.sprite;
    if (!sprite) return;
    sprite.scale.x = this.baseScale * this.facing;
    sprite.scale.y = this.baseScale;
  }

  /**
   * 应用炸弹结算结果：扣血 + 世界击退速度 + 姿态 / 空中转圈。
   * 击飞数值由炸弹属性算出，目标侧只负责接收（可再乘抗性）。
   * @param knockScale 击飞抗性，1 = 全吃，0.85 = 略抗
   */
  applyBlastHit(
    hit: {
      damage: number;
      knockVelX: number;
      knockVelY: number;
      dirX: number;
      poseStrength: number;
      airSpinTurns?: number;
    },
    knockScale = 1,
  ): boolean {
    if (!this.isAlive) return false;

    if (!this.invincible) {
      this.healthBar.applyDelta(-Math.abs(hit.damage));
      this.revealHealthBar();
    }

    // 木桩：完全无反馈（不抖、不转、不位移、不切 AI）
    if (this.passive) {
      return true;
    }

    applyKnockImpulse(this.knock, hit.knockVelX, hit.knockVelY, knockScale);

    this.poseController.triggerBlastKnock(Math.min(1.25, hit.poseStrength));
    if (hit.dirX !== 0) {
      this.facing = hit.dirX < 0 ? -1 : 1;
      this.applyFacingToSprite();
    }

    const turns = hit.airSpinTurns ?? 0;
    if (turns > 0) {
      this.poseController.triggerSpin(turns, hit.dirX < 0 ? -1 : 1);
    }

    // 被攻击也会锁定玩家（不依赖察觉距离）
    this.locked = true;

    // 被炸打断当前攻击，冷却略重置；落地后进入追击
    if (this.aiState === 'attack') {
      this.attackT = 0;
      this.attackPose = 0;
      this.attackDealt = false;
    }
    this.aiState = 'chase';
    this.attackCd = Math.max(this.attackCd, 0.35);

    return this.isAlive;
  }

  /**
   * 纯扣血（不触发锁定 / 击飞姿态）。生态捕食等用。
   * @returns 是否仍存活
   */
  applyDamage(amount: number): boolean {
    if (!this.isAlive) return false;
    if (!this.invincible) {
      this.healthBar.applyDelta(-Math.abs(amount));
      this.revealHealthBar();
    }
    return this.isAlive;
  }

  /** 受击后显示血条（木桩 / 无敌除外） */
  private revealHealthBar(): void {
    if (this.invincible || this.passive) return;
    this.healthBar.visible = true;
  }

  /**
   * 每帧：AI + 击退 + 姿态 / 空中转圈 + 血条。
   * @param playerWorldX / Y 玩家脚底（锁定 / 追击）
   * @param playerBodyProfileId 玩家碰撞模板（扑咬用 hurt 多形状判定）
   * @param ecology 可选生态上下文（猪觅食等）
   */
  update(
    deltaMS: number,
    playerWorldX: number,
    playerWorldY: number,
    playerBodyProfileId: BodyProfileId | null = null,
    ecology: CreatureEcologyContext | null = null,
  ): SpiderUpdateResult {
    const dt = deltaMS / 1000;
    this.ecology = ecology;
    this.healthBar.update(deltaMS);

    // 木桩 / 固定体：钉死出生点，无姿态反馈
    if (this.passive || this.immovable) {
      this.worldX = this.homeX;
      this.worldY = this.homeY;
      this.knock.velX = 0;
      this.knock.velY = 0;
      this.knock.velZ = 0;
      this.knock.height = 0;
      return { moved: false, attackHit: null };
    }

    let moved = false;
    let attackHit: SpiderAttackHit | null = null;

    // 击飞优先
    const knockStep = stepKnockArc(this.knock, dt);
    if (knockStep.moved) {
      this.worldX += knockStep.dx;
      this.worldY += knockStep.dy;
      moved = true;
    }

    const stunned =
      isKnockAirborne(this.knock) ||
      this.knock.height > AI.stunHeight ||
      this.poseController.isSpinning();

    // 仅 AI 主动位移才播走路晃动；纯分散挤开不算走路，否则会左右抖
    let aiMoved = false;
    if (this.isAlive && !stunned) {
      const aiResult = this.updateAI(
        dt,
        playerWorldX,
        playerWorldY,
        playerBodyProfileId,
      );
      // 生态饿死 / 被移除会 destroy 自身，勿再碰 sprite
      if (this.destroyed) {
        return { moved: false, attackHit: null };
      }
      if (aiResult.moved) {
        moved = true;
        aiMoved = true;
      }
      attackHit = aiResult.attackHit;
      // 靠近同伴时软推开，避免挤成一坨（攻击前摇时减弱）
      if (this.applyCrowdSeparation(dt)) moved = true;
    } else if (this.attackCd > 0) {
      this.attackCd = Math.max(0, this.attackCd - dt);
    }

    if (this.destroyed) {
      return { moved: false, attackHit: null };
    }

    const walking =
      !stunned &&
      aiMoved &&
      (this.aiState === 'chase' || this.aiState === 'patrol');
    this.updatePose(dt, walking);

    return { moved, attackHit };
  }

  /**
   * 软分散：与附近同伴保持个人空间，越近推得越狠。
   * 完全重叠时随机给一个方向，避免卡死。
   * 边缘有死区，避免在个人空间边界来回抖。
   */
  protected applyCrowdSeparation(dt: number): boolean {
    if (this.personalSpace <= 0 || !this.ecology) return false;
    // 扑咬中减弱，避免把近战位推散
    const strength = this.aiState === 'attack' ? 0.25 : 1;

    let pushX = 0;
    let pushY = 0;
    let near = 0;
    const space = this.personalSpace;
    // 只在明显侵入时推，边界附近不推 → 减少来回抽
    const activeR = space * 0.88;

    for (const other of this.ecology.creatures) {
      if (other === this || !other.isAlive) continue;
      const dx = this.worldX - other.worldX;
      const dy = this.worldY - other.worldY;
      const d = Math.hypot(dx, dy);
      if (d >= activeR) continue;
      near += 1;
      if (d < 1e-3) {
        // 完全重叠：稳定伪随机方向（用朝向，避免每帧变）
        const ang = this.facing > 0 ? 0.3 : Math.PI + 0.3;
        pushX += Math.cos(ang + near);
        pushY += Math.sin(ang + near);
        continue;
      }
      // 平方衰减：贴得越近推得越强
      const t = 1 - d / activeR;
      const w = t * t;
      pushX += (dx / d) * w;
      pushY += (dy / d) * w;
    }

    if (near === 0) return false;

    const len = Math.hypot(pushX, pushY);
    if (len < 1e-4) return false;
    const inv = 1 / len;
    // 单帧最多推开一点，避免过冲后弹回
    const step = Math.min(this.separationSpeed * strength * dt, space * 0.12);
    if (step < 0.02) return false;
    this.worldX += pushX * inv * step;
    this.worldY += pushY * inv * step;
    return true;
  }

  /**
   * 在领地圆盘内选巡视航点。
   * 多采样 + 偏向离其它生物更远的点，形成自然分散。
   */
  protected pickPatrolWaypoint(): void {
    const eco = this.ecology;
    const samples =
      eco && this.personalSpace > 0 ? AI.patrolWaypointSamples : 1;

    let bestX = this.homeX;
    let bestY = this.homeY;
    let bestScore = -Infinity;

    for (let i = 0; i < samples; i++) {
      const angle = Math.random() * Math.PI * 2;
      // sqrt 使面积均匀，略偏外圈更像绕领地巡视
      const r =
        Math.sqrt(0.15 + 0.85 * Math.random()) * this.territoryRadius;
      const x = this.homeX + Math.cos(angle) * r;
      const y = this.homeY + Math.sin(angle) * r;

      // 轻微随机，避免永远挑同一侧
      let score = Math.random() * 24;
      if (eco) {
        let minD = Infinity;
        for (const c of eco.creatures) {
          if (c === this || !c.isAlive) continue;
          const d = Math.hypot(c.worldX - x, c.worldY - y);
          if (d < minD) minD = d;
        }
        // 越空旷分越高；上限避免无限拉远
        if (Number.isFinite(minD)) {
          score += Math.min(minD, this.territoryRadius * 1.4);
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestX = x;
        bestY = y;
      }
    }

    this.patrolTargetX = bestX;
    this.patrolTargetY = bestY;
  }

  protected rollPatrolPause(): number {
    return (
      AI.patrolPauseMin +
      Math.random() * (AI.patrolPauseMax - AI.patrolPauseMin)
    );
  }

  /**
   * 未锁定：在领地内走航点 / 停步观望。
   * 顺带面向移动方向。
   */
  protected updatePatrol(dt: number): boolean {
    this.aiState = 'patrol';

    if (this.patrolPause > 0) {
      this.patrolPause = Math.max(0, this.patrolPause - dt);
      if (this.patrolPause <= 0) {
        this.pickPatrolWaypoint();
      }
      return false;
    }

    const dx = this.patrolTargetX - this.worldX;
    const dy = this.patrolTargetY - this.worldY;
    const dist = Math.hypot(dx, dy);

    if (dist <= AI.patrolArrive) {
      // 到点停步观望，停完后再 roll 下一个航点
      this.patrolPause = this.rollPatrolPause();
      return false;
    }

    const step = Math.min(AI.patrolSpeed * dt, dist);
    const inv = 1 / dist;
    this.worldX += dx * inv * step;
    this.worldY += dy * inv * step;
    this.faceToward(this.patrolTargetX, this.patrolTargetY);
    return true;
  }

  /**
   * 自由游荡：换点走动。
   * - 不设 center：以当前位置为中心滚动探索（会逐渐走远）
   * - 设 center：在锚点（食物区）周围转悠
   */
  protected updateSearchRoam(
    dt: number,
    options: {
      radius: number;
      speed: number;
      /** 到点后最短/最长停顿（秒） */
      pauseMin?: number;
      pauseMax?: number;
      /** 游荡锚点（食物坐标）；缺省用当前位置 */
      centerX?: number;
      centerY?: number;
      /** 0~1，越大越倾向采远处点 */
      preferFar?: number;
      /** true 时用 patrol 姿态（踱步）；false 用 chase（找食感） */
      leisurely?: boolean;
      /** 只走绿地，避开沙滩（牛马觅食区） */
      greenOnly?: boolean;
    },
  ): boolean {
    const radius = Math.max(40, options.radius);
    const speed = Math.max(20, options.speed);
    const pauseMin = options.pauseMin ?? 0.04;
    const pauseMax = options.pauseMax ?? 0.18;
    const preferFar = options.preferFar ?? 0.55;
    const leisurely = options.leisurely ?? false;
    const greenOnly = options.greenOnly ?? false;

    this.aiState = leisurely ? 'patrol' : 'chase';

    const rollWaypoint = (): void => {
      this.pickSearchWaypoint(radius, {
        centerX: options.centerX,
        centerY: options.centerY,
        preferFar,
        greenOnly,
      });
    };

    if (this.patrolPause > 0) {
      this.patrolPause = Math.max(0, this.patrolPause - dt);
      if (this.patrolPause <= 0) {
        rollWaypoint();
      }
      return false;
    }

    const dx = this.patrolTargetX - this.worldX;
    const dy = this.patrolTargetY - this.worldY;
    const dist = Math.hypot(dx, dy);

    if (dist <= AI.patrolArrive * 1.4) {
      // 至少停一小会，避免到点立刻换点导致抖
      const pause =
        Math.max(0.12, pauseMin) +
        Math.random() * Math.max(0, pauseMax - pauseMin);
      this.patrolPause = pause;
      rollWaypoint();
      return false;
    }

    const step = Math.min(speed * dt, dist);
    const inv = 1 / dist;
    this.worldX += dx * inv * step;
    this.worldY += dy * inv * step;
    this.faceToward(this.patrolTargetX, this.patrolTargetY);
    return true;
  }

  /**
   * 采游荡航点。
   * center 缺省 = 当前位置；preferFar 控制近/远环带。
   * greenOnly：只落在绿地上（与草生长区一致，避开沙滩）。
   */
  protected pickSearchWaypoint(
    radius: number,
    opts?: {
      centerX?: number;
      centerY?: number;
      preferFar?: number;
      greenOnly?: boolean;
    },
  ): void {
    const eco = this.ecology;
    const samples = 12;
    const greenOnly = opts?.greenOnly ?? false;
    const cx = opts?.centerX ?? this.worldX;
    const cy = opts?.centerY ?? this.worldY;
    const preferFar = opts?.preferFar ?? 0.55;
    // 无锚点时偏好沿朝向前进；围着食物转时更均匀
    const anchored =
      opts?.centerX !== undefined && opts?.centerY !== undefined;
    const preferAngle = this.facingDir > 0 ? 0 : Math.PI;

    // 默认回落：岛中心方向，避免采样全失败时仍走向沙滩
    let bestX = cx + radius * 0.4;
    let bestY = cy;
    if (eco?.mapDef) {
      const land = landRectOf(eco.mapDef);
      const islandCx = land.x + land.w * 0.5;
      const islandCy = land.y + land.h * 0.5;
      const toCx = islandCx - this.worldX;
      const toCy = islandCy - this.worldY;
      const d = Math.hypot(toCx, toCy);
      if (d > 1e-3) {
        const step = Math.min(radius * 0.55, d * 0.35);
        bestX = this.worldX + (toCx / d) * step;
        bestY = this.worldY + (toCy / d) * step;
      } else {
        bestX = islandCx;
        bestY = islandCy;
      }
    }
    let bestScore = -Infinity;

    const walkOk = (x: number, y: number): boolean => {
      if (!eco?.mapDef) return true;
      if (greenOnly) {
        return isOnGreenLand(x, y, eco.mapDef);
      }
      return isOnLand(x, y, eco.mapDef, 48);
    };

    for (let i = 0; i < samples; i++) {
      // preferFar 高 → 更多远点；低 → 更贴锚点（食物区踱步）
      const near = Math.random() * (1 - preferFar);
      const far = preferFar + (1 - preferFar) * Math.random();
      const band = Math.random() < preferFar ? far : near;
      const r = Math.sqrt(0.08 + 0.92 * band) * radius;
      const angle = anchored
        ? Math.random() * Math.PI * 2
        : i === 0
          ? preferAngle + (Math.random() - 0.5) * 0.9
          : Math.random() * Math.PI * 2;

      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;

      if (!walkOk(x, y)) continue;

      let score = Math.random() * 22;
      if (!anchored) {
        score += r * 0.3;
        score += Math.cos(angle - preferAngle) * 16;
      } else {
        // 在环上更均匀，略避开圆心正上方叠人
        score += Math.abs(r - radius * 0.55) * -0.08;
      }

      // 靠近海岸 / 已在沙滩：大幅偏向岛中心
      if (eco?.mapDef) {
        const land = landRectOf(eco.mapDef);
        const islandCx = land.x + land.w * 0.5;
        const islandCy = land.y + land.h * 0.5;
        const nearCoast = greenOnly
          ? !isOnGreenLand(this.worldX, this.worldY, eco.mapDef)
          : !isOnLand(this.worldX, this.worldY, eco.mapDef, 180);
        if (nearCoast) {
          const toCenterAngle = Math.atan2(
            islandCy - this.worldY,
            islandCx - this.worldX,
          );
          score += Math.cos(angle - toCenterAngle) * 50;
        }
      }

      if (eco) {
        let minD = Infinity;
        for (const c of eco.creatures) {
          if (c === this || !c.isAlive) continue;
          const d = Math.hypot(c.worldX - x, c.worldY - y);
          if (d < minD) minD = d;
        }
        if (Number.isFinite(minD)) {
          score += Math.min(minD, 160) * 0.4;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestX = x;
        bestY = y;
      }
    }

    this.patrolTargetX = bestX;
    this.patrolTargetY = bestY;
  }

  /** 朝向：1 右 / -1 左（供搜食偏向用） */
  protected get facingDir(): 1 | -1 {
    return this.facing;
  }

  /** 朝目标点移动一段，返回是否发生位移 */
  protected moveToward(
    tx: number,
    ty: number,
    speed: number,
    dt: number,
    stopDist = 4,
  ): boolean {
    const dx = tx - this.worldX;
    const dy = ty - this.worldY;
    const dist = Math.hypot(dx, dy);
    if (dist <= stopDist) return false;
    const step = Math.min(speed * dt, dist - stopDist);
    const inv = 1 / dist;
    this.worldX += dx * inv * step;
    this.worldY += dy * inv * step;
    this.faceToward(tx, ty);
    return true;
  }

  /**
   * 朝目标走，路上有树干 solid 则先绕到切点，避免直怼树来回顶。
   * @param bodyR 自身碰撞近似半径
   */
  protected moveTowardAvoidingTrees(
    tx: number,
    ty: number,
    speed: number,
    dt: number,
    stopDist = 4,
    bodyR = 22,
  ): boolean {
    let aimX = tx;
    let aimY = ty;

    const trees = getRuntimeTreeObstacles();

    let bestBlock: {
      t: { x: number; y: number; r: number };
      proj: number;
    } | null = null;

    const toTx = tx - this.worldX;
    const toTy = ty - this.worldY;
    const pathLen = Math.hypot(toTx, toTy);
    if (pathLen > 1e-3) {
      const invPath = 1 / pathLen;
      for (const t of trees) {
        const clearR = t.r + bodyR + 5;
        const toCx = t.x - this.worldX;
        const toCy = t.y - this.worldY;
        const proj = toCx * toTx * invPath + toCy * toTy * invPath;
        if (proj < 0 || proj > pathLen) continue;
        const cx = this.worldX + toTx * invPath * proj;
        const cy = this.worldY + toTy * invPath * proj;
        const perp = Math.hypot(t.x - cx, t.y - cy);
        if (perp >= clearR) continue;
        if (!bestBlock || proj < bestBlock.proj) {
          bestBlock = { t, proj };
        }
      }
    }

    if (bestBlock) {
      const t = bestBlock.t;
      const clearR = t.r + bodyR + 8;
      // 绕行点：树心到目标方向的垂直侧，偏向目标一侧
      let px = -(t.y - this.worldY);
      let py = t.x - this.worldX;
      let plen = Math.hypot(px, py);
      if (plen < 1e-3) {
        px = 1;
        py = 0;
        plen = 1;
      } else {
        px /= plen;
        py /= plen;
      }
      // 选更靠近最终目标的切侧
      const tdx = tx - t.x;
      const tdy = ty - t.y;
      if (px * tdx + py * tdy < 0) {
        px = -px;
        py = -py;
      }
      aimX = t.x + px * clearR;
      aimY = t.y + py * clearR;
    }

    return this.moveToward(aimX, aimY, speed, dt, stopDist);
  }

  protected updateAI(
    dt: number,
    playerX: number,
    playerY: number,
    playerBodyProfileId: BodyProfileId | null = null,
  ): { moved: boolean; attackHit: SpiderAttackHit | null } {
    let moved = false;
    let attackHit: SpiderAttackHit | null = null;

    if (this.attackCd > 0) {
      this.attackCd = Math.max(0, this.attackCd - dt);
    }

    const dx = playerX - this.worldX;
    const dy = playerY - this.worldY;
    const dist = Math.hypot(dx, dy);
    const inv = dist > 1e-4 ? 1 / dist : 0;
    const dirX = dx * inv;
    const dirY = dy * inv;

    // 察觉 → 锁定（动物可关：只有被打才锁定）
    if (
      this.aggroOnDetect &&
      !this.locked &&
      dist <= AI.detectRange
    ) {
      this.locked = true;
      this.aiState = 'chase';
      this.patrolPause = 0;
    }

    // 超出脱战距离：取消锁定，回巡视
    if (this.locked && this.leashRange > 0 && dist > this.leashRange) {
      this.locked = false;
      this.aiState = 'patrol';
      this.attackT = 0;
      this.attackPose = 0;
      this.attackDealt = false;
      moved = this.updatePatrol(dt);
      return { moved, attackHit };
    }

    // 未锁定：巡视领地
    if (!this.locked) {
      moved = this.updatePatrol(dt);
      return { moved, attackHit };
    }

    // 攻击状态机（可攻击单位）
    if (this.canAttack && this.aiState === 'attack') {
      this.attackT += dt;
      this.faceToward(playerX, playerY);

      const wind = AI.attackWindup;
      const lungeEnd = wind + AI.attackLunge;

      if (this.attackT < wind) {
        // 前摇：蓄力姿态
        this.attackPose = this.attackT / wind;
      } else if (this.attackT < lungeEnd) {
        // 扑咬：前冲 + 结算伤害
        this.attackPose = 1;
        const lungeU = (this.attackT - wind) / AI.attackLunge;
        const speed = AI.lungeSpeed * (1.15 - 0.55 * lungeU);
        this.worldX += dirX * speed * dt;
        this.worldY += dirY * speed * dt;
        moved = true;

        if (!this.attackDealt) {
          // 攻击体（蜘蛛中心圆）∩ 玩家 hurt 多形状
          const stillClose = playerBodyProfileId
            ? circleHitsHurt(
                this.worldX,
                this.worldY,
                AI.attackHitR,
                playerX,
                playerY,
                playerBodyProfileId,
              )
            : dist <= AI.attackHitR;
          if (stillClose) {
            attackHit = {
              damage: AI.attackDamage,
              dirX: dirX || this.facing,
              dirY: dirY || 0,
              knockImpulse: AI.hitKnock,
            };
          }
          this.attackDealt = true;
          this.attackCd = AI.attackCooldown;
        }
      } else {
        // 结束 → 回追击
        this.aiState = 'chase';
        this.attackT = 0;
        this.attackPose = 0;
        this.attackDealt = false;
      }

      return { moved, attackHit };
    }

    // 追击
    this.aiState = 'chase';
    this.faceToward(playerX, playerY);
    this.attackPose *= Math.exp(-10 * dt);
    if (this.attackPose < 0.02) this.attackPose = 0;

    if (dist > AI.attackRange * 0.85) {
      // 贴近但保留一点缓冲，避免贴脸抖动
      const stopDist = AI.attackRange * 0.55;
      if (dist > stopDist) {
        const step = Math.min(AI.chaseSpeed * dt, dist - stopDist);
        this.worldX += dirX * step;
        this.worldY += dirY * step;
        moved = true;
      }
    }

    // 进入攻击：可攻击、在范围内且冷却完毕
    if (
      this.canAttack &&
      dist <= AI.attackRange &&
      this.attackCd <= 0
    ) {
      this.aiState = 'attack';
      this.attackT = 0;
      this.attackDealt = false;
      this.attackPose = 0;
    }

    return { moved, attackHit };
  }

  private updatePose(dt: number, walking: boolean): void {
    this.poseController.update(
      dt,
      this.sprite,
      walking,
      this.footAnchorY,
      this.walkBob,
      this.attackPose,
      this.aiState === 'attack',
      AI.attackWindup,
      this.attackT,
    );
  }
}
