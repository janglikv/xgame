import {
  clearBodyProfileOverride,
  cloneShape,
  getBodyProfile,
  setBodyProfileOverride,
  type BodyProfile,
  type BodyProfileId,
  type BodyShape,
  type CircleShape,
  type RectShape,
} from '../data/bodyProfiles';

/** 编辑层：碰撞体 与 受击体 分开 */
export type ColliderEditPart = 'solid' | 'hurt';

export type ColliderHandleKind = 'center' | 'size';

export type ColliderDragState = {
  profileId: BodyProfileId;
  part: ColliderEditPart;
  index: number;
  handle: ColliderHandleKind;
  startWorldX: number;
  startWorldY: number;
  startShape: BodyShape;
};

export type SelectableBody = {
  profileId: BodyProfileId;
  worldX: number;
  worldY: number;
  pickPriority?: number;
};

const SIZE_HANDLE_PAD = 12;
const CENTER_HIT_R = 14;
const PICK_PAD = 8;

/**
 * 碰撞/受击体编辑：当前只编辑一层（solid 或 hurt），互不混选。
 */
export class ColliderEditController {
  /** 当前编辑层 */
  editPart: ColliderEditPart = 'solid';
  selectedId: BodyProfileId | null = null;
  /** 当前层内选中的形状下标 */
  selectedIndex: number | null = null;
  private drag: ColliderDragState | null = null;
  anchorX = 0;
  anchorY = 0;

  get isDragging(): boolean {
    return this.drag !== null;
  }

  /** 当前选中形状（层 + 下标） */
  get selectedShape(): { part: ColliderEditPart; index: number } | null {
    if (this.selectedIndex === null) return null;
    return { part: this.editPart, index: this.selectedIndex };
  }

  setEditPart(part: ColliderEditPart): void {
    if (this.editPart === part) return;
    this.editPart = part;
    this.drag = null;
    this.reselectShapeInLayer();
  }

  select(id: BodyProfileId, feetX: number, feetY: number): void {
    this.selectedId = id;
    this.anchorX = feetX;
    this.anchorY = feetY;
    this.drag = null;
    this.reselectShapeInLayer();
  }

  clearSelection(): void {
    this.selectedId = null;
    this.selectedIndex = null;
    this.drag = null;
  }

  syncAnchor(feetX: number, feetY: number): void {
    this.anchorX = feetX;
    this.anchorY = feetY;
  }

  resetSelected(): void {
    if (!this.selectedId) return;
    clearBodyProfileOverride(this.selectedId);
    this.select(this.selectedId, this.anchorX, this.anchorY);
  }

  /** 在当前编辑层追加形状 */
  addShape(kind: 'circle' | 'rect'): void {
    if (!this.selectedId) return;
    const part = this.editPart;
    const profile = getBodyProfile(this.selectedId);
    const next = cloneProfile(profile);
    const list = part === 'solid' ? next.solid : next.hurt;
    const shape: BodyShape =
      kind === 'circle'
        ? {
            type: 'circle',
            ox: 0,
            oy: part === 'hurt' ? -20 : 0,
            r: part === 'solid' ? 16 : 20,
          }
        : {
            type: 'rect',
            ox: 0,
            oy: part === 'hurt' ? -24 : -8,
            w: part === 'solid' ? 28 : 32,
            h: part === 'solid' ? 28 : 48,
          };
    list.push(shape);
    this.selectedIndex = list.length - 1;
    setBodyProfileOverride(next);
  }

  deleteSelectedShape(): void {
    if (!this.selectedId || this.selectedIndex === null) return;
    const profile = getBodyProfile(this.selectedId);
    const next = cloneProfile(profile);
    const list = this.editPart === 'solid' ? next.solid : next.hurt;
    if (list.length <= 0) return;
    list.splice(this.selectedIndex, 1);
    if (list.length === 0) {
      this.selectedIndex = null;
    } else {
      this.selectedIndex = Math.min(this.selectedIndex, list.length - 1);
    }
    setBodyProfileOverride(next);
  }

  onPointerDown(
    worldX: number,
    worldY: number,
    targets: readonly SelectableBody[],
  ): boolean {
    // 1) 当前模板、当前层手柄
    if (this.selectedId) {
      const handle = this.hitHandle(worldX, worldY);
      if (handle) {
        const profile = getBodyProfile(this.selectedId);
        const list =
          this.editPart === 'solid' ? profile.solid : profile.hurt;
        const shape = list[handle.index];
        if (shape) {
          this.selectedIndex = handle.index;
          this.drag = {
            profileId: this.selectedId,
            part: this.editPart,
            index: handle.index,
            handle: handle.kind,
            startWorldX: worldX,
            startWorldY: worldY,
            startShape: cloneShape(shape),
          };
          return true;
        }
      }

      // 2) 点到当前层形状
      const shapeHit = this.hitShapeOnProfile(
        this.selectedId,
        this.anchorX,
        this.anchorY,
        worldX,
        worldY,
      );
      if (shapeHit !== null) {
        this.selectedIndex = shapeHit;
        const profile = getBodyProfile(this.selectedId);
        const list =
          this.editPart === 'solid' ? profile.solid : profile.hurt;
        const shape = list[shapeHit]!;
        this.drag = {
          profileId: this.selectedId,
          part: this.editPart,
          index: shapeHit,
          handle: 'center',
          startWorldX: worldX,
          startWorldY: worldY,
          startShape: cloneShape(shape),
        };
        return true;
      }
    }

    // 3) 换选单位（脚底 / 当前层形状）
    const hit = this.pickTarget(worldX, worldY, targets);
    if (hit) {
      this.select(hit.profileId, hit.worldX, hit.worldY);
      const shapeHit = this.hitShapeOnProfile(
        hit.profileId,
        hit.worldX,
        hit.worldY,
        worldX,
        worldY,
      );
      if (shapeHit !== null) this.selectedIndex = shapeHit;
      return true;
    }

    return false;
  }

  onPointerMove(worldX: number, worldY: number): void {
    if (!this.drag) return;
    const dx = worldX - this.drag.startWorldX;
    const dy = worldY - this.drag.startWorldY;
    const profile = getBodyProfile(this.drag.profileId);
    const next = cloneProfile(profile);
    const list = this.drag.part === 'solid' ? next.solid : next.hurt;
    const start = this.drag.startShape;

    if (this.drag.handle === 'center') {
      list[this.drag.index] = {
        ...start,
        ox: round2(start.ox + dx),
        oy: round2(start.oy + dy),
      };
    } else {
      const cx = this.anchorX + start.ox;
      const cy = this.anchorY + start.oy;
      if (start.type === 'circle') {
        list[this.drag.index] = {
          type: 'circle',
          ox: start.ox,
          oy: start.oy,
          r: clampSize(Math.hypot(worldX - cx, worldY - cy)),
        } satisfies CircleShape;
      } else {
        list[this.drag.index] = {
          type: 'rect',
          ox: start.ox,
          oy: start.oy,
          w: clampSize(Math.abs(worldX - cx) * 2),
          h: clampSize(Math.abs(worldY - cy) * 2),
        } satisfies RectShape;
      }
    }

    setBodyProfileOverride(next);
  }

  onPointerUp(): void {
    this.drag = null;
  }

  private reselectShapeInLayer(): void {
    if (!this.selectedId) {
      this.selectedIndex = null;
      return;
    }
    const p = getBodyProfile(this.selectedId);
    const list = this.editPart === 'solid' ? p.solid : p.hurt;
    this.selectedIndex = list.length > 0 ? 0 : null;
  }

  private layerList(profileId: BodyProfileId): BodyShape[] {
    const p = getBodyProfile(profileId);
    return this.editPart === 'solid' ? p.solid : p.hurt;
  }

  private hitHandle(
    worldX: number,
    worldY: number,
  ): { index: number; kind: ColliderHandleKind } | null {
    if (!this.selectedId) return null;
    const list = this.layerList(this.selectedId);
    const ax = this.anchorX;
    const ay = this.anchorY;

    const order: number[] = [];
    if (this.selectedIndex !== null) order.push(this.selectedIndex);
    for (let i = 0; i < list.length; i++) {
      if (i !== this.selectedIndex) order.push(i);
    }

    for (const index of order) {
      const s = list[index];
      if (!s) continue;
      const cx = ax + s.ox;
      const cy = ay + s.oy;

      if (Math.hypot(worldX - cx, worldY - cy) <= CENTER_HIT_R) {
        return { index, kind: 'center' };
      }

      if (s.type === 'circle') {
        if (
          Math.hypot(worldX - (cx + s.r), worldY - cy) <= SIZE_HANDLE_PAD
        ) {
          return { index, kind: 'size' };
        }
        const d = Math.hypot(worldX - cx, worldY - cy);
        if (Math.abs(d - s.r) <= SIZE_HANDLE_PAD) {
          return { index, kind: 'size' };
        }
      } else {
        const corners = [
          [cx + s.w * 0.5, cy + s.h * 0.5],
          [cx - s.w * 0.5, cy + s.h * 0.5],
          [cx + s.w * 0.5, cy - s.h * 0.5],
          [cx - s.w * 0.5, cy - s.h * 0.5],
        ];
        for (const [hx, hy] of corners) {
          if (Math.hypot(worldX - hx!, worldY - hy!) <= SIZE_HANDLE_PAD) {
            return { index, kind: 'size' };
          }
        }
      }
    }
    return null;
  }

  /** 只测当前编辑层 */
  private hitShapeOnProfile(
    profileId: BodyProfileId,
    feetX: number,
    feetY: number,
    worldX: number,
    worldY: number,
  ): number | null {
    const list = this.layerList(profileId);
    let best: number | null = null;
    let bestD = Infinity;

    for (let i = 0; i < list.length; i++) {
      const s = list[i]!;
      const cx = feetX + s.ox;
      const cy = feetY + s.oy;
      let hit = false;
      const d = Math.hypot(worldX - cx, worldY - cy);
      if (s.type === 'circle') {
        hit = d <= s.r + PICK_PAD;
      } else {
        const hw = s.w * 0.5 + PICK_PAD;
        const hh = s.h * 0.5 + PICK_PAD;
        hit =
          worldX >= cx - hw &&
          worldX <= cx + hw &&
          worldY >= cy - hh &&
          worldY <= cy + hh;
      }
      if (hit && d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  private pickTarget(
    worldX: number,
    worldY: number,
    targets: readonly SelectableBody[],
  ): SelectableBody | null {
    let best: SelectableBody | null = null;
    let bestScore = Infinity;

    for (const t of targets) {
      const shapeIdx = this.hitShapeOnProfile(
        t.profileId,
        t.worldX,
        t.worldY,
        worldX,
        worldY,
      );
      const footD = Math.hypot(worldX - t.worldX, worldY - t.worldY);
      if (shapeIdx === null && footD > 36) continue;

      const dist = shapeIdx !== null ? 0 : footD;
      const score = dist - (t.pickPriority ?? 0) * 0.01;
      if (score < bestScore) {
        bestScore = score;
        best = t;
      }
    }
    return best;
  }
}

function cloneProfile(p: BodyProfile): BodyProfile {
  return {
    id: p.id,
    label: p.label,
    solid: p.solid.map(cloneShape),
    hurt: p.hurt.map(cloneShape),
  };
}

function clampSize(n: number): number {
  return Math.max(6, Math.min(160, round2(n)));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
