import {
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  Texture,
} from 'pixi.js';
import {
  getBodyEditSubjects,
  type BodyEditSubjectDef,
} from '../data/bodyEditCatalog';
import {
  getBodyProfile,
  type BodyProfileId,
  type BodyShape,
} from '../data/bodyProfiles';
import { copyBodyProfilesTs } from '../data/exportBodyProfiles';
import {
  ColliderEditController,
  type SelectableBody,
} from '../systems/ColliderEditController';
import { ColliderEditHud } from '../ui/ColliderEditHud';
import {
  loadOutlinedTexture,
  OUTLINE_PX_CHARACTER,
  paddedFootAnchorY,
} from '../utils/outlineTexture';
import { drawPineLocal } from '../world/PineTree';
import { drawGrassLocal } from '../world/GrassPatch';
import { drawAppleTreeLocal } from '../world/AppleTree';
import type { GameScene } from './types';

const BG = 0x121820;
const FLOOR = 0x1c2834;
const GRID = 0x243040;
const PICKER_W = 168;
const DEFAULT_ZOOM = 1.55;
const STAGE_FEET_Y = 40;

/**
 * 主体目录来自 bodyEditCatalog（角色 + ENEMY_KINDS + 环境）。
 * 新增动物只需 ENEMY_KINDS + BODY_PROFILES + catalog 条目，列表自动出现。
 */
const SUBJECTS: ReadonlyArray<BodyEditSubjectDef> = getBodyEditSubjects();

type Subject = {
  id: BodyProfileId;
  def: BodyEditSubjectDef;
  root: Container;
  sprite: Sprite | null;
  worldX: number;
  worldY: number;
  loaded: boolean;
};

type PickerRow = {
  id: BodyProfileId;
  root: Container;
  bg: Graphics;
  label: Text;
};

export type BodyEditSceneOptions = {
  onBack: () => void;
  onBackground?: (color: number) => void;
};

/**
 * 碰撞 / 受击体编辑：左侧选主体 → 中间单独调整。
 * 主体列表由 getBodyEditSubjects() 自动生成。
 */
export class BodyEditScene extends Container implements GameScene {
  private readonly bg: Graphics;
  private readonly worldRoot: Container;
  private readonly floorGfx: Graphics;
  private readonly shapeGfx: Graphics;
  private readonly subjectLayer: Container;
  private readonly pickerRoot: Container;
  private readonly pickerScroll: Container;
  private readonly pickerTitle: Text;
  private readonly stageTitle: Text;
  private readonly hud: ColliderEditHud;
  private readonly backBtn: Container;
  private readonly editor = new ColliderEditController();

  private readonly onBack: () => void;
  private readonly onBackground?: (color: number) => void;

  private viewW: number;
  private viewH: number;
  private zoom = DEFAULT_ZOOM;
  private camX = 0;
  private camY = 0;
  private subjects: Subject[] = [];
  private pickerRows: PickerRow[] = [];
  private activeIndex = 0;
  private statusT = 0;
  private pickerScrollY = 0;

  constructor(width: number, height: number, options: BodyEditSceneOptions) {
    super();
    this.label = 'BodyEditScene';
    this.viewW = width;
    this.viewH = height;
    this.onBack = options.onBack;
    this.onBackground = options.onBackground;

    this.eventMode = 'static';
    this.cursor = 'default';
    this.hitArea = new Rectangle(0, 0, width, height);

    this.bg = new Graphics();
    this.addChild(this.bg);

    this.worldRoot = new Container();
    this.worldRoot.label = 'BodyEditWorld';
    this.addChild(this.worldRoot);

    this.floorGfx = new Graphics();
    this.worldRoot.addChild(this.floorGfx);

    this.subjectLayer = new Container();
    this.worldRoot.addChild(this.subjectLayer);

    this.shapeGfx = new Graphics();
    this.worldRoot.addChild(this.shapeGfx);

    this.stageTitle = new Text({
      text: '',
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 16,
        fontWeight: '700',
        fill: 0xc8d8f0,
        stroke: { color: 0x000000, width: 3 },
      },
    });
    this.stageTitle.anchor.set(0.5, 1);
    this.addChild(this.stageTitle);

    this.pickerRoot = new Container();
    this.pickerRoot.label = 'SubjectPicker';
    this.pickerRoot.eventMode = 'static';
    this.addChild(this.pickerRoot);

    this.pickerTitle = new Text({
      text: '选择主体',
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 13,
        fontWeight: '700',
        fill: 0xa8c0d8,
      },
    });
    this.pickerRoot.addChild(this.pickerTitle);

    this.pickerScroll = new Container();
    this.pickerRoot.addChild(this.pickerScroll);

    this.hud = new ColliderEditHud();
    this.hud.setHandlers({
      onExport: () => {
        void this.exportProfiles();
      },
      onAdd: (kind) => {
        if (!this.editor.selectedId) {
          this.selectSubject(this.activeIndex);
        }
        this.editor.addShape(kind);
        this.redrawShapes();
      },
      onDelete: () => {
        this.editor.deleteSelectedShape();
        this.redrawShapes();
      },
      onMode: (part) => {
        this.editor.setEditPart(part);
        this.hud.setEditPart(part);
        this.redrawShapes();
      },
    });
    this.hud.setEditPart(this.editor.editPart);
    this.addChild(this.hud);

    this.backBtn = this.makeBackButton();
    this.addChild(this.backBtn);

    this.on('pointerdown', this.onPointerDown);
    this.on('pointermove', this.onPointerMove);
    this.on('pointerup', this.onPointerUp);
    this.on('pointerupoutside', this.onPointerUp);
    window.addEventListener('wheel', this.onWheel, { passive: false });

    this.buildSubjects();
    this.buildPicker();
    this.selectSubject(0);
    this.paintBg();
    this.layoutUi();
    this.redrawShapes();
  }

  async init(): Promise<void> {
    this.onBackground?.(BG);
    // 预加载全部贴图；舞台只显示当前选中
    await Promise.all(this.subjects.map((_, i) => this.ensureSubjectLoaded(i)));
    this.redrawShapes();
  }

  update(deltaMS: number): void {
    const dt = deltaMS / 1000;
    if (this.statusT > 0) {
      this.statusT = Math.max(0, this.statusT - dt);
      if (this.statusT <= 0) this.hud.setStatus('');
    }

    const active = this.activeSubject();
    if (active && this.editor.selectedId === active.id) {
      this.editor.syncAnchor(active.worldX, active.worldY);
    }
    this.redrawShapes();
  }

  resize(width: number, height: number): void {
    this.viewW = width;
    this.viewH = height;
    this.hitArea = new Rectangle(0, 0, width, height);
    this.paintBg();
    this.layoutStage();
    this.applyCamera();
    this.layoutUi();
    this.redrawShapes();
  }

  destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.off('pointerdown', this.onPointerDown);
    this.off('pointermove', this.onPointerMove);
    this.off('pointerup', this.onPointerUp);
    this.off('pointerupoutside', this.onPointerUp);
    window.removeEventListener('wheel', this.onWheel);
    super.destroy(options);
  }

  private activeSubject(): Subject | null {
    return this.subjects[this.activeIndex] ?? null;
  }

  private buildSubjects(): void {
    for (const def of SUBJECTS) {
      const root = new Container();
      root.eventMode = 'none';
      root.visible = false;

      let sprite: Sprite | null = null;
      if (def.kind === 'sprite') {
        sprite = new Sprite(Texture.EMPTY);
        sprite.anchor.set(0.5, def.footY);
        sprite.scale.set(def.scale);
        sprite.visible = false;
        root.addChild(sprite);
      } else if (def.kind === 'pine') {
        const pine = new Graphics();
        pine.label = 'BodyEditPine';
        drawPineLocal(pine, 1);
        pine.scale.set(def.pineScale);
        pine.tint = def.tint;
        root.addChild(pine);
      } else if (def.kind === 'apple') {
        const apple = new Graphics();
        apple.label = 'BodyEditApple';
        drawAppleTreeLocal(apple, 0, 2, 0, 0);
        apple.scale.set(def.pineScale);
        apple.tint = def.tint;
        root.addChild(apple);
      } else if (def.kind === 'grass') {
        const grass = new Graphics();
        grass.label = 'BodyEditGrass';
        drawGrassLocal(grass, 0);
        grass.scale.set(def.grassScale);
        grass.tint = def.tint;
        root.addChild(grass);
      }

      this.subjectLayer.addChild(root);
      this.subjects.push({
        id: def.id,
        def,
        root,
        sprite,
        worldX: 0,
        worldY: STAGE_FEET_Y,
        loaded: def.kind !== 'sprite',
      });
    }
  }

  private buildPicker(): void {
    this.pickerRows = [];
    this.pickerScroll.removeChildren();
    let y = 0;
    for (let i = 0; i < SUBJECTS.length; i++) {
      const def = SUBJECTS[i]!;
      const label = getBodyProfile(def.id).label;
      const row = this.makePickerRow(label, def.id, i, y);
      this.pickerRows.push(row);
      this.pickerScroll.addChild(row.root);
      y += row.root.height + 6;
    }
  }

  private makePickerRow(
    label: string,
    id: BodyProfileId,
    index: number,
    y: number,
  ): PickerRow {
    const root = new Container();
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.position.set(0, y);

    const bg = new Graphics();
    const t = new Text({
      text: label,
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 13,
        fontWeight: '700',
        fill: 0xe8f0f8,
      },
    });
    const padX = 12;
    const padY = 9;
    const w = PICKER_W - 20;
    const h = t.height + padY * 2;
    t.position.set(padX, padY);
    root.addChild(bg, t);

    bg.roundRect(0, 0, w, h, 8)
      .fill({ color: 0x1a2836, alpha: 0.95 })
      .stroke({ width: 1.2, color: 0x3a5068, alpha: 0.85 });

    root.on('pointertap', (e) => {
      e.stopPropagation();
      void this.selectSubject(index);
    });

    return { id, root, bg, label: t };
  }

  private async selectSubject(index: number): Promise<void> {
    if (index < 0 || index >= this.subjects.length) return;
    this.activeIndex = index;

    for (let i = 0; i < this.subjects.length; i++) {
      const s = this.subjects[i]!;
      s.root.visible = i === index;
    }

    await this.ensureSubjectLoaded(index);

    const s = this.subjects[index]!;
    s.worldX = 0;
    s.worldY = STAGE_FEET_Y;
    s.root.position.set(s.worldX, s.worldY);

    this.editor.select(s.id, s.worldX, s.worldY);
    this.camX = 0;
    this.camY = STAGE_FEET_Y - 36;
    this.layoutStage();
    this.applyCamera();
    this.refreshPickerStyles();
    this.stageTitle.text = getBodyProfile(s.id).label;
    this.redrawShapes();
  }

  private async ensureSubjectLoaded(index: number): Promise<void> {
    const s = this.subjects[index];
    if (!s || s.loaded) return;
    const def = s.def;
    if (def.kind !== 'sprite' || !s.sprite) {
      s.loaded = true;
      return;
    }
    try {
      const outlined = await loadOutlinedTexture(
        def.url,
        OUTLINE_PX_CHARACTER,
      );
      const footY = paddedFootAnchorY(
        def.footY,
        outlined.contentHeight,
        outlined.pad,
      );
      s.sprite.texture = outlined.texture;
      s.sprite.anchor.set(0.5, footY);
      s.sprite.scale.set(def.scale);
      s.sprite.visible = true;
    } catch {
      s.sprite.texture = Texture.EMPTY;
    }
    s.loaded = true;
  }

  private refreshPickerStyles(): void {
    for (let i = 0; i < this.pickerRows.length; i++) {
      const row = this.pickerRows[i]!;
      const active = i === this.activeIndex;
      const w = PICKER_W - 20;
      const h = row.label.height + 18;
      row.bg
        .clear()
        .roundRect(0, 0, w, h, 8)
        .fill({
          color: active ? 0x2a4a68 : 0x1a2836,
          alpha: 0.96,
        })
        .stroke({
          width: active ? 1.8 : 1.2,
          color: active ? 0x6ab0e8 : 0x3a5068,
          alpha: active ? 1 : 0.85,
        });
      row.label.style.fill = active ? 0xffffff : 0xc8d4e0;
    }
  }

  private layoutStage(): void {
    this.drawFloor();
  }

  private drawFloor(): void {
    const g = this.floorGfx;
    g.clear();
    const half = 220;
    const left = -half;
    const right = half;
    const y0 = STAGE_FEET_Y;
    g.rect(left, y0 - 4, right - left, 8).fill({ color: FLOOR, alpha: 0.95 });
    for (let x = Math.ceil(left / 40) * 40; x <= right; x += 40) {
      g.moveTo(x, y0 - 120)
        .lineTo(x, y0 + 50)
        .stroke({ width: 1, color: GRID, alpha: 0.35 });
    }
    for (let y = y0 - 120; y <= y0 + 50; y += 40) {
      g.moveTo(left, y)
        .lineTo(right, y)
        .stroke({ width: 1, color: GRID, alpha: 0.25 });
    }
  }

  private applyCamera(): void {
    const z = this.zoom;
    // 舞台中心偏右，给左侧列表留空
    const stageCx = PICKER_W + (this.viewW - PICKER_W) / 2;
    this.worldRoot.scale.set(z);
    this.worldRoot.position.set(
      stageCx - this.camX * z,
      this.viewH / 2 - this.camY * z,
    );
  }

  private paintBg(): void {
    this.bg.clear().rect(0, 0, this.viewW, this.viewH).fill({ color: BG });
    // 左侧选择栏底板
    this.bg
      .rect(0, 0, PICKER_W, this.viewH)
      .fill({ color: 0x0e141c, alpha: 0.92 });
    this.bg
      .moveTo(PICKER_W, 0)
      .lineTo(PICKER_W, this.viewH)
      .stroke({ width: 1.5, color: 0x2a3a4a, alpha: 0.9 });
  }

  private layoutUi(): void {
    this.hud.layout(this.viewW, this.viewH);
    // 工具条避开左侧栏
    this.hud.position.set(PICKER_W + 12, 12);
    this.backBtn.position.set(this.viewW - 100, 12);

    this.pickerRoot.position.set(10, 56);
    this.pickerTitle.position.set(0, 0);
    this.pickerScroll.position.set(0, 28);
    this.clampPickerScroll();

    this.stageTitle.position.set(
      PICKER_W + (this.viewW - PICKER_W) / 2,
      56,
    );
  }

  private clampPickerScroll(): void {
    const listH = this.pickerScroll.height;
    const viewH = Math.max(80, this.viewH - 100);
    const minY = Math.min(0, viewH - listH);
    this.pickerScrollY = Math.max(minY, Math.min(0, this.pickerScrollY));
    this.pickerScroll.position.y = 28 + this.pickerScrollY;
  }

  private makeBackButton(): Container {
    const root = new Container();
    root.eventMode = 'static';
    root.cursor = 'pointer';
    const g = new Graphics();
    const t = new Text({
      text: '返回',
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 14,
        fontWeight: '700',
        fill: 0xffffff,
      },
    });
    const w = 80;
    const h = 34;
    g.roundRect(0, 0, w, h, 10)
      .fill({ color: 0x2a3a4a, alpha: 0.95 })
      .stroke({ width: 1.5, color: 0x6a8aaa, alpha: 0.9 });
    t.anchor.set(0.5);
    t.position.set(w / 2, h / 2);
    root.addChild(g, t);
    root.on('pointertap', (e) => {
      e.stopPropagation();
      this.onBack();
    });
    return root;
  }

  private screenToWorld(
    screenX: number,
    screenY: number,
  ): { x: number; y: number } {
    const z = Math.max(this.zoom, 1e-4);
    const stageCx = PICKER_W + (this.viewW - PICKER_W) / 2;
    return {
      x: this.camX + (screenX - stageCx) / z,
      y: this.camY + (screenY - this.viewH / 2) / z,
    };
  }

  private collectTargets(): SelectableBody[] {
    const s = this.activeSubject();
    if (!s) return [];
    return [
      {
        profileId: s.id,
        worldX: s.worldX,
        worldY: s.worldY,
      },
    ];
  }

  private readonly onPointerDown = (e: {
    global: { x: number; y: number };
  }): void => {
    // 点在左侧列表区域不进世界编辑
    if (e.global.x < PICKER_W) return;
    const w = this.screenToWorld(e.global.x, e.global.y);
    this.editor.onPointerDown(w.x, w.y, this.collectTargets());
    this.redrawShapes();
  };

  private readonly onPointerMove = (e: {
    global: { x: number; y: number };
  }): void => {
    if (!this.editor.isDragging) return;
    const w = this.screenToWorld(e.global.x, e.global.y);
    this.editor.onPointerMove(w.x, w.y);
    this.redrawShapes();
  };

  private readonly onPointerUp = (): void => {
    if (this.editor.isDragging) {
      this.editor.onPointerUp();
      this.redrawShapes();
    }
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    // 指针在左侧列表：滚动主体列表
    if (e.clientX < PICKER_W + 8) {
      this.pickerScrollY -= e.deltaY * 0.5;
      this.clampPickerScroll();
      return;
    }
    const factor = e.deltaY > 0 ? 1 / 1.08 : 1.08;
    this.zoom = Math.min(3.2, Math.max(0.55, this.zoom * factor));
    this.applyCamera();
  };

  private async exportProfiles(): Promise<void> {
    const { text, copied } = await copyBodyProfilesTs();
    this.hud.setStatus(copied ? '已复制' : '复制失败');
    this.statusT = 2.5;
    if (!copied) console.info(text);
  }

  private redrawShapes(): void {
    const g = this.shapeGfx;
    g.clear();

    const s = this.activeSubject();
    if (!s) return;

    this.drawProfile(g, s.worldX, s.worldY, s.id, true);

    if (this.editor.selectedId && this.editor.selectedShape) {
      this.drawHandles(
        g,
        this.editor.anchorX,
        this.editor.anchorY,
        this.editor.selectedId,
        this.editor.selectedShape.part,
        this.editor.selectedShape.index,
      );
    }
  }

  private drawProfile(
    g: Graphics,
    feetX: number,
    feetY: number,
    id: BodyProfileId,
    selected: boolean,
  ): void {
    const p = getBodyProfile(id);
    const mode = this.editor.editPart;

    for (let i = 0; i < p.solid.length; i++) {
      const layerActive = mode === 'solid';
      const shapeActive =
        selected && layerActive && this.editor.selectedIndex === i;
      this.drawShape(
        g,
        feetX,
        feetY,
        p.solid[i]!,
        0x00e5ff,
        shapeActive ? 'active' : layerActive ? 'edit' : 'dim',
      );
    }
    for (let i = 0; i < p.hurt.length; i++) {
      const layerActive = mode === 'hurt';
      const shapeActive =
        selected && layerActive && this.editor.selectedIndex === i;
      this.drawShape(
        g,
        feetX,
        feetY,
        p.hurt[i]!,
        0xff9100,
        shapeActive ? 'active' : layerActive ? 'edit' : 'dim',
      );
    }

    const c = 5;
    g.moveTo(feetX - c, feetY)
      .lineTo(feetX + c, feetY)
      .stroke({ width: 1.5, color: 0x88a0b8, alpha: 0.9 })
      .moveTo(feetX, feetY - c)
      .lineTo(feetX, feetY + c)
      .stroke({ width: 1.5, color: 0x88a0b8, alpha: 0.9 });
  }

  private drawShape(
    g: Graphics,
    feetX: number,
    feetY: number,
    s: BodyShape,
    color: number,
    emphasis: 'dim' | 'edit' | 'active',
  ): void {
    const cx = feetX + s.ox;
    const cy = feetY + s.oy;
    const alphaFill =
      emphasis === 'active' ? 0.28 : emphasis === 'edit' ? 0.16 : 0.05;
    const strokeW =
      emphasis === 'active' ? 2.6 : emphasis === 'edit' ? 2 : 1.2;
    const strokeA =
      emphasis === 'active' ? 1 : emphasis === 'edit' ? 0.9 : 0.28;
    if (s.type === 'circle') {
      g.circle(cx, cy, s.r)
        .fill({ color, alpha: alphaFill })
        .stroke({ width: strokeW, color, alpha: strokeA });
    } else {
      g.rect(cx - s.w * 0.5, cy - s.h * 0.5, s.w, s.h)
        .fill({ color, alpha: alphaFill })
        .stroke({ width: strokeW, color, alpha: strokeA });
    }
  }

  private drawHandles(
    g: Graphics,
    ax: number,
    ay: number,
    id: BodyProfileId,
    part: 'solid' | 'hurt',
    index: number,
  ): void {
    const p = getBodyProfile(id);
    const list = part === 'solid' ? p.solid : p.hurt;
    const s = list[index];
    if (!s) return;
    const cx = ax + s.ox;
    const cy = ay + s.oy;
    this.dot(g, cx, cy, 0xffffff, true);
    if (s.type === 'circle') {
      this.dot(g, cx + s.r, cy, 0xffffff, true);
      g.circle(cx, cy, s.r).stroke({
        width: 1.5,
        color: 0xffffff,
        alpha: 0.45,
      });
    } else {
      this.dot(g, cx + s.w * 0.5, cy + s.h * 0.5, 0xffffff, true);
      this.dot(g, cx - s.w * 0.5, cy - s.h * 0.5, 0xffffff, false);
      g.rect(cx - s.w * 0.5, cy - s.h * 0.5, s.w, s.h).stroke({
        width: 1.5,
        color: 0xffffff,
        alpha: 0.45,
      });
    }
  }

  private dot(
    g: Graphics,
    x: number,
    y: number,
    color: number,
    active: boolean,
  ): void {
    const r = active ? 5.5 : 4;
    g.circle(x, y, r)
      .fill({ color, alpha: 1 })
      .stroke({ width: 1.5, color: 0x000000, alpha: 0.7 });
  }
}
