import { Assets, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { drawPineLocal } from '../world/PineTree';

export type GodBrush =
  | 'tree-sapling'
  | 'tree-medium'
  | 'tree-large'
  | 'spider'
  | 'flame-flower'
  | 'wooden-dummy'
  | 'spawn'
  | 'erase';

export interface GodModeHudOptions {
  onSelectBrush?: (brush: GodBrush) => void;
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

/**
 * 右侧悬浮可交互上帝模式面板（支持按版本折叠与游戏原生素材渲染）
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
        { brush: 'wooden-dummy', label: '训练木桩' },
      ],
    },
    {
      id: 'v1.2',
      version: 'v1.2',
      name: '调试工具',
      collapsed: false,
      items: [
        { brush: 'spawn', label: '出生点标记' },
        { brush: 'erase', label: '删除物体' },
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

    // 面板背景（底色）
    this.bg = new Graphics();
    this.bg.eventMode = 'static';
    this.bg.on('pointertap', (e) => e.stopPropagation());
    this.addChild(this.bg);

    // 头部区域
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

    // 底部提示
    this.tipText = new Text({
      text: '点击地图放置 · G 键退出',
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 11,
        fill: 0x90a4ae,
      },
    });
    this.addChild(this.tipText);

    // 分类与按钮容器
    this.groupsContainer = new Container();
    this.addChild(this.groupsContainer);

    // 面板置顶金色边框（防止被内部子图形/背景遮挡）
    this.borderOverlay = new Graphics();
    this.borderOverlay.eventMode = 'none';
    this.addChild(this.borderOverlay);

    this.rebuildUI();
  }

  setBrush(brush: GodBrush): void {
    this.activeBrush = brush;
    this.updateButtonStyles();
  }

  /**
   * 判断屏幕坐标点 (x, y) 是否落在右侧面板边界内
   */
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
    const panelW = 230; // 靠右面板固定宽度
    const padding = 8;
    const innerW = panelW - padding * 2;

    this.buttonWidgets = [];
    this.categoryWidgets = [];
    this.groupsContainer.removeChildren();

    const startX = screenW - panelW - 20;
    const startY = 20;

    // 头部布局（在内衬区域中）
    this.headerBg
      .clear()
      .roundRect(0, 0, innerW, 34, 6)
      .fill({ color: 0x251e33, alpha: 0.95 });

    this.titleText.position.set(10, 8);
    this.foldMainBtnText.position.set(innerW - 66, 9);
    this.headerContainer.position.set(startX + padding, startY + padding);

    let currentY = startY + padding + 38;

    if (!this.isMainCollapsed) {
      // 渲染各个版本分类组
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

        // 如果未折叠，渲染该组下的物品选项
        if (!group.collapsed) {
          const btnW = innerW;
          const btnH = 40;
          const gapY = 5;

          for (const item of group.items) {
            const btnContainer = new Container();
            btnContainer.eventMode = 'static';
            btnContainer.cursor = 'pointer';
            btnContainer.position.set(startX + padding, currentY);

            const btnBg = new Graphics();
            btnBg.eventMode = 'static';
            btnContainer.addChild(btnBg);

            // 渲染游戏真实素材/图标 preview
            const previewIcon = this.createPreviewIcon(item.brush);
            previewIcon.position.set(5, 4);
            btnContainer.addChild(previewIcon);

            // 名称文本
            const btnTextNode = new Text({
              text: item.label,
              style: {
                fontFamily: 'system-ui, sans-serif',
                fontSize: 13,
                fontWeight: '600',
                fill: 0xcccccc,
              },
            });
            btnTextNode.position.set(44, 11);
            btnContainer.addChild(btnTextNode);

            const widget: ButtonWidget = {
              container: btnContainer,
              bg: btnBg,
              textNode: btnTextNode,
              brush: item.brush,
              w: btnW,
              h: btnH,
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
              this.activeBrush = item.brush;
              this.updateButtonStyles();
              this.onSelectBrush?.(item.brush);
            });

            this.buttonWidgets.push(widget);
            this.groupsContainer.addChild(btnContainer);

            currentY += btnH + gapY;
          }
          currentY += 2;
        }
      }
    }

    // 绘制底部提示文字
    this.tipText.position.set(startX + padding + 6, currentY + 4);
    const totalH = currentY + 24 - startY;

    // 1. 绘制面板底层底色
    this.bg
      .clear()
      .roundRect(startX, startY, panelW, totalH, 12)
      .fill({ color: 0x120d1a, alpha: 0.93 });

    // 2. 绘制最上层置顶的立体金框（包含发光/描边，避免任何子组件遮盖）
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

  /**
   * 使用游戏中的原始素材/绘图逻辑渲染目标 Icon 预览
   */
  private createPreviewIcon(brush: GodBrush): Container {
    const iconContainer = new Container();

    // Icon 背景框
    const iconBg = new Graphics();
    iconBg
      .roundRect(0, 0, 32, 32, 6)
      .fill({ color: 0x181224, alpha: 0.9 })
      .roundRect(0, 0, 32, 32, 6)
      .stroke({ width: 1, color: 0x483a63, alpha: 0.5 });
    iconContainer.addChild(iconBg);

    if (
      brush === 'tree-sapling' ||
      brush === 'tree-medium' ||
      brush === 'tree-large'
    ) {
      const treeGfx = new Graphics();
      drawPineLocal(treeGfx, 0, 0, 0);
      treeGfx.position.set(16, 27);
      // 图标内用不同缩放区分体型
      const iconScale =
        brush === 'tree-sapling' ? 0.2 : brush === 'tree-large' ? 0.48 : 0.3;
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
        .circle(25, 25, 5.5)
        .fill({ color: badgeColor })
        .stroke({ width: 1, color: 0xffffff });
      iconContainer.addChild(badge);
    } else if (
      brush === 'spider' ||
      brush === 'flame-flower' ||
      brush === 'wooden-dummy'
    ) {
      const urlMap: Record<string, string> = {
        spider: '/assets/spider/spider.png',
        'flame-flower': '/assets/flame-flower/flame-flower.png',
        'wooden-dummy': '/assets/wooden-dummy/wooden-dummy.png',
      };
      const url = urlMap[brush];
      if (url) {
        const sprite = new Sprite();
        sprite.anchor.set(0.5);
        sprite.position.set(16, 16);
        iconContainer.addChild(sprite);

        void Assets.load<Texture>(url).then((tex) => {
          if (tex) {
            sprite.texture = tex;
            const maxDim = Math.max(tex.width, tex.height);
            const s = maxDim > 0 ? 25 / maxDim : 1;
            sprite.scale.set(s);
          }
        });
      }
    } else if (brush === 'spawn') {
      const g = new Graphics();
      g.circle(16, 16, 10).stroke({ width: 1.5, color: 0x4caf50 });
      g.circle(16, 16, 4).fill({ color: 0x81c784 });
      g.poly([16, 6, 22, 16, 10, 16]).fill({ color: 0xffeb3b });
      iconContainer.addChild(g);
    } else if (brush === 'erase') {
      const g = new Graphics();
      g.circle(16, 16, 10).stroke({ width: 2, color: 0xef5350 });
      g.moveTo(9, 9).lineTo(23, 23).stroke({ width: 2, color: 0xef5350 });
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
      bg.roundRect(0, 0, w, h, 6)
        .fill({ color: 0x5e4400, alpha: 0.95 })
        .roundRect(0, 0, w, h, 6)
        .stroke({ width: 2, color: 0xffd700, alpha: 0.9 });

      textNode.style.fill = 0xfffae6;
      textNode.style.fontWeight = '700';
    } else if (isHovered) {
      bg.roundRect(0, 0, w, h, 6)
        .fill({ color: 0x3d3254, alpha: 0.9 })
        .roundRect(0, 0, w, h, 6)
        .stroke({ width: 1, color: 0x9b84c7, alpha: 0.7 });

      textNode.style.fill = 0xffffff;
      textNode.style.fontWeight = '600';
    } else {
      bg.roundRect(0, 0, w, h, 6)
        .fill({ color: 0x221a2e, alpha: 0.75 })
        .roundRect(0, 0, w, h, 6)
        .stroke({ width: 1, color: 0x4a3d61, alpha: 0.4 });

      textNode.style.fill = 0xb8b0c8;
      textNode.style.fontWeight = '500';
    }
  }
}
