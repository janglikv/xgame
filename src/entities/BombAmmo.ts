/**
 * 炸炸药弹：数量上限 + 自动恢复。
 * 上限 / 恢复速率可被解锁改写，逻辑与场景解耦。
 */

export type BombAmmoStats = {
  /** 同时可持有的最大炸药数 */
  max: number;
  /** 每秒恢复数量（可为小数） */
  regenPerSec: number;
};

/**
 * 初始档：上限 12；恢复 1/s（飞剑默认的 1 倍）。
 */
export const DEFAULT_BOMB_AMMO: Readonly<BombAmmoStats> = {
  max: 12,
  regenPerSec: 1,
};

export type BombAmmoSnapshot = {
  current: number;
  max: number;
  /** 下一枚恢复进度 0→1；已满时为 0 */
  regenProgress: number;
  regenPerSec: number;
};

/**
 * 炸药库存：tryConsume 出手，update 按速率回满。
 */
export class BombAmmo {
  private current: number;
  private max: number;
  private regenPerSec: number;
  /** 累积恢复进度（满 1 加一枚） */
  private regenAcc = 0;

  constructor(stats: BombAmmoStats = DEFAULT_BOMB_AMMO) {
    this.max = Math.max(1, Math.floor(stats.max));
    this.regenPerSec = Math.max(0, stats.regenPerSec);
    this.current = this.max;
  }

  get snapshot(): BombAmmoSnapshot {
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
  applyUnlock(partial: Partial<BombAmmoStats>): void {
    if (partial.max !== undefined) {
      const nextMax = Math.max(1, Math.floor(partial.max));
      if (nextMax > this.max) {
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

  /** 消耗一枚；不足时返回 false */
  tryConsume(amount = 1): boolean {
    const n = Math.max(1, Math.floor(amount));
    if (this.current < n) return false;
    this.current -= n;
    return true;
  }

  /**
   * 按时间恢复。
   * @returns 本帧是否从 0 恢复到 ≥1
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
