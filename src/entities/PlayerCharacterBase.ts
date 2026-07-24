import { Container, Sprite } from 'pixi.js';
import type { CharacterId } from './types';
import {
  ENTRANCE_UNLOCKED,
  type EntranceContext,
  type EntranceLocks,
} from './CharacterEntrance';
import {
  AMMO_HUD_NONE,
  type AmmoHudModel,
} from './CharacterResources';
import type {
  RangedAim,
  RangedCombatServices,
} from './CharacterRanged';
import { createKnockArcState, type KnockArcState } from './knockArc';
import type { WorldActor } from './WorldActor';
import {
  profileHurtOffset,
  profileHurtR,
  profileSolidR,
  type BodyProfileId,
} from '../data/bodyProfiles';
import {
  loadOutlinedTexture,
  OUTLINE_PX_CHARACTER,
  paddedFootAnchorY,
} from '../utils/outlineTexture';

/** 走路晃动参数（作用在 sprite 局部，不改世界坐标） */
const BOB = {
  /** 完整一步的周期（秒） */
  period: 0.28,
  /** 上下弹跳像素（相对原图像素） */
  ampY: 14,
  /** 左右微摆像素 */
  ampX: 4,
  /** 旋转幅度（弧度） */
  ampRot: 0.06,
  /** 停步时回正速度 */
  settle: 12,
} as const;

/** 被炸飞时的姿态反馈（高度由场景 knock 抛物线负责，这里只留轻微余量） */
const BLAST = {
  lean: 0.55,
  lift: 8,
  tumble: 0.9,
  settle: 5.5,
} as const;

/** 大弹空中旋转两圈（额外抬升交给世界高度抛物线） */
const AIR_SPIN = {
  /** 转完两圈的时长（秒） */
  duration: 0.62,
  /** 旋转期间额外局部抬升（主高度已在轨迹里） */
  lift: 0,
} as const;

/** 脚底锚点 / 中心锚点（旋转时切到中心） */
const ANCHOR_FOOT_Y = 0.92;
const ANCHOR_CENTER_Y = 0.5;

export type PlayerCharacterOptions = {
  characterId: CharacterId;
  label: string;
  spriteLabel: string;
  previewUrl: string;
  /**
   * 贴图默认水平朝向修正。
   * -1：贴图默认偏左，使逻辑朝右（facing=1）时视觉也朝右。
   */
  textureFlipX: 1 | -1;
  canThrowBomb?: boolean;
  /** 冰霜游侠：直线投矛 */
  canThrowSpear?: boolean;
};

type PoseDelta = { x: number; y: number; rot: number };

/**
 * 玩家角色公共基类：世界坐标、贴图加载、朝向、镜头缩放、走路晃动、受击 / 空中转圈。
 * 具体角色只填配置；投弹等能力在子类扩展。
 * 脚底 worldX/Y 与 knock 由实体持有（WorldActor），场景不再另存一份。
 */
export abstract class PlayerCharacterBase
  extends Container
  implements WorldActor
{
  readonly characterId: CharacterId;
  readonly canThrowBomb: boolean;
  readonly canThrowSpear: boolean;

  /** 与 characterId 对齐的碰撞模板 */
  get bodyProfileId(): BodyProfileId {
    return this.characterId;
  }

  get bodyR(): number {
    return profileSolidR(this.bodyProfileId);
  }

  get hurtR(): number {
    return profileHurtR(this.bodyProfileId);
  }

  /** 第一 hurt 中心（多形状时取首个） */
  get hurtWorldX(): number {
    return this.worldX + profileHurtOffset(this.bodyProfileId).ox;
  }

  get hurtWorldY(): number {
    return this.worldY + profileHurtOffset(this.bodyProfileId).oy;
  }

  /** 脚底世界坐标（与蜘蛛同一空间） */
  worldX = 0;
  worldY = 0;
  /** 被炸飞 / 击退：地面速度 + 高度抛物线 */
  readonly knock: KnockArcState = createKnockArcState();

  private readonly previewUrl: string;
  private readonly spriteLabel: string;
  private readonly textureFlipX: 1 | -1;

  protected sprite: Sprite | null = null;
  private readonly baseScale: number;
  /**
   * 脚底锚点 Y（贴图 fraction）。
   * 描边外扩后会相对 ANCHOR_FOOT_Y 重算，保证脚底世界位置不变。
   */
  private footAnchorY = ANCHOR_FOOT_Y;
  /** 镜头缩放倍率（与地图 zoom 同步） */
  private viewScale = 1;
  /** 1 = 朝右，-1 = 朝左 */
  private facing: 1 | -1 = 1;
  /** 走路相位 */
  private bobPhase = 0;
  /** 走路晃 / 回正（不含子类附加姿态） */
  private poseX = 0;
  private poseY = 0;
  private poseRot = 0;
  /** 被炸飞姿态强度 0→1+ */
  private blastKnock = 0;
  /** 空中旋转进度 0→1；>0 时播放多圈旋转 */
  private spinT = 0;
  /** 目标旋转弧度（如 2 圈 = 4π） */
  private spinTarget = 0;
  /** 旋转方向（与击飞水平方向一致） */
  private spinSign: 1 | -1 = 1;

  protected constructor(options: PlayerCharacterOptions, scale = 1) {
    super();
    this.characterId = options.characterId;
    this.canThrowBomb = options.canThrowBomb ?? false;
    this.canThrowSpear = options.canThrowSpear ?? false;
    this.previewUrl = options.previewUrl;
    this.spriteLabel = options.spriteLabel;
    this.textureFlipX = options.textureFlipX;
    this.label = options.label;
    this.baseScale = scale;
    this.applyContainerScale();
  }

  /** 把脚底世界坐标写到显示位置（含 knock 高度） */
  syncToWorld(): void {
    this.position.set(this.worldX, this.worldY - this.knock.height);
    this.zIndex = this.worldY;
  }

  /** 是否有点击瞄准的远程攻击（炸弹 / 矛） */
  get canRangedAttack(): boolean {
    return this.canThrowBomb || this.canThrowSpear;
  }

  /**
   * 出场演出：默认无。子类覆盖实现角色专属登场。
   * 场景只负责注入 EntranceContext 并每帧 updateEntrance。
   */
  startEntrance(_ctx: EntranceContext): void {
    // no-op
  }

  /**
   * 推进出场演出与短命世界特效。
   * @param justLanded 本帧 knock 是否刚落地（冰空降用）
   */
  updateEntrance(
    _dt: number,
    _ctx: EntranceContext,
    _justLanded: boolean,
  ): void {
    // no-op
  }

  /** 中断出场（切换角色等）；默认无状态可清 */
  cancelEntrance(): void {
    // no-op
  }

  /** 出场是否进行中（含等待炸弹首爆等） */
  get isEntranceActive(): boolean {
    return false;
  }

  /** 出场期间输入锁；默认全开 */
  get entranceLocks(): EntranceLocks {
    return ENTRANCE_UNLOCKED;
  }

  /**
   * 推进弹药 / 能量等资源（仅非暂停时由场景调用）。
   * 默认无资源；子类覆盖。
   */
  tickResources(_deltaMS: number): void {
    // no-op
  }

  /**
   * 当前弹药 HUD 模型。场景按 kind 显示对应组件，避免 instanceof 角色类。
   */
  getAmmoHud(): AmmoHudModel {
    return AMMO_HUD_NONE;
  }

  /**
   * 远程攻击：角色决定打什么，经 combat 服务生成投射物。
   * 默认无远程；子类覆盖。返回是否成功发起（含进入前摇）。
   */
  tryRangedAttack(
    _aim: RangedAim,
    _combat: RangedCombatServices,
  ): boolean {
    return false;
  }

  /**
   * Q 键特技：默认无；子类覆盖。
   * @param combat 远程战斗服务（剑阵等免费投射物）
   * @param ctx 出场/特效上下文（残影等世界 FX）
   * @param aim 指针相对脚底的世界瞄准向量（未归一化）；缺省时角色自定 fallback
   * @returns 是否成功发动
   */
  trySpecialAbility(
    _combat?: RangedCombatServices,
    _ctx?: EntranceContext,
    _aim?: RangedAim,
  ): boolean {
    return false;
  }

  async load(): Promise<void> {
    if (this.sprite) return;

    const outlined = await loadOutlinedTexture(
      this.previewUrl,
      OUTLINE_PX_CHARACTER,
    );
    this.footAnchorY = paddedFootAnchorY(
      ANCHOR_FOOT_Y,
      outlined.contentHeight,
      outlined.pad,
    );
    const sprite = new Sprite(outlined.texture);
    sprite.anchor.set(0.5, this.footAnchorY);
    sprite.label = this.spriteLabel;
    this.sprite = sprite;
    this.addChild(sprite);
  }

  /** 与镜头 zoom 同步，保证缩全景时角色相对地图正确 */
  setViewScale(zoom: number): void {
    const z = Math.max(1e-4, zoom);
    if (Math.abs(z - this.viewScale) < 1e-6) return;
    this.viewScale = z;
    this.applyContainerScale();
  }

  private applyContainerScale(): void {
    const s = this.baseScale * this.viewScale;
    // 逻辑朝向 × 贴图修正（scale.x 符号不再等同于 facing）
    this.scale.x = s * this.facing * this.textureFlipX;
    this.scale.y = s;
  }

  /** 逻辑朝向：1 = 朝右，-1 = 朝左（不受贴图翻转影响） */
  get facingDir(): 1 | -1 {
    return this.facing;
  }

  /**
   * 根据水平移动方向左右翻转。
   * @param dirX 负值朝左，正值朝右；0 保持不变
   */
  setFacingFromMoveX(dirX: number): void {
    if (dirX === 0) return;
    const next: 1 | -1 = dirX < 0 ? -1 : 1;
    if (next === this.facing) return;
    this.facing = next;
    this.applyContainerScale();
  }

  /**
   * 被爆炸崩飞时的姿态：抬起 + 翻仰；大弹可空中转多圈。
   * @param strength 0~1，距爆心越近越大
   * @param dirX 击退水平方向（世界），用于转身 / 旋转方向
   * @param airSpinTurns 空中旋转圈数（大弹为 2）
   */
  playBlastKnock(strength: number, dirX = 0, airSpinTurns = 0): void {
    this.onBlastKnock();
    this.blastKnock = Math.max(this.blastKnock, Math.min(1.25, strength));
    if (dirX !== 0) this.setFacingFromMoveX(dirX);

    if (airSpinTurns > 0) {
      this.spinT = 0;
      this.spinTarget = airSpinTurns * Math.PI * 2;
      this.spinSign = dirX < 0 ? -1 : 1;
    }
  }

  /** 是否在空中翻滚（走路晃动应关闭） */
  get isAirSpinning(): boolean {
    return this.spinT > 0 && this.spinT < 1;
  }

  /**
   * 每帧更新。移动时图片上下晃 + 轻微摇摆，停下回正；可叠加受击 / 子类姿态。
   * @param deltaMS 帧间隔毫秒
   * @param moving 是否在移动
   */
  update(deltaMS: number, moving: boolean): void {
    const sprite = this.sprite;
    if (!sprite) return;

    const dt = deltaMS / 1000;
    const spinning = this.spinTarget > 0 && this.spinT < 1;
    const tumbling = this.blastKnock > 0.15 || spinning;

    if (moving && !tumbling) {
      this.bobPhase += (Math.PI * 2 * dt) / BOB.period;
      // 双频：一步两拍弹跳
      const step = Math.sin(this.bobPhase * 2);
      const sway = Math.sin(this.bobPhase);

      this.poseY = -Math.abs(step) * BOB.ampY;
      this.poseX = sway * BOB.ampX;
      this.poseRot = sway * BOB.ampRot;
    } else if (!tumbling) {
      // 走路姿态指数回正
      const k = 1 - Math.exp(-BOB.settle * dt);
      this.poseX += (0 - this.poseX) * k;
      this.poseY += (0 - this.poseY) * k;
      this.poseRot += (0 - this.poseRot) * k;

      if (Math.abs(this.poseX) < 0.05) this.poseX = 0;
      if (Math.abs(this.poseY) < 0.05) this.poseY = 0;
      if (Math.abs(this.poseRot) < 0.001) this.poseRot = 0;

      if (
        this.poseX === 0 &&
        this.poseY === 0 &&
        this.blastKnock <= 0 &&
        !spinning &&
        this.canResetBobPhase()
      ) {
        this.bobPhase = 0;
      }
    }

    let ox = this.poseX;
    let oy = this.poseY;
    let orot = this.poseRot;

    // 子类附加姿态（如扔弹后仰）
    const extra = this.applyExtraPose(dt);
    ox += extra.x;
    oy += extra.y;
    orot += extra.rot;

    if (this.blastKnock > 0) {
      const b = this.blastKnock;
      // 普通被炸：抬起、后仰；大弹转圈时主要用 spin 旋转，这里只保留抬升
      oy += -BLAST.lift * b;
      if (!spinning) {
        orot += BLAST.lean * b + BLAST.tumble * b * b;
      }
      ox += 8 * b;

      this.blastKnock *= Math.exp(-BLAST.settle * dt);
      if (this.blastKnock < 0.03) this.blastKnock = 0;
    }

    // 大弹：约 0.62s 内转满 spinTarget（默认两圈），绕身体中心旋转
    if (this.spinTarget > 0 && this.spinT < 1) {
      this.spinT = Math.min(1, this.spinT + dt / AIR_SPIN.duration);
      // ease-out：先快后慢
      const u = this.spinT;
      const eased = 1 - (1 - u) * (1 - u);
      orot += this.spinSign * this.spinTarget * eased;
      // 抛物线抬升：中间最高
      const loft = 4 * u * (1 - u);
      oy += -AIR_SPIN.lift * loft;

      if (this.spinT >= 1) {
        this.spinTarget = 0;
        this.spinT = 0;
      }
    }

    // 转圈时锚点切到中心，脚底原点改算到身体中心，避免绕脚甩
    if (spinning || (this.spinTarget > 0 && this.spinT > 0)) {
      const h = sprite.texture.height;
      // 脚底 → 中心的本地偏移（贴图像素；父级 scale 统一缩放）
      const toCenterY = (ANCHOR_CENTER_Y - this.footAnchorY) * h;
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

  /** 子类可叠加的局部姿态（默认无） */
  protected applyExtraPose(_dt: number): PoseDelta {
    return { x: 0, y: 0, rot: 0 };
  }

  /** 走路相位是否允许清零（子类有持续姿态时返回 false） */
  protected canResetBobPhase(): boolean {
    return true;
  }

  /** 受击开始时子类清理（如中断扔弹后仰） */
  protected onBlastKnock(): void {
    // no-op
  }
}
