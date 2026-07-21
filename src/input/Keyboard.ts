/**
 * 跟踪键盘按键状态（WASD / 方向键）。
 */
export class Keyboard {
  private readonly down = new Set<string>();
  private bound = false;

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    this.down.add(e.code);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };

  private readonly onBlur = (): void => {
    this.down.clear();
  };

  bind(): void {
    if (this.bound) return;
    this.bound = true;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  unbind(): void {
    if (!this.bound) return;
    this.bound = false;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.down.clear();
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /** 清空当前按键状态（暂停切入时用） */
  clear(): void {
    this.down.clear();
  }

  /** 归一化移动向量，对角线不会更快。 */
  getMoveAxis(): { x: number; y: number } {
    let x = 0;
    let y = 0;

    if (this.isDown('KeyA') || this.isDown('ArrowLeft')) x -= 1;
    if (this.isDown('KeyD') || this.isDown('ArrowRight')) x += 1;
    if (this.isDown('KeyW') || this.isDown('ArrowUp')) y -= 1;
    if (this.isDown('KeyS') || this.isDown('ArrowDown')) y += 1;

    if (x !== 0 && y !== 0) {
      const inv = 1 / Math.SQRT2;
      x *= inv;
      y *= inv;
    }

    return { x, y };
  }
}
