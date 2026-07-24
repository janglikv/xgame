import type {
  EntranceContext,
  EntranceLocks,
} from './CharacterEntrance';
import { ENTRANCE_UNLOCKED } from './CharacterEntrance';
import type { AmmoHudModel } from './CharacterResources';
import type {
  RangedAim,
  RangedCombatServices,
} from './CharacterRanged';
import { PlayerCharacterBase } from './PlayerCharacterBase';
import {
  DEFAULT_BOMB_AMMO,
  BombAmmo,
  type BombAmmoSnapshot,
  type BombAmmoStats,
} from './BombAmmo';
import { BOMB_MAX_RANGE } from './BombProjectile';

/** 出场三枚小炸弹落点半径（世界像素） */
const BOMB_ENTRANCE_RADIUS = 34;
const BOMB_ENTRANCE_COUNT = 3;
const BOMB_ENTRANCE_SIZE_SCALE = 0.7;
const BOMB_ENTRANCE_ORIGIN_HEIGHT = 24;

/**
 * 扔炸弹后仰（sprite 局部）。
 * textureFlipX=-1 时 scale.x 为负，正 X / 正旋转 才是“朝向反方向”后仰。
 */
const THROW = {
  /** 后仰角度（弧度） */
  lean: 0.32,
  /** 身体向后挪的像素 */
  push: 22,
  /** 略蹲一点 */
  crouch: 6,
  /** 回正速度 */
  settle: 9,
} as const;

/**
 * 扔弹出手点：相对脚底锚点的贴图像素偏移（贴图未镜像时）。
 * 炸弹妹持弹手在贴图左侧；改 x/y 可微调到手心。
 * - x：贴图坐标，左负右正
 * - y：贴图坐标，上负下正（脚底锚点附近 y≈0）
 */
const THROW_HAND_TEX = {
  x: -180,
  y: -230,
} as const;

/**
 * 玩家角色「炸炸」：橙发炸弹妹（整图预览）
 * 原点在脚底中心附近；可扔炸弹，带弹药上限与自动恢复。
 */
export class BombGirl extends PlayerCharacterBase {
  /**
   * 扔炸弹后仰强度 0→1；1 为最大后仰，每帧衰减。
   * 作用在 sprite 局部，翻转后仍相对朝向“向后”。
   */
  private throwRecoil = 0;
  private readonly ammo: BombAmmo;
  /** 出场：隐身等待首枚炸弹爆炸 */
  private entrancePending = false;

  constructor(scale = 1, ammoStats: BombAmmoStats = DEFAULT_BOMB_AMMO) {
    super(
      {
        characterId: 'bomb-girl',
        label: 'BombGirl',
        spriteLabel: 'BombGirlSprite',
        previewUrl: '/assets/bomb-girl/preview.png',
        textureFlipX: -1,
        canThrowBomb: true,
      },
      scale,
    );
    this.ammo = new BombAmmo(ammoStats);
  }

  /** 当前炸药库存（供 HUD / 调试） */
  get bombAmmo(): BombAmmoSnapshot {
    return this.ammo.snapshot;
  }

  /**
   * 解锁改写上限 / 恢复速率（后续技能树入口）。
   * @example girl.applyBombUnlock({ max: 16, regenPerSec: 3 })
   */
  applyBombUnlock(partial: Partial<BombAmmoStats>): void {
    this.ammo.applyUnlock(partial);
  }

  /** 尝试消耗一枚炸药；不足时返回 false */
  tryConsumeBomb(): boolean {
    return this.ammo.tryConsume(1);
  }

  /**
   * 炸药自动恢复（由场景在非暂停时经 tickResources 调用）。
   * 与 update 分离，避免暂停阶段偷回弹。
   */
  override tickResources(deltaMS: number): void {
    this.ammo.update(deltaMS / 1000);
  }

  override getAmmoHud(): AmmoHudModel {
    return { kind: 'bomb', snap: this.bombAmmo };
  }

  /**
   * 扔炸弹：clamp 最远距离 → 扣弹 → 后仰 → 生成抛物线炸弹。
   */
  override tryRangedAttack(
    aim: RangedAim,
    combat: RangedCombatServices,
  ): boolean {
    let landDx = aim.dx;
    let landDy = aim.dy;
    const worldDist = Math.hypot(landDx, landDy);
    if (worldDist > BOMB_MAX_RANGE) {
      const s = BOMB_MAX_RANGE / worldDist;
      landDx *= s;
      landDy *= s;
    }

    // 有效瞄准后再扣弹，避免点太近空耗（过近已在 Combat 过滤）
    if (!this.tryConsumeBomb()) return false;

    const endX = this.worldX + landDx;
    const endY = this.worldY + landDy;
    this.setFacingFromMoveX(endX - this.worldX);
    this.playThrowRecoil();

    const origin = this.getThrowOrigin(this.worldX, this.worldY);
    combat.spawnBomb(origin.x, origin.y, endX, endY, {
      originHeight: origin.height,
    });
    combat.notifyAmmoHud(this.getAmmoHud());
    return true;
  }

  /**
   * 扔弹出手点（世界坐标，与角色同层）。
   * 地面投影 + 离地高度，已含朝向翻转与角色缩放。
   * @param feetX 脚底世界 X
   * @param feetY 脚底世界 Y（不含击飞高度）
   */
  getThrowOrigin(feetX: number, feetY: number): {
    x: number;
    y: number;
    height: number;
  } {
    // scale.x 已含 facing × textureFlipX，贴图左侧出手点会随朝向镜像
    const dx = THROW_HAND_TEX.x * this.scale.x;
    const lift = -THROW_HAND_TEX.y * this.scale.y;
    return {
      x: feetX + dx,
      y: feetY,
      height: Math.max(4, lift),
    };
  }

  /** 扔炸弹瞬间触发：身体后仰一下再回正 */
  playThrowRecoil(): void {
    this.throwRecoil = 1;
  }

  /**
   * 炸炸出场：先隐身，原地抛三枚小炸弹，首次爆炸时显现。
   * 出场期间锁移动 / 攻击 / 切换。
   */
  override startEntrance(ctx: EntranceContext): void {
    this.cancelEntrance();
    this.alpha = 0;
    this.entrancePending = true;

    const landings: Array<{ endX: number; endY: number }> = [];
    for (let i = 0; i < BOMB_ENTRANCE_COUNT; i++) {
      const angle = -Math.PI / 2 + (i * Math.PI * 2) / BOMB_ENTRANCE_COUNT;
      landings.push({
        endX: this.worldX + Math.cos(angle) * BOMB_ENTRANCE_RADIUS,
        endY: this.worldY + Math.sin(angle) * BOMB_ENTRANCE_RADIUS,
      });
    }

    ctx.combat.throwBombBurst(
      this,
      landings,
      {
        originHeight: BOMB_ENTRANCE_ORIGIN_HEIGHT,
        sizeScale: BOMB_ENTRANCE_SIZE_SCALE,
        blast: {
          maxDamage: 12,
          minDamage: 4,
        },
      },
      () => {
        if (!this.entrancePending) return;
        this.entrancePending = false;
        this.alpha = 1;
      },
    );
  }

  override updateEntrance(
    _dt: number,
    _ctx: EntranceContext,
    _justLanded: boolean,
  ): void {
    // 显现由首爆回调驱动；无每帧演出
  }

  override cancelEntrance(): void {
    this.entrancePending = false;
    this.alpha = 1;
  }

  override get isEntranceActive(): boolean {
    return this.entrancePending;
  }

  override get entranceLocks(): EntranceLocks {
    if (!this.entrancePending) return ENTRANCE_UNLOCKED;
    return { move: true, attack: true, switch: true };
  }

  protected override applyExtraPose(dt: number): {
    x: number;
    y: number;
    rot: number;
  } {
    if (this.throwRecoil <= 0) {
      return { x: 0, y: 0, rot: 0 };
    }

    const r = this.throwRecoil;
    // 与 textureFlipX 配套：正号 = 视觉上朝投掷反方向后仰
    const delta = {
      x: THROW.push * r,
      y: THROW.crouch * r,
      rot: THROW.lean * r,
    };

    this.throwRecoil *= Math.exp(-THROW.settle * dt);
    if (this.throwRecoil < 0.02) this.throwRecoil = 0;

    return delta;
  }

  protected override canResetBobPhase(): boolean {
    return this.throwRecoil <= 0;
  }

  protected override onBlastKnock(): void {
    this.throwRecoil = 0;
  }
}
