import type { Minion } from '../world/Minion';
import type { MinionPhysicsProxy } from '../world/physics/MinionPhysicsProxy';

export interface WarpLandingState {
  minion: Minion;
  phys: MinionPhysicsProxy;
  startY: number;
  targetX: number;
  targetZ: number;
  progress: number;
}

const WARP_DURATION = 0.22;

/**
 * 传送落地轻落动画：从 startY 落到地面。
 * 状态可挂在任意世界的玩家上，由 GameApp 统一 tick。
 */
export class WarpLanding {
  private state: WarpLandingState | null = null;

  get active(): boolean {
    return this.state !== null;
  }

  trigger(
    minion: Minion,
    phys: MinionPhysicsProxy,
    tx: number,
    tz: number,
    startY = 0.75,
  ): void {
    minion.root.position.set(tx, startY, tz);
    phys.teleportToTarget();
    this.state = {
      minion,
      phys,
      startY,
      targetX: tx,
      targetZ: tz,
      progress: 0,
    };
  }

  /** @returns 是否仍在播放 */
  update(dt: number): boolean {
    if (!this.state) return false;
    const w = this.state;
    w.progress += dt / WARP_DURATION;
    if (w.progress >= 1) {
      w.minion.root.position.set(w.targetX, 0, w.targetZ);
      w.phys.teleportToTarget();
      this.state = null;
      return false;
    }
    const t = w.progress;
    const easeY = (1 - t) * (1 - t);
    w.minion.root.position.x = w.targetX;
    w.minion.root.position.z = w.targetZ;
    w.minion.root.position.y = w.startY * easeY;
    w.phys.teleportToTarget();
    return true;
  }

  cancel(): void {
    this.state = null;
  }
}
