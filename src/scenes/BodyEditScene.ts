import {
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  Texture,
} from 'pixi.js';
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
import type { GameScene } from './types';

const BG = 0x121820;
const FLOOR = 0x1c2834;
const GRID = 0x243040;

const SUBJECTS: ReadonlyArray<{
  id: BodyProfileId;
  url: string;
  scale: number;
  footY: number;
}> = [
  {
    id: 'bomb-girl',
    url: '/assets/bomb-girl/preview.png',
    scale: 0.07,
    footY: 0.92,
  },
  {
    id: 'ice-ranger',
    url: '/assets/ice-ranger/preview.png',
    scale: 0.066,
    footY: 0.92,
  },
  {
    id: 'spider',
    url: '/assets/spider/spider.png',
    scale: 0.1,
    footY: 0.88,
  },
  {
    id: 'flame-flower',
    url: '/assets/flame-flower/flame-flower.png',
    scale: 0.09,
    footY: 0.94,
  },
  {
    id: 'wooden-dummy',
    url: '/assets/wooden-dummy/wooden-dummy.png',
    scale: 0.09,
    footY: 0.96,
  },
];

const SPACING = 200;
const DEFAULT_ZOOM = 1.35;

type Subject = {
  id: BodyProfileId;
  root: Container;
  sprite: Sprite;
  worldX: number;
  worldY: number;
};

export type BodyEditSceneOptions = {
  onBack: () => void;
  onBackground?: (color: number) => void;
};

/**
 * 碰撞 / 受击体独立编辑场景。
 * 鼠标拖拽调参；工具条仅导出与增删形状，无快捷键。
 */
export class BodyEditScene extends Container implements GameScene {
  private readonly bg: Graphics;
  private readonly worldRoot: Container;
  private readonly floorGfx: Graphics;
  private readonly shapeGfx: Graphics;
  private readonly subjectLayer: Container;
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
  private statusT = 0;

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

    this.hud = new ColliderEditHud();
    this.hud.setHandlers({
      onExport: () => {
        void this.exportProfiles();
      },
      onAdd: (kind) => {
        if (!this.editor.selectedId) {
          const first = this.subjects[0];
          if (first) this.editor.select(first.id, first.worldX, first.worldY);
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

    this.layoutSubjects();
    this.applyCamera();
    this.paintBg();
    this.layoutUi();
    const first = this.subjects[0];
    if (first) this.editor.select(first.id, first.worldX, first.worldY);
    this.redrawShapes();
  }

  async init(): Promise<void> {
    this.onBackground?.(BG);
    await this.loadSprites();
    this.redrawShapes();
  }

  update(deltaMS: number): void {
    const dt = deltaMS / 1000;
    if (this.statusT > 0) {
      this.statusT = Math.max(0, this.statusT - dt);
      if (this.statusT <= 0) this.hud.setStatus('');
    }

    const id = this.editor.selectedId;
    if (id) {
      const s = this.subjects.find((x) => x.id === id);
      if (s) this.editor.syncAnchor(s.worldX, s.worldY);
    }
    this.redrawShapes();
  }

  resize(width: number, height: number): void {
    this.viewW = width;
    this.viewH = height;
    this.hitArea = new Rectangle(0, 0, width, height);
    this.paintBg();
    this.layoutSubjects();
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

  private async loadSprites(): Promise<void> {
    await Promise.all(
      this.subjects.map(async (s, i) => {
        const def = SUBJECTS[i]!;
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
      }),
    );
  }

  private layoutSubjects(): void {
    const n = SUBJECTS.length;
    const totalW = (n - 1) * SPACING;
    const groundY = 40;

    if (this.subjects.length === 0) {
      for (let i = 0; i < n; i++) {
        const def = SUBJECTS[i]!;
        const root = new Container();
        root.eventMode = 'none';
        const sprite = new Sprite(Texture.EMPTY);
        sprite.anchor.set(0.5, def.footY);
        sprite.scale.set(def.scale);
        sprite.visible = false;
        root.addChild(sprite);

        const label = new Text({
          text: getBodyProfile(def.id).label,
          style: {
            fontFamily: 'system-ui, sans-serif',
            fontSize: 13,
            fontWeight: '700',
            fill: 0xc8d8f0,
            stroke: { color: 0x000000, width: 3 },
          },
        });
        label.anchor.set(0.5, 0);
        label.position.set(0, 10);
        root.addChild(label);

        this.subjectLayer.addChild(root);
        this.subjects.push({
          id: def.id,
          root,
          sprite,
          worldX: 0,
          worldY: groundY,
        });
      }
    }

    for (let i = 0; i < this.subjects.length; i++) {
      const s = this.subjects[i]!;
      s.worldX = -totalW / 2 + i * SPACING;
      s.worldY = groundY;
      s.root.position.set(s.worldX, s.worldY);
    }

    this.camX = 0;
    this.camY = groundY - 30;
    this.drawFloor(totalW);
  }

  private drawFloor(totalW: number): void {
    const g = this.floorGfx;
    g.clear();
    const pad = 120;
    const left = -totalW / 2 - pad;
    const right = totalW / 2 + pad;
    const y0 = 40;
    g.rect(left, y0 - 4, right - left, 8).fill({ color: FLOOR, alpha: 0.95 });
    for (let x = Math.ceil(left / 40) * 40; x <= right; x += 40) {
      g.moveTo(x, y0 - 80)
        .lineTo(x, y0 + 40)
        .stroke({ width: 1, color: GRID, alpha: 0.35 });
    }
    for (let y = y0 - 80; y <= y0 + 40; y += 40) {
      g.moveTo(left, y)
        .lineTo(right, y)
        .stroke({ width: 1, color: GRID, alpha: 0.25 });
    }
  }

  private applyCamera(): void {
    const z = this.zoom;
    this.worldRoot.scale.set(z);
    this.worldRoot.position.set(
      this.viewW / 2 - this.camX * z,
      this.viewH / 2 - this.camY * z,
    );
  }

  private paintBg(): void {
    this.bg.clear().rect(0, 0, this.viewW, this.viewH).fill({ color: BG });
  }

  private layoutUi(): void {
    this.hud.layout(this.viewW, this.viewH);
    this.backBtn.position.set(this.viewW - 100, 12);
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
    return {
      x: this.camX + (screenX - this.viewW / 2) / z,
      y: this.camY + (screenY - this.viewH / 2) / z,
    };
  }

  private collectTargets(): SelectableBody[] {
    return this.subjects.map((s) => ({
      profileId: s.id,
      worldX: s.worldX,
      worldY: s.worldY,
    }));
  }

  private readonly onPointerDown = (e: {
    global: { x: number; y: number };
  }): void => {
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
    const factor = e.deltaY > 0 ? 1 / 1.08 : 1.08;
    this.zoom = Math.min(3, Math.max(0.55, this.zoom * factor));
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

    for (const s of this.subjects) {
      const selected = this.editor.selectedId === s.id;
      this.drawProfile(g, s.worldX, s.worldY, s.id, selected);
    }

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

    // 非当前编辑层：淡化只读；当前层：可强调
    for (let i = 0; i < p.solid.length; i++) {
      const layerActive = mode === 'solid';
      const shapeActive =
        selected &&
        layerActive &&
        this.editor.selectedIndex === i;
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
        selected &&
        layerActive &&
        this.editor.selectedIndex === i;
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
      g.circle(cx, cy, s.r).stroke({ width: 1.5, color: 0xffffff, alpha: 0.45 });
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
