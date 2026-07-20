import {
  Assets,
  Container,
  Rectangle,
  Sprite,
  Texture,
  type Texture as PixiTexture,
} from 'pixi.js';

/** 角色资源根目录：外层预览，parts/ 内为拆解图与定位 */
const CHAR_DIR = '/assets/frost-archer';
const PREVIEW_URL = `${CHAR_DIR}/preview.png`;
const RIG_URL = `${CHAR_DIR}/parts/rig.json`;

interface PartFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface PartRig {
  frame: PartFrame;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  flip: boolean;
  /** 部件图片中作为关节的归一化坐标 */
  anchor?: { x: number; y: number };
  /** 挂到父关节后使用局部坐标，方便后续直接旋转骨骼 */
  parent?: string;
}

interface ArcherRig {
  sheet: string;
  order: string[];
  feet: { x: number; y: number };
  parts: Record<string, PartRig>;
}

/**
 * 由 parts 图集组装的寒冰射手。
 * 资源：assets/frost-archer/parts/{atlas,rig}
 * 原点在脚底中心（rig.feet）。
 */
export class FrostArcher extends Container {
  private readonly root = new Container();
  private readonly joints = new Map<string, Container>();
  private loaded = false;

  constructor(scale = 1) {
    super();
    this.label = 'FrostArcher';
    this.root.label = 'FrostArcherParts';
    this.addChild(this.root);
    this.scale.set(scale);
  }

  async load(): Promise<void> {
    if (this.loaded) return;

    const rig = (await Assets.load(RIG_URL)) as ArcherRig;
    const sheetTexture = (await Assets.load(rig.sheet)) as PixiTexture;

    for (const name of rig.order) {
      const part = rig.parts[name];
      if (part) this.addPart(name, part, sheetTexture);
    }

    this.loaded = true;
  }

  private addPart(name: string, part: PartRig, sheetTexture: PixiTexture): void {
    const frame = new Rectangle(part.frame.x, part.frame.y, part.frame.w, part.frame.h);
    const texture = new Texture({ source: sheetTexture.source, frame });
    const joint = new Container();
    const sprite = new Sprite(texture);
    const parent = part.parent ? this.joints.get(part.parent) : this.root;

    if (!parent) throw new Error(`FrostArcher joint not found: ${part.parent}`);

    joint.label = `${name}Joint`;
    joint.position.set(part.x, part.y);
    joint.rotation = (part.rotation * Math.PI) / 180;

    sprite.label = name;
    sprite.anchor.set(part.anchor?.x ?? 0.5, part.anchor?.y ?? 0.5);
    sprite.scale.set(part.flip ? -part.scale : part.scale, part.scale);

    joint.addChild(sprite);
    parent.addChild(joint);
    this.joints.set(name, joint);
  }
}

/**
 * 整图预览版（对照用）
 */
export class FrostArcherOriginal extends Container {
  private sprite: Sprite | null = null;

  constructor(scale = 1) {
    super();
    this.label = 'FrostArcherOriginal';
    this.scale.set(scale);
  }

  async load(): Promise<void> {
    if (this.sprite) return;
    const texture = await Assets.load(PREVIEW_URL);
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 0.92);
    sprite.label = 'OriginalSprite';
    this.sprite = sprite;
    this.addChild(sprite);
  }
}
