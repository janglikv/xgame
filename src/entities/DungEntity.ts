import { Container, Graphics } from 'pixi.js';

export type DungOptions = {
  dungId?: string;
  nutrient?: number;
  radius?: number;
  onDepleted?: (dung: DungEntity) => void;
};

/**
 * 牛马排泄的天然有机肥料（粑粑）实体。
 * - 拥有 120px 的肥力影响半径。
 * - 允许范围内草的间距缩小为 16px（密度翻 3 倍）。
 * - 每次协助草生长发芽或增加密度，消耗养分，养分尽后自然分解融入土壤。
 */
export class DungEntity extends Container {
  readonly dungId: string;
  readonly radius: number;
  worldX: number;
  worldY: number;

  /** 剩余养分/肥力（默认 100 点，每次助长草消耗 1 点） */
  nutrient: number;
  private maxNutrient: number;
  private isDepleting = false;

  private readonly gfx: Graphics;
  private readonly auraGfx: Graphics;
  private animTime = Math.random() * Math.PI * 2;
  private onDepleted?: (dung: DungEntity) => void;

  constructor(worldX: number, worldY: number, options: DungOptions = {}) {
    super();
    this.worldX = worldX;
    this.worldY = worldY;
    this.dungId = options.dungId ?? `dung_${Math.floor(Math.random() * 1000000)}`;
    this.maxNutrient = options.nutrient ?? 100;
    this.nutrient = this.maxNutrient;
    this.radius = options.radius ?? 120;
    this.onDepleted = options.onDepleted;

    this.position.set(worldX, worldY);

    // 1. 肥力养分光环（微弱的温热黄绿色有机发酵光环）
    this.auraGfx = new Graphics();
    this.auraGfx.label = 'DungAura';
    this.addChild(this.auraGfx);

    // 2. 卡通牛马粑粑主体
    this.gfx = new Graphics();
    this.gfx.label = 'DungGfx';
    this.addChild(this.gfx);

    this.renderDung();
    this.renderAura();
  }

  /** 绘制肥力光环 */
  private renderAura(): void {
    this.auraGfx.clear();
    const alpha01 = Math.max(0.1, this.nutrient / this.maxNutrient);
    // 渐变温热黄绿光环
    this.auraGfx
      .circle(0, 0, this.radius)
      .fill({ color: 0x88cc33, alpha: 0.08 * alpha01 })
      .stroke({ width: 1.5, color: 0xaaee44, alpha: 0.25 * alpha01 });
  }

  /** 绘制可爱生动的矢量牛马粑粑 */
  private renderDung(): void {
    this.gfx.clear();
    const scale = 0.9;
    const strokeBlack = { width: 1.2, color: 0x221100, alpha: 0.9 };

    // 底部投影
    this.gfx.ellipse(0, 3, 10 * scale, 4 * scale).fill({
      color: 0x000000,
      alpha: 0.18,
    });

    // 底层主堆 (深卡其/泥棕色)
    this.gfx
      .circle(-2 * scale, 1 * scale, 6.5 * scale)
      .fill({ color: 0x4a2e15 })
      .stroke(strokeBlack);
    this.gfx
      .circle(3.5 * scale, 1.5 * scale, 5.5 * scale)
      .fill({ color: 0x4a2e15 })
      .stroke(strokeBlack);
    this.gfx
      .circle(0, -1 * scale, 6 * scale)
      .fill({ color: 0x5b3a1a })
      .stroke(strokeBlack);

    // 中层小卷堆
    this.gfx
      .circle(0, -5 * scale, 4.5 * scale)
      .fill({ color: 0x6e4720 })
      .stroke(strokeBlack);

    // 顶尖卷
    this.gfx
      .circle(0, -8.5 * scale, 2.5 * scale)
      .fill({ color: 0x825528 })
      .stroke(strokeBlack);

    // 几粒细微发酵有机亮斑点
    this.gfx.circle(-1.5 * scale, -2 * scale, 1 * scale).fill({ color: 0xa87438, alpha: 0.8 });
    this.gfx.circle(2 * scale, -6 * scale, 0.8 * scale).fill({ color: 0xa87438, alpha: 0.8 });
  }

  /** 消耗养分（每次助长新草或加速消耗 1 点） */
  consumeNutrient(amount = 1): boolean {
    if (this.isDepleting) return false;
    this.nutrient = Math.max(0, this.nutrient - amount);
    this.renderAura();

    if (this.nutrient <= 0) {
      this.isDepleting = true;
      this.onDepleted?.(this);
    }
    return true;
  }

  update(deltaMS: number): void {
    const dt = deltaMS / 1000;
    this.animTime += dt;

    // 轻微呼吸浮动光环
    const pulse = Math.sin(this.animTime * 2) * 0.04;
    this.auraGfx.scale.set(1 + pulse);

    // 消耗殆尽渐隐
    if (this.isDepleting) {
      this.alpha = Math.max(0, this.alpha - dt * 1.5);
    }
  }

  syncToWorld(): void {
    this.position.set(this.worldX, this.worldY);
  }
}
