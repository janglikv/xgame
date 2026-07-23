/**
 * 受击体 & 碰撞体 Debug 全局开关管理
 */
export class DebugConfig {
  private static enabled = false;
  private static listeners = new Set<(enabled: boolean) => void>();

  /** 获取当前 Debug 开关状态 */
  static isDebugEnabled(): boolean {
    return this.enabled;
  }

  /** 设置当前 Debug 开关状态 */
  static setDebugEnabled(value: boolean): void {
    if (this.enabled !== value) {
      this.enabled = value;
      this.notify();
    }
  }

  /** 切换 Debug 开关状态并返回新状态 */
  static toggleDebug(): boolean {
    this.enabled = !this.enabled;
    this.notify();
    return this.enabled;
  }

  /** 监听 Debug 开关状态变化 */
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
