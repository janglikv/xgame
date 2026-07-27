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
  emptyIslandDef,
  gridDims,
  isLandCell,
  isSpawnValid,
  normalizeTrees,
  saveMapDraft,
  treeKindOf,
  worldToCell,
  type EnemyKind,
  type EnemySpawn,
  type LevelMapDef,
  type MapTree,
  type TreeKind,
} from '../data/maps';
import { LEVEL_1 } from '../data/maps/level-1';
import { PINE_SPACING } from '../world/mapLayout';
import type { GameScene } from './types';

const BG = 0x0a2030;
const OCEAN = 0x1a5a8a;
const LAND = 0x6fc93c;
const GRID_LINE = 0x1a4030;
const TREE_HARVEST = 0x3d9634;
const TREE_PINE = 0x1f5a1a;
const SPAWN = 0xff4d4d;

const BTN_HEIGHT = 30;
const BTN_RADIUS = 6;
const HEADER_HEIGHT = 44;

const BRUSH_MIN = 1;
const BRUSH_MAX = 7;
const UNDO_MAX = 40;
const ENEMY_PICK_CELLS = 2.0;

type EditTool = 'tree' | 'eraser' | 'enemy' | 'spawn';

type EditSnapshot = {
  trees: MapTree[];
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
 * 地图编辑器：海岛模型。
 * 工具：摆树 / 擦树 / 敌人 / 起点。陆地默认可走，外圈为海。
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
  private seaMarginCells: number;
  private cols: number;
  private rows: number;
  /** key → kind */
  private readonly treeMap = new Map<number, TreeKind>();
  private spawn: { x: number; y: number };
  private enemies: EnemySpawn[];
  private levelId: string;
  private readonly undoStack: EditSnapshot[] = [];

  private viewW: number;
  private viewH: number;
  private zoom = 0.1;
  private camX = 0;
  private camY = 0;

  private tool: EditTool = 'tree';
  private treeKind: TreeKind = 'harvest';
  private enemyKind: EnemyKind = 'spider';
  private brushSize = 1;
  private painting: 'place' | 'erase' | null = null;
  private lastCell: { c: number; r: number } | null = null;
  private hoverCell: { c: number; r: number } | null = null;
  private tipTimer = 0;

  private readonly onBack: () => void;
  private readonly onPreview: (def: LevelMapDef) => void;
  private readonly onBackground?: (color: number) => void;

  private backBtn!: HudBtn;
  private toolBtns: Record<EditTool, HudBtn> = {} as Record<EditTool, HudBtn>;
  private enemyBtns: Record<EnemyKind, HudBtn> = {} as Record<
    EnemyKind,
    HudBtn
  >;
  private treeKindBtns: Record<TreeKind, HudBtn> = {} as Record<
    TreeKind,
    HudBtn
  >;
  private brushMinusBtn!: HudBtn;
  private brushPlusBtn!: HudBtn;
  private brushLabel!: Text;
  private undoBtn!: HudBtn;
  private clearBtn!: HudBtn;
  private previewBtn!: HudBtn;
  private exportBtn!: HudBtn;

  private brushSubGroup!: Container;
  private treeKindSubGroup!: Container;
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
      : emptyIslandDef(LEVEL_1.id, { cellSize: PINE_SPACING });

    this.levelId = src.id;
    this.mapSize = src.mapSize;
    this.cellSize = src.cellSize || PINE_SPACING;
    this.seaMarginCells = src.seaMarginCells ?? 0;
    const dim = gridDims(this.mapSize, this.cellSize);
    this.cols = dim.cols;
    this.rows = dim.rows;
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

    this.topBarGfx = new Graphics();
    this.hud.addChild(this.topBarGfx);

    this.toastContainer = new Container();
    this.toastBg = new Graphics();
    this.toastText = new Text({
      text: '',
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 12,
        fontWeight: '600',
        fill: 0xdfeef5,
      },
    });
    this.toastText.anchor.set(0.5);
    this.toastContainer.addChild(this.toastBg, this.toastText);
    this.hud.addChild(this.toastContainer);

    this.buildUI();

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
    this.backBtn = this.createBtn('❮', 34, 0x1a3040, 0xb8dce8, () => {
      this.persistCurrentDraft();
      this.onBack();
    });
    this.hud.addChild(this.backBtn);

    const tools: { id: EditTool; label: string; width: number }[] = [
      { id: 'tree', label: '摆树', width: 48 },
      { id: 'eraser', label: '擦树', width: 48 },
      { id: 'enemy', label: '敌人', width: 48 },
      { id: 'spawn', label: '起点', width: 48 },
    ];
    for (const t of tools) {
      const btn = this.createBtn(t.label, t.width, 0x1a3038, 0xc4dbe0, () =>
        this.setTool(t.id),
      );
      this.toolBtns[t.id] = btn;
      this.hud.addChild(btn);
    }
    this.toolBtns[this.tool].setActive?.(true);

    this.brushSubGroup = new Container();
    this.brushMinusBtn = this.createBtn('−', 26, 0x2a3d48, 0xffffff, () =>
      this.setBrushSize(this.brushSize - 1),
    );
    this.brushPlusBtn = this.createBtn('+', 26, 0x2a3d48, 0xffffff, () =>
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

    this.treeKindSubGroup = new Container();
    const kinds: { id: TreeKind; label: string; w: number }[] = [
      { id: 'harvest', label: '可砍', w: 48 },
      { id: 'pine', label: '装饰', w: 48 },
    ];
    let kx = 0;
    for (const k of kinds) {
      const btn = this.createBtn(k.label, k.w, 0x2a4030, 0xffffff, () =>
        this.setTreeKind(k.id),
      );
      btn.position.set(kx, 0);
      kx += k.w + 4;
      this.treeKindBtns[k.id] = btn;
      this.treeKindSubGroup.addChild(btn);
    }
    this.treeKindBtns[this.treeKind].setActive?.(true);
    this.hud.addChild(this.treeKindSubGroup);

    this.enemySubGroup = new Container();
    const enemies: {
      id: EnemyKind;
      label: string;
      width: number;
      color: number;
    }[] = [
      { id: 'spider', label: '🕷️ 蜘蛛', width: 68, color: 0x3d284a },
      { id: 'flame-flower', label: '🌸 火焰花', width: 78, color: 0x4a2a1a },
      { id: 'wooden-dummy', label: '🪵 木桩', width: 68, color: 0x3a2e1a },
    ];
    let ex = 0;
    for (const e of enemies) {
      const btn = this.createBtn(
        e.label,
        e.width,
        e.color,
        0xffffff,
        () => this.setEnemyKind(e.id),
        12,
      );
      btn.position.set(ex, 0);
      ex += e.width + 4;
      this.enemyBtns[e.id] = btn;
      this.enemySubGroup.addChild(btn);
    }
    this.enemyBtns[this.enemyKind].setActive?.(true);
    this.hud.addChild(this.enemySubGroup);

    this.undoBtn = this.createBtn('↩ 撤销', 58, 0x243038, 0xd0e0e8, () =>
      this.undo(),
    );
    this.clearBtn = this.createBtn('🗑️ 清空', 58, 0x243038, 0xd0e0e8, () => {
      if (this.treeMap.size === 0 && this.enemies.length === 0) {
        this.flash('已经是空的');
        return;
      }
      this.pushUndo();
      this.treeMap.clear();
      this.enemies = [];
      this.paint();
      this.flash('已清空树与敌人');
    });
    this.previewBtn = this.createBtn('▶ 预览', 62, 0x1b5e3a, 0x73ffaa, () =>
      this.preview(),
    );
    this.exportBtn = this.createBtn('💾 导出', 62, 0x8a6314, 0xffe89e, () =>
      void this.exportCode(),
    );

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
    this.seaMarginCells = src.seaMarginCells ?? 0;
    const dim = gridDims(this.mapSize, this.cellSize);
    this.cols = dim.cols;
    this.rows = dim.rows;
    this.treeMap.clear();
    for (const t of normalizeTrees(src)) {
      this.treeMap.set(cellKey(t.c, t.r, this.cols), treeKindOf(t));
    }
    this.spawn = { ...src.spawn };
    this.enemies = (src.enemies ?? []).map((e) => ({ ...e }));
  }

  private persistCurrentDraft(): LevelMapDef {
    return saveMapDraft(this.toDef());
  }

  private preview(): void {
    const def = this.toDef();
    if (!isSpawnValid(def)) {
      this.flash('请把出生点放到陆地上（避开外圈海）');
      return;
    }
    const saved = saveMapDraft(def);
    this.onPreview(saved);
  }

  private defaultTip(): string {
    if (this.tool === 'eraser') {
      return `擦树：左键拖擦 · 笔 ${this.brushSize} · 树 ${this.treeMap.size} · 滚轮缩放`;
    }
    if (this.tool === 'enemy') {
      return `敌人（${this.enemyKindName(this.enemyKind)}）：点击放置/再点删除 · ${this.enemies.length} 只 · 滚轮缩放`;
    }
    if (this.tool === 'spawn') {
      return '起点：点击陆地放置出生点 · 滚轮缩放';
    }
    const kindLabel = this.treeKind === 'pine' ? '装饰' : '可砍';
    return `摆树（${kindLabel}）：左键拖放 · 笔 ${this.brushSize} · 树 ${this.treeMap.size} · 滚轮缩放`;
  }

  private treesFromMap(): MapTree[] {
    const out: MapTree[] = [];
    for (const [k, kind] of this.treeMap) {
      const c = k % this.cols;
      const r = (k / this.cols) | 0;
      out.push({ c, r, kind });
    }
    return out;
  }

  private takeSnapshot(): EditSnapshot {
    return {
      trees: this.treesFromMap(),
      spawn: { x: this.spawn.x, y: this.spawn.y },
      enemies: this.enemies.map((e) => ({ ...e })),
    };
  }

  private applySnapshot(s: EditSnapshot): void {
    this.treeMap.clear();
    for (const t of s.trees) {
      this.treeMap.set(cellKey(t.c, t.r, this.cols), treeKindOf(t));
    }
    this.spawn = { x: s.spawn.x, y: s.spawn.y };
    this.enemies = s.enemies.map((e) => ({ ...e }));
  }

  private pushUndo(): void {
    this.undoStack.push(this.takeSnapshot());
    if (this.undoStack.length > UNDO_MAX) this.undoStack.shift();
  }

  private undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) {
      this.flash('没有可撤销的操作');
      return;
    }
    this.painting = null;
    this.lastCell = null;
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
    this.cursor =
      tool === 'enemy' || tool === 'spawn' ? 'pointer' : 'cell';
    this.layout();
    this.flash(
      tool === 'eraser'
        ? '擦树模式'
        : tool === 'enemy'
          ? '敌人模式'
          : tool === 'spawn'
            ? '起点模式'
            : '摆树模式',
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

  private setTreeKind(kind: TreeKind): void {
    if (this.treeKind === kind) return;
    this.treeKindBtns[this.treeKind]?.setActive?.(false);
    this.treeKind = kind;
    this.treeKindBtns[this.treeKind]?.setActive?.(true);
    this.flash(kind === 'pine' ? '装饰树（不可砍）' : '可砍树');
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
    return {
      id: this.levelId,
      mapSize: this.mapSize,
      cellSize: this.cellSize,
      seaMarginCells: this.seaMarginCells,
      spawn: { ...this.spawn },
      trees: this.treesFromMap(),
      enemies: this.enemies.map((e) => ({ ...e })),
    };
  }

  private landDefStub(): LevelMapDef {
    return {
      id: this.levelId,
      mapSize: this.mapSize,
      cellSize: this.cellSize,
      seaMarginCells: this.seaMarginCells,
      spawn: this.spawn,
      trees: [],
      enemies: [],
    };
  }

  private placeEnemyAtCell(c: number, r: number, wx: number, wy: number): void {
    const pos = cellCenter(c, r, this.mapSize, this.cellSize);
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

    if (!isLandCell(c, r, this.landDefStub())) {
      this.flash('不能把敌人放在海里');
      return;
    }

    this.pushUndo();
    this.enemies.push({ kind: this.enemyKind, x: pos.x, y: pos.y });
    this.flash(
      `已放${this.enemyKindName(this.enemyKind)}（共 ${this.enemies.length}）`,
    );
  }

  private fit(): void {
    // 留出海景边距，避免绿地贴满编辑器视口
    const fit = this.mapSize * 1.5;
    this.zoom = Math.min(this.viewW / fit, this.viewH / fit) * 0.88;
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

  private stampTree(c: number, r: number, place: boolean): void {
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return;
    if (place && !isLandCell(c, r, this.landDefStub())) return;
    const k = cellKey(c, r, this.cols);
    if (place) this.treeMap.set(k, this.treeKind);
    else this.treeMap.delete(k);
  }

  private stampBrush(c: number, r: number, place: boolean): void {
    const s = this.brushSize;
    const half = Math.floor((s - 1) / 2);
    for (let dr = 0; dr < s; dr++) {
      for (let dc = 0; dc < s; dc++) {
        this.stampTree(c + dc - half, r + dr - half, place);
      }
    }
  }

  private strokeTo(c: number, r: number, place: boolean): void {
    if (!this.lastCell) {
      this.stampBrush(c, r, place);
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
      this.stampBrush(cc, rr, place);
    }
    this.lastCell = { c, r };
  }

  private onDown = (e: {
    global: { x: number; y: number };
    button: number;
  }): void => {
    const cell = this.cellAtScreenLoose(e.global.x, e.global.y);

    if (this.tool === 'spawn') {
      if (e.button === 0) {
        if (!isLandCell(cell.c, cell.r, this.landDefStub())) {
          this.flash('出生点必须在陆地上');
          return;
        }
        const next = cellCenter(cell.c, cell.r, this.mapSize, this.cellSize);
        if (next.x !== this.spawn.x || next.y !== this.spawn.y) {
          this.pushUndo();
          this.spawn = next;
        }
        this.paint();
        this.flash('出生点已设置');
      }
      return;
    }

    if (this.tool === 'enemy') {
      if (e.button === 0) {
        const w = this.toWorld(e.global.x, e.global.y);
        this.placeEnemyAtCell(cell.c, cell.r, w.x, w.y);
        this.paint();
      }
      return;
    }

    if (e.button !== 0 && e.button !== 2) return;
    const place = this.tool === 'tree' && e.button === 0;
    const erase = this.tool === 'eraser' || e.button === 2;
    if (!place && !erase) return;

    this.pushUndo();
    this.painting = place ? 'place' : 'erase';
    this.lastCell = null;
    this.strokeTo(cell.c, cell.r, place);
    this.paint();
  };

  private onMove = (e: { global: { x: number; y: number } }): void => {
    const cell = this.cellAtScreenLoose(e.global.x, e.global.y);
    this.hoverCell = cell;

    if (
      this.painting &&
      (this.tool === 'tree' || this.tool === 'eraser')
    ) {
      this.strokeTo(cell.c, cell.r, this.painting === 'place');
    }
    this.paint();
  };

  private onUp = (): void => {
    this.painting = null;
    this.lastCell = null;
    this.paint();
  };

  private renderEnemyNode(
    kind: EnemyKind,
    x: number,
    y: number,
    alpha = 1,
  ): Container {
    const node = new Container();
    node.position.set(x, y);
    node.alpha = alpha;

    const tex = this.enemyTextures.get(kind);
    if (tex) {
      const sp = new Sprite(tex);
      sp.anchor.set(0.5, 0.5);
      const targetDim = this.cellSize * 3.0;
      const scale = targetDim / Math.max(tex.width, tex.height);
      sp.scale.set(scale);
      node.addChild(sp);
    } else {
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
    const stub = this.landDefStub();
    this.gfx.clear();
    this.enemyLayer.removeChildren();

    // 海：陆地以外全是海（画远超地图的范围）
    const oceanExtent = Math.max(this.mapSize * 8, 20000);
    const oh = oceanExtent / 2;
    this.gfx.rect(-oh, -oh, oceanExtent, oceanExtent).fill({
      color: OCEAN,
    });

    // 陆地岛屿
    const m = this.seaMarginCells * this.cellSize;
    const landSize = this.mapSize - m * 2;
    if (landSize > 0) {
      this.gfx
        .roundRect(-half + m, -half + m, landSize, landSize, 8)
        .fill({ color: LAND, alpha: 0.92 });
    }

    // 网格
    const step = this.cellSize;
    const gridEvery = this.zoom < 0.08 ? 4 : this.zoom < 0.15 ? 2 : 1;
    this.gfx.setStrokeStyle({
      width: sw,
      color: GRID_LINE,
      alpha: 0.35,
    });
    for (let i = 0; i <= this.cols; i += gridEvery) {
      const x = -half + i * step;
      this.gfx.moveTo(x, -half).lineTo(x, half).stroke();
    }
    for (let i = 0; i <= this.rows; i += gridEvery) {
      const y = -half + i * step;
      this.gfx.moveTo(-half, y).lineTo(half, y).stroke();
    }

    // 树
    for (const [k, kind] of this.treeMap) {
      const c = k % this.cols;
      const r = (k / this.cols) | 0;
      const o = cellOrigin(c, r, this.mapSize, this.cellSize);
      const pad = 3;
      this.gfx
        .roundRect(
          o.x + pad,
          o.y + pad,
          this.cellSize - pad * 2,
          this.cellSize - pad * 2,
          4,
        )
        .fill({
          color: kind === 'pine' ? TREE_PINE : TREE_HARVEST,
          alpha: 0.9,
        });
    }

    // 笔刷预览
    if (
      (this.tool === 'tree' || this.tool === 'eraser') &&
      this.hoverCell
    ) {
      const s = this.brushSize;
      const halfB = Math.floor((s - 1) / 2);
      const o = cellOrigin(
        this.hoverCell.c - halfB,
        this.hoverCell.r - halfB,
        this.mapSize,
        this.cellSize,
      );
      const erase = this.tool === 'eraser';
      this.gfx
        .rect(o.x, o.y, s * this.cellSize, s * this.cellSize)
        .fill({
          color: erase ? 0xff4444 : 0xffffff,
          alpha: erase ? 0.2 : 0.12,
        })
        .stroke({
          width: sw * 2,
          color: erase ? 0xff6666 : 0xffe14a,
          alpha: 0.9,
        });
    } else if (this.tool === 'spawn' && this.hoverCell) {
      const o = cellOrigin(
        this.hoverCell.c,
        this.hoverCell.r,
        this.mapSize,
        this.cellSize,
      );
      const ok = isLandCell(this.hoverCell.c, this.hoverCell.r, stub);
      this.gfx.rect(o.x, o.y, this.cellSize, this.cellSize).stroke({
        width: sw * 2,
        color: ok ? SPAWN : 0xff8888,
        alpha: 0.8,
      });
    }

    for (const e of this.enemies) {
      this.enemyLayer.addChild(this.renderEnemyNode(e.kind, e.x, e.y, 1));
    }

    if (this.tool === 'enemy' && this.hoverCell && !this.painting) {
      const pos = cellCenter(
        this.hoverCell.c,
        this.hoverCell.r,
        this.mapSize,
        this.cellSize,
      );
      this.enemyLayer.addChild(
        this.renderEnemyNode(this.enemyKind, pos.x, pos.y, 0.5),
      );
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
    if (!isSpawnValid(def)) {
      this.flash('请把出生点放到陆地上');
      return;
    }
    const exportName =
      this.levelId === 'level-2'
        ? 'LEVEL_2'
        : this.levelId.replace(/[^a-zA-Z0-9_]/g, '_').toUpperCase() ||
          'LEVEL_1';
    const { text, copied } = await copyLevelDefTs(def, exportName);
    console.log('[MapEdit]\n' + text);
    this.flash(
      copied
        ? `已复制 树 ${def.trees.length} · 敌人 ${def.enemies?.length ?? 0} → ${exportName}`
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
      .fill({ color: 0x0a1820, alpha: 0.88 })
      .stroke({ color: 0x365468, width: 1 });

    this.toastContainer.position.set(this.viewW / 2, this.viewH - 24);
  }

  private layout(): void {
    const btnY = (HEADER_HEIGHT - BTN_HEIGHT) / 2;
    const gap = 6;

    this.topBarGfx
      .clear()
      .rect(0, 0, this.viewW, HEADER_HEIGHT)
      .fill({ color: 0x0a141c, alpha: 0.92 })
      .moveTo(0, HEADER_HEIGHT)
      .lineTo(this.viewW, HEADER_HEIGHT)
      .stroke({ color: 0x274050, width: 1 });

    let leftX = 10;
    this.backBtn.position.set(leftX, btnY);
    leftX += this.backBtn.__w + gap + 4;

    let toolX = leftX;
    const toolOrder: EditTool[] = ['tree', 'eraser', 'enemy', 'spawn'];
    for (const id of toolOrder) {
      const btn = this.toolBtns[id];
      if (btn) {
        btn.position.set(toolX, btnY);
        toolX += btn.__w + 2;
      }
    }
    toolX += gap + 4;

    const showBrush = this.tool === 'tree' || this.tool === 'eraser';
    this.brushSubGroup.visible = showBrush;
    if (showBrush) {
      this.brushSubGroup.position.set(toolX, btnY);
      toolX += 94 + gap;
    }

    const showTreeKind = this.tool === 'tree';
    this.treeKindSubGroup.visible = showTreeKind;
    if (showTreeKind) {
      this.treeKindSubGroup.position.set(toolX, btnY);
      toolX += 104 + gap;
    }

    const showEnemy = this.tool === 'enemy';
    this.enemySubGroup.visible = showEnemy;
    if (showEnemy) {
      this.enemySubGroup.position.set(toolX, btnY);
    }

    let rightX = this.viewW - 10;
    for (const btn of [
      this.exportBtn,
      this.previewBtn,
      this.clearBtn,
      this.undoBtn,
    ]) {
      rightX -= btn.__w;
      btn.position.set(rightX, btnY);
      rightX -= gap;
    }

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
