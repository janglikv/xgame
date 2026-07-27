const STORAGE_KEY = 'lu_night_mode';

/**
 * 夜晚模式全局开关与持久化存储管理
 */
export class NightConfig {
  private static enabled = (() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  })();

  private static listeners = new Set<(enabled: boolean) => void>();

  /** 获取当前夜晚模式开关状态 */
  static isNightEnabled(): boolean {
    return this.enabled;
  }

  /** 设置夜晚模式开关状态 */
  static setNightEnabled(value: boolean): void {
    if (this.enabled !== value) {
      this.enabled = value;
      try {
        localStorage.setItem(STORAGE_KEY, String(value));
      } catch {}
      this.notify();
    }
  }

  /** 切换夜晚模式开关状态并返回新状态 */
  static toggleNight(): boolean {
    this.setNightEnabled(!this.enabled);
    return this.enabled;
  }

  /** 监听夜晚模式开关状态变化 */
  static onChange(cb: (enabled: boolean) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private static notify(): void {
    for (const cb of this.listeners) {
      cb(this.enabled);
    }
  }
}
