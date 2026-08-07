/**
 * 专一游戏背景音乐播放器 (BGM Audio Engine)
 *
 * 专门加载与循环播放官方 MP3 原声文件 `/audio/The_Last_Lap.mp3`：
 * - 自动循环播放 (loop: true)
 * - 混音总线音量调控 (setVolume)
 * - ESC 菜单低通沉浸滤波 (setInMenu)
 */
import * as Tone from 'tone';

export class BgmSynth {
  private ready = false;
  private playing = false;
  private volumeValue = 0.65;
  private inMenu = false;

  private bgmBus: Tone.Volume | null = null;
  private filterNode: Tone.Filter | null = null;
  private mp3Player: Tone.Player | null = null;
  private mp3Loaded = false;

  constructor() {}

  /**
   * 初始化音频生成图（在 AudioContext running 后调用）
   */
  public initGraph(masterOutput: Tone.ToneAudioNode): void {
    if (this.ready) return;

    // 1. 混音总线
    this.bgmBus = new Tone.Volume(this.calcVolumeDb());

    // ESC 菜单 低通滤镜 (平时 18000Hz 敞开，在菜单中降至 650Hz)
    this.filterNode = new Tone.Filter({
      type: 'lowpass',
      frequency: this.inMenu ? 650 : 18000,
      Q: 1.0,
    });

    // 节点连接: Bus -> Filter -> Destination
    this.bgmBus.connect(this.filterNode);
    this.filterNode.connect(masterOutput);

    // 2. MP3 Player 准备并挂载到混音总线
    this.mp3Player = new Tone.Player({
      url: '/audio/The_Last_Lap.mp3',
      loop: true,
      autostart: false,
      onload: () => {
        this.mp3Loaded = true;
        if (this.playing && this.mp3Player) {
          try {
            if (this.mp3Player.state !== 'started') {
              this.mp3Player.start();
            }
          } catch {
            // ignore audio timing jitter
          }
        }
      },
    }).connect(this.bgmBus);

    this.ready = true;
  }

  /**
   * 启动 BGM 播放
   */
  public start(): void {
    if (this.playing) return;
    this.playing = true;

    if (this.mp3Player && this.mp3Loaded && this.mp3Player.state !== 'started') {
      try {
        this.mp3Player.start();
      } catch {
        // ignore
      }
    }
  }

  /**
   * 停止 BGM 播放
   */
  public stop(): void {
    if (!this.playing) return;
    this.playing = false;

    if (this.mp3Player && this.mp3Player.state === 'started') {
      try {
        this.mp3Player.stop();
      } catch {
        // ignore
      }
    }
  }

  /**
   * 设置音量 (0~1)
   */
  public setVolume(val: number): void {
    this.volumeValue = Math.min(1, Math.max(0, val));
    if (this.bgmBus) {
      this.bgmBus.volume.rampTo(this.calcVolumeDb(), 0.05);
    }
  }

  /**
   * 设置 ESC 菜单过滤状态
   */
  public setInMenu(inMenu: boolean): void {
    this.inMenu = inMenu;
    if (this.filterNode) {
      const targetFreq = inMenu ? 650 : 18000;
      this.filterNode.frequency.rampTo(targetFreq, 0.25);
    }
  }

  public getVolume(): number {
    return this.volumeValue;
  }

  public isPlaying(): boolean {
    return this.playing;
  }

  private calcVolumeDb(): number {
    if (this.volumeValue <= 1e-4) return -Infinity;
    return Tone.gainToDb(Math.max(0.0001, this.volumeValue * 0.6));
  }

  public dispose(): void {
    this.stop();
    this.mp3Player?.dispose();
    this.mp3Player = null;
    this.mp3Loaded = false;
    this.filterNode?.dispose();
    this.bgmBus?.dispose();
    this.ready = false;
  }
}
