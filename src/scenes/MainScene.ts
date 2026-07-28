import { Container, Graphics, Text } from 'pixi.js';
import {
  getPlayableCatalog,
  hasMapDraft,
  levelDisplayName,
  getLevelIndex,
  type LevelMapDef,
} from '../data/maps';
import { confirmAndResetGameData } from '../utils/resetGameData';
import type { GameScene } from './types';

/** 主场景纯色背景（偏夜） */
const BG_COLOR = 0x1a2430;

export type MainSceneOptions = {
  onSelectLevel: (mapDef: LevelMapDef) => void;
  /** 碰撞 / 受击体模板编辑 */
  onBodyEdit?: () => void;
  onResetData?: () => void;
  onBackground?: (color: number) => void;
};

type MenuButton = {
  root: Container;
  bg: Graphics;
  width: number;
  height: number;
  baseColor: number;
  hoverColor: number;
  onClick: () => void;
};

/**
 * 主场景：选择关卡 / 碰撞编辑。
 * 地图用关内上帝模式（G）编辑。
 */
export class MainScene extends Container implements GameScene {
  private readonly bg: Graphics;
  private readonly title: Text;
  private readonly subtitle: Text;
  private readonly buttons: MenuButton[] = [];
  private readonly onSelectLevel: (mapDef: LevelMapDef) => void;
  private readonly onBodyEdit?: () => void;
  private readonly onResetData?: () => void;
  private readonly onBackground?: (color: number) => void;
  private viewWidth: number;
  private viewHeight: number;

  constructor(width: number, height: number, options: MainSceneOptions) {
    super();
    this.label = 'MainScene';
    this.viewWidth = width;
    this.viewHeight = height;
    this.onSelectLevel = options.onSelectLevel;
    this.onBodyEdit = options.onBodyEdit;
    this.onResetData = options.onResetData;
    this.onBackground = options.onBackground;

    this.bg = new Graphics();
    this.bg.label = 'SolidBg';
    this.addChild(this.bg);
    this.paintBg(width, height);

    this.title = new Text({
      text: 'lu-o-lu',
      style: {
        fontFamily: 'system-ui, "Segoe UI", sans-serif',
        fontSize: 56,
        fontWeight: '700',
        fill: 0xffffff,
        dropShadow: {
          color: 0x0a1208,
          blur: 6,
          distance: 3,
          angle: Math.PI / 4,
        },
      },
    });
    this.title.anchor.set(0.5);
    this.addChild(this.title);

    this.subtitle = new Text({
      text: '选择关卡 · 关内 G 上帝模式编辑地图',
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 20,
        fill: 0xd0dce8,
      },
    });
    this.subtitle.anchor.set(0.5);
    this.addChild(this.subtitle);

    const levelColors: Array<[number, number]> = [
      [0x3a5a9a, 0x5a7fd4],
      [0x5a3a8a, 0x7a5ad4],
      [0x3a7a6a, 0x5a9a8a],
    ];

    // 可玩版 = 草稿优先，主菜单进关即是最新编辑结果
    getPlayableCatalog().forEach((map) => {
      const i = getLevelIndex(map.id);
      const [base, hover] = levelColors[(i >= 0 ? i : 0) % levelColors.length]!;
      const name = i >= 0 ? levelDisplayName(i) : map.id;
      const label = hasMapDraft(map.id) ? `${name} · 草稿` : name;
      this.buttons.push(
        this.createButton(label, base, hover, () => this.onSelectLevel(map)),
      );
    });

    if (this.onBodyEdit) {
      this.buttons.push(
        this.createButton('碰撞编辑', 0x3a6a8a, 0x5a8aaa, () =>
          this.onBodyEdit?.(),
        ),
      );
    }

    this.buttons.push(
      this.createButton('重置数据', 0x8a3a3a, 0xaa5a5a, () => {
        if (this.onResetData) {
          this.onResetData();
        } else {
          confirmAndResetGameData();
        }
      }),
    );

    this.layout();
  }

  private paintBg(width: number, height: number): void {
    this.bg.clear().rect(0, 0, width, height).fill({ color: BG_COLOR });
  }

  private createButton(
    text: string,
    baseColor: number,
    hoverColor: number,
    onClick: () => void,
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
      width,
      height,
      baseColor,
      hoverColor,
      onClick,
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
      onClick();
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
    this.onBackground?.(BG_COLOR);
  }

  update(_deltaMS: number): void {
    // 主菜单无需逐帧更新
  }

  resize(width: number, height: number): void {
    this.viewWidth = width;
    this.viewHeight = height;
    this.paintBg(width, height);
    this.layout();
  }

  private layout(): void {
    const cx = this.viewWidth / 2;
    const cy = this.viewHeight / 2;

    const gap = 16;
    const totalH =
      this.buttons.reduce((s, b) => s + b.height, 0) +
      gap * (this.buttons.length - 1);
    this.title.position.set(cx, cy - totalH / 2 - 70);
    this.subtitle.position.set(cx, cy - totalH / 2 - 28);

    let y = cy - totalH / 2 + 16;
    for (const btn of this.buttons) {
      btn.root.pivot.set(btn.width / 2, btn.height / 2);
      btn.root.position.set(cx, y + btn.height / 2);
      y += btn.height + gap;
    }
  }
}
