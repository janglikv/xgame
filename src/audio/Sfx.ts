const lastPlayAt = new Map<string, number>();
const pools = new Map<string, HTMLAudioElement[]>();
const POOL_SIZE = 4;

function acquireVoice(src: string): HTMLAudioElement {
  let pool = pools.get(src);
  if (!pool) {
    pool = [];
    pools.set(src, pool);
  }
  for (let i = 0; i < pool.length; i++) {
    const a = pool[i]!;
    if (a.paused || a.ended) return a;
  }
  if (pool.length < POOL_SIZE) {
    const created = new Audio(src);
    created.preload = 'auto';
    pool.push(created);
    return created;
  }
  // 池满则打断最早的一条，避免无上限 new Audio
  const steal = pool[0]!;
  pool.push(pool.shift()!);
  steal.pause();
  steal.currentTime = 0;
  return steal;
}

/**
 * 短音效：按路径复用 Audio 池，避免每发新建解码。
 * debounceMs > 0 时，同一路径在窗口内只播一次。
 */
export function playSfx(src: string, volume = 0.45, debounceMs = 0): void {
  if (debounceMs > 0) {
    const now = performance.now();
    const last = lastPlayAt.get(src) ?? 0;
    if (now - last < debounceMs) return;
    lastPlayAt.set(src, now);
  }

  const audio = acquireVoice(src);
  audio.volume = volume;
  audio.currentTime = 0;
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
