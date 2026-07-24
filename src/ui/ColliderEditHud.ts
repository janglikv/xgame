import { Container, Graphics, Text } from 'pixi.js';
import type { ColliderEditPart } from '../systems/ColliderEditController';

const LABEL_STYLE = {
  fontFamily: 'system-ui, -apple-system, sans-serif',
  fontSize: 12,
  fontWeight: '700' as const,
  fill: 0xffffff,
};

type ModeBtn = {
  root: Container;
  bg: Graphics;
  part: ColliderEditPart;
  w: number;
  h: number;
};

/**
 * 碰撞编辑工具条：碰撞体 / 受击体 分栏，再加圆/矩/删除/导出。
 */
export class ColliderEditHud extends Container {
  private readonly bg: Graphics;
  private readonly statusText: Text;
  private readonly modeBtns: ModeBtn[] = [];
  private editPart: ColliderEditPart = 'solid';

  private onExport: (() => void) | null = null;
  private onAdd: ((kind: 'circle' | 'rect') => void) | null = null;
  private onDelete: (() => void) | null = null;
  private onMode: ((part: ColliderEditPart) => void) | null = null;

  constructor() {
    super();
    this.label = 'ColliderEditHud';
    this.eventMode = 'static';
    this.visible = true;

    this.bg = new Graphics();
    this.addChild(this.bg);

    let x = 10;
    const y = 10;

    const solidBtn = this.makeModeButton('碰撞体', 'solid', x, y);
    this.modeBtns.push(solidBtn);
    x += solidBtn.w + 6;

    const hurtBtn = this.makeModeButton('受击体', 'hurt', x, y);
    this.modeBtns.push(hurtBtn);
    x += hurtBtn.w + 14;

    x = this.makeActionButton('+圆', x, y, () => this.onAdd?.('circle')).right + 6;
    x = this.makeActionButton('+矩', x, y, () => this.onAdd?.('rect')).right + 6;
    x = this.makeActionButton('删除', x, y, () => this.onDelete?.()).right + 8;
    x = this.makeActionButton('导出', x, y, () => this.onExport?.()).right + 10;

    this.statusText = new Text({
      text: '',
      style: {
        ...LABEL_STYLE,
        fontSize: 11,
        fontWeight: '600',
        fill: 0xffcc66,
      },
    });
    this.statusText.position.set(x, y + 6);
    this.addChild(this.statusText);

    this.refreshModeStyles();
    this.redrawBg(Math.max(500, x + 100), 44);
  }

  setHandlers(handlers: {
    onExport: () => void;
    onAdd: (kind: 'circle' | 'rect') => void;
    onDelete: () => void;
    onMode: (part: ColliderEditPart) => void;
  }): void {
    this.onExport = handlers.onExport;
    this.onAdd = handlers.onAdd;
    this.onDelete = handlers.onDelete;
    this.onMode = handlers.onMode;
  }

  setEditPart(part: ColliderEditPart): void {
    this.editPart = part;
    this.refreshModeStyles();
  }

  setStatus(message: string): void {
    this.statusText.text = message;
  }

  layout(_screenWidth: number, _screenHeight: number): void {
    this.position.set(12, 12);
  }

  private makeModeButton(
    label: string,
    part: ColliderEditPart,
    x: number,
    y: number,
  ): ModeBtn {
    const root = new Container();
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.position.set(x, y);

    const bg = new Graphics();
    const t = new Text({
      text: label,
      style: { ...LABEL_STYLE, fontSize: 13 },
    });
    const padX = 12;
    const padY = 6;
    const w = t.width + padX * 2;
    const h = t.height + padY * 2;
    t.position.set(padX, padY);
    root.addChild(bg, t);

    root.on('pointertap', (e) => {
      e.stopPropagation();
      this.editPart = part;
      this.refreshModeStyles();
      this.onMode?.(part);
    });

    this.addChild(root);
    return { root, bg, part, w, h };
  }

  private refreshModeStyles(): void {
    for (const btn of this.modeBtns) {
      const active = btn.part === this.editPart;
      const color =
        btn.part === 'solid'
          ? active
            ? 0x145a48
            : 0x1a2838
          : active
            ? 0x5a3010
            : 0x1a2838;
      const stroke =
        btn.part === 'solid'
          ? active
            ? 0x00e5ff
            : 0x3a5a6a
          : active
            ? 0xff9100
            : 0x3a5a6a;
      btn.bg
        .clear()
        .roundRect(0, 0, btn.w, btn.h, 8)
        .fill({ color, alpha: 0.95 })
        .stroke({ width: active ? 2 : 1.5, color: stroke, alpha: 0.95 });
    }
  }

  private makeActionButton(
    label: string,
    x: number,
    y: number,
    onTap: () => void,
  ): { right: number } {
    const root = new Container();
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.position.set(x, y);

    const g = new Graphics();
    const t = new Text({
      text: label,
      style: { ...LABEL_STYLE, fontSize: 12 },
    });
    const padX = 10;
    const padY = 6;
    const w = t.width + padX * 2;
    const h = t.height + padY * 2;
    g.roundRect(0, 0, w, h, 8)
      .fill({ color: 0x1a2838, alpha: 0.95 })
      .stroke({ width: 1.5, color: 0x4a7a9a, alpha: 0.9 });
    t.position.set(padX, padY);
    root.addChild(g, t);
    root.on('pointertap', (e) => {
      e.stopPropagation();
      onTap();
    });
    this.addChild(root);
    return { right: x + w };
  }

  private redrawBg(w: number, h: number): void {
    this.bg
      .clear()
      .roundRect(0, 0, w, h, 10)
      .fill({ color: 0x0c141e, alpha: 0.9 })
      .stroke({ width: 1.5, color: 0x3a5a6a, alpha: 0.85 });
  }
}
