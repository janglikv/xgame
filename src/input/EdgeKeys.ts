/**
 * 边沿检测：本帧按下且上一帧未按下。
 * 每帧对关心的键调用 pressed() 即可推进状态。
 */
export class EdgeKeys {
  private readonly wasDown = new Map<string, boolean>();

  /** 上升沿（刚按下） */
  pressed(code: string, isDown: boolean): boolean {
    const was = this.wasDown.get(code) ?? false;
    this.wasDown.set(code, isDown);
    return isDown && !was;
  }

  /** 强制清零（暂停切入等，避免松手前连触发） */
  clear(): void {
    this.wasDown.clear();
  }
}
