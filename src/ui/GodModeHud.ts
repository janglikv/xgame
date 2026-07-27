import { Container, Graphics, Text } from 'pixi.js';

export type GodBrush =
  | 'harvest'
  | 'pine'
  | 'spider'
  | 'flame-flower'
  | 'wooden-dummy'
  | 'spawn'
  | 'erase';

const BRUSH_LABEL: Record<GodBrush, string> = {
  harvest: '1 可砍树',
  pine: '2 松树',
  spider: '3 蜘蛛',
  'flame-flower': '4 火焰花',
  'wooden-dummy': '5 木桩',
  spawn: '6 出生点',
  erase: '7 删除',
};

/**
 * 上帝模式顶栏提示。
 */
export class GodModeHud extends Container {
  private readonly bg: Graphics;
  private readonly title: Text;
  private readonly detail: Text;

  constructor() {
    super();
    this.label = 'GodModeHud';
    this.visible = false;
    this.eventMode = 'none';

    this.bg = new Graphics();
    this.addChild(this.bg);

    this.title = new Text({
      text: '上帝模式',
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 18,
        fontWeight: '700',
        fill: 0xffe08a,
      },
    });
    this.title.anchor.set(0.5, 0);
    this.addChild(this.title);

    this.detail = new Text({
      text: '',
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 13,
        fill: 0xe8f0ff,
        align: 'center',
      },
    });
    this.detail.anchor.set(0.5, 0);
    this.addChild(this.detail);
  }

  setBrush(brush: GodBrush): void {
    const keys = Object.entries(BRUSH_LABEL)
      .map(([k, v]) => (k === brush ? `【${v}】` : v))
      .join('  ');
    this.detail.text =
      `${keys}\n点击陆地放置 · G 退出 · 自动保存草稿 · 无视碰撞`;
  }

  layout(width: number, _height: number): void {
    const panelW = Math.min(720, width - 24);
    const panelH = 64;
    const x = (width - panelW) / 2;
    const y = 12;

    this.bg
      .clear()
      .roundRect(x, y, panelW, panelH, 12)
      .fill({ color: 0x1a1420, alpha: 0.88 })
      .roundRect(x, y, panelW, panelH, 12)
      .stroke({ width: 1.5, color: 0xe8b84a, alpha: 0.55 });

    this.title.position.set(width / 2, y + 8);
    this.detail.position.set(width / 2, y + 30);
  }
}
