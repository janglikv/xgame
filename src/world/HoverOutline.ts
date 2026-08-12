import {
  Color3,
  SelectionOutlineLayer,
  type AbstractMesh,
  type Node,
  type Scene,
} from '@babylonjs/core';
import type { Minion } from './Minion';

/** 悬停外轮廓：深红（与旧 Three OutlinePass 一致） */
const OUTLINE_COLOR = Color3.FromHexString('#8B0000');
const OUTLINE_THICKNESS = 2.2;

/**
 * 鼠标悬停目标：屏幕空间整体轮廓高亮。
 * - 只描 bodyRoot 下的模型（不含脚底阵法 / 物理代理）
 * - 同一目标多 mesh 作为一组，外轮廓连成整体
 */
export class HoverOutline {
  private readonly layer: SelectionOutlineLayer;
  private readonly minions: Minion[] = [];
  private hovered: Minion | null = null;
  private enabled = true;

  constructor(scene: Scene) {
    this.layer = new SelectionOutlineLayer('hoverOutline', scene, {
      // 略提高主 RT 清晰度，细描边更干净
      mainTextureRatio: 1,
    });
    this.layer.outlineColor = OUTLINE_COLOR;
    this.layer.outlineThickness = OUTLINE_THICKNESS;
    // 被遮挡部分仍隐约可见，类似旧 OutlinePass hiddenEdge
    this.layer.occlusionStrength = 0.55;
    this.layer.occlusionThreshold = 0.01;
  }

  /** 注册可悬停描边的小兵（展示阵列目标） */
  registerMinions(minions: readonly Minion[]): void {
    for (const m of minions) {
      if (this.minions.includes(m)) continue;
      this.minions.push(m);
    }
  }

  setEnabled(on: boolean): void {
    if (this.enabled === on) return;
    this.enabled = on;
    if (!on) this.clear();
  }

  /**
   * 用场景当前指针射线拾取并同步轮廓。
   * 应在 pointermove / 每帧（目标可能被推走）调用。
   */
  updateFromScenePick(scene: Scene): void {
    if (!this.enabled || this.minions.length === 0) {
      this.clear();
      return;
    }

    const pick = scene.pick(
      scene.pointerX,
      scene.pointerY,
      (mesh) => this.isPickableOutlineMesh(mesh),
      false,
    );

    const next =
      pick?.hit && pick.pickedMesh
        ? this.resolveMinion(pick.pickedMesh)
        : null;
    this.setHovered(next);
  }

  /** 指针离开画布或打开菜单时清除 */
  clear(): void {
    this.setHovered(null);
  }

  getHovered(): Minion | null {
    return this.hovered;
  }

  /**
   * 外观替换后 mesh 列表变化时调用：
   * 若仍悬停同一单位，重新收集 bodyRoot 子 mesh 进描边层。
   */
  refreshSelection(): void {
    if (!this.hovered) return;
    const m = this.hovered;
    this.hovered = null;
    this.setHovered(m);
  }

  dispose(): void {
    this.clear();
    this.layer.dispose();
    this.minions.length = 0;
  }

  private setHovered(minion: Minion | null): void {
    if (this.hovered === minion) return;
    this.hovered = minion;
    this.layer.clearSelection();
    if (!minion) return;

    const meshes = minion.bodyRoot.getChildMeshes(false);
    if (meshes.length === 0) return;
    // 数组 → 作为单一整体外轮廓，而非零件级各自描边
    this.layer.addSelection(meshes);
  }

  private isPickableOutlineMesh(mesh: AbstractMesh): boolean {
    if (!mesh.isEnabled() || !mesh.isVisible) return false;
    // 物理代理等已 isPickable=false；这里再保险过滤
    if (!mesh.isPickable) return false;
    return this.resolveMinion(mesh) !== null;
  }

  private resolveMinion(mesh: AbstractMesh): Minion | null {
    let node: Node | null = mesh;
    while (node) {
      for (const m of this.minions) {
        if (node === m.bodyRoot || node === m.root) return m;
      }
      node = node.parent;
    }
    return null;
  }
}
