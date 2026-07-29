import { Container } from 'pixi.js';

/**
 * 关卡世界图层：草/屏外树 → 身后树 → 角色与近 Y 树 → 身前树。
 */
export class LevelWorldLayers {
  readonly worldRoot: Container;
  /** 全景/屏外草 + 屏外树：不参与角色每帧 z 排序 */
  readonly grassFarLayer: Container;
  /** 树在角色身后（worldY 偏小） */
  readonly treeBackLayer: Container;
  /** 角色与近 Y 树 */
  readonly sortLayer: Container;
  /** 树在角色身前（worldY 偏大） */
  readonly treeFrontLayer: Container;

  constructor() {
    this.worldRoot = new Container();
    this.worldRoot.label = 'WorldRoot';

    this.grassFarLayer = LevelWorldLayers.makeLayer('GrassFarLayer');
    this.treeBackLayer = LevelWorldLayers.makeLayer('TreeBackLayer');
    this.sortLayer = LevelWorldLayers.makeLayer('SortLayer');
    this.treeFrontLayer = LevelWorldLayers.makeLayer('TreeFrontLayer');

    this.worldRoot.addChild(
      this.grassFarLayer,
      this.treeBackLayer,
      this.sortLayer,
      this.treeFrontLayer,
    );
  }

  /** 只排角色层：草已不在此层，树大部分在前后静态带 */
  sortDepth(): void {
    this.sortLayer.sortChildren();
  }

  /** 前后树带：节点少，保证树与树之间遮挡正确 */
  sortTreeBands(): void {
    this.treeBackLayer.sortChildren();
    this.treeFrontLayer.sortChildren();
  }

  private static makeLayer(label: string): Container {
    const layer = new Container();
    layer.label = label;
    layer.sortableChildren = true;
    layer.eventMode = 'none';
    return layer;
  }
}
