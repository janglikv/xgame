import type { Scene } from '@babylonjs/core';
import type { FadeOverlay } from '../ui/FadeOverlay';

export type TeleportFadePhase = 'follow' | 'hold' | 'fadeIn';

export interface TeleportFlowOptions {
  /** 切场景后全黑保持（秒） */
  blackHold?: number;
  /** 全黑 → 可见淡入（秒） */
  fadeIn?: number;
}

/**
 * 传送黑场会话（单一真相）：
 * follow（跟蓄力）→ 全黑切场景 → hold → fadeIn → follow
 *
 * 切场景异步期间 switching=true，遮罩锁全黑且不推进 hold 计时。
 */
export class TeleportFlow {
  private phase: TeleportFadePhase = 'follow';
  private holdTimer = 0;
  private switching = false;

  private readonly blackHold: number;
  private readonly fadeInDuration: number;

  constructor(
    private readonly fade: FadeOverlay,
    options: TeleportFlowOptions = {},
  ) {
    this.blackHold = options.blackHold ?? 0.12;
    this.fadeInDuration = options.fadeIn ?? 0.55;
  }

  /** 黑场 / 切场景中：冻结操作与传送再蓄力 */
  get locksInput(): boolean {
    return this.phase !== 'follow' || this.switching;
  }

  /** 是否可接受新的 goto 请求 */
  get canAcceptTransition(): boolean {
    return this.phase === 'follow' && !this.switching;
  }

  get phaseName(): TeleportFadePhase {
    return this.phase;
  }

  /** 首屏恢复等：挂到目标 Scene */
  rebindScene(scene: Scene, preserveAlpha = false): void {
    this.fade.rebind(scene, preserveAlpha);
  }

  /**
   * 执行一次传送切换：锁全黑 → switchFn（返回新 Scene）→ rebind 保持全黑 → hold。
   */
  async runTransition(switchFn: () => Promise<Scene>): Promise<void> {
    if (this.switching) return;
    this.switching = true;
    this.fade.setAlpha(1);
    try {
      const scene = await switchFn();
      this.fade.rebind(scene, true);
      this.fade.setAlpha(1);
      this.phase = 'hold';
      this.holdTimer = this.blackHold;
    } finally {
      this.switching = false;
    }
  }

  /**
   * 每帧：跟蓄力 / hold / fadeIn。
   * @param charge01 当前世界传送阵视觉蓄力（仅 follow 阶段使用）
   */
  update(dt: number, charge01: number): void {
    // 切场景中：保持全黑，不消耗 hold 时间
    if (this.switching) {
      this.fade.setAlpha(1);
      return;
    }

    if (this.phase === 'hold') {
      this.fade.setAlpha(1);
      this.holdTimer -= dt;
      if (this.holdTimer <= 0) {
        this.phase = 'fadeIn';
      }
      return;
    }

    if (this.phase === 'fadeIn') {
      const next = Math.max(
        0,
        this.fade.getAlpha() - dt / this.fadeInDuration,
      );
      this.fade.setAlpha(next);
      if (next <= 0.001) {
        this.fade.setAlpha(0);
        this.phase = 'follow';
      }
      return;
    }

    // follow
    this.fade.setAlpha(charge01);
  }
}
