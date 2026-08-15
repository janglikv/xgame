const lastPlayAt = new Map<string, number>();

/**
 * 短音效：每次新建 Audio 以便连发可重叠。
 * debounceMs > 0 时，同一路径在窗口内只播一次（避免双远程同帧叠音）。
 */
export function playSfx(src: string, volume = 0.45, debounceMs = 0): void {
  if (debounceMs > 0) {
    const now = performance.now();
    const last = lastPlayAt.get(src) ?? 0;
    if (now - last < debounceMs) return;
    lastPlayAt.set(src, now);
  }

  const audio = new Audio(src);
  audio.volume = volume;
  void audio.play().catch(() => {
    // 未与页面交互时浏览器会拦截，忽略
  });
}

/** 可启停的循环音（传送阵站上播放、离开停止） */
export class LoopSfx {
  private audio: HTMLAudioElement | null = null;
  private playing = false;

  constructor(
    private readonly src: string,
    private readonly volume = 0.55,
  ) {}

  get isPlaying(): boolean {
    return this.playing;
  }

  start(): void {
    if (this.playing) return;
    if (!this.audio) {
      this.audio = new Audio(this.src);
      this.audio.loop = true;
      this.audio.volume = this.volume;
    }
    this.playing = true;
    void this.audio.play().catch(() => {
      this.playing = false;
    });
  }

  stop(): void {
    if (!this.audio) return;
    this.audio.pause();
    this.audio.currentTime = 0;
    this.playing = false;
  }
}
