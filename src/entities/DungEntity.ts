import { Container } from 'pixi.js';

export type DungOptions = {
  dungId?: string;
  nutrient?: number;
  radius?: number;
  onDepleted?: (dung: DungEntity) => void;
};

/**
 * 牛马排泄的天然有机肥料（隐形肥力节点）。
 * - 拥有 120px 的隐形肥力影响半径。
 * - 允许范围内草的间距缩小为 16px（密度翻 3 倍）且不易老死。
 * - 每次协助草生长发芽或增加密度，消耗养分，养分耗尽后自然消失。
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
  }

  /** 消耗养分（每次助长新草或加速消耗 1 点） */
  consumeNutrient(amount = 1): boolean {
    if (this.isDepleting) return false;
    this.nutrient = Math.max(0, this.nutrient - amount);

    if (this.nutrient <= 0) {
      this.isDepleting = true;
      this.onDepleted?.(this);
    }
    return true;
  }

  update(deltaMS: number): void {
    const dt = deltaMS / 1000;
    if (this.isDepleting) {
      this.alpha = Math.max(0, this.alpha - dt * 1.5);
    }
  }

  syncToWorld(): void {
    this.position.set(this.worldX, this.worldY);
  }
}
