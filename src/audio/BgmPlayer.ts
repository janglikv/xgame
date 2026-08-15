/** 公共目录下的背景乐 */
const TRACKS = ['/audio/Final_Coin_Drop.mp3'] as const;

const DEFAULT_VOLUME = 0.35;

/**
 * HTMLAudio 背景乐，单曲循环。
 * 浏览器自动播放策略下，需一次指针/键盘手势后才会真正出声。
 */
export class BgmPlayer {
  private readonly audio = new Audio();
  private enabled = true;
  private unlocked = false;
  private unlockBound = false;

  constructor() {
    this.audio.preload = 'auto';
    this.audio.loop = true;
    this.audio.volume = DEFAULT_VOLUME;
  }

  /** 绑定一次性解锁；游戏启动后调用一次 */
  armUnlock(): void {
    if (this.unlockBound) return;
    this.unlockBound = true;
    const unlock = (): void => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      this.unlocked = true;
      if (this.enabled) void this.playCurrent();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.audio.pause();
      return;
    }
    if (this.unlocked) void this.playCurrent();
  }

  dispose(): void {
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
  }

  private async playCurrent(): Promise<void> {
    const src = TRACKS[0];
    if (!this.audio.src.endsWith(src)) {
      this.audio.src = src;
    }
    try {
      await this.audio.play();
    } catch {
      // 未解锁或被策略拦截时静默；下次手势会再试
    }
  }
}
