import { Container, Graphics, Text } from 'pixi.js';
import { CartoonGrass } from '../world/CartoonGrass';
import type { GameScene, LevelTheme } from './types';

export type MainSceneOptions = {
  onSelectLevel: (theme: LevelTheme) => void;
  onBackground?: (color: number) => void;
};

type MenuButton = {
  root: Container;
  bg: Graphics;
  theme: LevelTheme;
  width: number;
  height: number;
  baseColor: number;
  hoverColor: number;
};

/**
 * 主场景：选择进入白天关或黑夜关。
 */
export class MainScene extends Container implements GameScene {
  private readonly grass: CartoonGrass;
  private readonly veil: Graphics;
  private readonly title: Text;
  private readonly subtitle: Text;
  private readonly buttons: MenuButton[] = [];
  private readonly onSelectLevel: (theme: LevelTheme) => void;
  private readonly onBackground?: (color: number) => void;
  private viewWidth: number;
  private viewHeight: number;
  private driftT = 0;

  constructor(width: number, height: number, options: MainSceneOptions) {
    super();
    this.label = 'MainScene';
    this.viewWidth = width;
    this.viewHeight = height;
    this.onSelectLevel = options.onSelectLevel;
    this.onBackground = options.onBackground;

    this.grass = new CartoonGrass(7);
    this.addChild(this.grass);

    this.veil = new Graphics();
    this.veil.label = 'Veil';
    this.veil.rect(0, 0, width, height).fill({ color: 0x0b1520, alpha: 0.28 });
    this.addChild(this.veil);

    this.title = new Text({
      text: 'lu-o-lu',
      style: {
        fontFamily: 'system-ui, "Segoe UI", sans-serif',
        fontSize: 56,
        fontWeight: '700',
        fill: 0xffffff,
        dropShadow: {
          color: 0x1a3a0a,
          blur: 6,
          distance: 3,
          angle: Math.PI / 4,
        },
      },
    });
    this.title.anchor.set(0.5);
    this.addChild(this.title);

    this.subtitle = new Text({
      text: '选择关卡',
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 20,
        fill: 0xf0ffe8,
      },
    });
    this.subtitle.anchor.set(0.5);
    this.addChild(this.subtitle);

    this.buttons.push(
      this.createButton('白天关卡', 'day', 0xf0c040, 0xffd86a),
      this.createButton('黑夜关卡', 'night', 0x3a5a9a, 0x5a7fd4),
    );

    this.layout();
    this.grass.draw(width, height, 0, 0, true);
  }

  private createButton(
    text: string,
    theme: LevelTheme,
    baseColor: number,
    hoverColor: number,
  ): MenuButton {
    const width = 240;
    const height = 64;
    const root = new Container();
    root.eventMode = 'static';
    root.cursor = 'pointer';

    const bg = new Graphics();
    this.paintButton(bg, width, height, baseColor);
    root.addChild(bg);

    const label = new Text({
      text,
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 24,
        fontWeight: '600',
        fill: 0xffffff,
      },
    });
    label.anchor.set(0.5);
    label.position.set(width / 2, height / 2);
    root.addChild(label);

    const btn: MenuButton = {
      root,
      bg,
      theme,
      width,
      height,
      baseColor,
      hoverColor,
    };

    root.on('pointerover', () => {
      this.paintButton(bg, width, height, hoverColor);
      root.scale.set(1.04);
    });
    root.on('pointerout', () => {
      this.paintButton(bg, width, height, baseColor);
      root.scale.set(1);
    });
    root.on('pointertap', () => {
      this.onSelectLevel(theme);
    });

    this.addChild(root);
    return btn;
  }

  private paintButton(
    g: Graphics,
    w: number,
    h: number,
    color: number,
  ): void {
    g.clear();
    g.roundRect(4, 6, w, h, 16).fill({ color: 0x000000, alpha: 0.25 });
    g.roundRect(0, 0, w, h, 16).fill({ color });
    g.roundRect(10, 8, w - 20, 12, 8).fill({ color: 0xffffff, alpha: 0.18 });
  }

  async init(): Promise<void> {
    this.onBackground?.(0x5a8f3c);
  }

  update(deltaMS: number): void {
    this.driftT += deltaMS * 0.02;
    const camX = Math.sin(this.driftT * 0.0015) * 40;
    const camY = Math.cos(this.driftT * 0.0011) * 30;
    this.grass.draw(this.viewWidth, this.viewHeight, camX, camY, false);
  }

  resize(width: number, height: number): void {
    this.viewWidth = width;
    this.viewHeight = height;
    this.veil
      .clear()
      .rect(0, 0, width, height)
      .fill({ color: 0x0b1520, alpha: 0.28 });
    this.grass.draw(width, height, 0, 0, true);
    this.layout();
  }

  private layout(): void {
    const cx = this.viewWidth / 2;
    const cy = this.viewHeight / 2;

    this.title.position.set(cx, cy - 110);
    this.subtitle.position.set(cx, cy - 55);

    const gap = 20;
    const totalH =
      this.buttons.reduce((s, b) => s + b.height, 0) +
      gap * (this.buttons.length - 1);
    let y = cy - totalH / 2 + 40;

    for (const btn of this.buttons) {
      btn.root.pivot.set(btn.width / 2, btn.height / 2);
      btn.root.position.set(cx, y + btn.height / 2);
      y += btn.height + gap;
    }
  }
}
