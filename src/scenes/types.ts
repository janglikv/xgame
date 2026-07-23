import type { Container } from 'pixi.js';

/** 可切换的游戏场景约定 */
export interface GameScene extends Container {
  init(): Promise<void>;
  update(deltaMS: number): void;
  resize(width: number, height: number): void;
}

