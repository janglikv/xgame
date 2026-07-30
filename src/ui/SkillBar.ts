import * as THREE from 'three';

export type SkillSlotId = 'Q' | 'W' | 'E' | 'R';

export interface SkillBarOptions {
  /**
   * 技能键按下（能力尚未实现时也会触发，便于后续接逻辑）。
   * 菜单打开时应由外部决定是否忽略。
   */
  onSkillPress?: (slot: SkillSlotId) => void;
  /** 返回 true 时屏蔽按键（例如 ESC 菜单打开） */
  isInputBlocked?: () => boolean;
}

interface SlotState {
  /** 剩余冷却（秒） */
  cdRemaining: number;
  /** 总冷却（秒，>0 才画 CD） */
  cdTotal: number;
  /** 是否处于选点状态 */
  targeting: boolean;
  /** 槽位是否已实现（未实现画十字） */
  ready: boolean;
  /** 简短技能名（可选） */
  label: string;
}

const SLOTS: SkillSlotId[] = ['Q', 'W', 'E', 'R'];

const KEY_TO_SLOT: Record<string, SkillSlotId> = {
  KeyQ: 'Q',
  KeyW: 'W',
  KeyE: 'E',
  KeyR: 'R',
};

const DEFAULT_SLOT: SlotState = {
  cdRemaining: 0,
  cdTotal: 0,
  targeting: false,
  ready: false,
  label: '',
};

/**
 * 底部技能栏：Q / W / E / R。
 * 与主场景同 canvas 叠加渲染（正交 HUD + Canvas 纹理）。
 */
export class SkillBar {
  private static readonly CANVAS_W = 560;
  private static readonly CANVAS_H = 120;
  /** 面板在 UI 空间中的宽度（屏幕高度为 2 时） */
  private static readonly PANEL_W = 0.92;
  private static readonly PANEL_ASPECT =
    SkillBar.CANVAS_W / SkillBar.CANVAS_H;
  /** 相对屏幕底部的上移量（UI 空间，高度 2） */
  private static readonly BOTTOM_OFFSET = 0.14;

  private readonly uiScene = new THREE.Scene();
  private readonly uiCamera: THREE.OrthographicCamera;
  private readonly panelMesh: THREE.Mesh;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly panelMat: THREE.MeshBasicMaterial;

  private readonly onSkillPress?: (slot: SkillSlotId) => void;
  private readonly isInputBlocked?: () => boolean;

  private readonly onKeyDown: (e: KeyboardEvent) => void;
  private readonly onKeyUp: (e: KeyboardEvent) => void;
  private readonly onBlur: () => void;

  /** 当前按住的技能键 */
  private readonly pressed = new Set<SkillSlotId>();
  private readonly slots: Record<SkillSlotId, SlotState> = {
    Q: { ...DEFAULT_SLOT },
    W: { ...DEFAULT_SLOT },
    E: {
      ...DEFAULT_SLOT,
      ready: true,
      label: '弹雨',
    },
    R: { ...DEFAULT_SLOT },
  };
  private dirty = true;
  private viewW = 1;
  private viewH = 1;

  constructor(options: SkillBarOptions = {}) {
    this.onSkillPress = options.onSkillPress;
    this.isInputBlocked = options.isInputBlocked;

    this.uiCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    this.uiCamera.position.z = 1;

    this.canvas = document.createElement('canvas');
    this.canvas.width = SkillBar.CANVAS_W;
    this.canvas.height = SkillBar.CANVAS_H;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    this.panelMat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    const panelH = SkillBar.PANEL_W / SkillBar.PANEL_ASPECT;
    this.panelMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(SkillBar.PANEL_W, panelH),
      this.panelMat,
    );
    this.panelMesh.name = 'SkillBar';
    this.panelMesh.frustumCulled = false;
    this.panelMesh.renderOrder = 2;
    // 贴在屏幕底部中央
    this.panelMesh.position.set(0, -1 + SkillBar.BOTTOM_OFFSET + panelH / 2, 0);

    this.uiScene.add(this.panelMesh);
    this.redraw();

    this.onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (this.isInputBlocked?.()) return;
      const slot = KEY_TO_SLOT[e.code];
      if (!slot) return;
      e.preventDefault();
      if (this.pressed.has(slot)) return;
      this.pressed.add(slot);
      this.dirty = true;
      this.onSkillPress?.(slot);
    };

    this.onKeyUp = (e: KeyboardEvent) => {
      const slot = KEY_TO_SLOT[e.code];
      if (!slot) return;
      if (!this.pressed.has(slot)) return;
      this.pressed.delete(slot);
      this.dirty = true;
    };

    this.onBlur = () => {
      if (this.pressed.size === 0) return;
      this.pressed.clear();
      this.dirty = true;
    };

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  /** 更新某槽冷却（remaining/total 秒） */
  setCooldown(slot: SkillSlotId, remaining: number, total: number): void {
    const s = this.slots[slot];
    const r = Math.max(0, remaining);
    const t = Math.max(0, total);
    if (
      Math.abs(s.cdRemaining - r) < 0.02 &&
      Math.abs(s.cdTotal - t) < 1e-4
    ) {
      // 冷却显示按 0.1s 刷新，避免每帧全量 redraw
      if (r > 0 && Math.floor(s.cdRemaining * 10) === Math.floor(r * 10)) {
        s.cdRemaining = r;
        return;
      }
      if (r <= 0 && s.cdRemaining <= 0) return;
    }
    s.cdRemaining = r;
    s.cdTotal = t;
    this.dirty = true;
  }

  /** 标记选点中的技能槽 */
  setTargeting(slot: SkillSlotId | null): void {
    let changed = false;
    for (const id of SLOTS) {
      const next = slot === id;
      if (this.slots[id].targeting !== next) {
        this.slots[id].targeting = next;
        changed = true;
      }
    }
    if (changed) this.dirty = true;
  }

  setSize(width: number, height: number): void {
    this.viewW = Math.max(width, 1);
    this.viewH = Math.max(height, 1);
    const aspect = this.viewW / this.viewH;
    this.uiCamera.left = -aspect;
    this.uiCamera.right = aspect;
    this.uiCamera.top = 1;
    this.uiCamera.bottom = -1;
    this.uiCamera.updateProjectionMatrix();
  }

  /** 主场景 / 亮度层之后调用：不清色，只清深度后叠 HUD */
  render(renderer: THREE.WebGLRenderer): void {
    if (this.dirty) this.redraw();

    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.uiScene, this.uiCamera);
    renderer.autoClear = prevAutoClear;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);

    this.panelMesh.geometry.dispose();
    this.panelMat.dispose();
    this.texture.dispose();
  }

  private redraw(): void {
    const { ctx } = this;
    const W = SkillBar.CANVAS_W;
    const H = SkillBar.CANVAS_H;

    ctx.clearRect(0, 0, W, H);

    // 半透明底板
    this.roundRect(8, 8, W - 16, H - 16, 18);
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, 'rgba(22, 32, 48, 0.82)');
    bg.addColorStop(1, 'rgba(10, 14, 22, 0.9)');
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
    ctx.lineWidth = 2;
    ctx.stroke();

    const gap = 14;
    const slotSize = 78;
    const totalSlotsW = SLOTS.length * slotSize + (SLOTS.length - 1) * gap;
    let x = (W - totalSlotsW) / 2;
    const y = (H - slotSize) / 2 + 2;

    for (const slot of SLOTS) {
      this.drawSlot(x, y, slotSize, slot);
      x += slotSize + gap;
    }

    this.texture.needsUpdate = true;
    this.dirty = false;
  }

  private drawSlot(x: number, y: number, size: number, slot: SkillSlotId): void {
    const { ctx } = this;
    const state = this.slots[slot];
    const pressed = this.pressed.has(slot);
    const targeting = state.targeting;
    const onCd = state.cdRemaining > 0.02;

    // 外框
    this.roundRect(x, y, size, size, 12);
    if (targeting) {
      ctx.fillStyle = 'rgba(88, 40, 72, 0.95)';
    } else if (pressed) {
      ctx.fillStyle = 'rgba(37, 72, 120, 0.95)';
    } else {
      ctx.fillStyle = 'rgba(15, 23, 34, 0.88)';
    }
    ctx.fill();
    ctx.strokeStyle = targeting
      ? 'rgba(244, 114, 182, 0.9)'
      : pressed
        ? 'rgba(96, 165, 250, 0.85)'
        : 'rgba(148, 163, 184, 0.35)';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // 内槽
    const inset = 8;
    this.roundRect(x + inset, y + inset, size - inset * 2, size - inset * 2, 8);
    const inner = ctx.createLinearGradient(0, y, 0, y + size);
    if (targeting) {
      inner.addColorStop(0, 'rgba(120, 40, 90, 0.7)');
      inner.addColorStop(1, 'rgba(60, 20, 50, 0.8)');
    } else if (pressed) {
      inner.addColorStop(0, 'rgba(56, 96, 150, 0.55)');
      inner.addColorStop(1, 'rgba(30, 50, 80, 0.7)');
    } else if (state.ready) {
      inner.addColorStop(0, 'rgba(60, 36, 70, 0.7)');
      inner.addColorStop(1, 'rgba(30, 22, 40, 0.8)');
    } else {
      inner.addColorStop(0, 'rgba(30, 42, 60, 0.65)');
      inner.addColorStop(1, 'rgba(18, 26, 38, 0.75)');
    }
    ctx.fillStyle = inner;
    ctx.fill();
    ctx.strokeStyle = 'rgba(71, 85, 105, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const cx = x + size / 2;
    const cy = y + size / 2 - 4;

    if (state.ready && state.label) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = targeting ? '#fbcfe8' : '#f9a8d4';
      ctx.font = '700 16px system-ui, -apple-system, "Segoe UI", sans-serif';
      ctx.fillText(state.label, cx, cy);
    } else {
      // 空技能占位十字
      ctx.strokeStyle = pressed
        ? 'rgba(147, 197, 253, 0.35)'
        : 'rgba(100, 116, 139, 0.28)';
      ctx.lineWidth = 2;
      const arm = 10;
      ctx.beginPath();
      ctx.moveTo(cx - arm, cy);
      ctx.lineTo(cx + arm, cy);
      ctx.moveTo(cx, cy - arm);
      ctx.lineTo(cx, cy + arm);
      ctx.stroke();
    }

    // 冷却遮罩 + 数字
    if (onCd) {
      const frac =
        state.cdTotal > 1e-4
          ? THREE.MathUtils.clamp(state.cdRemaining / state.cdTotal, 0, 1)
          : 1;
      ctx.save();
      this.roundRect(
        x + inset,
        y + inset,
        size - inset * 2,
        size - inset * 2,
        8,
      );
      ctx.clip();
      // 从下往上消退
      const coverH = (size - inset * 2) * frac;
      ctx.fillStyle = 'rgba(8, 12, 20, 0.72)';
      ctx.fillRect(
        x + inset,
        y + inset + (size - inset * 2 - coverH),
        size - inset * 2,
        coverH,
      );
      ctx.restore();

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '700 20px system-ui, -apple-system, "Segoe UI", sans-serif';
      const sec =
        state.cdRemaining >= 10
          ? `${Math.ceil(state.cdRemaining)}`
          : state.cdRemaining.toFixed(1);
      ctx.fillText(sec, cx, cy + 2);
    }

    // 键位标签（右下角小徽章）
    const badgeW = 22;
    const badgeH = 18;
    const bx = x + size - badgeW - 5;
    const by = y + size - badgeH - 5;
    this.roundRect(bx, by, badgeW, badgeH, 5);
    ctx.fillStyle = targeting
      ? 'rgba(219, 39, 119, 0.95)'
      : pressed
        ? 'rgba(59, 130, 246, 0.95)'
        : 'rgba(30, 41, 59, 0.95)';
    ctx.fill();
    ctx.strokeStyle = targeting
      ? 'rgba(251, 207, 232, 0.75)'
      : pressed
        ? 'rgba(147, 197, 253, 0.7)'
        : 'rgba(148, 163, 184, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = pressed || targeting ? '#eff6ff' : '#e2e8f0';
    ctx.font = '700 12px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillText(slot, bx + badgeW / 2, by + badgeH / 2 + 0.5);
  }

  private roundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void {
    const { ctx } = this;
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }
}
