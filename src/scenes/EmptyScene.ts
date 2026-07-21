import { Container, Graphics } from 'pixi.js';
import { FrostArcher } from '../entities/FrostArcher';

/**
 * 空场景：展示寒冰射手。
 */
export class EmptyScene extends Container {
  private readonly bg: Graphics;
  private readonly archer: FrostArcher;

  constructor(width: number, height: number) {
    super();
    this.label = 'EmptyScene';

    this.bg = new Graphics()
      .rect(0, 0, width, height)
      .fill({ color: 0x0b0f14 });
    this.addChild(this.bg);

    this.archer = new FrostArcher(0.14);
    this.archer.position.set(width / 2, height / 2 + 40);
    this.addChild(this.archer);
  }

  async init(): Promise<void> {
    await this.archer.load();
  }

  resize(width: number, height: number): void {
    this.bg.clear().rect(0, 0, width, height).fill({ color: 0x0b0f14 });
    this.archer.position.set(width / 2, height / 2 + 40);
  }
}
