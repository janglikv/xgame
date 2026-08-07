/**
 * Tone.js 多风格/多曲目程序化背景音乐引擎 (Multi-Track Procedural BGM Engine)
 *
 * 内置 4 首不同风格与情绪的备选背景音乐曲目：
 * 1. upbeat (🎉 欢快极速竞技): C大调欢快复调交响 (136 BPM)
 * 2. cyber   (🌆 赛博霓虹狂想): 80s 赛博 Synthwave/Neon Electro (128 BPM)
 * 3. lofi    (🍃 惬意峡谷漫步): Lofi/Pixel RPG 舒缓温润钢琴与木琴 (114 BPM)
 * 4. epic    (⚔️ 史诗英雄决战): D小调重锤史诗交响与 Brass 冲击 (138 BPM)
 *
 * 支持：
 * - 动态曲目切换 (setTrack)
 * - 动能模式切换 (setMode: 'calm' | 'battle')
 * - ESC 菜单沉浸 Lowpass 滤波 (setInMenu)
 */
import * as Tone from 'tone';

export type BgmMode = 'calm' | 'battle';

export type BgmTrackId = 'upbeat' | 'cyber' | 'lofi' | 'epic';

export interface BgmTrackMeta {
  id: BgmTrackId;
  name: string;
  desc: string;
  bpm: number;
}

export const BGM_TRACKS: Record<BgmTrackId, BgmTrackMeta> = {
  upbeat: {
    id: 'upbeat',
    name: '🎉 欢快极速竞技 (Upbeat Champion)',
    desc: 'C大调欢快复调交响 · 跃动切分木琴与高能鼓点',
    bpm: 136,
  },
  cyber: {
    id: 'cyber',
    name: '🌆 赛博霓虹狂想 (Cyberpunk Neon)',
    desc: '80s 赛博 Synthwave · 霓虹 FM 琶音与复古 Low-end 低音',
    bpm: 128,
  },
  lofi: {
    id: 'lofi',
    name: '🍃 惬意峡谷漫步 (Lofi Valley Pluck)',
    desc: '温润钢琴与水晶木琴 · 轻松惬意的休闲探索韵律',
    bpm: 114,
  },
  epic: {
    id: 'epic',
    name: '⚔️ 史诗英雄决战 (Epic Battle Orchestra)',
    desc: 'D小调史诗交响 · 强力管弦 Brass Hits 与极限团战高潮',
    bpm: 138,
  },
};

export class BgmSynth {
  private ready = false;
  private playing = false;
  private volumeValue = 0.65;
  private mode: BgmMode = 'battle';
  private trackId: BgmTrackId = 'upbeat';
  private inMenu = false;

  private bgmBus: Tone.Volume | null = null;
  private filterNode: Tone.Filter | null = null;
  private delayNode: Tone.PingPongDelay | null = null;
  private reverbNode: Tone.Reverb | null = null;
  private chorusNode: Tone.Chorus | null = null;

  // 乐器声部定义
  private bassSynth: Tone.MonoSynth | null = null;
  private padSynth: Tone.PolySynth<Tone.Synth> | null = null;
  private arpSynth: Tone.PolySynth<Tone.Synth> | null = null;
  private marimbaSynth: Tone.PolySynth<Tone.FMSynth> | null = null;
  private lead1Synth: Tone.Synth | null = null;
  private lead2Synth: Tone.Synth | null = null;
  private brassStabSynth: Tone.PolySynth<Tone.Synth> | null = null;
  private kickSynth: Tone.MembraneSynth | null = null;
  private snareSynth: Tone.NoiseSynth | null = null;
  private hihatSynth: Tone.MetalSynth | null = null;
  private crashSynth: Tone.MetalSynth | null = null;

  // 动态序列
  private sequences: Tone.Sequence[] = [];

  constructor() {}

  /**
   * 初始化音频生成图（在 AudioContext running 后调用）
   */
  public initGraph(masterOutput: Tone.ToneAudioNode): void {
    if (this.ready) return;

    // 1. 总线与效果器链
    this.bgmBus = new Tone.Volume(this.calcVolumeDb());

    // ESC 菜单 低通滤镜 (平时 18000Hz 敞开，在菜单中降至 650Hz)
    this.filterNode = new Tone.Filter({
      type: 'lowpass',
      frequency: this.inMenu ? 650 : 18000,
      Q: 1.0,
    });

    // 欢快立体声效果器链：Chorus + Delay + Reverb
    this.chorusNode = new Tone.Chorus({
      frequency: 2.5,
      delayTime: 3.5,
      depth: 0.7,
      wet: 0.25,
    }).start();

    this.delayNode = new Tone.PingPongDelay({
      delayTime: '8n.',
      feedback: 0.28,
      wet: 0.2,
    });

    this.reverbNode = new Tone.Reverb({
      decay: 2.2,
      wet: 0.22,
    });

    // 节点连接
    this.bgmBus.connect(this.filterNode);
    this.filterNode.connect(this.reverbNode);
    this.reverbNode.connect(masterOutput);

    this.chorusNode.connect(this.reverbNode);
    this.delayNode.connect(this.chorusNode);

    // 2. 乐器声部实例化
    this.bassSynth = new Tone.MonoSynth({
      oscillator: { type: 'square' },
      filter: { Q: 2.5, type: 'lowpass' },
      envelope: { attack: 0.005, decay: 0.16, sustain: 0.25, release: 0.12 },
      filterEnvelope: { attack: 0.005, decay: 0.1, sustain: 0.2, release: 0.1, baseFrequency: 110, octaves: 3 },
      volume: -7,
    }).connect(this.bgmBus);

    this.padSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.1, decay: 0.35, sustain: 0.75, release: 0.5 },
      volume: -12,
    });
    this.padSynth.connect(this.bgmBus);
    this.padSynth.connect(this.chorusNode);

    this.arpSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'sine' },
      envelope: { attack: 0.002, decay: 0.1, sustain: 0, release: 0.06 },
      volume: -14,
    });
    this.arpSynth.connect(this.bgmBus);
    this.arpSynth.connect(this.delayNode);

    this.marimbaSynth = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 3.01,
      modulationIndex: 4.5,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.18, sustain: 0.01, release: 0.12 },
      volume: -10,
    });
    this.marimbaSynth.connect(this.bgmBus);
    this.marimbaSynth.connect(this.delayNode);

    this.lead1Synth = new Tone.Synth({
      oscillator: { type: 'pulse', width: 0.35 },
      envelope: { attack: 0.008, decay: 0.14, sustain: 0.65, release: 0.18 },
      volume: -8.5,
    });
    this.lead1Synth.connect(this.bgmBus);
    this.lead1Synth.connect(this.delayNode);

    this.lead2Synth = new Tone.Synth({
      oscillator: { type: 'sawtooth' },
      envelope: { attack: 0.012, decay: 0.18, sustain: 0.55, release: 0.2 },
      volume: -10,
    });
    this.lead2Synth.connect(this.bgmBus);
    this.lead2Synth.connect(this.delayNode);

    this.brassStabSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'sawtooth' },
      envelope: { attack: 0.005, decay: 0.15, sustain: 0.2, release: 0.1 },
      volume: -9,
    }).connect(this.bgmBus);

    this.kickSynth = new Tone.MembraneSynth({
      pitchDecay: 0.03,
      octaves: 3.8,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.24, sustain: 0, release: 0.08 },
      volume: -3.5,
    }).connect(this.bgmBus);

    this.snareSynth = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.05 },
      volume: -9.5,
    }).connect(this.bgmBus);

    this.hihatSynth = new Tone.MetalSynth({
      envelope: { attack: 0.001, decay: 0.03, release: 0.01 },
      harmonicity: 4.5,
      modulationIndex: 14,
      resonance: 5200,
      octaves: 1.4,
      volume: -17,
    }).connect(this.bgmBus);

    this.crashSynth = new Tone.MetalSynth({
      envelope: { attack: 0.002, decay: 0.6, release: 0.3 },
      harmonicity: 5.2,
      modulationIndex: 22,
      resonance: 3500,
      octaves: 1.8,
      volume: -15,
    });
    this.crashSynth.connect(this.bgmBus);
    this.crashSynth.connect(this.reverbNode);

    // 3. 构建当前曲目的序列
    this.rebuildTrackSequences();
    this.ready = true;
  }

  /** 重建并启动当前 TrackId 对应的 Sequence 阵列 */
  private rebuildTrackSequences(): void {
    // 先清理旧 Sequence
    for (const seq of this.sequences) {
      seq.stop();
      seq.dispose();
    }
    this.sequences = [];

    const meta = BGM_TRACKS[this.trackId];
    Tone.getTransport().bpm.value = meta.bpm;

    if (this.trackId === 'upbeat') {
      this.setupUpbeatTrack();
    } else if (this.trackId === 'cyber') {
      this.setupCyberTrack();
    } else if (this.trackId === 'lofi') {
      this.setupLofiTrack();
    } else if (this.trackId === 'epic') {
      this.setupEpicTrack();
    }

    if (this.playing) {
      for (const seq of this.sequences) {
        seq.start(0);
      }
    }
  }

  // --- Track 1: 🎉 欢快极速竞技 (Upbeat Champion) ---
  private setupUpbeatTrack(): void {
    const sixteenChords = [
      ['F3', 'A3', 'C4', 'E4'], ['G3', 'B3', 'D4', 'F4'], ['E3', 'G3', 'B3', 'D4'], ['A3', 'C4', 'E4', 'G4'],
      ['D3', 'F3', 'A3', 'C4'], ['G3', 'B3', 'D4', 'F4'], ['C3', 'E3', 'G3', 'B3'], ['A3', 'C#4', 'E4', 'G4'],
      ['F3', 'A3', 'C4', 'E4'], ['F3', 'G3', 'B3', 'D4'], ['E3', 'G3', 'B3', 'D4'], ['A3', 'C4', 'E4', 'G4'],
      ['D3', 'F3', 'A3', 'C4'], ['E3', 'G3', 'B3', 'D4'], ['F3', 'A3', 'C4', 'E4'], ['G3', 'C4', 'D4', 'F4'],
    ];

    const bassRoots = ['F1', 'G1', 'E1', 'A1', 'D1', 'G1', 'C1', 'A1', 'F1', 'G1', 'E1', 'A1', 'D1', 'E1', 'F1', 'G1'];

    const bassPattern: (string | null)[] = [];
    for (let bar = 0; bar < 16; bar++) {
      const root = bassRoots[bar];
      const oct = Tone.Frequency(root).transpose(12).toNote();
      const fifth = Tone.Frequency(root).transpose(7).toNote();
      bassPattern.push(root, null, oct, root, null, fifth, oct, null);
    }

    this.sequences.push(new Tone.Sequence((time, note) => {
      if (note && this.bassSynth && this.playing) {
        this.bassSynth.triggerAttackRelease(note, '16n', time, this.mode === 'battle' ? 0.9 : 0.65);
      }
    }, bassPattern, '8n'));

    this.sequences.push(new Tone.Sequence((time, chord) => {
      if (chord && this.padSynth && this.playing) {
        this.padSynth.triggerAttackRelease(chord, '1m', time, 0.45);
      }
    }, sixteenChords, '1m'));

    this.sequences.push(new Tone.Sequence((time, index) => {
      if (!this.playing || !this.arpSynth) return;
      const chord = sixteenChords[Math.floor(index / 16) % 16];
      const note = chord[index % chord.length];
      this.arpSynth.triggerAttackRelease(note, '16n', time, this.mode === 'battle' ? 0.45 : 0.25);
    }, Array.from({ length: 256 }, (_, i) => i), '16n'));

    this.sequences.push(new Tone.Sequence((time, index) => {
      if (!this.playing || !this.marimbaSynth) return;
      const step = index % 16;
      if (step === 4 || step === 10 || step === 14) {
        const chord = sixteenChords[Math.floor(index / 16) % 16];
        this.marimbaSynth.triggerAttackRelease(Tone.Frequency(chord[2]).transpose(12).toNote(), '16n', time, 0.5);
      }
    }, Array.from({ length: 256 }, (_, i) => i), '16n'));

    this.sequences.push(new Tone.Sequence((time, index) => {
      if (!this.playing) return;
      const bar = Math.floor(index / 16);
      const step = index % 16;
      if (step === 0 && bar % 4 === 0 && this.crashSynth && this.mode === 'battle') {
        this.crashSynth.triggerAttackRelease('8n', time, 0.8);
      }
      if ((step === 0 || step === 4 || step === 8 || step === 12) && this.kickSynth) {
        this.kickSynth.triggerAttackRelease('C1', '8n', time, this.mode === 'battle' ? 0.95 : 0.5);
      }
      if ((step === 4 || step === 12) && this.snareSynth && this.mode === 'battle') {
        this.snareSynth.triggerAttackRelease('16n', time, 0.75);
      }
      if (this.hihatSynth && (this.mode === 'battle' || step % 2 === 1)) {
        this.hihatSynth.triggerAttackRelease('32n', time, step % 2 === 1 ? 0.45 : 0.25);
      }
    }, Array.from({ length: 256 }, (_, i) => i), '16n'));

    const lead1Notes: (string | null)[] = [
      'C5', 'E5', 'G5', null, 'C6', null, 'B5', 'A5', 'G5', null, 'E5', 'G5', 'A5', 'G5', 'E5', 'D5',
      'E5', 'G5', 'B5', null, 'D6', null, 'C6', 'B5', 'A5', null, 'E5', 'A5', 'B5', 'A5', 'G5', 'E5',
      'F5', 'A5', 'C6', null, 'E6', null, 'D6', 'C6', 'B5', null, 'G5', 'B5', 'D6', 'C6', 'B5', 'A5',
      'C6', 'E6', 'G6', 'F6', 'E6', 'D6', 'C6', 'D6', 'E6', 'G6', 'A6', 'C7', 'C7', null, null, null,
    ];

    this.sequences.push(new Tone.Sequence((time, note) => {
      if (note && this.lead1Synth && this.playing && this.mode === 'battle') {
        this.lead1Synth.triggerAttackRelease(note, '8n', time, 0.75);
      }
    }, lead1Notes, '8n'));
  }

  // --- Track 2: 🌆 赛博霓虹狂想 (Cyberpunk Neon Synthwave) ---
  private setupCyberTrack(): void {
    const cyberChords = [
      ['F3', 'Ab3', 'C4'], ['Eb3', 'G3', 'Bb3'], ['Db3', 'F3', 'Ab3'], ['C3', 'Eb3', 'G3'],
    ];
    const bassNotes = ['F1', 'Eb1', 'Db1', 'C1'];

    // 复古 Synthwave 反拍 16 分音符 Low-end Bass
    const cyberBass: (string | null)[] = [];
    for (let i = 0; i < 4; i++) {
      const b = bassNotes[i];
      cyberBass.push(b, b, b, b, b, b, b, b);
    }

    this.sequences.push(new Tone.Sequence((time, note) => {
      if (note && this.bassSynth && this.playing) {
        this.bassSynth.triggerAttackRelease(note, '16n', time, 0.85);
      }
    }, cyberBass, '16n'));

    this.sequences.push(new Tone.Sequence((time, chord) => {
      if (chord && this.padSynth && this.playing) {
        this.padSynth.triggerAttackRelease(chord, '1m', time, 0.5);
      }
    }, cyberChords, '1m'));

    // 赛博 16 分音符 FM 霓虹琶音
    const cyberArp = [
      ['F4', 'Ab4', 'C5', 'F5'], ['Eb4', 'G4', 'Bb4', 'Eb5'], ['Db4', 'F4', 'Ab4', 'Db5'], ['C4', 'Eb4', 'G4', 'C5']
    ];
    const flatCyberArp: string[] = [];
    for (const pat of cyberArp) {
      flatCyberArp.push(...pat, ...pat, ...pat, ...pat);
    }

    this.sequences.push(new Tone.Sequence((time, note) => {
      if (note && this.arpSynth && this.playing) {
        this.arpSynth.triggerAttackRelease(note, '16n', time, 0.4);
      }
    }, flatCyberArp, '16n'));

    // Synthwave 经典四拍鼓点 (Kick on 1, 5, 9, 13; Snare on 5, 13)
    this.sequences.push(new Tone.Sequence((time, step) => {
      if (!this.playing) return;
      if ((step === 0 || step === 4 || step === 8 || step === 12) && this.kickSynth) {
        this.kickSynth.triggerAttackRelease('C1', '8n', time, 0.9);
      }
      if ((step === 4 || step === 12) && this.snareSynth && this.mode === 'battle') {
        this.snareSynth.triggerAttackRelease('16n', time, 0.8);
      }
      if (this.hihatSynth && step % 2 === 1) {
        this.hihatSynth.triggerAttackRelease('32n', time, 0.35);
      }
    }, Array.from({ length: 16 }, (_, i) => i), '16n'));

    // 赛博飘逸主旋律
    const cyberLead = [
      'F5', null, 'C6', 'Bb5', 'Ab5', null, 'F5', 'G5',
      'Ab5', null, 'Eb5', null, 'F5', null, null, null,
      'Db5', null, 'Ab5', 'G5', 'F5', null, 'C5', 'Eb5',
      'F5', null, 'G5', 'Ab5', 'C6', null, null, null,
    ];

    this.sequences.push(new Tone.Sequence((time, note) => {
      if (note && this.lead1Synth && this.playing && this.mode === 'battle') {
        this.lead1Synth.triggerAttackRelease(note, '8n', time, 0.7);
      }
    }, cyberLead, '8n'));
  }

  // --- Track 3: 🍃 惬意峡谷漫步 (Lofi Valley Pluck) ---
  private setupLofiTrack(): void {
    const lofiChords = [
      ['G3', 'B3', 'D4', 'F#4'], ['E3', 'G3', 'B3', 'D4'], ['C3', 'E3', 'G3', 'B3'], ['D3', 'F#3', 'A3', 'C4']
    ];
    const bassNotes = ['G1', 'E1', 'C1', 'D1'];

    this.sequences.push(new Tone.Sequence((time, note) => {
      if (note && this.bassSynth && this.playing) {
        this.bassSynth.triggerAttackRelease(note, '8n', time, 0.6);
      }
    }, bassNotes, '1m'));

    this.sequences.push(new Tone.Sequence((time, chord) => {
      if (chord && this.padSynth && this.playing) {
        this.padSynth.triggerAttackRelease(chord, '1m', time, 0.35);
      }
    }, lofiChords, '1m'));

    // 晶莹清澈的木琴点拨
    const marimbaLofi = [
      'G4', 'B4', 'D5', 'G5', 'E4', 'G4', 'B4', 'E5',
      'C4', 'E4', 'G4', 'C5', 'D4', 'F#4', 'A4', 'D5'
    ];

    this.sequences.push(new Tone.Sequence((time, note) => {
      if (note && this.marimbaSynth && this.playing) {
        this.marimbaSynth.triggerAttackRelease(note, '8n', time, 0.5);
      }
    }, marimbaLofi, '8n'));

    // 极简轻松 Lofi 鼓点
    this.sequences.push(new Tone.Sequence((time, step) => {
      if (!this.playing) return;
      if (step === 0 && this.kickSynth) {
        this.kickSynth.triggerAttackRelease('C1', '8n', time, 0.6);
      }
      if (step === 8 && this.snareSynth) {
        this.snareSynth.triggerAttackRelease('16n', time, 0.4);
      }
      if (this.hihatSynth && step % 4 === 2) {
        this.hihatSynth.triggerAttackRelease('32n', time, 0.25);
      }
    }, Array.from({ length: 16 }, (_, i) => i), '16n'));
  }

  // --- Track 4: ⚔️ 史诗英雄决战 (Epic Battle Orchestra) ---
  private setupEpicTrack(): void {
    const epicChords = [
      ['D3', 'F3', 'A3'], ['Bb2', 'D3', 'F3'], ['G2', 'Bb2', 'D3'], ['A2', 'C#3', 'E3']
    ];
    const bassNotes = ['D1', 'Bb0', 'G0', 'A0'];

    // 8th 音符雷霆低音
    const epicBass: (string | null)[] = [];
    for (let i = 0; i < 4; i++) {
      const b = bassNotes[i];
      epicBass.push(b, null, b, b, b, null, b, b);
    }

    this.sequences.push(new Tone.Sequence((time, note) => {
      if (note && this.bassSynth && this.playing) {
        this.bassSynth.triggerAttackRelease(note, '8n', time, 0.95);
      }
    }, epicBass, '8n'));

    this.sequences.push(new Tone.Sequence((time, chord) => {
      if (chord && this.padSynth && this.playing) {
        this.padSynth.triggerAttackRelease(chord, '1m', time, 0.55);
      }
    }, epicChords, '1m'));

    // Brass Hits 铜管决战切分
    this.sequences.push(new Tone.Sequence((time, step) => {
      if (!this.playing || !this.brassStabSynth || this.mode !== 'battle') return;
      if (step === 0 || step === 6 || step === 12) {
        this.brassStabSynth.triggerAttackRelease(['D4', 'F4', 'A4'], '8n', time, 0.9);
      }
    }, Array.from({ length: 16 }, (_, i) => i), '16n'));

    // 重锤战场鼓点
    this.sequences.push(new Tone.Sequence((time, step) => {
      if (!this.playing) return;
      if ((step === 0 || step === 4 || step === 8 || step === 12) && this.kickSynth) {
        this.kickSynth.triggerAttackRelease('C1', '8n', time, 0.95);
      }
      if ((step === 4 || step === 12) && this.snareSynth && this.mode === 'battle') {
        this.snareSynth.triggerAttackRelease('16n', time, 0.85);
      }
      if (this.hihatSynth) {
        this.hihatSynth.triggerAttackRelease('32n', time, step % 2 === 0 ? 0.4 : 0.2);
      }
    }, Array.from({ length: 16 }, (_, i) => i), '16n'));

    // 史诗英雄决战主旋律
    const epicLead = [
      'D5', null, 'A5', null, 'F5', 'G5', 'A5', null,
      'Bb5', null, 'F5', null, 'G5', 'F5', 'E5', null,
      'D5', null, 'F5', null, 'G5', 'A5', 'Bb5', null,
      'A5', null, 'E5', null, 'D5', null, null, null,
    ];

    this.sequences.push(new Tone.Sequence((time, note) => {
      if (note && this.lead1Synth && this.playing && this.mode === 'battle') {
        this.lead1Synth.triggerAttackRelease(note, '8n', time, 0.8);
      }
    }, epicLead, '8n'));
  }

  /**
   * 启动 BGM 播放
   */
  public start(): void {
    if (this.playing) return;
    this.playing = true;

    for (const seq of this.sequences) {
      seq.start(0);
    }

    if (Tone.getTransport().state !== 'started') {
      Tone.getTransport().start();
    }
  }

  /**
   * 停止 BGM 播放
   */
  public stop(): void {
    if (!this.playing) return;
    this.playing = false;
    for (const seq of this.sequences) {
      seq.stop();
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
   * 设置模式 ('calm' 惬意轻快 / 'battle' 激情欢快)
   */
  public setMode(mode: BgmMode): void {
    this.mode = mode;
  }

  /**
   * 切换备选音乐曲目 ('upbeat' | 'cyber' | 'lofi' | 'epic')
   */
  public setTrack(trackId: BgmTrackId): void {
    if (this.trackId === trackId) return;
    this.trackId = trackId;
    this.rebuildTrackSequences();
  }

  public getTrack(): BgmTrackId {
    return this.trackId;
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

  public getMode(): BgmMode {
    return this.mode;
  }

  public isPlaying(): boolean {
    return this.playing;
  }

  private calcVolumeDb(): number {
    if (this.volumeValue <= 1e-4) return -Infinity;
    return Tone.gainToDb(Math.max(0.0001, this.volumeValue * 0.55));
  }

  public dispose(): void {
    this.stop();
    for (const seq of this.sequences) {
      seq.dispose();
    }
    this.sequences = [];

    this.bassSynth?.dispose();
    this.padSynth?.dispose();
    this.arpSynth?.dispose();
    this.marimbaSynth?.dispose();
    this.lead1Synth?.dispose();
    this.lead2Synth?.dispose();
    this.brassStabSynth?.dispose();
    this.kickSynth?.dispose();
    this.snareSynth?.dispose();
    this.hihatSynth?.dispose();
    this.crashSynth?.dispose();
    this.filterNode?.dispose();
    this.chorusNode?.dispose();
    this.delayNode?.dispose();
    this.reverbNode?.dispose();
    this.bgmBus?.dispose();

    this.ready = false;
  }
}
