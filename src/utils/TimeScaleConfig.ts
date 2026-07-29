/**
 * 全局时间倍率配置（支持 0.1x ~ 500x 时间加速）
 */
const STORAGE_KEY = 'xgame_time_scale';
const PRESETS = [1.0, 2.0, 5.0, 10.0, 20.0, 50.0, 100.0, 200.0, 500.0];

export class TimeScaleConfig {
  private static scale = 1.0;
  private static listeners = new Set<(scale: number) => void>();
  private static initialized = false;

  private static init(): void {
    if (this.initialized) return;
    this.initialized = true;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const val = parseFloat(stored);
        if (!isNaN(val) && val >= 0.1 && val <= 500.0) {
          this.scale = val;
        }
      }
    } catch {
      // 忽略 localStorage 失败情况
    }
  }

  /** 获取当前时间倍率 (0.1 ~ 500.0) */
  static getScale(): number {
    this.init();
    return this.scale;
  }

  /** 设置时间倍率 (最高 500 倍) */
  static setScale(val: number): void {
    this.init();
    // 最多 500 倍，最少 0.1 倍
    const clamped = Math.min(500.0, Math.max(0.1, Math.round(val * 10) / 10));
    if (this.scale !== clamped) {
      this.scale = clamped;
      try {
        localStorage.setItem(STORAGE_KEY, clamped.toString());
      } catch {
        // 忽略
      }
      this.notify();
    }
  }

  /** 循环切换预设倍率 (1x -> 2x -> 5x -> 10x -> 20x -> 50x -> 100x -> 200x -> 500x -> 1x) */
  static toggleNextPreset(): number {
    this.init();
    const current = this.scale;
    // 寻找下一个大于当前值的预设，否则循环回到 1.0
    const next = PRESETS.find((p) => p > current + 0.01) ?? PRESETS[0];
    this.setScale(next);
    return this.scale;
  }

  /** 增加倍率（加 step，上限 500.0） */
  static increase(step = 1.0): void {
    this.setScale(this.getScale() + step);
  }

  /** 减少倍率（减 step，下限 0.5） */
  static decrease(step = 1.0): void {
    this.setScale(this.getScale() - step);
  }

  /** 监听倍率变化 */
  static onChange(cb: (scale: number) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private static notify(): void {
    for (const cb of this.listeners) {
      cb(this.scale);
    }
  }
}
