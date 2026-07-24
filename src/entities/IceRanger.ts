import { Container, Graphics, Sprite } from 'pixi.js';
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
import { applyRecoilHop } from './knockArc';
import { PlayerCharacterBase } from './PlayerCharacterBase';
import {
  DEFAULT_SPEAR_AMMO,
  SpearAmmo,
  type SpearAmmoSnapshot,
  type SpearAmmoStats,
} from './SpearAmmo';
import {
  getSpearTexture,
  loadSpearTexture,
  SPEAR_SCALE,
  SPEAR_TEX_ANGLE,
} from './SpearProjectile';

/** 空降初始离地高度（世界像素） */
const ICE_ENTRANCE_HEIGHT = 90;
/** 初始向下速度，使空降约 0.13 秒完成 */
const ICE_ENTRANCE_DROP_SPEED = 600;
const ICE_ENTRANCE_START_ALPHA = 0;
const ICE_LANDING_FX_DURATION = 0.32;
const ICE_AFTERIMAGE_INTERVAL = 0.035;
const ICE_AFTERIMAGE_DURATION = 0.24;
/** 落地后免费三连射发数 */
const ICE_ENTRANCE_VOLLEY_COUNT = 3;

/**
 * 投矛后仰（sprite 局部）。
 * textureFlipX=-1 时正 X / 正旋转 = 朝投掷反方向后仰。
 */
const THROW = {
  lean: 0.28,
  push: 18,
  crouch: 5,
  settle: 10,
} as const;

/**
 * 投矛时自身后跳：沿投掷反方向的地面冲量（像素/秒）。
 * 走场景 knock 抛物线，会带一点小 hop。
 */
export const SPEAR_THROW_RECOIL_SPEED = 165;

/**
 * 出手点：相对脚底锚点的贴图像素偏移（贴图未镜像时）。
 * 冰霜游侠偏正面；持矛手取身体左侧略高处，随朝向镜像。
 */
const THROW_HAND_TEX = {
  x: -160,
  y: -210,
} as const;

/**
 * 出手后下一枚矛在手上旋转出现。
 * 位置与 getThrowOrigin 同一手点（贴图像素，经 handAttach 对齐角色姿态）。
 * 当弹药用尽等待 CD 恢复时，准备动画与 CD 冷却进度 100% 绑定。
 */
const HAND_SPEAR = {
  /** 有余弹时快速抽剑旋入时长（0.2 秒，保证连发爽快感） */
  fastSpinDuration: 0.2,
  /** 旋入圈数（多转一圈由 1.2 调至 2.2） */
  spins: 2.2,
  /**
   * 握持静止角（sprite 局部，相对贴图默认朝向已扣 SPEAR_TEX_ANGLE，目标角度 -30°）。
   * 尖大致朝前上，随角色 scale.x 翻转。
   */
  restRot: -Math.PI * 0.62 - SPEAR_TEX_ANGLE - (30 * Math.PI) / 180,
  /** 出现时从小到大的起始比例 */
  startScale: 0.15,
} as const;

/**
 * 玩家角色「冰冰」：冰霜游侠，直线投矛。
 * 原点在脚底中心附近。
 */
export class IceRanger extends PlayerCharacterBase {
  private throwRecoil = 0;
  private readonly characterScale: number;
  private readonly ammo: SpearAmmo;

  /**
   * 手持矛挂点：与角色 sprite 同级，每帧同步 sprite 的位移/旋转。
   * Pixi v8 起 Sprite 不再是 Container，不能把矛直接 addChild 到贴图上。
   */
  private handAttach: Container | null = null;
  /** 手持下一枚矛（子节点挂在 handAttach 上） */
  private handSpear: Sprite | null = null;
  /** 有余弹时快速旋入进度 0→1；≥1 为静止握持 */
  private handSpearT = 1;
  /** 是否处于 CD 召唤凝结模式（当无余弹在等 CD 恢复时） */
  private isCdSummoning = false;
  /** 是否显示手持矛 */
  private handSpearVisible = false;
  /** 是否处于手持飞剑发射甩动前摇中 */
  private isLaunching = false;
  private launchTime = 0;
  private launchStartRot = 0;
  private launchTargetRot = 0;
  private launchOnRelease: (() => void) | null = null;

  /** 出场：空降中 */
  private entranceDropping = false;
  private iceAfterimageElapsed = 0;
  private readonly entranceAfterimages: Array<{
    sprite: Sprite;
    elapsed: number;
  }> = [];
  private readonly landingEffects: Array<{
    gfx: Graphics;
    elapsed: number;
  }> = [];

  constructor(scale = 1, ammoStats: SpearAmmoStats = DEFAULT_SPEAR_AMMO) {
    super(
      {
        characterId: 'ice-ranger',
        label: 'IceRanger',
        spriteLabel: 'IceRangerSprite',
        previewUrl: '/assets/ice-ranger/preview.png',
        textureFlipX: -1,
        canThrowBomb: false,
        canThrowSpear: true,
      },
      scale,
    );
    this.characterScale = scale;
    this.ammo = new SpearAmmo(ammoStats);
  }

  override async load(): Promise<void> {
    await super.load();
    await loadSpearTexture();
    this.ensureHandSpear();
    // 满仓开局：手上直接握一把（无旋入）
    if (this.ammo.hasAmmo) {
      this.showHandSpearReady();
    }
  }

  /** 当前飞剑库存（供 HUD / 调试） */
  get spearAmmo(): SpearAmmoSnapshot {
    return this.ammo.snapshot;
  }

  /**
   * 解锁改写上限 / 恢复速率（后续技能树入口）。
   * @example ranger.applySpearUnlock({ max: 5, regenPerSec: 1.5 })
   */
  applySpearUnlock(partial: Partial<SpearAmmoStats>): void {
    this.ammo.applyUnlock(partial);
    if (this.ammo.hasAmmo && !this.handSpearVisible) {
      this.showHandSpearReady();
    }
  }

  /**
   * 触发手上飞剑后拉蓄力 + 划弧斩出前摇，并在脱手瞬间回调生成飞行投射物
   */
  launchSpear(dirX: number, dirY: number, onRelease: () => void): boolean {
    if (!this.ammo.hasAmmo || this.isLaunching) return false;

    this.ensureHandSpear();
    if (!this.handSpear) return false;

    const worldAngle = Math.atan2(dirY, dirX);
    const facingLeft = this.scale.x < 0;
    const localTargetRot = facingLeft
      ? Math.PI - worldAngle - SPEAR_TEX_ANGLE
      : worldAngle - SPEAR_TEX_ANGLE;

    this.isLaunching = true;
    this.launchTime = 0;
    this.launchStartRot = this.handSpear.rotation;
    this.launchTargetRot = localTargetRot;
    this.launchOnRelease = onRelease;

    this.handSpearVisible = true;
    this.handSpear.visible = true;

    this.playThrowRecoil();
    return true;
  }

  /**
   * 尝试消耗一把飞剑。
   * 成功后：有余弹则快速换枪旋入下一枚；
   * 否则开启 CD 召唤模式，准备动画跟随 CD 恢复进度同步凝结。
   */
  tryConsumeSpear(): boolean {
    if (!this.ammo.tryConsume(1)) return false;
    if (this.ammo.hasAmmo) {
      this.isCdSummoning = false;
      this.playHandSpearSpinIn();
    } else {
      // 弹药耗尽：进入 CD 凝结召唤，飞剑动画随 CD 恢复进度（0->1）平滑播放
      this.isCdSummoning = true;
      this.handSpearVisible = true;
      if (this.handSpear) {
        this.handSpear.visible = true;
      }
      this.applyHandSpearVisual(0);
    }
    return true;
  }

  /**
   * 投矛出手点（世界坐标）。
   * @param feetX 脚底世界 X
   * @param feetY 脚底世界 Y（不含击飞高度）
   */
  getThrowOrigin(feetX: number, feetY: number): {
    x: number;
    y: number;
    height: number;
  } {
    const dx = THROW_HAND_TEX.x * this.scale.x;
    const lift = -THROW_HAND_TEX.y * this.scale.y;
    return {
      x: feetX + dx,
      y: feetY,
      height: Math.max(4, lift),
    };
  }

  /**
   * 冰冰出场：当前位置上空垂直落下，残影拖尾，落地冲击环 + 免费三连矛。
   */
  override startEntrance(ctx: EntranceContext): void {
    this.cancelEntrance();
    this.knock.velX = 0;
    this.knock.velY = 0;
    this.knock.velZ = -ICE_ENTRANCE_DROP_SPEED;
    this.knock.height = ICE_ENTRANCE_HEIGHT;
    this.alpha = ICE_ENTRANCE_START_ALPHA;
    this.entranceDropping = true;
    this.iceAfterimageElapsed = ICE_AFTERIMAGE_INTERVAL;
    this.spawnEntranceAfterimage(ctx);
  }

  override updateEntrance(
    dt: number,
    ctx: EntranceContext,
    justLanded: boolean,
  ): void {
    this.updateEntranceAfterimages(dt);
    this.updateLandingEffects(dt);

    if (!this.entranceDropping) return;

    const appearProgress = 1 - this.knock.height / ICE_ENTRANCE_HEIGHT;
    this.alpha =
      ICE_ENTRANCE_START_ALPHA +
      (1 - ICE_ENTRANCE_START_ALPHA) * appearProgress;
    this.iceAfterimageElapsed += dt;
    if (this.iceAfterimageElapsed >= ICE_AFTERIMAGE_INTERVAL) {
      this.iceAfterimageElapsed -= ICE_AFTERIMAGE_INTERVAL;
      this.spawnEntranceAfterimage(ctx);
    }
    if (justLanded) {
      this.finishEntrance(ctx);
    }
  }

  override cancelEntrance(): void {
    this.entranceDropping = false;
    this.alpha = 1;
    this.clearEntranceAfterimages();
    // 离场后不再 tick updateEntrance，落地环一并清掉避免残留
    this.clearLandingEffects();
  }

  override get isEntranceActive(): boolean {
    return this.entranceDropping;
  }

  override get entranceLocks(): EntranceLocks {
    if (!this.entranceDropping) return ENTRANCE_UNLOCKED;
    // 空降中锁移动/攻击，允许切换（场景会 cancel）
    return { move: true, attack: true, switch: false };
  }

  /** 落地：冲击环 + 自动瞄准三连发 */
  private finishEntrance(ctx: EntranceContext): void {
    if (!this.entranceDropping) return;
    this.entranceDropping = false;
    this.alpha = 1;
    this.spawnLandingEffect(ctx);
    ctx.combat.fireFreeAutoAimSpearVolley(
      this,
      ctx.getTargets(),
      ICE_ENTRANCE_VOLLEY_COUNT,
    );
  }

  private spawnEntranceAfterimage(ctx: EntranceContext): void {
    const body = this.sprite;
    if (!body) return;

    const ghost = new Sprite(body.texture);
    ghost.label = 'IceEntranceAfterimage';
    ghost.anchor.set(body.anchor.x, body.anchor.y);
    ghost.position.set(
      this.worldX + body.x * this.scale.x,
      this.worldY - this.knock.height + body.y * this.scale.y,
    );
    ghost.scale.set(
      this.scale.x * body.scale.x,
      this.scale.y * body.scale.y,
    );
    ghost.rotation = this.scale.x < 0 ? -body.rotation : body.rotation;
    ghost.tint = 0xa9e7ff;
    ghost.alpha = 0.42;
    ghost.eventMode = 'none';

    ctx.addWorldFx(ghost, this.worldY - 2);
    this.entranceAfterimages.push({ sprite: ghost, elapsed: 0 });
  }

  private updateEntranceAfterimages(dt: number): void {
    for (let i = this.entranceAfterimages.length - 1; i >= 0; i--) {
      const effect = this.entranceAfterimages[i]!;
      effect.elapsed += dt;
      const progress = Math.min(1, effect.elapsed / ICE_AFTERIMAGE_DURATION);
      effect.sprite.alpha = 0.42 * (1 - progress);
      if (progress < 1) continue;

      effect.sprite.parent?.removeChild(effect.sprite);
      effect.sprite.destroy();
      this.entranceAfterimages.splice(i, 1);
    }
  }

  private clearEntranceAfterimages(): void {
    for (const effect of this.entranceAfterimages) {
      effect.sprite.parent?.removeChild(effect.sprite);
      effect.sprite.destroy();
    }
    this.entranceAfterimages.length = 0;
  }

  private spawnLandingEffect(ctx: EntranceContext): void {
    const gfx = new Graphics();
    gfx.label = 'IceEntranceLandingFx';
    gfx
      .ellipse(0, 0, 34, 13)
      .fill({ color: 0xa9e7ff, alpha: 0.2 })
      .stroke({ width: 4, color: 0x8bdcff, alpha: 0.95 });
    gfx.position.set(this.worldX, this.worldY);
    ctx.addWorldFx(gfx, this.worldY - 1);
    this.landingEffects.push({ gfx, elapsed: 0 });
  }

  private updateLandingEffects(dt: number): void {
    for (let i = this.landingEffects.length - 1; i >= 0; i--) {
      const effect = this.landingEffects[i]!;
      effect.elapsed += dt;
      const progress = Math.min(1, effect.elapsed / ICE_LANDING_FX_DURATION);
      effect.gfx.scale.set(1 + progress * 1.8);
      effect.gfx.alpha = 1 - progress;
      if (progress < 1) continue;

      effect.gfx.parent?.removeChild(effect.gfx);
      effect.gfx.destroy();
      this.landingEffects.splice(i, 1);
    }
  }

  private clearLandingEffects(): void {
    for (const effect of this.landingEffects) {
      effect.gfx.parent?.removeChild(effect.gfx);
      effect.gfx.destroy();
    }
    this.landingEffects.length = 0;
  }

  /** 投矛瞬间：身体后仰（手上矛由 tryConsumeSpear 处理） */
  playThrowRecoil(): void {
    this.throwRecoil = 1;
  }

  /**
   * 飞剑自动恢复（由场景在非暂停时经 tickResources 调用）。
   * 与 update 分离，避免暂停阶段偷回弹。
   */
  override tickResources(deltaMS: number): void {
    const { restoredFromEmpty } = this.ammo.update(deltaMS / 1000);
    if (restoredFromEmpty) {
      this.isCdSummoning = false;
      this.showHandSpearReady();
    }
  }

  override getAmmoHud(): AmmoHudModel {
    return { kind: 'spear', snap: this.spearAmmo };
  }

  /**
   * 投矛：前摇甩剑 → 脱手瞬间后坐 + 生成直线矛（扣弹在 launch 结束时）。
   */
  override tryRangedAttack(
    aim: RangedAim,
    combat: RangedCombatServices,
  ): boolean {
    const aimLen = Math.hypot(aim.dx, aim.dy);
    if (aimLen < 1e-4) return false;
    const inv = 1 / aimLen;
    const dirX = aim.dx * inv;
    const dirY = aim.dy * inv;

    this.setFacingFromMoveX(aim.dx);

    return this.launchSpear(dirX, dirY, () => {
      applyRecoilHop(
        this.knock,
        -dirX,
        -dirY,
        SPEAR_THROW_RECOIL_SPEED,
      );
      // 脱手瞬间再取脚底，与前摇期间位移一致
      const origin = this.getThrowOrigin(this.worldX, this.worldY);
      combat.spawnSpear(origin.x, origin.y, dirX, dirY, {
        originHeight: origin.height,
      });
      combat.notifyAmmoHud(this.getAmmoHud());
    });
  }

  override update(deltaMS: number, moving: boolean): void {
    super.update(deltaMS, moving);
    this.syncHandAttach();
    this.updateHandSpear(deltaMS / 1000);
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

  /** 创建手持矛 sprite（经 handAttach 跟随角色姿态：晃动 / 后仰 / 朝向） */
  private ensureHandSpear(): void {
    if (this.handSpear) return;
    const tex = getSpearTexture();
    if (!tex || !this.sprite) return;

    if (!this.handAttach) {
      const attach = new Container();
      attach.label = 'IceRangerHandAttach';
      this.addChild(attach);
      this.handAttach = attach;
    }

    const spear = new Sprite(tex);
    spear.anchor.set(0.5, 0.5);
    spear.label = 'IceRangerHandSpear';
    spear.position.set(THROW_HAND_TEX.x, THROW_HAND_TEX.y);
    // 角色容器已有 characterScale，本地再缩到与飞行矛世界尺寸一致
    const local = SPEAR_SCALE / Math.max(1e-6, this.characterScale);
    spear.scale.set(local);
    spear.visible = false;
    spear.alpha = 0;
    this.handAttach.addChild(spear);
    this.handSpear = spear;
    this.syncHandAttach();
  }

  /** 把手持挂点对齐到角色贴图当前局部姿态（与旧「挂在 sprite 下」等价） */
  private syncHandAttach(): void {
    const attach = this.handAttach;
    const body = this.sprite;
    if (!attach || !body) return;
    attach.position.set(body.x, body.y);
    attach.rotation = body.rotation;
  }

  /** 出手后（且尚有余弹）：下一枚在 0.2s 内快速旋入握持位 */
  private playHandSpearSpinIn(): void {
    this.ensureHandSpear();
    if (!this.handSpear) return;
    this.handSpearVisible = true;
    this.handSpearT = 0;
    this.handSpear.visible = true;
    this.applyHandSpearVisual(0);
  }

  /** 静止握持（满仓开局 / 解锁补弹 / CD 恢复完成） */
  private showHandSpearReady(): void {
    this.ensureHandSpear();
    if (!this.handSpear) return;
    this.handSpearVisible = true;
    this.handSpearT = 1;
    this.isCdSummoning = false;
    this.applyHandSpearVisual(1);
  }

  private updateHandSpear(dt: number): void {
    if (!this.handSpear || !this.handSpearVisible) return;

    if (this.isLaunching) {
      this.launchTime += dt;
      const duration = 0.11; // 110ms 强打击感划弧甩出前摇
      const progress = Math.min(1, this.launchTime / duration);
      const facingLeft = this.scale.x < 0;

      let currentRot = this.launchStartRot;
      if (progress < 0.25) {
        // 0~25% 时间：往后拉剑蓄力
        const u = progress / 0.25;
        const pullBack = Math.sin(u * Math.PI * 0.5) * 0.35;
        currentRot =
          this.launchStartRot - (facingLeft ? -pullBack : pullBack);
      } else {
        // 25%~100% 时间：弧形斩出，尖端直指目标
        const u = (progress - 0.25) / 0.75;
        const eased = u * u * (3 - 2 * u);
        const startRot =
          this.launchStartRot - (facingLeft ? -0.35 : 0.35);
        currentRot = startRot + (this.launchTargetRot - startRot) * eased;
      }

      this.handSpear.rotation = currentRot;
      this.handSpear.alpha = 1;
      this.handSpear.visible = true;

      if (progress >= 1) {
        this.isLaunching = false;
        const cb = this.launchOnRelease;
        this.launchOnRelease = null;
        this.tryConsumeSpear();
        if (cb) cb();
      }
      return;
    }

    if (this.isCdSummoning) {
      // 处于 CD 恢复期（库存为 0）：手持飞剑准备动画 1:1 绑定 CD 恢复进度 (0->1)
      const snapshot = this.ammo.snapshot;
      if (snapshot.current > 0) {
        this.isCdSummoning = false;
        this.showHandSpearReady();
      } else {
        const progress = snapshot.regenProgress;
        this.applyHandSpearVisual(progress);
      }
    } else {
      // 连发换弹（尚有余弹）：0.2s 内快速旋入
      if (this.handSpearT < 1) {
        this.handSpearT = Math.min(
          1,
          this.handSpearT + dt / HAND_SPEAR.fastSpinDuration,
        );
      }
      this.applyHandSpearVisual(this.handSpearT);
    }
  }

  /**
   * @param t 0→1 旋入；1 = 握持静止
   */
  private applyHandSpearVisual(t: number): void {
    const spear = this.handSpear;
    if (!spear) return;

    // ease-out cubic：先快后慢落位
    const u = Math.min(1, Math.max(0, t));
    const eased = 1 - (1 - u) * (1 - u) * (1 - u);

    const local = SPEAR_SCALE / Math.max(1e-6, this.characterScale);
    const s =
      local *
      (HAND_SPEAR.startScale + (1 - HAND_SPEAR.startScale) * eased);
    spear.scale.set(s);
    spear.alpha = Math.max(0.08, eased);
    // 从 rest - spins*2π 旋到 rest
    spear.rotation =
      HAND_SPEAR.restRot - (1 - eased) * HAND_SPEAR.spins * Math.PI * 2;
    spear.visible = true;
  }
}
