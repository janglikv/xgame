import { Container, Graphics, Rectangle, Text } from 'pixi.js';
import {
  cellCenter,
  cellKey,
  cellOrigin,
  cloneLevelDef,
  copyLevelDefTs,
  defFromCells,
  gridDims,
  isSpawnValid,
  worldToCell,
  type LevelMapDef,
} from '../data/maps';
import { LEVEL_1 } from '../data/maps/level-1';
import { PINE_SPACING } from '../world/mapLayout';
import type { GameScene } from './types';

const BG = 0x152018;
const FOREST = 0x243d22;
const GRID_LINE = 0x1a3018;
const HOLE = 0x8fe05a;
const SPAWN = 0xff4d4d;
const BTN = 0x3d5c3d;
const BTN_HOVER = 0x527a52;
const BTN_MAIN = 0xf0c040;
const BTN_BRUSH = 0x4a6a8a;

/** 画笔边长（格），1 = 单格，最大 11 */
const BRUSH_MIN = 1;
const BRUSH_MAX = 11;

export type MapEditSceneOptions = {
  onBack: () => void;
  onBackground?: (color: number) => void;
  initialDef?: LevelMapDef;
};

/**
 * 抠图式地图编辑：按「一棵树宽」格子涂抹可走区。
 * 左键涂抹 · 右键擦除 · Shift+点击放出生点 · [ ] 调笔粗 · 滚轮缩放
 */
export class MapEditScene extends Container implements GameScene {
  private readonly world: Container;
  private readonly gfx: Graphics;
  private readonly hud: Container;
  private readonly tip: Text;
  private readonly brushLabel: Text;
  private readonly actionBtns: Container[] = [];

  private readonly mapSize: number;
  private readonly cellSize: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly cells: Set<number>;
  private spawn: { x: number; y: number };
  private readonly levelId: string;

  private viewW: number;
  private viewH: number;
  private zoom = 0.1;
  private camX = 0;
  private camY = 0;

  /** 画笔粗细：边长（格），正方形笔刷 */
  private brushSize = 3;
  private painting: 'dig' | 'fill' | null = null;
  private lastCell: { c: number; r: number } | null = null;
  private hoverCell: { c: number; r: number } | null = null;
  private shiftDown = false;
  private tipTimer = 0;

  private readonly onBack: () => void;
  private readonly onBackground?: (color: number) => void;

  constructor(width: number, height: number, options: MapEditSceneOptions) {
    super();
    this.label = 'MapEditScene';
    this.viewW = width;
    this.viewH = height;
    this.onBack = options.onBack;
    this.onBackground = options.onBackground;

    const src = options.initialDef
      ? cloneLevelDef(options.initialDef)
      : {
          id: LEVEL_1.id,
          mapSize: LEVEL_1.mapSize,
          cellSize: PINE_SPACING,
          spawn: { x: 0, y: 0 },
          walk: [] as LevelMapDef['walk'],
        };

    this.levelId = src.id;
    this.mapSize = src.mapSize;
    this.cellSize = src.cellSize || PINE_SPACING;
    const dim = gridDims(this.mapSize, this.cellSize);
    this.cols = dim.cols;
    this.rows = dim.rows;
    this.cells = new Set<number>();
    for (const rect of src.walk) {
      for (let r = rect.r; r < rect.r + rect.h; r++) {
        for (let c = rect.c; c < rect.c + rect.w; c++) {
          if (c >= 0 && r >= 0 && c < this.cols && r < this.rows) {
            this.cells.add(cellKey(c, r, this.cols));
          }
        }
      }
    }
    this.spawn = { ...src.spawn };

    this.eventMode = 'static';
    this.cursor = 'cell';
    this.hitArea = new Rectangle(0, 0, width, height);

    this.world = new Container();
    this.world.eventMode = 'none';
    this.addChild(this.world);

    this.gfx = new Graphics();
    this.world.addChild(this.gfx);

    this.hud = new Container();
    this.hud.eventMode = 'static';
    this.addChild(this.hud);

    this.tip = new Text({
      text: this.defaultTip(),
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 15,
        fill: 0xe2f0dc,
      },
    });
    this.hud.addChild(this.tip);

    this.brushLabel = new Text({
      text: this.brushText(),
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 15,
        fontWeight: '700',
        fill: 0xffffff,
      },
    });
    this.brushLabel.anchor.set(0.5, 0.5);
    this.hud.addChild(this.brushLabel);

    // 笔粗：左上 [ − ] 笔 NxN [ + ]
    this.addBtn(
      '−',
      BTN_BRUSH,
      0xffffff,
      () => this.setBrushSize(this.brushSize - 1),
      44,
      'brush',
    );
    this.addBtn(
      '+',
      BTN_BRUSH,
      0xffffff,
      () => this.setBrushSize(this.brushSize + 1),
      44,
      'brush',
    );

    this.addBtn('导出', BTN_MAIN, 0x222222, () => void this.exportCode());
    this.addBtn('清空', BTN, 0xffffff, () => {
      this.cells.clear();
      this.paint();
      this.flash('已清空');
    });
    this.addBtn('返回', BTN, 0xffffff, () => this.onBack());

    this.on('pointerdown', this.onDown);
    this.on('pointermove', this.onMove);
    this.on('pointerup', this.onUp);
    this.on('pointerupoutside', this.onUp);

    this.fit();
    this.paint();
    this.layout();
  }

  private brushText(): string {
    return `笔 ${this.brushSize}×${this.brushSize}`;
  }

  private defaultTip(): string {
    return `左键涂 · 右键擦 · Shift+点出生 · [ ] 调笔粗（现 ${this.brushSize} 格）· 滚轮缩放`;
  }

  private setBrushSize(n: number): void {
    const next = Math.min(BRUSH_MAX, Math.max(BRUSH_MIN, Math.round(n)));
    if (next === this.brushSize) return;
    this.brushSize = next;
    this.brushLabel.text = this.brushText();
    this.flash(`画笔 ${this.brushSize}×${this.brushSize} 格`);
    this.paint();
  }

  private toDef(): LevelMapDef {
    return defFromCells(
      {
        id: this.levelId,
        mapSize: this.mapSize,
        cellSize: this.cellSize,
        spawn: this.spawn,
      },
      this.cells,
    );
  }

  private addBtn(
    label: string,
    color: number,
    textColor: number,
    onClick: () => void,
    width = 88,
    group: 'action' | 'brush' = 'action',
  ): void {
    const w = width;
    const h = 40;
    const root = new Container();
    root.eventMode = 'static';
    root.cursor = 'pointer';
    const bg = new Graphics();
    bg.roundRect(0, 0, w, h, 10).fill({ color });
    const text = new Text({
      text: label,
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 16,
        fontWeight: '700',
        fill: textColor,
      },
    });
    text.anchor.set(0.5);
    text.position.set(w / 2, h / 2);
    root.addChild(bg, text);
    root.on('pointerdown', (e) => e.stopPropagation());
    root.on('pointerover', () => {
      const hover =
        color === BTN_MAIN
          ? 0xffd86a
          : color === BTN_BRUSH
            ? 0x6a8aaa
            : BTN_HOVER;
      bg.clear().roundRect(0, 0, w, h, 10).fill({ color: hover });
    });
    root.on('pointerout', () => {
      bg.clear().roundRect(0, 0, w, h, 10).fill({ color });
    });
    root.on('pointertap', (e) => {
      e.stopPropagation();
      onClick();
    });
    (root as Container & { __w: number; __group: string }).__w = w;
    (root as Container & { __w: number; __group: string }).__group = group;
    this.hud.addChild(root);
    this.actionBtns.push(root);
  }

  private fit(): void {
    this.zoom =
      Math.min(this.viewW / this.mapSize, this.viewH / this.mapSize) * 0.88;
    this.camX = 0;
    this.camY = 0;
    this.applyCam();
  }

  private applyCam(): void {
    this.world.scale.set(this.zoom);
    this.world.position.set(
      this.viewW / 2 - this.camX * this.zoom,
      this.viewH / 2 - this.camY * this.zoom,
    );
  }

  private toWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - this.viewW / 2) / this.zoom + this.camX,
      y: (sy - this.viewH / 2) / this.zoom + this.camY,
    };
  }

  private clampCell(c: number, r: number): { c: number; r: number } | null {
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return null;
    return { c, r };
  }

  private cellAtScreen(sx: number, sy: number): { c: number; r: number } | null {
    const w = this.toWorld(sx, sy);
    const { c, r } = worldToCell(w.x, w.y, this.mapSize, this.cellSize);
    return this.clampCell(c, r);
  }

  private stampCell(c: number, r: number, dig: boolean): void {
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return;
    const k = cellKey(c, r, this.cols);
    if (dig) {
      if (!this.cells.has(k)) {
        const wasEmpty = this.cells.size === 0;
        this.cells.add(k);
        if (wasEmpty) {
          this.spawn = cellCenter(c, r, this.mapSize, this.cellSize);
        }
      }
    } else {
      this.cells.delete(k);
    }
  }

  /** 以 (c,r) 为中心，刷正方形 brushSize×brushSize */
  private stampBrush(c: number, r: number, dig: boolean): void {
    const s = this.brushSize;
    const half = Math.floor((s - 1) / 2);
    for (let dr = 0; dr < s; dr++) {
      for (let dc = 0; dc < s; dc++) {
        this.stampCell(c + dc - half, r + dr - half, dig);
      }
    }
  }

  /** 在两格之间插值涂抹，避免拖快点漏格 */
  private strokeTo(c: number, r: number, dig: boolean): void {
    if (!this.lastCell) {
      this.stampBrush(c, r, dig);
      this.lastCell = { c, r };
      return;
    }
    const c0 = this.lastCell.c;
    const r0 = this.lastCell.r;
    const dc = c - c0;
    const dr = r - r0;
    const steps = Math.max(Math.abs(dc), Math.abs(dr), 1);
    for (let i = 0; i <= steps; i++) {
      const cc = Math.round(c0 + (dc * i) / steps);
      const rr = Math.round(r0 + (dr * i) / steps);
      this.stampBrush(cc, rr, dig);
    }
    this.lastCell = { c, r };
  }

  private onDown = (e: {
    global: { x: number; y: number };
    button: number;
  }): void => {
    const cell = this.cellAtScreen(e.global.x, e.global.y);
    if (!cell) return;

    // Shift+点：出生点
    if (this.shiftDown && e.button === 0) {
      this.spawn = cellCenter(cell.c, cell.r, this.mapSize, this.cellSize);
      this.paint();
      this.flash(
        this.cells.has(cellKey(cell.c, cell.r, this.cols))
          ? '出生点已放'
          : '出生点不在洞里（先涂抹再放）',
      );
      return;
    }

    if (e.button === 0) {
      this.painting = 'dig';
      this.lastCell = null;
      this.strokeTo(cell.c, cell.r, true);
      this.paint();
      return;
    }

    if (e.button === 2) {
      this.painting = 'fill';
      this.lastCell = null;
      this.strokeTo(cell.c, cell.r, false);
      this.paint();
    }
  };

  private onMove = (e: { global: { x: number; y: number } }): void => {
    const cell = this.cellAtScreen(e.global.x, e.global.y);
    this.hoverCell = cell;
    if (this.painting && cell) {
      this.strokeTo(cell.c, cell.r, this.painting === 'dig');
    }
    this.paint();
  };

  private onUp = (): void => {
    this.painting = null;
    this.lastCell = null;
  };

  private paint(): void {
    const half = this.mapSize / 2;
    const sw = 1 / Math.max(this.zoom, 0.05);
    this.gfx.clear();
    this.gfx.rect(-half, -half, this.mapSize, this.mapSize).fill({
      color: FOREST,
    });

    // 树格网（略淡，提示基本单元）
    const step = this.cellSize;
    const gridEvery =
      this.zoom < 0.08 ? 4 : this.zoom < 0.15 ? 2 : 1;
    this.gfx.setStrokeStyle({
      width: sw,
      color: GRID_LINE,
      alpha: 0.45,
    });
    for (let i = 0; i <= this.cols; i += gridEvery) {
      const x = -half + i * step;
      this.gfx.moveTo(x, -half).lineTo(x, half).stroke();
    }
    for (let i = 0; i <= this.rows; i += gridEvery) {
      const y = -half + i * step;
      this.gfx.moveTo(-half, y).lineTo(half, y).stroke();
    }

    // 可走格
    for (const k of this.cells) {
      const c = k % this.cols;
      const r = (k / this.cols) | 0;
      const o = cellOrigin(c, r, this.mapSize, this.cellSize);
      this.gfx
        .rect(o.x, o.y, this.cellSize, this.cellSize)
        .fill({ color: HOLE, alpha: 0.55 });
    }

    // 画笔预览（当前悬停格为中心的正方形）
    if (this.hoverCell) {
      const s = this.brushSize;
      const halfB = Math.floor((s - 1) / 2);
      const o = cellOrigin(
        this.hoverCell.c - halfB,
        this.hoverCell.r - halfB,
        this.mapSize,
        this.cellSize,
      );
      this.gfx
        .rect(o.x, o.y, s * this.cellSize, s * this.cellSize)
        .fill({ color: 0xffffff, alpha: 0.12 })
        .stroke({ width: sw * 2, color: 0xffe14a, alpha: 0.9 });
    }

    // 出生点
    this.gfx.circle(this.spawn.x, this.spawn.y, this.cellSize * 0.7).fill({
      color: SPAWN,
      alpha: 0.95,
    });
    this.gfx
      .circle(this.spawn.x, this.spawn.y, this.cellSize * 0.7)
      .stroke({ width: sw * 3, color: 0xffffff });
  }

  private async exportCode(): Promise<void> {
    const def = this.toDef();
    if (def.walk.length === 0) {
      this.flash('先涂抹出可走格子');
      return;
    }
    if (!isSpawnValid(def)) {
      this.flash('请把出生点放到洞里（Shift+点击）');
      return;
    }
    const { text, copied } = await copyLevelDefTs(def, 'LEVEL_1');
    console.log('[MapEdit]\n' + text);
    this.flash(
      copied
        ? `已复制 ${this.cells.size} 格 → 粘贴到 level-1.ts`
        : '剪贴板失败，请看控制台',
    );
  }

  private flash(msg: string): void {
    this.tip.text = msg;
    this.tipTimer = 2.8;
  }

  private layout(): void {
    // 右上：导出 / 清空 / 返回
    let x = this.viewW - 12;
    for (let i = this.actionBtns.length - 1; i >= 0; i--) {
      const b = this.actionBtns[i] as Container & {
        __w?: number;
        __group?: string;
      };
      if (b.__group === 'brush') continue;
      const w = b.__w ?? 88;
      x -= w;
      b.position.set(x, 12);
      x -= 10;
    }

    // 左上：−  笔 NxN  +
    const brushBtns = this.actionBtns.filter(
      (b) => (b as Container & { __group?: string }).__group === 'brush',
    );
    let bx = 14;
    const by = 52;
    if (brushBtns[0]) {
      brushBtns[0].position.set(bx, by);
      bx += ((brushBtns[0] as Container & { __w?: number }).__w ?? 44) + 8;
    }
    this.brushLabel.position.set(bx + 40, by + 20);
    bx += 88;
    if (brushBtns[1]) {
      brushBtns[1].position.set(bx, by);
    }

    this.tip.position.set(14, 18);
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Shift') this.shiftDown = true;
    // [ ] 或 - = 调笔粗；数字 1–9 直设
    if (e.key === '[' || e.key === '-' || e.key === '_') {
      this.setBrushSize(this.brushSize - 1);
      e.preventDefault();
    } else if (e.key === ']' || e.key === '=' || e.key === '+') {
      this.setBrushSize(this.brushSize + 1);
      e.preventDefault();
    } else if (e.key >= '1' && e.key <= '9') {
      this.setBrushSize(Number(e.key));
      e.preventDefault();
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === 'Shift') this.shiftDown = false;
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const next = Math.min(
      2,
      Math.max(0.05, this.zoom * (e.deltaY > 0 ? 0.9 : 1.1)),
    );
    const before = this.toWorld(e.offsetX, e.offsetY);
    this.zoom = next;
    const after = this.toWorld(e.offsetX, e.offsetY);
    this.camX += before.x - after.x;
    this.camY += before.y - after.y;
    this.applyCam();
    this.paint();
  };

  private readonly onContext = (e: Event): void => e.preventDefault();

  async init(): Promise<void> {
    this.onBackground?.(BG);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('contextmenu', this.onContext);
  }

  update(deltaMS: number): void {
    if (this.tipTimer > 0) {
      this.tipTimer -= deltaMS / 1000;
      if (this.tipTimer <= 0) this.tip.text = this.defaultTip();
    }
  }

  resize(width: number, height: number): void {
    this.viewW = width;
    this.viewH = height;
    this.hitArea = new Rectangle(0, 0, width, height);
    this.fit();
    this.layout();
    this.paint();
  }

  destroy(options?: Parameters<Container['destroy']>[0]): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('contextmenu', this.onContext);
    this.off('pointerdown', this.onDown);
    this.off('pointermove', this.onMove);
    this.off('pointerup', this.onUp);
    this.off('pointerupoutside', this.onUp);
    super.destroy(options);
  }
}
