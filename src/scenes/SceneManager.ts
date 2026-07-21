import type { Container } from 'pixi.js';
import type { GameScene } from './types';

/**
 * 负责场景切换：销毁旧场景、挂载并初始化新场景。
 */
export class SceneManager {
  private current: GameScene | null = null;
  private switching: Promise<void> = Promise.resolve();

  constructor(
    private readonly stage: Container,
    private readonly getSize: () => { width: number; height: number },
  ) {}

  get active(): GameScene | null {
    return this.current;
  }

  async setScene(create: () => GameScene): Promise<void> {
    // 串行化切换，避免连点导致重叠
    this.switching = this.switching.then(() => this.swap(create));
    await this.switching;
  }

  private async swap(create: () => GameScene): Promise<void> {
    if (this.current) {
      this.stage.removeChild(this.current);
      this.current.destroy({ children: true });
      this.current = null;
    }

    const { width, height } = this.getSize();
    const scene = create();
    this.stage.addChild(scene);
    this.current = scene;
    scene.resize(width, height);
    await scene.init();
  }

  update(deltaMS: number): void {
    this.current?.update(deltaMS);
  }

  resize(width: number, height: number): void {
    this.current?.resize(width, height);
  }
}
