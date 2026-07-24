import {
  Assets,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  Texture,
} from 'pixi.js';
import {
  cellCenter,
  cellKey,
  cellOrigin,
  cloneLevelDef,
  copyLevelDefTs,
  defFromCells,
  gridDims,
  isSpawnValid,
  saveMapDraft,
  worldToCell,
  type EnemyKind,
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

const BTN_HEIGHT = 30;
const BTN_RADIUS = 6;
const HEADER_HEIGHT = 44;

const BRUSH_MIN = 1;
const BRUSH_MAX = 11;
const UNDO_MAX = 40;
const ENEMY_PICK_CELLS = 2.0;

type EditTool = 'brush' | 'eraser' | 'box' | 'enemy' | 'spawn';

type EditSnapshot = {
  cells: number[];
  spawn: { x: number; y: number };
  enemies: EnemySpawn[];
};

type HudBtn = Container & {
  __w: number;
  __h: number;
  __baseColor: number;
  __bg: Graphics;
  __label: Text;
  __active?: boolean;
  setActive?: (active: boolean) => void;
};

export type MapEditSceneOptions = {
  onBack: () => void;
  onPreview: (def: LevelMapDef) => void;
  onBackground?: (color: number) => void;
  initialDef?: LevelMapDef;
};

/**
 * 地图编辑器 Scene
 * 极简单行 Header 布局，无冗余关卡切换下拉
 */
export class MapEditScene extends Container implements GameScene {
  private readonly world: Container;
  private readonly gfx: Graphics;
  private readonly enemyLayer: Container;
  private readonly hud: Container;
  private readonly topBarGfx: Graphics;

  private readonly toastContainer: Container;
  private readonly toastBg: Graphics;
  private readonly toastText: Text;

  private readonly enemyTextures = new Map<EnemyKind, Texture>();

  private mapSize: number;
  private cellSize: number;
  private cols: number;
  private rows: number;
  private readonly cells: Set<number>;
  private spawn: { x: number; y: number };
  private enemies: EnemySpawn[];
  private levelId: string;
  private readonly undoStack: EditSnapshot[] = [];

  private viewW: number;
  private viewH: number;
  private zoom = 0.1;
  private camX = 0;
  private camY = 0;

  private tool: EditTool = 'brush';
  private enemyKind: EnemyKind = 'spider';
  private brushSize = 3;
  private painting: 'dig' | 'fill' | null = null;
  private lastCell: { c: number; r: number } | null = null;
  private hoverCell: { c: number; r: number } | null = null;
  private boxStart: { c: number; r: number } | null = null;
  private boxEnd: { c: number; r: number } | null = null;
  private tipTimer = 0;

  private readonly onBack: () => void;
  private readonly onPreview: (def: LevelMapDef) => void;
  private readonly onBackground?: (color: number) => void;

  // UI 元素引用
  private backBtn!: HudBtn;
  private toolBtns: Record<EditTool, HudBtn> = {} as any;
  private enemyBtns: Record<EnemyKind, HudBtn> = {} as any;
  private brushMinusBtn!: HudBtn;
  private brushPlusBtn!: HudBtn;
  private brushLabel!: Text;
  private undoBtn!: HudBtn;
  private clearBtn!: HudBtn;
  private previewBtn!: HudBtn;
  private exportBtn!: HudBtn;

  private brushSubGroup!: Container;
  private enemySubGroup!: Container;

  constructor(width: number, height: number, options: MapEditSceneOptions) {
    super();
    this.label = 'MapEditScene';
    this.viewW = width;
    this.viewH = height;
    this.onBack = options.onBack;
    this.onPreview = options.onPreview;
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
    this.spawn = { x: 0, y: 0 };
    this.enemies = [];
    this.applyDefData(src);

    this.eventMode = 'static';
    this.cursor = 'cell';
    this.hitArea = new Rectangle(0, 0, width, height);

    this.world = new Container();
    this.world.eventMode = 'none';
    this.addChild(this.world);

    this.gfx = new Graphics();
    this.enemyLayer = new Container();
    this.world.addChild(this.gfx, this.enemyLayer);

    this.hud = new Container();
    this.hud.eventMode = 'static';
    this.addChild(this.hud);

    // Top Header 背景
    this.topBarGfx = new Graphics();
    this.hud.addChild(this.topBarGfx);

    // 底部 Toast 容器
    this.toastContainer = new Container();
    this.toastBg = new Graphics();
    this.toastText = new Text({
      text: '',
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 12,
        fontWeight: '600',
        fill: 0xdfede2,
      },
    });
    this.toastText.anchor.set(0.5);
    this.toastContainer.addChild(this.toastBg, this.toastText);
    this.hud.addChild(this.toastContainer);

    this.buildUI();

    // 绑定事件
    this.on('pointerdown', this.onDown);
    this.on('pointermove', this.onMove);
    this.on('pointerup', this.onUp);
    this.on('pointerupoutside', this.onUp);

    this.fit();
    this.paint();
    this.layout();
  }

  private async loadEnemyTextures(): Promise<void> {
    try {
      const [spiderTex, flowerTex, dummyTex] = await Promise.all([
        Assets.load<Texture>('/assets/spider/spider.png'),
        Assets.load<Texture>('/assets/flame-flower/flame-flower.png'),
        Assets.load<Texture>('/assets/wooden-dummy/wooden-dummy.png'),
      ]);
      if (spiderTex) this.enemyTextures.set('spider', spiderTex);
      if (flowerTex) this.enemyTextures.set('flame-flower', flowerTex);
      if (dummyTex) this.enemyTextures.set('wooden-dummy', dummyTex);
      this.paint();
    } catch (e) {
      console.warn('MapEditScene: Failed to load enemy textures', e);
    }
  }

  private createBtn(
    label: string,
    width: number,
    baseColor: number,
    textColor = 0xffffff,
    onClick?: () => void,
    fontSize = 13,
  ): HudBtn {
    const root = new Container() as HudBtn;
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.__w = width;
    root.__h = BTN_HEIGHT;
    root.__baseColor = baseColor;

    const bg = new Graphics();
    bg.roundRect(0, 0, width, BTN_HEIGHT, BTN_RADIUS).fill({ color: baseColor });
    root.__bg = bg;

    const text = new Text({
      text: label,
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize,
        fontWeight: '700',
        fill: textColor,
      },
    });
    text.anchor.set(0.5);
    text.position.set(width / 2, BTN_HEIGHT / 2);
    root.__label = text;

    root.addChild(bg, text);

    root.setActive = (active: boolean) => {
      root.__active = active;
      if (active) {
        bg.clear()
          .roundRect(0, 0, width, BTN_HEIGHT, BTN_RADIUS)
          .fill({ color: 0xf0c040 });
        text.style.fill = 0x181408;
      } else {
        bg.clear()
          .roundRect(0, 0, width, BTN_HEIGHT, BTN_RADIUS)
          .fill({ color: baseColor });
        text.style.fill = textColor;
      }
    };

    root.on('pointerdown', (e) => e.stopPropagation());
    root.on('pointerover', () => {
      if (root.__active) return;
      bg.clear()
        .roundRect(0, 0, width, BTN_HEIGHT, BTN_RADIUS)
        .fill({ color: this.lightenColor(baseColor, 0.18) });
    });
    root.on('pointerout', () => {
      if (root.__active) return;
      bg.clear()
        .roundRect(0, 0, width, BTN_HEIGHT, BTN_RADIUS)
        .fill({ color: baseColor });
    });
    if (onClick) {
      root.on('pointertap', (e) => {
        e.stopPropagation();
        onClick();
      });
    }

    return root;
  }

  private lightenColor(col: number, percent: number): number {
    let r = (col >> 16) & 0xff;
    let g = (col >> 8) & 0xff;
    let b = col & 0xff;
    r = Math.min(255, Math.floor(r + (255 - r) * percent));
    g = Math.min(255, Math.floor(g + (255 - g) * percent));
    b = Math.min(255, Math.floor(b + (255 - b) * percent));
    return (r << 16) | (g << 8) | b;
  }

  private buildUI(): void {
    // 1. 返回按钮
    this.backBtn = this.createBtn('❮', 34, 0x223326, 0xb8dec2, () => {
      this.persistCurrentDraft();
      this.onBack();
    });
    this.hud.addChild(this.backBtn);

    // 2. 工具组 Segment
    const tools: { id: EditTool; label: string; width: number }[] = [
      { id: 'brush', label: '涂抹', width: 48 },
      { id: 'eraser', label: '橡皮', width: 48 },
      { id: 'box', label: '框选', width: 48 },
      { id: 'enemy', label: '敌人', width: 48 },
      { id: 'spawn', label: '起点', width: 48 },
    ];

    for (const t of tools) {
      const btn = this.createBtn(
        t.label,
        t.width,
        0x213025,
        0xc4dbc9,
        () => this.setTool(t.id),
      );
      this.toolBtns[t.id] = btn;
      this.hud.addChild(btn);
    }
    this.toolBtns[this.tool].setActive?.(true);

    // 3. 子参数组：画笔大小 (涂抹/橡皮时显示)
    this.brushSubGroup = new Container();
    this.brushMinusBtn = this.createBtn('−', 26, 0x2a3d30, 0xffffff, () =>
      this.setBrushSize(this.brushSize - 1),
    );
    this.brushPlusBtn = this.createBtn('+', 26, 0x2a3d30, 0xffffff, () =>
      this.setBrushSize(this.brushSize + 1),
    );
    this.brushLabel = new Text({
      text: `${this.brushSize}×${this.brushSize}`,
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 12,
        fontWeight: '700',
        fill: 0xffd966,
      },
    });
    this.brushLabel.anchor.set(0.5);
    this.brushLabel.position.set(40, BTN_HEIGHT / 2);

    this.brushMinusBtn.position.set(0, 0);
    this.brushPlusBtn.position.set(64, 0);
    this.brushSubGroup.addChild(
      this.brushMinusBtn,
      this.brushLabel,
      this.brushPlusBtn,
    );
    this.hud.addChild(this.brushSubGroup);

    // 4. 子参数组：敌人种类 (敌人模式下显示)
    this.enemySubGroup = new Container();
    const enemies: { id: EnemyKind; label: string; width: number; color: number }[] = [
      { id: 'spider', label: '🕷️ 蜘蛛', width: 68, color: 0x3d284a },
      { id: 'flame-flower', label: '🌸 火焰花', width: 78, color: 0x4a2a1a },
      { id: 'wooden-dummy', label: '🪵 木桩', width: 68, color: 0x3a2e1a },
    ];
    for (const e of enemies) {
      const btn = this.createBtn(
        e.label,
        e.width,
        e.color,
        0xffffff,
        () => this.setEnemyKind(e.id),
        12,
      );
      this.enemyBtns[e.id] = btn;
      this.enemySubGroup.addChild(btn);
    }
    this.enemyBtns[this.enemyKind].setActive?.(true);
    this.hud.addChild(this.enemySubGroup);

    // 5. 右侧操作按键组
    this.undoBtn = this.createBtn('↩ 撤销', 58, 0x243328, 0xd0e8d6, () => this.undo());
    this.clearBtn = this.createBtn('🗑️ 清空', 58, 0x243328, 0xd0e8d6, () => {
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
    this.previewBtn = this.createBtn('▶ 预览', 62, 0x1b5e3a, 0x73ffaa, () => this.preview());
    this.exportBtn = this.createBtn('💾 导出', 62, 0x8a6314, 0xffe89e, () => void this.exportCode());

    this.hud.addChild(
      this.undoBtn,
      this.clearBtn,
      this.previewBtn,
      this.exportBtn,
    );
  }

  private applyDefData(src: LevelMapDef): void {
    this.levelId = src.id;
    this.mapSize = src.mapSize;
    this.cellSize = src.cellSize || PINE_SPACING;
    const dim = gridDims(this.mapSize, this.cellSize);
    this.cols = dim.cols;
    this.rows = dim.rows;
    this.cells.clear();
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
    if (src.enemies === undefined) {
      this.enemies = [
        { kind: 'spider', x: src.spawn.x - 180, y: src.spawn.y - 160 },
        { kind: 'spider', x: src.spawn.x + 180, y: src.spawn.y - 160 },
      ];
    } else {
      this.enemies = src.enemies.map((e) => ({ ...e }));
    }
  }

  private persistCurrentDraft(): LevelMapDef {
    const def = this.toDef();
    return saveMapDraft(def);
  }

  private preview(): void {
    const def = this.toDef();
    if (def.walk.length === 0) {
      this.flash('先挖出可走格子再预览');
      return;
    }
    if (!isSpawnValid(def)) {
      this.flash('请把出生点放到洞里（点击起点按钮放置）');
      return;
    }
    const saved = saveMapDraft(def);
    this.onPreview(saved);
  }

  private defaultTip(): string {
    if (this.tool === 'eraser') {
      return `橡皮擦：左/右键擦除 · 笔 ${this.brushSize} · 滚轮缩放`;
    }
    if (this.tool === 'box') {
      return '框选：拖矩形批量挖/擦格子 · 滚轮缩放';
    }
    if (this.tool === 'enemy') {
      return `敌人（${this.enemyKindName(this.enemyKind)}）：点击放置 / 再次点击删除 · 现有 ${this.enemies.length} 只 · 滚轮缩放`;
    }
    if (this.tool === 'spawn') {
      return '起点：点击地图放置玩家出生点 · 滚轮缩放';
    }
    return `涂抹：左键挖洞 · 右键擦除 · 笔 ${this.brushSize} · 滚轮缩放`;
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
    this.toolBtns[this.tool]?.setActive?.(false);
    this.tool = tool;
    this.toolBtns[this.tool]?.setActive?.(true);

    this.painting = null;
    this.lastCell = null;
    this.boxStart = null;
    this.boxEnd = null;
    this.cursor =
      tool === 'box'
        ? 'crosshair'
        : tool === 'enemy' || tool === 'spawn'
          ? 'pointer'
          : 'cell';

    this.layout();
    this.flash(
      tool === 'eraser'
        ? '橡皮擦模式'
        : tool === 'box'
          ? '框选模式'
          : tool === 'enemy'
            ? '敌人模式'
            : tool === 'spawn'
              ? '起点模式'
              : '涂抹模式',
    );
    this.paint();
  }

  private setBrushSize(n: number): void {
    const next = Math.min(BRUSH_MAX, Math.max(BRUSH_MIN, Math.round(n)));
    if (next === this.brushSize) return;
    this.brushSize = next;
    this.brushLabel.text = `${this.brushSize}×${this.brushSize}`;
    this.flash(`画笔 ${this.brushSize}×${this.brushSize} 格`);
    this.paint();
  }

  private setEnemyKind(kind: EnemyKind): void {
    if (this.enemyKind === kind) return;
    this.enemyBtns[this.enemyKind]?.setActive?.(false);
    this.enemyKind = kind;
    this.enemyBtns[this.enemyKind]?.setActive?.(true);
    this.paint();
    this.flash(`当前怪物：${this.enemyKindName(kind)}`);
  }

  private enemyKindName(kind: EnemyKind): string {
    if (kind === 'flame-flower') return '火焰花';
    if (kind === 'wooden-dummy') return '木桩';
    return '蜘蛛';
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

  private placeEnemyAtCell(c: number, r: number, wx: number, wy: number): void {
    const pos = cellCenter(c, r, this.mapSize, this.cellSize);
    // 检查当前格或点击位置附近是否有已有敌人 (若有，再次点击即删除)
    const existingIdx = this.enemies.findIndex(
      (e) =>
        Math.hypot(e.x - pos.x, e.y - pos.y) < this.cellSize * 0.75 ||
        Math.hypot(e.x - wx, e.y - wy) < this.cellSize * ENEMY_PICK_CELLS * 0.8,
    );

    if (existingIdx >= 0) {
      this.pushUndo();
      const [removed] = this.enemies.splice(existingIdx, 1);
      const name = removed ? this.enemyKindName(removed.kind) : '敌人';
      this.flash(`已删除${name}（剩余 ${this.enemies.length}）`);
      return;
    }

    this.pushUndo();
    this.enemies.push({ kind: this.enemyKind, x: pos.x, y: pos.y });
    const name = this.enemyKindName(this.enemyKind);
    const onWalk = this.cells.has(cellKey(c, r, this.cols));
    this.flash(
      onWalk
        ? `已放${name}（共 ${this.enemies.length}）`
        : `已放${name}（不在洞里，共 ${this.enemies.length}）`,
    );
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

  private removeEnemiesInBox(
    a: { c: number; r: number },
    b: { c: number; r: number },
  ): number {
    const { c0, r0, c1, r1 } = this.normalizeBox(a, b);
    let count = 0;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i]!;
      const cell = worldToCell(e.x, e.y, this.mapSize, this.cellSize);
      if (cell.c >= c0 && cell.c <= c1 && cell.r >= r0 && cell.r <= r1) {
        this.enemies.splice(i, 1);
        count++;
      }
    }
    return count;
  }

  private onDown = (e: {
    global: { x: number; y: number };
    button: number;
  }): void => {
    const cell = this.cellAtScreenLoose(e.global.x, e.global.y);

    if (this.tool === 'spawn') {
      if (e.button === 0) {
        const next = cellCenter(cell.c, cell.r, this.mapSize, this.cellSize);
        if (next.x !== this.spawn.x || next.y !== this.spawn.y) {
          this.pushUndo();
          this.spawn = next;
        }
        this.paint();
        this.flash(
          this.cells.has(cellKey(cell.c, cell.r, this.cols))
            ? '出生点已设置'
            : '出生点不在洞里（请先挖洞）',
        );
      }
      return;
    }

    if (this.tool === 'enemy') {
      const w = this.toWorld(e.global.x, e.global.y);
      if (e.button === 0) {
        this.placeEnemyAtCell(cell.c, cell.r, w.x, w.y);
      } else if (e.button === 2) {
        this.painting = 'fill';
        this.boxStart = { ...cell };
        this.boxEnd = { ...cell };
      }
      this.paint();
      return;
    }

    const isEraser = this.tool === 'eraser';
    const dig = isEraser ? false : e.button === 0;
    const erase = isEraser ? true : e.button === 2;
    if (!dig && !erase) return;

    if (this.tool === 'box') {
      this.painting = dig ? 'dig' : 'fill';
      this.boxStart = { ...cell };
      this.boxEnd = { ...cell };
      this.paint();
      return;
    }

    this.pushUndo();
    this.painting = dig ? 'dig' : 'fill';
    this.lastCell = null;
    this.strokeTo(cell.c, cell.r, dig);
    this.paint();
  };

  private onMove = (e: { global: { x: number; y: number } }): void => {
    const cell = this.cellAtScreenLoose(e.global.x, e.global.y);
    this.hoverCell = cell;

    if (
      this.painting &&
      (this.tool === 'box' || this.tool === 'enemy') &&
      this.boxStart
    ) {
      this.boxEnd = { ...cell };
      this.paint();
      return;
    }

    if (this.painting && (this.tool === 'brush' || this.tool === 'eraser')) {
      this.strokeTo(cell.c, cell.r, this.painting === 'dig');
    }
    this.paint();
  };

  private onUp = (): void => {
    if (
      (this.tool === 'box' || this.tool === 'enemy') &&
      this.painting &&
      this.boxStart &&
      this.boxEnd
    ) {
      const isErase = this.painting === 'fill';
      this.pushUndo();

      if (this.tool === 'box') {
        const dig = this.painting === 'dig';
        this.fillBox(this.boxStart, this.boxEnd, dig);
        const removed = isErase
          ? this.removeEnemiesInBox(this.boxStart, this.boxEnd)
          : 0;
        const box = this.normalizeBox(this.boxStart, this.boxEnd);
        const w = box.c1 - box.c0 + 1;
        const h = box.r1 - box.r0 + 1;
        const enemyMsg = removed > 0 ? ` · 清除 ${removed} 个敌人` : '';
        this.flash(
          dig
            ? `框选挖洞 ${w}×${h} 格`
            : `框选擦除 ${w}×${h} 格${enemyMsg}`,
        );
      } else if (this.tool === 'enemy') {
        const removed = this.removeEnemiesInBox(this.boxStart, this.boxEnd);
        if (removed > 0) {
          this.flash(
            `已框选删除 ${removed} 个敌人（剩余 ${this.enemies.length}）`,
          );
        } else {
          const w = cellCenter(
            this.boxStart.c,
            this.boxStart.r,
            this.mapSize,
            this.cellSize,
          );
          const idx = this.nearestEnemyIndex(w.x, w.y);
          if (idx >= 0) {
            const [rem] = this.enemies.splice(idx, 1);
            this.flash(
              `已删除${rem ? this.enemyKindName(rem.kind) : '敌人'}（剩余 ${this.enemies.length}）`,
            );
          } else {
            this.flash('框选区域内没有敌人');
          }
        }
      }
    }
    this.painting = null;
    this.lastCell = null;
    this.boxStart = null;
    this.boxEnd = null;
    this.paint();
  };

  private renderEnemyNode(
    kind: EnemyKind,
    x: number,
    y: number,
    _sw: number,
    alpha = 1,
  ): Container {
    const node = new Container();
    node.position.set(x, y);
    node.alpha = alpha;

    // 敌人真实图片标记
    const tex = this.enemyTextures.get(kind);
    if (tex) {
      const sp = new Sprite(tex);
      sp.anchor.set(0.5, 0.5);
      const targetDim = this.cellSize * 3.0;
      const scale = targetDim / Math.max(tex.width, tex.height);
      sp.scale.set(scale);
      node.addChild(sp);
    } else {
      // 兜底大号符号
      const textLabel = new Text({
        text:
          kind === 'flame-flower'
            ? '🌸'
            : kind === 'wooden-dummy'
              ? '🪵'
              : '🕷️',
        style: { fontSize: Math.round(this.cellSize * 1.1) },
      });
      textLabel.anchor.set(0.5);
      node.addChild(textLabel);
    }

    return node;
  }

  private paint(): void {
    const half = this.mapSize / 2;
    const sw = 1 / Math.max(this.zoom, 0.05);
    this.gfx.clear();
    this.enemyLayer.removeChildren();

    // 1. 背景与网格
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

    // 2. 可走格子
    for (const k of this.cells) {
      const c = k % this.cols;
      const r = (k / this.cols) | 0;
      const o = cellOrigin(c, r, this.mapSize, this.cellSize);
      this.gfx
        .rect(o.x, o.y, this.cellSize, this.cellSize)
        .fill({ color: HOLE, alpha: 0.55 });
    }

    // 3. 工具模式选框 / 涂抹 / 框选预览
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
    } else if ((this.tool === 'brush' || this.tool === 'eraser') && this.hoverCell) {
      const s = this.brushSize;
      const halfB = Math.floor((s - 1) / 2);
      const o = cellOrigin(
        this.hoverCell.c - halfB,
        this.hoverCell.r - halfB,
        this.mapSize,
        this.cellSize,
      );
      const isEraser = this.tool === 'eraser';
      this.gfx
        .rect(o.x, o.y, s * this.cellSize, s * this.cellSize)
        .fill({ color: isEraser ? 0xff4444 : 0xffffff, alpha: isEraser ? 0.2 : 0.12 })
        .stroke({ width: sw * 2, color: isEraser ? 0xff6666 : 0xffe14a, alpha: 0.9 });
    } else if (
      (this.tool === 'box' || this.tool === 'spawn') &&
      this.hoverCell &&
      !this.painting
    ) {
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
          color: this.tool === 'spawn' ? SPAWN : 0xffe14a,
          alpha: 0.7,
        });
    }

    // 4. 渲染所有敌人真实图片标记描点
    for (const e of this.enemies) {
      const node = this.renderEnemyNode(e.kind, e.x, e.y, sw, 1);
      this.enemyLayer.addChild(node);
    }

    // 5. 如果正处于【敌人】模式且鼠标悬停格子上，绘制敌人真实图片半透明放置预览
    if (this.tool === 'enemy' && this.hoverCell && !this.painting) {
      const pos = cellCenter(
        this.hoverCell.c,
        this.hoverCell.r,
        this.mapSize,
        this.cellSize,
      );
      const ghostNode = this.renderEnemyNode(
        this.enemyKind,
        pos.x,
        pos.y,
        sw,
        0.5,
      );
      this.enemyLayer.addChild(ghostNode);
    }

    // 6. 出生点标记
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
      this.flash('请把出生点放到洞里');
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
    this.toastText.text = msg;
    this.tipTimer = 2.8;
    this.updateToastLayout();
  }

  private updateToastLayout(): void {
    const textW = this.toastText.width;
    const paddingX = 16;
    const toastW = Math.max(120, textW + paddingX * 2);
    const toastH = 26;

    this.toastBg
      .clear()
      .roundRect(-toastW / 2, -toastH / 2, toastW, toastH, 13)
      .fill({ color: 0x0f1c13, alpha: 0.88 })
      .stroke({ color: 0x36543e, width: 1 });

    this.toastContainer.position.set(this.viewW / 2, this.viewH - 24);
  }

  private layout(): void {
    const btnY = (HEADER_HEIGHT - BTN_HEIGHT) / 2;
    const gap = 6;

    // 1. Top Header 背景线
    this.topBarGfx
      .clear()
      .rect(0, 0, this.viewW, HEADER_HEIGHT)
      .fill({ color: 0x0f1712, alpha: 0.9 })
      .moveTo(0, HEADER_HEIGHT)
      .lineTo(this.viewW, HEADER_HEIGHT)
      .stroke({ color: 0x273d2d, width: 1 });

    // 2. 左侧组：[返回]
    let leftX = 10;
    this.backBtn.position.set(leftX, btnY);
    leftX += this.backBtn.__w + gap + 4;

    // 3. 中间组：工具按钮 Segment
    let toolX = leftX;
    const toolOrder: EditTool[] = ['brush', 'eraser', 'box', 'enemy', 'spawn'];
    for (const id of toolOrder) {
      const btn = this.toolBtns[id];
      if (btn) {
        btn.position.set(toolX, btnY);
        toolX += btn.__w + 2;
      }
    }
    toolX += gap + 4;

    // 4. 动态子参数组挂接在工具右边
    const showBrush = this.tool === 'brush' || this.tool === 'eraser';
    this.brushSubGroup.visible = showBrush;
    if (showBrush) {
      this.brushSubGroup.position.set(toolX, btnY);
      toolX += 94 + gap;
    }

    const showEnemy = this.tool === 'enemy';
    this.enemySubGroup.visible = showEnemy;
    if (showEnemy) {
      let enemyX = 0;
      const enemyOrder: EnemyKind[] = [
        'spider',
        'flame-flower',
        'wooden-dummy',
      ];
      for (const k of enemyOrder) {
        const btn = this.enemyBtns[k];
        if (btn) {
          btn.position.set(enemyX, 0);
          enemyX += btn.__w + 4;
        }
      }
      this.enemySubGroup.position.set(toolX, btnY);
      toolX += enemyX + gap;
    }

    // 5. 右侧组：操作按钮逆序靠右对齐
    let rightX = this.viewW - 10;
    const rightGroup = [
      this.exportBtn,
      this.previewBtn,
      this.clearBtn,
      this.undoBtn,
    ];
    for (const btn of rightGroup) {
      rightX -= btn.__w;
      btn.position.set(rightX, btnY);
      rightX -= gap;
    }

    // 6. Toast 布局更新
    if (this.tipTimer <= 0) {
      this.toastText.text = this.defaultTip();
    }
    this.updateToastLayout();
  }

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
    window.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('contextmenu', this.onContext);
    void this.loadEnemyTextures();
  }

  update(deltaMS: number): void {
    if (this.tipTimer > 0) {
      this.tipTimer -= deltaMS / 1000;
      if (this.tipTimer <= 0) {
        this.toastText.text = this.defaultTip();
        this.updateToastLayout();
      }
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
    window.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('contextmenu', this.onContext);
    this.off('pointerdown', this.onDown);
    this.off('pointermove', this.onMove);
    this.off('pointerup', this.onUp);
    this.off('pointerupoutside', this.onUp);
    super.destroy(options);
  }
}
