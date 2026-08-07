/**
 * Tone.js 游戏音频层：SFX 总线 + 程序化开火/命中。
 * 预留采样 Player 槽位，后续可把 wav 接到同总线。
 *
 * 须在用户手势后 unlock（Tone.start）。
 */
import * as Tone from 'tone';
import { BgmSynth, type BgmMode, type BgmTrackId } from './BgmSynth';

export type GunHand = 'left' | 'right';

/** 命中音色：英雄粉弹 / 小兵 / 防御塔 / 范围 tick */
export type HitSfxKind = 'hero' | 'minion' | 'tower' | 'aoe';

export interface HeroGunshotOptions {
  /** 左右枪交替 pan 轻微偏移 */
  hand?: GunHand;
  /** 音高倍率，1=默认 */
  pitch?: number;
  /** 相对本枪响度 0~1 */
  gain?: number;
}

export interface ProjectileHitOptions {
  kind?: HitSfxKind;
  pitch?: number;
  gain?: number;
  /** 立体声 pan -1~1 */
  pan?: number;
}

const DEFAULT_SFX_VOLUME = 0.72;
const DEFAULT_BGM_VOLUME = 0.65;

/**
 * 全局游戏音频（Tone.js）。
 * 对外 API 保持稳定，场景侧只调 play* / setSfxVolume / unlock / BGM 控制。
 */
export class GameAudio {
  private ready = false;
  private unlocked = false;
  private sfxVolume = DEFAULT_SFX_VOLUME;
  private bgmVolume = DEFAULT_BGM_VOLUME;
  private muted = false;
  private bgmSynth = new BgmSynth();

  private sfxBus: Tone.Volume | null = null;
  private gunPanner: Tone.Panner | null = null;
  private hitPanner: Tone.Panner | null = null;
  /** 需 dispose 的中间节点（压缩/滤波等） */
  private readonly nodes: Tone.ToneAudioNode[] = [];

  /** 枪口气爆 */
  private gunNoise: Tone.NoiseSynth | null = null;
  /** 枪身 thrump */
  private gunBody: Tone.MembraneSynth | null = null;
  /** 金属机括 */
  private gunMetal: Tone.MetalSynth | null = null;
  /** 枪口高频气爆层 */
  private gunAir: Tone.NoiseSynth | null = null;

  /** 命中噪声冲击 */
  private hitNoise: Tone.NoiseSynth | null = null;
  /** 命中 thrump */
  private hitBody: Tone.MembraneSynth | null = null;
  /** 命中金属叮 */
  private hitMetal: Tone.MetalSynth | null = null;

  /** 预留：按名缓存的采样（未来 drop-in wav） */
  private readonly samplePlayers = new Map<string, Tone.Player>();

  private lastGunshotAt = 0;
  private static readonly MIN_GUNSHOT_GAP = 0.05;
  private lastHitAt = 0;
  private static readonly MIN_HIT_GAP = 0.03;
  private lastAoeHitAt = 0;
  private static readonly MIN_AOE_HIT_GAP = 0.085;

  get isUnlocked(): boolean {
    return this.unlocked;
  }

  getSfxVolume(): number {
    return this.sfxVolume;
  }

  setSfxVolume(value: number): void {
    this.sfxVolume = clamp01(value);
    this.applySfxGain();
  }

  getBgmVolume(): number {
    return this.bgmVolume;
  }

  setBgmVolume(value: number): void {
    this.bgmVolume = clamp01(value);
    this.bgmSynth.setVolume(this.muted ? 0 : this.bgmVolume);
  }

  getBgmMode(): BgmMode {
    return this.bgmSynth.getMode();
  }

  setBgmMode(mode: BgmMode): void {
    this.bgmSynth.setMode(mode);
  }

  getBgmTrack(): BgmTrackId {
    return this.bgmSynth.getTrack();
  }

  setBgmTrack(trackId: BgmTrackId): void {
    this.bgmSynth.setTrack(trackId);
  }

  setBgmInMenu(inMenu: boolean): void {
    this.bgmSynth.setInMenu(inMenu);
  }

  startBgm(): void {
    if (this.isRunning()) {
      this.bgmSynth.start();
    }
  }

  stopBgm(): void {
    this.bgmSynth.stop();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applySfxGain();
    this.bgmSynth.setVolume(muted ? 0 : this.bgmVolume);
  }

  /**
   * 用户手势后调用：启动 AudioContext 并构建合成图。
   */
  async unlock(): Promise<void> {
    try {
      await Tone.start();
    } catch {
      return;
    }
    this.ensureGraph();
    this.unlocked = Tone.getContext().state === 'running';
    if (this.unlocked) {
      this.bgmSynth.initGraph(Tone.getDestination());
      this.bgmSynth.setVolume(this.muted ? 0 : this.bgmVolume);
      this.bgmSynth.start();
    }
  }

  /**
   * 英雄普攻：双枪短促「啪」
   * Noise 气爆 + Membrane thrump + Metal 机括。
   */
  playHeroGunshot(options: HeroGunshotOptions = {}): void {
    if (this.muted || this.sfxVolume <= 1e-4) return;
    if (!this.isRunning()) {
      void this.unlock().then(() => {
        if (this.isRunning()) this.playHeroGunshot(options);
      });
      return;
    }
    this.ensureGraph();
    if (!this.gunNoise || !this.gunBody || !this.gunMetal || !this.gunAir) {
      return;
    }
    if (!this.gunPanner || !this.sfxBus) return;

    const now = Tone.now();
    if (now - this.lastGunshotAt < GameAudio.MIN_GUNSHOT_GAP) return;
    this.lastGunshotAt = now;

    const pitch = clamp(options.pitch ?? 1, 0.85, 1.25);
    const gainMul = clamp01(options.gain ?? 1);
    const pan =
      options.hand === 'left' ? -0.28 : options.hand === 'right' ? 0.28 : 0;

    this.gunPanner.pan.rampTo(pan, 0.01);
    this.setInstrumentGain(this.gunNoise, 0.55 * gainMul);
    this.setInstrumentGain(this.gunAir, 0.28 * gainMul);
    this.setInstrumentGain(this.gunBody, 0.7 * gainMul);
    this.setInstrumentGain(this.gunMetal, 0.22 * gainMul);

    // 主体气爆
    this.gunNoise.noise.type = 'white';
    this.gunNoise.envelope.attack = 0.001;
    this.gunNoise.envelope.decay = 0.09;
    this.gunNoise.envelope.sustain = 0;
    this.gunNoise.envelope.release = 0.04;
    this.gunNoise.triggerAttackRelease(0.1, now);

    // 高频气尾
    this.gunAir.noise.type = 'white';
    this.gunAir.envelope.attack = 0.0008;
    this.gunAir.envelope.decay = 0.05;
    this.gunAir.envelope.sustain = 0;
    this.gunAir.envelope.release = 0.02;
    this.gunAir.triggerAttackRelease(0.06, now + 0.002);

    // 低频 thrump（粉枪体感）
    const bodyNote = 48 + 12 * Math.log2(pitch); // 约 C2 附近随 pitch
    this.gunBody.pitchDecay = 0.018;
    this.gunBody.octaves = 3.2;
    this.gunBody.triggerAttackRelease(bodyNote, 0.1, now, 0.9);

    // 金属机括 click
    this.gunMetal.frequency.value = 280 * pitch;
    this.gunMetal.envelope.attack = 0.0005;
    this.gunMetal.envelope.decay = 0.04;
    this.gunMetal.envelope.release = 0.02;
    this.gunMetal.harmonicity = 5.1;
    this.gunMetal.modulationIndex = 28;
    this.gunMetal.resonance = 3800 * pitch;
    this.gunMetal.octaves = 1.2;
    this.gunMetal.triggerAttackRelease(0.05, now + 0.003, 0.7);
  }

  /**
   * 子弹命中：短促冲击；kind 区分英雄 / 小兵 / 塔 / AOE。
   */
  playProjectileHit(options: ProjectileHitOptions = {}): void {
    if (this.muted || this.sfxVolume <= 1e-4) return;
    if (!this.isRunning()) {
      void this.unlock().then(() => {
        if (this.isRunning()) this.playProjectileHit(options);
      });
      return;
    }
    this.ensureGraph();
    if (!this.hitNoise || !this.hitBody || !this.hitMetal || !this.hitPanner) {
      return;
    }

    const kind = options.kind ?? 'minion';
    const now = Tone.now();
    if (kind === 'aoe') {
      if (now - this.lastAoeHitAt < GameAudio.MIN_AOE_HIT_GAP) return;
      this.lastAoeHitAt = now;
    } else {
      if (now - this.lastHitAt < GameAudio.MIN_HIT_GAP) return;
      this.lastHitAt = now;
    }

    const pitchJitter = 0.94 + Math.random() * 0.12;
    const pitch = clamp((options.pitch ?? 1) * pitchJitter, 0.75, 1.4);
    const gainMul = clamp01(options.gain ?? 1);
    const pan = clamp(options.pan ?? Math.random() * 0.35 - 0.175, -1, 1);
    const profile = HIT_PROFILES[kind];

    this.hitPanner.pan.rampTo(pan, 0.01);
    this.setInstrumentGain(this.hitNoise, profile.noiseGain * gainMul);
    this.setInstrumentGain(this.hitBody, profile.bodyGain * gainMul);
    this.setInstrumentGain(this.hitMetal, profile.metalGain * gainMul);

    // 冲击噪声
    this.hitNoise.noise.type = profile.noiseType;
    this.hitNoise.envelope.attack = 0.0008;
    this.hitNoise.envelope.decay = profile.noiseDecay;
    this.hitNoise.envelope.sustain = 0;
    this.hitNoise.envelope.release = 0.03;
    this.hitNoise.triggerAttackRelease(profile.noiseDur, now);

    // thrump
    this.hitBody.pitchDecay = profile.pitchDecay;
    this.hitBody.octaves = profile.octaves;
    const midi = profile.bodyMidi + 12 * Math.log2(pitch);
    this.hitBody.triggerAttackRelease(midi, profile.bodyDur, now, 0.85);

    // 金属 / 叮
    if (profile.metalGain > 0.01) {
      this.hitMetal.frequency.value = profile.metalFreq * pitch;
      this.hitMetal.envelope.attack = 0.0005;
      this.hitMetal.envelope.decay = profile.metalDecay;
      this.hitMetal.envelope.release = 0.02;
      this.hitMetal.harmonicity = profile.harmonicity;
      this.hitMetal.modulationIndex = profile.modIndex;
      this.hitMetal.resonance = profile.resonance * pitch;
      this.hitMetal.octaves = profile.metalOctaves;
      this.hitMetal.triggerAttackRelease(
        profile.metalDur,
        now + 0.002,
        0.65,
      );
    }
  }

  /** E 技能开场：短连射 */
  playHeroBulletRainStart(): void {
    const base = 1 + (Math.random() * 0.06 - 0.03);
    this.playHeroGunshot({ hand: 'right', pitch: base, gain: 0.9 });
    window.setTimeout(() => {
      this.playHeroGunshot({
        hand: 'left',
        pitch: base * 1.04,
        gain: 0.78,
      });
    }, 55);
    window.setTimeout(() => {
      this.playHeroGunshot({
        hand: 'right',
        pitch: base * 0.97,
        gain: 0.68,
      });
    }, 110);
  }

  /** W 技能激活：更高亢双响，提示攻速提升 */
  playHeroWActivate(): void {
    const base = 1.12 + (Math.random() * 0.05 - 0.02);
    this.playHeroGunshot({ hand: 'left', pitch: base, gain: 0.82 });
    window.setTimeout(() => {
      this.playHeroGunshot({
        hand: 'right',
        pitch: base * 1.08,
        gain: 0.72,
      });
    }, 48);
  }

  /** D 疾跑：昂扬上升增益音效 */
  playHeroGhost(): void {
    if (!this.unlocked || this.muted || !this.gunBody) return;
    try {
      const now = Tone.now();
      this.gunBody.triggerAttackRelease('D4', '16n', now, 0.7);
      this.gunBody.triggerAttackRelease('A4', '8n', now + 0.08, 0.85);
    } catch {
      // 忽略未解锁音频并发异常
    }
  }

  /** F 闪现：清亮空灵位移音效 */
  playHeroFlash(): void {
    if (!this.unlocked || this.muted || !this.hitMetal || !this.gunAir) return;
    try {
      const now = Tone.now();
      this.hitMetal.triggerAttackRelease('E6', '32n', now, 0.85);
      this.gunAir.triggerAttackRelease('16n', now + 0.02, 0.65);
    } catch {
      // 忽略未解锁音频并发异常
    }
  }

  /**
   * 预留采样播放：先 loadSample，再 playSample。
   * 未加载时静默失败（合成路径不受影响）。
   */
  async loadSample(id: string, url: string): Promise<void> {
    this.ensureGraph();
    if (!this.sfxBus) return;
    const existing = this.samplePlayers.get(id);
    if (existing) {
      existing.dispose();
      this.samplePlayers.delete(id);
    }
    const player = new Tone.Player({
      url,
      autostart: false,
      onload: () => {
        /* ready */
      },
    }).connect(this.sfxBus);
    this.samplePlayers.set(id, player);
    await Tone.loaded();
  }

  playSample(
    id: string,
    options: { gain?: number; playbackRate?: number } = {},
  ): void {
    if (this.muted || this.sfxVolume <= 1e-4 || !this.isRunning()) return;
    const player = this.samplePlayers.get(id);
    if (!player || !player.loaded) return;
    const rate = clamp(options.playbackRate ?? 1, 0.5, 2);
    const g = clamp01(options.gain ?? 1);
    player.playbackRate = rate;
    player.volume.value = Tone.gainToDb(Math.max(0.0001, g));
    player.start();
  }

  dispose(): void {
    this.bgmSynth.dispose();
    for (const p of this.samplePlayers.values()) p.dispose();
    this.samplePlayers.clear();

    this.gunNoise?.dispose();
    this.gunAir?.dispose();
    this.gunBody?.dispose();
    this.gunMetal?.dispose();
    this.hitNoise?.dispose();
    this.hitBody?.dispose();
    this.hitMetal?.dispose();
    for (const n of this.nodes) n.dispose();
    this.nodes.length = 0;
    this.gunPanner?.dispose();
    this.hitPanner?.dispose();
    this.sfxBus?.dispose();

    this.gunNoise = null;
    this.gunAir = null;
    this.gunBody = null;
    this.gunMetal = null;
    this.hitNoise = null;
    this.hitBody = null;
    this.hitMetal = null;
    this.gunPanner = null;
    this.hitPanner = null;
    this.sfxBus = null;
    this.ready = false;
    this.unlocked = false;
  }

  /** AudioContext 是否已在 running（已解锁） */
  private isRunning(): boolean {
    return this.unlocked && Tone.getContext().state === 'running';
  }

  private ensureGraph(): void {
    if (this.ready && this.sfxBus) return;

    // SFX 总线 → 主输出
    this.sfxBus = new Tone.Volume(this.volumeDb()).toDestination();

    this.gunPanner = new Tone.Panner(0).connect(this.sfxBus);
    this.hitPanner = new Tone.Panner(0).connect(this.sfxBus);

    // —— 开火链：轻微压缩让瞬态更「打」——
    const gunComp = new Tone.Compressor({
      threshold: -18,
      ratio: 4,
      attack: 0.001,
      release: 0.08,
    }).connect(this.gunPanner);
    this.nodes.push(gunComp);

    const gunFilter = new Tone.Filter({
      type: 'highpass',
      frequency: 120,
      Q: 0.5,
    }).connect(gunComp);
    this.nodes.push(gunFilter);

    this.gunNoise = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: {
        attack: 0.001,
        decay: 0.09,
        sustain: 0,
        release: 0.04,
      },
      volume: -8,
    }).connect(gunFilter);

    const airFilter = new Tone.Filter({
      type: 'highpass',
      frequency: 3200,
      Q: 0.7,
    }).connect(gunComp);
    this.nodes.push(airFilter);

    this.gunAir = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: {
        attack: 0.0008,
        decay: 0.05,
        sustain: 0,
        release: 0.02,
      },
      volume: -14,
    }).connect(airFilter);

    this.gunBody = new Tone.MembraneSynth({
      pitchDecay: 0.018,
      octaves: 3.2,
      oscillator: { type: 'sine' },
      envelope: {
        attack: 0.001,
        decay: 0.1,
        sustain: 0,
        release: 0.04,
      },
      volume: -6,
    }).connect(gunComp);

    this.gunMetal = new Tone.MetalSynth({
      envelope: {
        attack: 0.0005,
        decay: 0.04,
        release: 0.02,
      },
      harmonicity: 5.1,
      modulationIndex: 28,
      resonance: 3800,
      octaves: 1.2,
      volume: -18,
    }).connect(gunComp);

    // —— 命中链 ——
    const hitComp = new Tone.Compressor({
      threshold: -20,
      ratio: 3.5,
      attack: 0.001,
      release: 0.06,
    }).connect(this.hitPanner);
    this.nodes.push(hitComp);

    this.hitNoise = new Tone.NoiseSynth({
      noise: { type: 'pink' },
      envelope: {
        attack: 0.0008,
        decay: 0.06,
        sustain: 0,
        release: 0.03,
      },
      volume: -10,
    }).connect(hitComp);

    this.hitBody = new Tone.MembraneSynth({
      pitchDecay: 0.02,
      octaves: 2.8,
      oscillator: { type: 'sine' },
      envelope: {
        attack: 0.001,
        decay: 0.08,
        sustain: 0,
        release: 0.04,
      },
      volume: -8,
    }).connect(hitComp);

    this.hitMetal = new Tone.MetalSynth({
      envelope: {
        attack: 0.0005,
        decay: 0.05,
        release: 0.02,
      },
      harmonicity: 4.2,
      modulationIndex: 20,
      resonance: 2800,
      octaves: 1.1,
      volume: -20,
    }).connect(hitComp);

    this.ready = true;
    this.applySfxGain();
  }

  private applySfxGain(): void {
    if (!this.sfxBus) return;
    this.sfxBus.volume.rampTo(this.volumeDb(), 0.04);
  }

  private volumeDb(): number {
    if (this.muted || this.sfxVolume <= 1e-4) return -Infinity;
    // 感知响度略抬：0.72 → 约 -3dB
    return Tone.gainToDb(Math.max(0.0001, this.sfxVolume * 0.95));
  }

  /** 按 0~1 线性增益设置乐器 volume（dB） */
  private setInstrumentGain(
    inst: { volume: Tone.Volume['volume'] } | Tone.NoiseSynth | Tone.MembraneSynth | Tone.MetalSynth,
    linear: number,
  ): void {
    const g = Math.max(0.0001, linear);
    inst.volume.value = Tone.gainToDb(g);
  }
}

/** 单例 */
let shared: GameAudio | null = null;

export function getGameAudio(): GameAudio {
  if (!shared) shared = new GameAudio();
  return shared;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}

interface HitProfile {
  noiseType: 'white' | 'pink' | 'brown';
  noiseGain: number;
  noiseDecay: number;
  noiseDur: number;
  bodyGain: number;
  bodyMidi: number;
  bodyDur: number;
  pitchDecay: number;
  octaves: number;
  metalGain: number;
  metalFreq: number;
  metalDecay: number;
  metalDur: number;
  harmonicity: number;
  modIndex: number;
  resonance: number;
  metalOctaves: number;
}

const HIT_PROFILES: Record<HitSfxKind, HitProfile> = {
  hero: {
    noiseType: 'white',
    noiseGain: 0.55,
    noiseDecay: 0.055,
    noiseDur: 0.07,
    bodyGain: 0.65,
    bodyMidi: 52,
    bodyDur: 0.08,
    pitchDecay: 0.016,
    octaves: 2.6,
    metalGain: 0.28,
    metalFreq: 420,
    metalDecay: 0.045,
    metalDur: 0.05,
    harmonicity: 5.4,
    modIndex: 24,
    resonance: 4200,
    metalOctaves: 1.3,
  },
  minion: {
    noiseType: 'pink',
    noiseGain: 0.42,
    noiseDecay: 0.05,
    noiseDur: 0.06,
    bodyGain: 0.55,
    bodyMidi: 45,
    bodyDur: 0.07,
    pitchDecay: 0.02,
    octaves: 2.4,
    metalGain: 0.12,
    metalFreq: 220,
    metalDecay: 0.035,
    metalDur: 0.04,
    harmonicity: 3.8,
    modIndex: 16,
    resonance: 2200,
    metalOctaves: 1.0,
  },
  tower: {
    noiseType: 'brown',
    noiseGain: 0.6,
    noiseDecay: 0.09,
    noiseDur: 0.1,
    bodyGain: 0.85,
    bodyMidi: 36,
    bodyDur: 0.12,
    pitchDecay: 0.028,
    octaves: 3.4,
    metalGain: 0.18,
    metalFreq: 160,
    metalDecay: 0.06,
    metalDur: 0.07,
    harmonicity: 3.2,
    modIndex: 18,
    resonance: 1400,
    metalOctaves: 0.9,
  },
  aoe: {
    noiseType: 'white',
    noiseGain: 0.28,
    noiseDecay: 0.035,
    noiseDur: 0.045,
    bodyGain: 0.32,
    bodyMidi: 55,
    bodyDur: 0.045,
    pitchDecay: 0.012,
    octaves: 2.0,
    metalGain: 0.1,
    metalFreq: 380,
    metalDecay: 0.03,
    metalDur: 0.035,
    harmonicity: 4.5,
    modIndex: 14,
    resonance: 3600,
    metalOctaves: 1.1,
  },
};
