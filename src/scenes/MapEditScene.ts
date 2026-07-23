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
  type EnemySpawn,
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
const ENEMY = 0xc45cff;
const BTN = 0x3d5c3d;
const BTN_HOVER = 0x527a52;
const BTN_MAIN = 0xf0c040;
const BTN_BRUSH = 0x4a6a8a;
const BTN_MODE = 0x3d4a5c;
const BTN_MODE_ON = 0xf0c040;

/** 画笔边长（格），1 = 单格，最大 11 */
const BRUSH_MIN = 1;
const BRUSH_MAX = 11;
/** 撤销步数上限 */
const UNDO_MAX = 40;
/** 右键删除敌人时的拾取半径（相对格宽） */
const ENEMY_PICK_CELLS = 1.25;

type EditTool = 'brush' | 'box' | 'enemy';

/** 可撤销的地图状态快照 */
type EditSnapshot = {
  cells: number[];
  spawn: { x: number; y: number };
  enemies: EnemySpawn[];
};

type HudBtn = Container & {
  __w: number;
  __group: 'action' | 'brush' | 'mode';
  __id?: string;
  __baseColor: number;
  __bg: Graphics;
  __label: Text;
};

export type MapEditSceneOptions = {
  onBack: () => void;
  onBackground?: (color: number) => void;
  initialDef?: LevelMapDef;
};

/**
 * 地图编辑：树宽格子上涂抹 / 框选可走区；敌人模式放置刷怪点。
 * 涂抹：左键挖、右键擦、[ ] 笔粗
 * 框选：拖矩形挖/擦整块格
 * 敌人：左键放蜘蛛、右键删最近
 * Shift+点：出生点 · Ctrl/Cmd+Z 撤销
 */
export class MapEditScene extends Container implements GameScene {
  private readonly world: Container;
  private readonly gfx: Graphics;
  private readonly hud: Container;
  private readonly tip: Text;
  private readonly brushLabel: Text;
  private readonly actionBtns: HudBtn[] = [];

  private readonly mapSize: number;
  private readonly cellSize: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly cells: Set<number>;
  private spawn: { x: number; y: number };
  private enemies: EnemySpawn[];
  private readonly levelId: string;
  private readonly undoStack: EditSnapshot[] = [];

  private viewW: number;
  private viewH: number;
  private zoom = 0.1;
  private camX = 0;
  private camY = 0;

  private tool: EditTool = 'brush';
  private brushSize = 3;
  private painting: 'dig' | 'fill' | null = null;
  private lastCell: { c: number; r: number } | null = null;
  private hoverCell: { c: number; r: number } | null = null;
  /** 框选起点 / 当前角（格子） */
  private boxStart: { c: number; r: number } | null = null;
  private boxEnd: { c: number; r: number } | null = null;
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
          enemies: [] as EnemySpawn[],
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
    this.enemies = (src.enemies ?? []).map((e) => ({ ...e }));

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

    this.addBtn('涂抹', BTN_MODE, 0xffffff, () => this.setTool('brush'), 72, 'mode', 'brush');
    this.addBtn('框选', BTN_MODE, 0xffffff, () => this.setTool('box'), 72, 'mode', 'box');
    this.addBtn('敌人', BTN_MODE, 0xffffff, () => this.setTool('enemy'), 72, 'mode', 'enemy');

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

    this.addBtn('撤销', BTN, 0xffffff, () => this.undo());
    this.addBtn('导出', BTN_MAIN, 0x222222, () => void this.exportCode());
    this.addBtn('清空', BTN, 0xffffff, () => {
      if (this.cells.size === 0 && this.enemies.length === 0) {
        this.flash('已经是空的');
        return;
      }
      this.pushUndo();
      this.cells.clear();
      this.enemies = [];
      this.paint();
      this.flash('已清空可走区与敌人');
    });
    this.addBtn('返回', BTN, 0xffffff, () => this.onBack());

    this.on('pointerdown', this.onDown);
    this.on('pointermove', this.onMove);
    this.on('pointerup', this.onUp);
    this.on('pointerupoutside', this.onUp);

    this.refreshModeButtons();
    this.fit();
    this.paint();
    this.layout();
  }

  private brushText(): string {
    return `笔 ${this.brushSize}×${this.brushSize}`;
  }

  private defaultTip(): string {
    if (this.tool === 'box') {
      return '框选：左键挖 · 右键擦 · Shift+点出生 · Ctrl+Z 撤销 · B/R/E 切工具 · 滚轮缩放';
    }
    if (this.tool === 'enemy') {
      return `敌人：左键放蜘蛛 · 右键删最近 · 已放 ${this.enemies.length} · Shift+点出生 · E 本工具 · 滚轮缩放`;
    }
    return `涂抹：左键挖 · 右键擦 · 笔 ${this.brushSize} · Ctrl+Z 撤销 · B/R/E 切工具 · 滚轮缩放`;
  }

  private takeSnapshot(): EditSnapshot {
    return {
      cells: Array.from(this.cells),
      spawn: { x: this.spawn.x, y: this.spawn.y },
      enemies: this.enemies.map((e) => ({ ...e })),
    };
  }

  private applySnapshot(s: EditSnapshot): void {
    this.cells.clear();
    for (const k of s.cells) this.cells.add(k);
    this.spawn = { x: s.spawn.x, y: s.spawn.y };
    this.enemies = s.enemies.map((e) => ({ ...e }));
  }

  /** 在修改前压栈；同一次笔触只压一次 */
  private pushUndo(): void {
    this.undoStack.push(this.takeSnapshot());
    if (this.undoStack.length > UNDO_MAX) {
      this.undoStack.shift();
    }
  }

  private undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) {
      this.flash('没有可撤销的操作');
      return;
    }
    // 中断进行中的笔触
    this.painting = null;
    this.lastCell = null;
    this.boxStart = null;
    this.boxEnd = null;
    this.applySnapshot(prev);
    this.paint();
    this.flash(`已撤销（剩余 ${this.undoStack.length} 步）`);
  }

  private setTool(tool: EditTool): void {
    if (this.tool === tool) return;
    this.tool = tool;
    this.painting = null;
    this.lastCell = null;
    this.boxStart = null;
    this.boxEnd = null;
    this.cursor =
      tool === 'box' ? 'crosshair' : tool === 'enemy' ? 'pointer' : 'cell';
    this.refreshModeButtons();
    this.layout();
    this.flash(
      tool === 'box' ? '框选模式' : tool === 'enemy' ? '敌人模式' : '涂抹模式',
    );
    this.paint();
  }

  private setBrushSize(n: number): void {
    const next = Math.min(BRUSH_MAX, Math.max(BRUSH_MIN, Math.round(n)));
    if (next === this.brushSize) return;
    this.brushSize = next;
    this.brushLabel.text = this.brushText();
    this.flash(`画笔 ${this.brushSize}×${this.brushSize} 格`);
    this.paint();
  }

  private refreshModeButtons(): void {
    for (const b of this.actionBtns) {
      if (b.__group !== 'mode') continue;
      const on = b.__id === this.tool;
      const color = on ? BTN_MODE_ON : b.__baseColor;
      b.__bg.clear().roundRect(0, 0, b.__w, 40, 10).fill({ color });
      b.__label.style.fill = on ? 0x1a1200 : 0xffffff;
    }
  }

  private toDef(): LevelMapDef {
    return defFromCells(
      {
        id: this.levelId,
        mapSize: this.mapSize,
        cellSize: this.cellSize,
        spawn: this.spawn,
        enemies: this.enemies.map((e) => ({ ...e })),
      },
      this.cells,
    );
  }

  /** 找距离世界点最近的敌人索引；超出拾取半径返回 -1 */
  private nearestEnemyIndex(wx: number, wy: number): number {
    const maxDist = this.cellSize * ENEMY_PICK_CELLS;
    let best = -1;
    let bestD = maxDist;
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i]!;
      const d = Math.hypot(e.x - wx, e.y - wy);
      if (d <= bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  private placeEnemyAtCell(c: number, r: number): void {
    const pos = cellCenter(c, r, this.mapSize, this.cellSize);
    const dup = this.enemies.some(
      (e) => Math.hypot(e.x - pos.x, e.y - pos.y) < this.cellSize * 0.25,
    );
    if (dup) {
      this.flash('这一格已有敌人');
      return;
    }
    this.pushUndo();
    this.enemies.push({ kind: 'spider', x: pos.x, y: pos.y });
    const onWalk = this.cells.has(cellKey(c, r, this.cols));
    this.flash(
      onWalk
        ? `已放蜘蛛（共 ${this.enemies.length}）`
        : `已放蜘蛛（不在洞里，共 ${this.enemies.length}）`,
    );
  }

  private removeNearestEnemy(wx: number, wy: number): void {
    const idx = this.nearestEnemyIndex(wx, wy);
    if (idx < 0) {
      this.flash('附近没有敌人');
      return;
    }
    this.pushUndo();
    this.enemies.splice(idx, 1);
    this.flash(`已删除（剩余 ${this.enemies.length}）`);
  }

  private addBtn(
    label: string,
    color: number,
    textColor: number,
    onClick: () => void,
    width = 88,
    group: 'action' | 'brush' | 'mode' = 'action',
    id?: string,
  ): void {
    const w = width;
    const h = 40;
    const root = new Container() as HudBtn;
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
    root.__w = w;
    root.__group = group;
    root.__id = id;
    root.__baseColor = color;
    root.__bg = bg;
    root.__label = text;

    root.on('pointerdown', (e) => e.stopPropagation());
    root.on('pointerover', () => {
      if (group === 'mode' && root.__id === this.tool) return;
      const hover =
        color === BTN_MAIN
          ? 0xffd86a
          : color === BTN_BRUSH
            ? 0x6a8aaa
            : color === BTN_MODE
              ? 0x5a6a7c
              : BTN_HOVER;
      bg.clear().roundRect(0, 0, w, h, 10).fill({ color: hover });
    });
    root.on('pointerout', () => {
      if (group === 'mode') {
        this.refreshModeButtons();
        return;
      }
      bg.clear().roundRect(0, 0, w, h, 10).fill({ color });
    });
    root.on('pointertap', (e) => {
      e.stopPropagation();
      onClick();
    });
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

  /** 映射到格子并 clamp 到地图内 */
  private cellAtScreenLoose(
    sx: number,
    sy: number,
  ): { c: number; r: number } {
    const w = this.toWorld(sx, sy);
    const { c, r } = worldToCell(w.x, w.y, this.mapSize, this.cellSize);
    return {
      c: Math.min(this.cols - 1, Math.max(0, c)),
      r: Math.min(this.rows - 1, Math.max(0, r)),
    };
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

  private stampBrush(c: number, r: number, dig: boolean): void {
    const s = this.brushSize;
    const half = Math.floor((s - 1) / 2);
    for (let dr = 0; dr < s; dr++) {
      for (let dc = 0; dc < s; dc++) {
        this.stampCell(c + dc - half, r + dr - half, dig);
      }
    }
  }

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

  /** 轴对齐格子矩形（含端点） */
  private normalizeBox(
    a: { c: number; r: number },
    b: { c: number; r: number },
  ): { c0: number; r0: number; c1: number; r1: number } {
    return {
      c0: Math.min(a.c, b.c),
      r0: Math.min(a.r, b.r),
      c1: Math.max(a.c, b.c),
      r1: Math.max(a.r, b.r),
    };
  }

  private fillBox(
    a: { c: number; r: number },
    b: { c: number; r: number },
    dig: boolean,
  ): void {
    const { c0, r0, c1, r1 } = this.normalizeBox(a, b);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        this.stampCell(c, r, dig);
      }
    }
  }

  private onDown = (e: {
    global: { x: number; y: number };
    button: number;
  }): void => {
    const cell = this.cellAtScreenLoose(e.global.x, e.global.y);

    if (this.shiftDown && e.button === 0) {
      const next = cellCenter(cell.c, cell.r, this.mapSize, this.cellSize);
      if (next.x !== this.spawn.x || next.y !== this.spawn.y) {
        this.pushUndo();
        this.spawn = next;
      }
      this.paint();
      this.flash(
        this.cells.has(cellKey(cell.c, cell.r, this.cols))
          ? '出生点已放'
          : '出生点不在洞里（先挖洞再放）',
      );
      return;
    }

    if (this.tool === 'enemy') {
      if (e.button === 0) {
        this.placeEnemyAtCell(cell.c, cell.r);
      } else if (e.button === 2) {
        const w = this.toWorld(e.global.x, e.global.y);
        this.removeNearestEnemy(w.x, w.y);
      }
      this.paint();
      return;
    }

    const dig = e.button === 0;
    const erase = e.button === 2;
    if (!dig && !erase) return;

    if (this.tool === 'box') {
      this.painting = dig ? 'dig' : 'fill';
      this.boxStart = { ...cell };
      this.boxEnd = { ...cell };
      this.paint();
      return;
    }

    // 涂抹：下笔前压栈（整段拖动算一步）
    this.pushUndo();
    this.painting = dig ? 'dig' : 'fill';
    this.lastCell = null;
    this.strokeTo(cell.c, cell.r, dig);
    this.paint();
  };

  private onMove = (e: { global: { x: number; y: number } }): void => {
    const cell = this.cellAtScreenLoose(e.global.x, e.global.y);
    this.hoverCell = cell;

    if (this.painting && this.tool === 'box' && this.boxStart) {
      this.boxEnd = { ...cell };
      this.paint();
      return;
    }

    if (this.painting && this.tool === 'brush') {
      this.strokeTo(cell.c, cell.r, this.painting === 'dig');
    }
    this.paint();
  };

  private onUp = (): void => {
    if (
      this.tool === 'box' &&
      this.painting &&
      this.boxStart &&
      this.boxEnd
    ) {
      const dig = this.painting === 'dig';
      this.pushUndo();
      this.fillBox(this.boxStart, this.boxEnd, dig);
      const box = this.normalizeBox(this.boxStart, this.boxEnd);
      const w = box.c1 - box.c0 + 1;
      const h = box.r1 - box.r0 + 1;
      this.flash(
        dig
          ? `框选挖洞 ${w}×${h} 格`
          : `框选修除 ${w}×${h} 格`,
      );
    }
    // 涂抹若完全没改到格子，去掉刚压的空步（可选简化：保留也行）
    this.painting = null;
    this.lastCell = null;
    this.boxStart = null;
    this.boxEnd = null;
    this.paint();
  };

  private paint(): void {
    const half = this.mapSize / 2;
    const sw = 1 / Math.max(this.zoom, 0.05);
    this.gfx.clear();
    this.gfx.rect(-half, -half, this.mapSize, this.mapSize).fill({
      color: FOREST,
    });

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

    for (const k of this.cells) {
      const c = k % this.cols;
      const r = (k / this.cols) | 0;
      const o = cellOrigin(c, r, this.mapSize, this.cellSize);
      this.gfx
        .rect(o.x, o.y, this.cellSize, this.cellSize)
        .fill({ color: HOLE, alpha: 0.55 });
    }

    // 框选预览
    if (this.tool === 'box' && this.boxStart && this.boxEnd) {
      const { c0, r0, c1, r1 } = this.normalizeBox(this.boxStart, this.boxEnd);
      const o = cellOrigin(c0, r0, this.mapSize, this.cellSize);
      const dig = this.painting !== 'fill';
      this.gfx
        .rect(
          o.x,
          o.y,
          (c1 - c0 + 1) * this.cellSize,
          (r1 - r0 + 1) * this.cellSize,
        )
        .fill({ color: dig ? 0xffffff : 0xff6666, alpha: 0.18 })
        .stroke({
          width: sw * 2.5,
          color: dig ? 0xffe14a : 0xff8888,
          alpha: 0.95,
        });
    } else if (this.tool === 'brush' && this.hoverCell) {
      // 画笔预览
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
    } else if (
      (this.tool === 'box' || this.tool === 'enemy') &&
      this.hoverCell &&
      !this.painting
    ) {
      // 框选 / 敌人空闲时高亮当前格
      const o = cellOrigin(
        this.hoverCell.c,
        this.hoverCell.r,
        this.mapSize,
        this.cellSize,
      );
      this.gfx
        .rect(o.x, o.y, this.cellSize, this.cellSize)
        .stroke({
          width: sw * 2,
          color: this.tool === 'enemy' ? ENEMY : 0xffe14a,
          alpha: 0.7,
        });
    }

    // 敌人标记（紫点 + 外圈）
    const enemyR = this.cellSize * 0.5;
    for (const e of this.enemies) {
      this.gfx.circle(e.x, e.y, enemyR).fill({
        color: ENEMY,
        alpha: 0.9,
      });
      this.gfx.circle(e.x, e.y, enemyR).stroke({
        width: sw * 2.5,
        color: 0xffffff,
        alpha: 0.85,
      });
      // 简易「X」示意怪物
      const arm = enemyR * 0.45;
      this.gfx
        .moveTo(e.x - arm, e.y - arm)
        .lineTo(e.x + arm, e.y + arm)
        .stroke({ width: sw * 2, color: 0xffffff, alpha: 0.95 });
      this.gfx
        .moveTo(e.x + arm, e.y - arm)
        .lineTo(e.x - arm, e.y + arm)
        .stroke({ width: sw * 2, color: 0xffffff, alpha: 0.95 });
    }

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
      this.flash('先挖出可走格子');
      return;
    }
    if (!isSpawnValid(def)) {
      this.flash('请把出生点放到洞里（Shift+点击）');
      return;
    }
    const exportName =
      this.levelId === 'level-2'
        ? 'LEVEL_2'
        : this.levelId.replace(/[^a-zA-Z0-9_]/g, '_').toUpperCase() ||
          'LEVEL_1';
    const { text, copied } = await copyLevelDefTs(def, exportName);
    console.log('[MapEdit]\n' + text);
    const nEnemy = def.enemies?.length ?? 0;
    this.flash(
      copied
        ? `已复制 ${this.cells.size} 格 · 敌人 ${nEnemy} → ${exportName}`
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
      const b = this.actionBtns[i]!;
      if (b.__group !== 'action') continue;
      x -= b.__w;
      b.position.set(x, 12);
      x -= 10;
    }

    // 左上第二行：工具 + 笔粗
    let bx = 14;
    const by = 52;
    for (const b of this.actionBtns) {
      if (b.__group !== 'mode') continue;
      b.position.set(bx, by);
      bx += b.__w + 8;
    }
    bx += 12;

    const showBrush = this.tool === 'brush';
    this.brushLabel.visible = showBrush;
    const brushBtns = this.actionBtns.filter((b) => b.__group === 'brush');
    for (const b of brushBtns) b.visible = showBrush;

    if (showBrush) {
      if (brushBtns[0]) {
        brushBtns[0].position.set(bx, by);
        bx += brushBtns[0].__w + 8;
      }
      this.brushLabel.position.set(bx + 40, by + 20);
      bx += 88;
      if (brushBtns[1]) {
        brushBtns[1].position.set(bx, by);
      }
    }

    this.tip.position.set(14, 18);
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Shift') this.shiftDown = true;

    // Ctrl/Cmd+Z 撤销
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
      this.undo();
      e.preventDefault();
      return;
    }

    if (e.key === 'b' || e.key === 'B') {
      this.setTool('brush');
      e.preventDefault();
      return;
    }
    if (e.key === 'r' || e.key === 'R') {
      this.setTool('box');
      e.preventDefault();
      return;
    }
    if (e.key === 'e' || e.key === 'E') {
      this.setTool('enemy');
      e.preventDefault();
      return;
    }
    if (this.tool !== 'brush') return;
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
