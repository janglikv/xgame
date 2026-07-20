import { Container, Graphics, Text } from 'pixi.js';
import { FrostArcher, FrostArcherOriginal } from '../entities/FrostArcher';

/**
 * 空场景：原图 vs 部件组装，左右对比。
 */
export class EmptyScene extends Container {
  private readonly bg: Graphics;
  private readonly original: FrostArcherOriginal;
  private readonly assembled: FrostArcher;
  private readonly labelLeft: Text;
  private readonly labelRight: Text;

  constructor(width: number, height: number) {
    super();
    this.label = 'EmptyScene';

    this.bg = new Graphics()
      .rect(0, 0, width, height)
      .fill({ color: 0x0b0f14 });
    this.addChild(this.bg);

    const characterScale = 0.28;

    this.original = new FrostArcherOriginal(characterScale);
    this.assembled = new FrostArcher(characterScale);

    this.labelLeft = makeLabel('原图');
    this.labelRight = makeLabel('部件组装');

    this.addChild(this.original, this.assembled, this.labelLeft, this.labelRight);
    this.layout(width, height);
  }

  async init(): Promise<void> {
    await Promise.all([this.original.load(), this.assembled.load()]);
  }

  resize(width: number, height: number): void {
    this.bg.clear().rect(0, 0, width, height).fill({ color: 0x0b0f14 });
    this.layout(width, height);
  }

  private layout(width: number, height: number): void {
    const midY = height / 2 + 40;
    const leftX = width * 0.28;
    const rightX = width * 0.72;

    this.original.position.set(leftX, midY);
    this.assembled.position.set(rightX, midY);

    this.labelLeft.position.set(leftX, midY + 120);
    this.labelRight.position.set(rightX, midY + 120);
  }
}

function makeLabel(text: string): Text {
  const t = new Text({
    text,
    style: {
      fontFamily: 'system-ui, sans-serif',
      fontSize: 18,
      fill: 0x9ca3af,
    },
  });
  t.anchor.set(0.5, 0);
  return t;
}
