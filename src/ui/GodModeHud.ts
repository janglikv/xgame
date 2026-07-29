import { Assets, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { drawPineLocal } from '../world/PineTree';
import { drawGrassLocal } from '../world/GrassPatch';
import { drawAppleTreeLocal } from '../world/AppleTree';

export type GodBrush =
  | 'tree-sapling'
  | 'tree-medium'
  | 'tree-large'
  | 'apple-sapling'
  | 'apple-medium'
  | 'apple-large'
  | 'grass-small'
  | 'grass-medium'
  | 'grass-large'
  | 'spider'
  | 'flame-flower'
  | 'wooden-dummy'
  | 'chicken'
  | 'pig'
  | 'cow'
  | 'horse'
  | 'wolf'
  | 'bear'
  | 'spawn'
  | 'erase'
  | 'clear-scene';

export interface GodModeHudOptions {
  onSelectBrush?: (brush: GodBrush) => void;
  onClearScene?: () => void;
}

export interface BrushItem {
  brush: GodBrush;
  label: string;
}

export interface CategoryGroup {
  id: string;
  version: string;
  name: string;
  collapsed: boolean;
  items: BrushItem[];
}

type ButtonWidget = {
  container: Container;
  bg: Graphics;
  textNode: Text;
  brush: GodBrush;
  w: number;
  h: number;
  isHovered: boolean;
};

type CategoryWidget = {
  container: Container;
  bg: Graphics;
  titleText: Text;
  arrowText: Text;
  groupId: string;
};

/** 面板宽度（屏幕像素） */
const PANEL_W = 340;
/** 网格列数 */
const GRID_COLS = 4;
/** 格子间距 */
const CELL_GAP = 6;
/** 格子高度（宽由列数均分） */
const CELL_H = 72;
/** 格子内图标尺寸 */
const ICON_SIZE = 40;

/**
 * 右侧悬浮上帝模式面板：分类折叠 + 方块网格刷子。
 */
export class GodModeHud extends Container {
  private readonly bg: Graphics;
  private readonly borderOverlay: Graphics;
  private readonly headerContainer: Container;
  private readonly headerBg: Graphics;
  private readonly titleText: Text;
  private readonly foldMainBtnText: Text;
  private readonly tipText: Text;

  private readonly groupsContainer: Container;

  private activeBrush: GodBrush = 'tree-medium';
  private isMainCollapsed = false;
  private onSelectBrush?: (brush: GodBrush) => void;
  private onClearScene?: () => void;

  private readonly groups: CategoryGroup[] = [
    {
      id: 'v1.0',
      version: 'v1.0',
      name: '基础植被',
      collapsed: false,
      items: [
        { brush: 'tree-sapling', label: '小树苗' },
        { brush: 'tree-medium', label: '中树' },
        { brush: 'tree-large', label: '大树' },
        { brush: 'apple-sapling', label: '小苹果苗' },
        { brush: 'apple-medium', label: '中苹果树' },
        { brush: 'apple-large', label: '大苹果树' },
        { brush: 'grass-small', label: '小草' },
        { brush: 'grass-medium', label: '中草' },
        { brush: 'grass-large', label: '大草' },
      ],
    },
    {
      id: 'v1.1',
      version: 'v1.1',
      name: '生物与实体',
      collapsed: false,
      items: [
        { brush: 'spider', label: '蜘蛛' },
        { brush: 'flame-flower', label: '火焰花' },
        { brush: 'wooden-dummy', label: '木桩' },
        { brush: 'chicken', label: '鸡' },
        { brush: 'pig', label: '猪' },
        { brush: 'cow', label: '牛' },
        { brush: 'horse', label: '马' },
        { brush: 'wolf', label: '狼' },
        { brush: 'bear', label: '熊' },
      ],
    },
    {
      id: 'v1.2',
      version: 'v1.2',
      name: '调试工具',
      collapsed: false,
      items: [
        { brush: 'spawn', label: '出生点' },
        { brush: 'erase', label: '删除' },
        { brush: 'clear-scene', label: '清空场景' },
      ],
    },
  ];

  private buttonWidgets: ButtonWidget[] = [];
  private categoryWidgets: CategoryWidget[] = [];

  private lastScreenWidth = 1024;
  private currentBounds = { x: 0, y: 0, width: 0, height: 0 };

  constructor(options?: GodModeHudOptions) {
    super();
    this.label = 'GodModeHud';
    this.visible = false;
    this.eventMode = 'static';
    this.onSelectBrush = options?.onSelectBrush;
    this.onClearScene = options?.onClearScene;

    this.bg = new Graphics();
    this.bg.eventMode = 'static';
    this.bg.on('pointertap', (e) => e.stopPropagation());
    this.addChild(this.bg);

    this.headerContainer = new Container();
    this.headerContainer.eventMode = 'static';
    this.headerBg = new Graphics();
    this.headerContainer.addChild(this.headerBg);

    this.titleText = new Text({
      text: '上帝模式',
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 14,
        fontWeight: '700',
        fill: 0xffe08a,
      },
    });
    this.headerContainer.addChild(this.titleText);

    this.foldMainBtnText = new Text({
      text: '[ 收起 ▲ ]',
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 12,
        fontWeight: '600',
        fill: 0xb0c4de,
      },
    });
    this.foldMainBtnText.eventMode = 'static';
    this.foldMainBtnText.cursor = 'pointer';
    this.foldMainBtnText.on('pointerenter', () => {
      this.foldMainBtnText.style.fill = 0xffffff;
    });
    this.foldMainBtnText.on('pointerleave', () => {
      this.foldMainBtnText.style.fill = 0xb0c4de;
    });
    this.foldMainBtnText.on('pointertap', (e) => {
      e.stopPropagation();
      this.isMainCollapsed = !this.isMainCollapsed;
      this.foldMainBtnText.text = this.isMainCollapsed
        ? '[ 展开 ▼ ]'
        : '[ 收起 ▲ ]';
      this.rebuildUI();
    });
    this.headerContainer.addChild(this.foldMainBtnText);

    this.addChild(this.headerContainer);

    this.tipText = new Text({
      text: '点击地图放置 · G 键退出',
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 11,
        fill: 0x90a4ae,
      },
    });
    this.addChild(this.tipText);

    this.groupsContainer = new Container();
    this.addChild(this.groupsContainer);

    this.borderOverlay = new Graphics();
    this.borderOverlay.eventMode = 'none';
    this.addChild(this.borderOverlay);

    this.rebuildUI();
  }

  setBrush(brush: GodBrush): void {
    this.activeBrush = brush;
    this.updateButtonStyles();
  }

  containsScreenPoint(x: number, y: number): boolean {
    if (!this.visible) return false;
    const b = this.currentBounds;
    return (
      x >= b.x &&
      x <= b.x + b.width &&
      y >= b.y &&
      y <= b.y + b.height
    );
  }

  layout(width: number, _height: number): void {
    this.lastScreenWidth = width;
    this.rebuildUI();
  }

  private rebuildUI(): void {
    const screenW = this.lastScreenWidth;
    const panelW = PANEL_W;
    const padding = 10;
    const innerW = panelW - padding * 2;
    const cellW =
      (innerW - CELL_GAP * (GRID_COLS - 1)) / GRID_COLS;

    this.buttonWidgets = [];
    this.categoryWidgets = [];
    this.groupsContainer.removeChildren();

    const startX = screenW - panelW - 16;
    const startY = 16;

    this.headerBg
      .clear()
      .roundRect(0, 0, innerW, 34, 6)
      .fill({ color: 0x251e33, alpha: 0.95 });

    this.titleText.position.set(10, 8);
    this.foldMainBtnText.position.set(innerW - 70, 9);
    this.headerContainer.position.set(startX + padding, startY + padding);

    let currentY = startY + padding + 38;

    if (!this.isMainCollapsed) {
      for (const group of this.groups) {
        const catContainer = new Container();
        catContainer.eventMode = 'static';
        catContainer.position.set(startX + padding, currentY);

        const catBg = new Graphics();
        catBg.eventMode = 'static';
        catBg.cursor = 'pointer';

        const arrowStr = group.collapsed ? '▶' : '▼';
        const countStr = `(${group.items.length})`;

        const titleText = new Text({
          text: `${group.version} ${group.name} ${countStr}`,
          style: {
            fontFamily: 'system-ui, sans-serif',
            fontSize: 12,
            fontWeight: '700',
            fill: 0xddb86c,
          },
        });
        titleText.position.set(22, 5);

        const arrowText = new Text({
          text: arrowStr,
          style: {
            fontFamily: 'system-ui, sans-serif',
            fontSize: 11,
            fill: 0xddb86c,
          },
        });
        arrowText.position.set(7, 6);

        catBg
          .clear()
          .roundRect(0, 0, innerW, 26, 6)
          .fill({ color: 0x1f192b, alpha: 0.88 });

        catBg.on('pointerenter', () => {
          catBg
            .clear()
            .roundRect(0, 0, innerW, 26, 6)
            .fill({ color: 0x312845, alpha: 0.95 });
        });
        catBg.on('pointerleave', () => {
          catBg
            .clear()
            .roundRect(0, 0, innerW, 26, 6)
            .fill({ color: 0x1f192b, alpha: 0.88 });
        });

        const toggleCollapse = (e: { stopPropagation: () => void }) => {
          e.stopPropagation();
          group.collapsed = !group.collapsed;
          this.rebuildUI();
        };

        catBg.on('pointertap', toggleCollapse);

        catContainer.addChild(catBg);
        catContainer.addChild(arrowText);
        catContainer.addChild(titleText);
        this.groupsContainer.addChild(catContainer);

        this.categoryWidgets.push({
          container: catContainer,
          bg: catBg,
          titleText,
          arrowText,
          groupId: group.id,
        });

        currentY += 30;

        if (!group.collapsed) {
          let col = 0;
          for (const item of group.items) {
            const colIndex = col % GRID_COLS;
            const rowIndex = Math.floor(col / GRID_COLS);
            const cellX =
              startX + padding + colIndex * (cellW + CELL_GAP);
            const cellY = currentY + rowIndex * (CELL_H + CELL_GAP);

            const btnContainer = new Container();
            btnContainer.eventMode = 'static';
            btnContainer.cursor = 'pointer';
            btnContainer.position.set(cellX, cellY);

            const btnBg = new Graphics();
            btnBg.eventMode = 'static';
            btnContainer.addChild(btnBg);

            const previewIcon = this.createPreviewIcon(item.brush);
            previewIcon.position.set((cellW - ICON_SIZE) / 2, 6);
            btnContainer.addChild(previewIcon);

            const btnTextNode = new Text({
              text: item.label,
              style: {
                fontFamily: 'system-ui, sans-serif',
                fontSize: 11,
                fontWeight: '600',
                fill: 0xcccccc,
                align: 'center',
                wordWrap: true,
                wordWrapWidth: cellW - 6,
              },
            });
            btnTextNode.anchor.set(0.5, 0);
            btnTextNode.position.set(cellW / 2, ICON_SIZE + 10);
            btnContainer.addChild(btnTextNode);

            const widget: ButtonWidget = {
              container: btnContainer,
              bg: btnBg,
              textNode: btnTextNode,
              brush: item.brush,
              w: cellW,
              h: CELL_H,
              isHovered: false,
            };

            btnContainer.on('pointerenter', () => {
              widget.isHovered = true;
              this.drawSingleButton(widget);
            });
            btnContainer.on('pointerleave', () => {
              widget.isHovered = false;
              this.drawSingleButton(widget);
            });
            btnContainer.on('pointertap', (e) => {
              e.stopPropagation();
              if (item.brush === 'clear-scene') {
                if (
                  window.confirm(
                    '确定要清空当前场景中的所有树木、草地与生物吗？',
                  )
                ) {
                  this.onClearScene?.();
                }
                return;
              }
              this.activeBrush = item.brush;
              this.updateButtonStyles();
              this.onSelectBrush?.(item.brush);
            });

            this.buttonWidgets.push(widget);
            this.groupsContainer.addChild(btnContainer);
            col += 1;
          }

          const rows = Math.ceil(group.items.length / GRID_COLS);
          currentY += rows * (CELL_H + CELL_GAP) + 4;
        }
      }
    }

    this.tipText.position.set(startX + padding + 4, currentY + 2);
    const totalH = currentY + 22 - startY;

    this.bg
      .clear()
      .roundRect(startX, startY, panelW, totalH, 12)
      .fill({ color: 0x120d1a, alpha: 0.93 });

    this.borderOverlay
      .clear()
      .roundRect(startX, startY, panelW, totalH, 12)
      .stroke({ width: 2, color: 0xe8b84a, alpha: 0.85 });

    this.currentBounds = {
      x: startX,
      y: startY,
      width: panelW,
      height: totalH,
    };

    this.updateButtonStyles();
  }

  /** 格子内 40×40 图标预览 */
  private createPreviewIcon(brush: GodBrush): Container {
    const iconContainer = new Container();
    const s = ICON_SIZE;

    const iconBg = new Graphics();
    iconBg
      .roundRect(0, 0, s, s, 8)
      .fill({ color: 0x181224, alpha: 0.9 })
      .roundRect(0, 0, s, s, 8)
      .stroke({ width: 1, color: 0x483a63, alpha: 0.5 });
    iconContainer.addChild(iconBg);

    const cx = s / 2;
    const cy = s / 2;

    if (
      brush === 'tree-sapling' ||
      brush === 'tree-medium' ||
      brush === 'tree-large'
    ) {
      const treeGfx = new Graphics();
      drawPineLocal(treeGfx, 0, 0, 0);
      treeGfx.position.set(cx, s - 6);
      const iconScale =
        brush === 'tree-sapling' ? 0.24 : brush === 'tree-large' ? 0.55 : 0.36;
      treeGfx.scale.set(iconScale);
      iconContainer.addChild(treeGfx);
      const badgeColor =
        brush === 'tree-sapling'
          ? 0x8fd46a
          : brush === 'tree-large'
            ? 0xc4782a
            : 0xd69a19;
      const badge = new Graphics();
      badge
        .circle(s - 7, s - 7, 5.5)
        .fill({ color: badgeColor })
        .stroke({ width: 1, color: 0xffffff });
      iconContainer.addChild(badge);
    } else if (
      brush === 'apple-sapling' ||
      brush === 'apple-medium' ||
      brush === 'apple-large'
    ) {
      const treeGfx = new Graphics();
      const count = brush === 'apple-large' ? 2 : 0;
      drawAppleTreeLocal(treeGfx, 0, count, 0, 0);
      treeGfx.position.set(cx, s - 6);
      const iconScale =
        brush === 'apple-sapling' ? 0.24 : brush === 'apple-large' ? 0.55 : 0.36;
      treeGfx.scale.set(iconScale);
      iconContainer.addChild(treeGfx);
      const badgeColor =
        brush === 'apple-sapling'
          ? 0x8fd46a
          : brush === 'apple-large'
            ? 0xef3636
            : 0xd69a19;
      const badge = new Graphics();
      badge
        .circle(s - 7, s - 7, 5.5)
        .fill({ color: badgeColor })
        .stroke({ width: 1, color: 0xffffff });
      iconContainer.addChild(badge);
    } else if (
      brush === 'grass-small' ||
      brush === 'grass-medium' ||
      brush === 'grass-large'
    ) {
      const grassGfx = new Graphics();
      drawGrassLocal(grassGfx, 0, 0, 0);
      grassGfx.position.set(cx, s - 8);
      const iconScale =
        brush === 'grass-small' ? 0.28 : brush === 'grass-large' ? 0.62 : 0.42;
      grassGfx.scale.set(iconScale);
      iconContainer.addChild(grassGfx);
      const badgeColor =
        brush === 'grass-small'
          ? 0x8fd46a
          : brush === 'grass-large'
            ? 0x4f9e34
            : 0x66bb48;
      const badge = new Graphics();
      badge
        .circle(s - 7, s - 7, 5.5)
        .fill({ color: badgeColor })
        .stroke({ width: 1, color: 0xffffff });
      iconContainer.addChild(badge);
    } else if (
      brush === 'spider' ||
      brush === 'flame-flower' ||
      brush === 'wooden-dummy' ||
      brush === 'chicken' ||
      brush === 'pig' ||
      brush === 'cow' ||
      brush === 'horse' ||
      brush === 'wolf' ||
      brush === 'bear'
    ) {
      const urlMap: Record<string, string> = {
        spider: '/assets/spider/spider.png',
        'flame-flower': '/assets/flame-flower/flame-flower.png',
        'wooden-dummy': '/assets/wooden-dummy/wooden-dummy.png',
        chicken: '/assets/chicken/chicken.png',
        pig: '/assets/pig/pig.png',
        cow: '/assets/cow/cow.png',
        horse: '/assets/horse/horse.png',
        wolf: '/assets/wolf/wolf.png',
        bear: '/assets/bear/bear.png',
      };
      const url = urlMap[brush];
      if (url) {
        const sprite = new Sprite();
        sprite.anchor.set(0.5);
        sprite.position.set(cx, cy);
        iconContainer.addChild(sprite);

        void Assets.load<Texture>(url).then((tex) => {
          if (tex) {
            sprite.texture = tex;
            const maxDim = Math.max(tex.width, tex.height);
            const sc = maxDim > 0 ? (s - 8) / maxDim : 1;
            sprite.scale.set(sc);
          }
        });
      }
    } else if (brush === 'spawn') {
      const g = new Graphics();
      g.circle(cx, cy, 12).stroke({ width: 1.5, color: 0x4caf50 });
      g.circle(cx, cy, 5).fill({ color: 0x81c784 });
      g.poly([cx, cy - 10, cx + 7, cy + 2, cx - 7, cy + 2]).fill({
        color: 0xffeb3b,
      });
      iconContainer.addChild(g);
    } else if (brush === 'erase') {
      const g = new Graphics();
      g.circle(cx, cy, 12).stroke({ width: 2, color: 0xef5350 });
      g.moveTo(cx - 7, cy - 7)
        .lineTo(cx + 7, cy + 7)
        .stroke({ width: 2, color: 0xef5350 });
      g.moveTo(cx + 7, cy - 7)
        .lineTo(cx - 7, cy + 7)
        .stroke({ width: 2, color: 0xef5350 });
      iconContainer.addChild(g);
    } else if (brush === 'clear-scene') {
      const g = new Graphics();
      // 红色标志性垃圾桶图标
      g.roundRect(cx - 7, cy - 2, 14, 13, 2).fill({ color: 0xe53935 });
      g.roundRect(cx - 9, cy - 6, 18, 3, 1).fill({ color: 0xef5350 });
      g.roundRect(cx - 3, cy - 9, 6, 3, 1).fill({ color: 0xff8a80 });
      g.rect(cx - 4, cy + 1, 2, 7).fill({ color: 0xffffff, alpha: 0.65 });
      g.rect(cx + 2, cy + 1, 2, 7).fill({ color: 0xffffff, alpha: 0.65 });
      iconContainer.addChild(g);
    }

    return iconContainer;
  }

  private updateButtonStyles(): void {
    for (const widget of this.buttonWidgets) {
      this.drawSingleButton(widget);
    }
  }

  private drawSingleButton(widget: ButtonWidget): void {
    const isSelected = widget.brush === this.activeBrush;
    const { bg, textNode, w, h, isHovered } = widget;

    bg.clear();

    if (isSelected) {
      bg.roundRect(0, 0, w, h, 8)
        .fill({ color: 0x5e4400, alpha: 0.95 })
        .roundRect(0, 0, w, h, 8)
        .stroke({ width: 2, color: 0xffd700, alpha: 0.9 });

      textNode.style.fill = 0xfffae6;
      textNode.style.fontWeight = '700';
    } else if (isHovered) {
      bg.roundRect(0, 0, w, h, 8)
        .fill({ color: 0x3d3254, alpha: 0.9 })
        .roundRect(0, 0, w, h, 8)
        .stroke({ width: 1, color: 0x9b84c7, alpha: 0.7 });

      textNode.style.fill = 0xffffff;
      textNode.style.fontWeight = '600';
    } else if (widget.brush === 'clear-scene') {
      bg.roundRect(0, 0, w, h, 8)
        .fill({ color: isHovered ? 0x4a1820 : 0x2d1016, alpha: 0.88 })
        .roundRect(0, 0, w, h, 8)
        .stroke({ width: 1, color: 0xd32f2f, alpha: 0.7 });

      textNode.style.fill = isHovered ? 0xffcdd2 : 0xef9a9a;
      textNode.style.fontWeight = '600';
    } else {
      bg.roundRect(0, 0, w, h, 8)
        .fill({ color: 0x221a2e, alpha: 0.75 })
        .roundRect(0, 0, w, h, 8)
        .stroke({ width: 1, color: 0x4a3d61, alpha: 0.4 });

      textNode.style.fill = 0xb8b0c8;
      textNode.style.fontWeight = '500';
    }
  }
}
