import { Container, Graphics, Sprite } from 'pixi.js';

export type BaseProjectilePhase = 'flying' | 'holding' | 'stuck' | 'blast' | 'exploding' | 'done';

/**
 * 投射物基础组件/抽象类：统一管理世界坐标、图形精灵与阴影挂载、步进生命周期。
 */
export abstract class BaseProjectile extends Container {
  public worldX = 0;
  public worldY = 0;
  public phase: BaseProjectilePhase = 'flying';

  protected readonly sprite: Sprite;
  protected readonly shadowG: Graphics;

  constructor(label: string) {
    super();
    this.label = label;

    this.shadowG = new Graphics();
    this.shadowG.label = `${label}Shadow`;
    this.addChild(this.shadowG);

    this.sprite = new Sprite();
    this.sprite.label = `${label}Sprite`;
    this.addChild(this.sprite);
  }

  /** 判定投射物生命周期是否完全结束 */
  public get isFinished(): boolean {
    return this.phase === 'done';
  }

  /** 设置/更新物理世界坐标并同步 Pixi 容器位置 */
  public setPosition(x: number, y: number): void {
    this.worldX = x;
    this.worldY = y;
    this.position.set(x, y);
  }

  /**
   * 基础每帧更新（派生类实现具体的逻辑运动）
   */
  public abstract update(dt: number): void;
}
