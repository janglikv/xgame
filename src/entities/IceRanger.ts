import { Sprite } from 'pixi.js';
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
 * 位置与 getThrowOrigin 同一手点（贴图像素，挂在角色 sprite 下）。
 */
const HAND_SPEAR = {
  duration: 0.34,
  /** 旋入圈数 */
  spins: 1.2,
  /**
   * 握持静止角（sprite 局部，相对贴图默认朝向已扣 SPEAR_TEX_ANGLE）。
   * 尖大致朝前上，随角色 scale.x 翻转。
   */
  restRot: -Math.PI * 0.62 - SPEAR_TEX_ANGLE,
  /** 出现时从小到大的起始比例 */
  startScale: 0.15,
} as const;

/**
 * 冰霜游侠：直线投矛。
 * 原点在脚底中心附近。
 */
export class IceRanger extends PlayerCharacterBase {
  private throwRecoil = 0;
  private readonly characterScale: number;
  private readonly ammo: SpearAmmo;

  /** 手持下一枚矛（子节点挂在角色 sprite 上） */
  private handSpear: Sprite | null = null;
  /** 旋入进度 0→1；≥1 为静止握持 */
  private handSpearT = 1;
  /** 是否显示手持矛 */
  private handSpearVisible = false;

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
   * 尝试消耗一把飞剑。
   * 成功后：有余弹则手上旋入下一枚，否则收起手持矛。
   */
  tryConsumeSpear(): boolean {
    if (!this.ammo.tryConsume(1)) return false;
    if (this.ammo.hasAmmo) {
      this.playHandSpearSpinIn();
    } else {
      this.hideHandSpear();
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

  /** 投矛瞬间：身体后仰（手上矛由 tryConsumeSpear 处理） */
  playThrowRecoil(): void {
    this.throwRecoil = 1;
  }

  /**
   * 飞剑自动恢复（由场景在非暂停时调用）。
   * 与 update 分离，避免暂停 / 选角阶段偷回弹。
   * 恢复不播手上动画：弹回到账后直接握持。
   */
  tickSpearAmmo(deltaMS: number): void {
    const { restoredFromEmpty } = this.ammo.update(deltaMS / 1000);
    if (restoredFromEmpty) {
      this.showHandSpearReady();
    }
  }

  override update(deltaMS: number, moving: boolean): void {
    super.update(deltaMS, moving);
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

  /** 创建手持矛 sprite（挂在角色贴图下，随晃动 / 朝向） */
  private ensureHandSpear(): void {
    if (this.handSpear) return;
    const tex = getSpearTexture();
    const body = this.sprite;
    if (!tex || !body) return;

    const spear = new Sprite(tex);
    spear.anchor.set(0.5, 0.5);
    spear.label = 'IceRangerHandSpear';
    spear.position.set(THROW_HAND_TEX.x, THROW_HAND_TEX.y);
    // 角色容器已有 characterScale，本地再缩到与飞行矛世界尺寸一致
    const local = SPEAR_SCALE / Math.max(1e-6, this.characterScale);
    spear.scale.set(local);
    spear.visible = false;
    spear.alpha = 0;
    body.addChild(spear);
    this.handSpear = spear;
  }

  /** 出手后：下一枚立即从缩小+旋转旋入握持位 */
  private playHandSpearSpinIn(): void {
    this.ensureHandSpear();
    if (!this.handSpear) return;
    this.handSpearVisible = true;
    this.handSpearT = 0;
    this.handSpear.visible = true;
    this.applyHandSpearVisual(0);
  }

  /** 静止握持（满仓开局 / 解锁补弹） */
  private showHandSpearReady(): void {
    this.ensureHandSpear();
    if (!this.handSpear) return;
    this.handSpearVisible = true;
    this.handSpearT = 1;
    this.applyHandSpearVisual(1);
  }

  private hideHandSpear(): void {
    this.handSpearVisible = false;
    this.handSpearT = 1;
    if (this.handSpear) {
      this.handSpear.visible = false;
      this.handSpear.alpha = 0;
    }
  }

  private updateHandSpear(dt: number): void {
    if (!this.handSpear || !this.handSpearVisible) return;

    if (this.handSpearT < 1) {
      this.handSpearT = Math.min(1, this.handSpearT + dt / HAND_SPEAR.duration);
    }
    this.applyHandSpearVisual(this.handSpearT);
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
    spear.alpha = eased;
    // 从 rest - spins*2π 旋到 rest
    spear.rotation =
      HAND_SPEAR.restRot - (1 - eased) * HAND_SPEAR.spins * Math.PI * 2;
    spear.visible = true;
  }
}
