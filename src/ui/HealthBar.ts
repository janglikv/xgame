import { Container, Graphics } from 'pixi.js';

export type HealthBarOptions = {
  maxHp?: number;
  width?: number;
  height?: number;
};

/**
 * 头顶血条：深色底 + 绿色填充 + 细边框。
 * 不跟角色一起翻转，适合作为角色 sibling 挂在头顶。
 */
export class HealthBar extends Container {
  private readonly track: Graphics;
  private readonly fill: Graphics;
  private readonly frame: Graphics;

  private readonly barWidth: number;
  private readonly barHeight: number;
  private maxHp: number;
  private hp: number;
  /** 显示用比例，可平滑追赶真实血量 */
  private displayRatio = 1;

  constructor(options: HealthBarOptions = {}) {
    super();
    this.label = 'HealthBar';
    this.eventMode = 'none';

    this.barWidth = options.width ?? 52;
    this.barHeight = options.height ?? 7;
    this.maxHp = options.maxHp ?? 100;
    this.hp = this.maxHp;

    this.track = new Graphics();
    this.fill = new Graphics();
    this.frame = new Graphics();
    this.addChild(this.track, this.fill, this.frame);

    this.paintTrack();
    this.paintFrame();
    this.paintFill(1);
  }

  get currentHp(): number {
    return this.hp;
  }

  get maximumHp(): number {
    return this.maxHp;
  }

  /** 设置当前 / 最大生命（会钳到合法范围） */
  setHealth(hp: number, maxHp?: number): void {
    if (maxHp !== undefined && maxHp > 0) {
      this.maxHp = maxHp;
    }
    this.hp = Math.max(0, Math.min(this.maxHp, hp));
    this.paintFill(this.hp / this.maxHp);
    this.displayRatio = this.hp / this.maxHp;
  }

  /** 立即扣 / 加血 */
  applyDelta(delta: number): void {
    this.setHealth(this.hp + delta);
  }

  /**
   * 可选：平滑过渡填充宽度。
   * 目前直接同步，保留接口方便以后受伤闪一下。
   */
  update(_deltaMS: number): void {
    const target = this.maxHp > 0 ? this.hp / this.maxHp : 0;
    if (Math.abs(this.displayRatio - target) < 0.001) {
      this.displayRatio = target;
      return;
    }
    const k = 1 - Math.exp(-14 * (_deltaMS / 1000));
    this.displayRatio += (target - this.displayRatio) * k;
    this.paintFill(this.displayRatio);
  }

  private paintTrack(): void {
    const w = this.barWidth;
    const h = this.barHeight;
    // 以中心为原点，便于钉在头顶
    this.track
      .clear()
      .roundRect(-w / 2, -h / 2, w, h, 3)
      .fill({ color: 0x1a1a1a, alpha: 0.75 });
  }

  private paintFrame(): void {
    const w = this.barWidth;
    const h = this.barHeight;
    this.frame
      .clear()
      .roundRect(-w / 2, -h / 2, w, h, 3)
      .stroke({ width: 1, color: 0xffffff, alpha: 0.35 });
  }

  private paintFill(ratio: number): void {
    const r = Math.max(0, Math.min(1, ratio));
    const w = this.barWidth;
    const h = this.barHeight;
    const pad = 1;
    const innerW = Math.max(0, (w - pad * 2) * r);
    const innerH = h - pad * 2;
    const x0 = -w / 2 + pad;
    const y0 = -h / 2 + pad;

    this.fill.clear();
    if (innerW <= 0.5) return;

    // 高血绿 → 中血黄 → 低血红
    const color = r > 0.5 ? 0x4caf50 : r > 0.25 ? 0xe6b422 : 0xe53935;

    this.fill
      .roundRect(x0, y0, innerW, innerH, 2)
      .fill({ color, alpha: 0.95 });
  }
}
