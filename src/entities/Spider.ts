import { Container, Sprite, Texture } from 'pixi.js';
import {
  applyKnockImpulse,
  createKnockArcState,
  isKnockAirborne,
  stepKnockArc,
  type KnockArcState,
} from './knockArc';
import type { WorldActor } from './WorldActor';
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
} as const;

/** 走路晃动（局部） */
const WALK = {
  period: 0.22,
  ampY: 5,
  ampX: 2.5,
  ampRot: 0.05,
} as const;

/** 被炸飞姿态（作用在 sprite 局部；高度由 knock 抛物线负责） */
const BLAST = {
  lean: 0.5,
  lift: 6,
  tumble: 0.75,
  settle: 5.2,
} as const;

/** 大弹空中旋转两圈（额外抬升交给世界高度抛物线） */
const AIR_SPIN = {
  duration: 0.62,
  lift: 0,
} as const;

/** 脚底锚点 / 中心锚点（旋转时切到中心） */
const ANCHOR_FOOT_Y = 0.88;
const ANCHOR_CENTER_Y = 0.5;

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
  /** 被炸飞姿态强度 */
  private blastKnock = 0;
  /** 击飞抛物线（地面速度 + 高度） */
  readonly knock: KnockArcState = createKnockArcState();
  /** 空中旋转进度 0→1 */
  private spinT = 0;
  private spinTarget = 0;
  private spinSign: 1 | -1 = 1;

  /** AI */
  private aiState: SpiderAIState = 'patrol';
  /** 是否已锁定玩家（察觉 / 被打后保持，直到死亡） */
  private locked = false;
  /** 攻击冷却计时（秒，>0 不可出手） */
  private attackCd = 0;
  /** 攻击阶段计时（秒） */
  private attackT = 0;
  /** 本段攻击是否已结算伤害 */
  private attackDealt = false;
  /** 走路相位 */
  private walkPhase = 0;
  /** 攻击姿态 0→1 */
  private attackPose = 0;

  /** 领地中心（出生点） */
  private readonly homeX: number;
  private readonly homeY: number;
  /** 当前巡视航点 */
  private patrolTargetX: number;
  private patrolTargetY: number;
  /** 航点停留计时（秒，>0 表示停步观望） */
  private patrolPause = 0;

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
    // 木桩 / 无敌单位不显示血条
    this.healthBar.visible = !this.invincible && !this.passive;
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

  /**
   * 写到世界坐标层（父级 worldRoot 负责镜头）。
   * zIndex = 脚底 worldY，参与纵深排序。
   */
  syncToWorld(): void {
    this.position.set(this.worldX, this.worldY - this.knock.height);
    this.zIndex = this.worldY;
  }

  /**
   * 按摄像机把世界坐标写到屏幕位置（旧 API，屏幕空间场景用）。
   * @param zoom 镜头缩放（与地图一致）
   */
  syncToScreen(
    cameraWorldX: number,
    cameraWorldY: number,
    screenCenterX: number,
    screenCenterY: number,
    zoom = 1,
  ): void {
    this.position.set(
      screenCenterX + (this.worldX - cameraWorldX) * zoom,
      screenCenterY +
        (this.worldY - cameraWorldY) * zoom -
        this.knock.height * zoom,
    );
  }

  /** 面向某世界点（只翻转贴图，血条不镜像） */
  faceToward(wx: number, _wy: number): void {
    const dx = wx - this.worldX;
    if (dx === 0) return;
    this.facing = dx < 0 ? -1 : 1;
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
    }

    // 木桩：完全无反馈（不抖、不转、不位移、不切 AI）
    if (this.passive) {
      return true;
    }

    applyKnockImpulse(this.knock, hit.knockVelX, hit.knockVelY, knockScale);

    this.blastKnock = Math.max(
      this.blastKnock,
      Math.min(1.25, hit.poseStrength),
    );
    if (hit.dirX !== 0) {
      this.facing = hit.dirX < 0 ? -1 : 1;
      this.applyFacingToSprite();
    }

    const turns = hit.airSpinTurns ?? 0;
    if (turns > 0) {
      this.spinT = 0;
      this.spinTarget = turns * Math.PI * 2;
      this.spinSign = hit.dirX < 0 ? -1 : 1;
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
   * 每帧：AI + 击退 + 姿态 / 空中转圈 + 血条。
   * @param playerWorldX / Y 玩家脚底（锁定 / 追击）
   * @param playerBodyProfileId 玩家碰撞模板（扑咬用 hurt 多形状判定）
   */
  update(
    deltaMS: number,
    playerWorldX: number,
    playerWorldY: number,
    playerBodyProfileId: BodyProfileId | null = null,
  ): SpiderUpdateResult {
    const dt = deltaMS / 1000;
    this.healthBar.update(deltaMS);

    // 木桩 / 固定体：钉死出生点，无姿态反馈
    if (this.passive || this.immovable) {
      this.worldX = this.homeX;
      this.worldY = this.homeY;
      this.knock.velX = 0;
      this.knock.velY = 0;
      this.knock.velZ = 0;
      this.knock.height = 0;
      this.blastKnock = 0;
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
      this.blastKnock > 0.35 ||
      (this.spinTarget > 0 && this.spinT < 1);

    if (this.isAlive && !stunned) {
      const aiResult = this.updateAI(
        dt,
        playerWorldX,
        playerWorldY,
        playerBodyProfileId,
      );
      if (aiResult.moved) moved = true;
      attackHit = aiResult.attackHit;
    } else if (this.attackCd > 0) {
      this.attackCd = Math.max(0, this.attackCd - dt);
    }

    const walking =
      !stunned &&
      moved &&
      (this.aiState === 'chase' || this.aiState === 'patrol');
    this.updatePose(dt, walking);

    return { moved, attackHit };
  }

  /** 在领地圆盘内均匀随机一个航点 */
  private pickPatrolWaypoint(): void {
    const angle = Math.random() * Math.PI * 2;
    // sqrt 使面积均匀，略偏外圈更像绕领地巡视
    const r = Math.sqrt(0.15 + 0.85 * Math.random()) * AI.territoryRadius;
    this.patrolTargetX = this.homeX + Math.cos(angle) * r;
    this.patrolTargetY = this.homeY + Math.sin(angle) * r;
  }

  private rollPatrolPause(): number {
    return (
      AI.patrolPauseMin +
      Math.random() * (AI.patrolPauseMax - AI.patrolPauseMin)
    );
  }

  /**
   * 未锁定：在领地内走航点 / 停步观望。
   * 顺带面向移动方向。
   */
  private updatePatrol(dt: number): boolean {
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

  private updateAI(
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

    // 察觉 → 永久锁定
    if (!this.locked && dist <= AI.detectRange) {
      this.locked = true;
      this.aiState = 'chase';
      this.patrolPause = 0;
    }

    // 未锁定：巡视领地
    if (!this.locked) {
      moved = this.updatePatrol(dt);
      return { moved, attackHit };
    }

    // 攻击状态机
    if (this.aiState === 'attack') {
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

    // 进入攻击：在范围内且冷却完毕
    if (dist <= AI.attackRange && this.attackCd <= 0) {
      this.aiState = 'attack';
      this.attackT = 0;
      this.attackDealt = false;
      this.attackPose = 0;
    }

    return { moved, attackHit };
  }

  private updatePose(dt: number, walking: boolean): void {
    const sprite = this.sprite;
    if (!sprite) return;

    let ox = 0;
    let oy = 0;
    let orot = 0;
    const spinning = this.spinTarget > 0 && this.spinT < 1;

    if (walking && !spinning && this.blastKnock < 0.15) {
      this.walkPhase += (Math.PI * 2 * dt) / WALK.period;
      const step = Math.sin(this.walkPhase * 2);
      const sway = Math.sin(this.walkPhase);
      oy += -Math.abs(step) * WALK.ampY;
      ox += sway * WALK.ampX;
      orot += sway * WALK.ampRot;
    } else if (!walking) {
      this.walkPhase = 0;
    }

    // 攻击姿态：局部空间（贴图已按 facing 翻转，负 X = 朝向后方）
    if (this.attackPose > 0.01 && this.aiState === 'attack') {
      const a = this.attackPose;
      if (this.attackT < AI.attackWindup) {
        ox += -10 * a;
        oy += 4 * a;
        orot += -0.28 * a;
      } else {
        ox += 14 * a;
        oy += -6 * a;
        orot += 0.35 * a;
      }
    }

    if (this.blastKnock > 0) {
      const b = this.blastKnock;
      oy += -BLAST.lift * b;
      if (!spinning) {
        orot += -BLAST.lean * b - BLAST.tumble * b * b;
      }
      ox += -6 * b;

      this.blastKnock *= Math.exp(-BLAST.settle * dt);
      if (this.blastKnock < 0.03) this.blastKnock = 0;
    }

    if (this.spinTarget > 0 && this.spinT < 1) {
      this.spinT = Math.min(1, this.spinT + dt / AIR_SPIN.duration);
      const u = this.spinT;
      const eased = 1 - (1 - u) * (1 - u);
      orot += this.spinSign * this.spinTarget * eased;
      const loft = 4 * u * (1 - u);
      oy += -AIR_SPIN.lift * loft;

      if (this.spinT >= 1) {
        this.spinTarget = 0;
        this.spinT = 0;
      }
    }

    // 转圈时绕身体中心转：锚点切到中心，补偿脚底→中心偏移
    if (spinning) {
      const sy = Math.abs(sprite.scale.y) || 1;
      const toCenterY =
        (ANCHOR_CENTER_Y - this.footAnchorY) * sprite.texture.height * sy;
      sprite.anchor.set(0.5, ANCHOR_CENTER_Y);
      sprite.x = ox;
      sprite.y = oy + toCenterY;
    } else {
      sprite.anchor.set(0.5, this.footAnchorY);
      sprite.x = ox;
      sprite.y = oy;
    }
    sprite.rotation = orot;
  }
}
