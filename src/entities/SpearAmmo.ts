/**
 * 冰霜游侠飞剑弹药：数量上限 + 自动恢复。
 * 上限 / 恢复速率可被解锁改写，逻辑与场景解耦。
 */

export type SpearAmmoStats = {
  /** 同时可持有的最大飞剑数 */
  max: number;
  /** 每秒恢复数量（可为小数，如 1.5 = 2/3 秒一把） */
  regenPerSec: number;
};

/** 初始解锁档：上限 3，每秒恢复 1 */
export const DEFAULT_SPEAR_AMMO: Readonly<SpearAmmoStats> = {
  max: 3,
  regenPerSec: 1,
};

export type SpearAmmoSnapshot = {
  current: number;
  max: number;
  /** 下一把恢复进度 0→1；已满时为 0 */
  regenProgress: number;
  regenPerSec: number;
};

/**
 * 飞剑库存：tryConsume 出手，update 按速率回满。
 */
export class SpearAmmo {
  private current: number;
  private max: number;
  private regenPerSec: number;
  /** 累积恢复进度（满 1 加一把） */
  private regenAcc = 0;

  constructor(stats: SpearAmmoStats = DEFAULT_SPEAR_AMMO) {
    this.max = Math.max(1, Math.floor(stats.max));
    this.regenPerSec = Math.max(0, stats.regenPerSec);
    this.current = this.max;
  }

  get snapshot(): SpearAmmoSnapshot {
    return {
      current: this.current,
      max: this.max,
      regenProgress:
        this.current >= this.max || this.regenPerSec <= 0
          ? 0
          : Math.min(1, this.regenAcc),
      regenPerSec: this.regenPerSec,
    };
  }

  get isFull(): boolean {
    return this.current >= this.max;
  }

  get hasAmmo(): boolean {
    return this.current > 0;
  }

  /**
   * 解锁 / 升级：改上限或恢复速率。
   * 提高上限时补满新增格；降低上限时钳当前值。
   */
  applyUnlock(partial: Partial<SpearAmmoStats>): void {
    if (partial.max !== undefined) {
      const nextMax = Math.max(1, Math.floor(partial.max));
      if (nextMax > this.max) {
        // 扩容：新增格视为已装填
        this.current += nextMax - this.max;
      }
      this.max = nextMax;
      this.current = Math.min(this.current, this.max);
    }
    if (partial.regenPerSec !== undefined) {
      this.regenPerSec = Math.max(0, partial.regenPerSec);
    }
    if (this.current >= this.max) this.regenAcc = 0;
  }

  /** 消耗一把；不足时返回 false */
  tryConsume(amount = 1): boolean {
    const n = Math.max(1, Math.floor(amount));
    if (this.current < n) return false;
    this.current -= n;
    return true;
  }

  /**
   * 按时间恢复。
   * @returns 本帧是否从 0 恢复到 ≥1（便于播手上旋入）
   */
  update(dt: number): { restoredFromEmpty: boolean } {
    if (dt <= 0 || this.current >= this.max || this.regenPerSec <= 0) {
      if (this.current >= this.max) this.regenAcc = 0;
      return { restoredFromEmpty: false };
    }

    const wasEmpty = this.current <= 0;
    this.regenAcc += this.regenPerSec * dt;

    let gained = 0;
    while (this.regenAcc >= 1 && this.current < this.max) {
      this.regenAcc -= 1;
      this.current += 1;
      gained += 1;
    }
    if (this.current >= this.max) this.regenAcc = 0;

    return { restoredFromEmpty: wasEmpty && gained > 0 };
  }
}
