import { Container, Graphics, Text } from 'pixi.js';
import type { BombProjectile } from '../entities/BombProjectile';
import type { PlayerCharacterBase } from '../entities/PlayerCharacterBase';
import type { SpearProjectile } from '../entities/SpearProjectile';
import type { Spider } from '../entities/Spider';
import { SPEAR_BODY_R, SPEAR_HIT_R } from '../entities/SpearProjectile';
import { DebugConfig } from '../utils/DebugConfig';



/** Debug 文本样式配置 */
const LABEL_STYLE = {
  fontFamily: 'system-ui, -apple-system, sans-serif',
  fontSize: 11,
  fontWeight: '700',
  fill: 0xffffff,
  stroke: { color: 0x000000, width: 3 },
} as const;

export type DebugRenderWorld = {
  player: PlayerCharacterBase | null;
  spiders: Spider[];
  bombs: ReadonlyArray<BombProjectile>;
  spears: ReadonlyArray<SpearProjectile>;
};

/**
 * 受击体（Hurtbox）与碰撞体（Solid Collider）Debug 绘制层。
 * 挂载在 worldRoot 最顶端，统一使用世界坐标系绘制。
 */
export class DebugOverlay extends Container {
  private readonly gfx: Graphics;
  private readonly labelContainer: Container;
  private readonly labelPool: Text[] = [];
  private activeLabelCount = 0;

  constructor() {
    super();
    this.label = 'DebugOverlay';
    this.eventMode = 'none';

    this.gfx = new Graphics();
    this.gfx.label = 'DebugGraphics';
    this.addChild(this.gfx);

    this.labelContainer = new Container();
    this.labelContainer.label = 'DebugLabels';
    this.addChild(this.labelContainer);
  }

  /**
   * 每帧更新 Debug 绘制
   */
  update(world: DebugRenderWorld): void {
    const enabled = DebugConfig.isDebugEnabled();
    if (!enabled) {
      if (this.visible) {
        this.visible = false;
        this.gfx.clear();
        this.resetLabels();
      }
      return;
    }

    this.visible = true;
    this.gfx.clear();
    this.resetLabels();

    // 1. 绘制蜘蛛 Solid / Hurtbox / Hitbox
    for (const spider of world.spiders) {
      if (!spider.isAlive) continue;
      this.drawSpider(spider);
    }

    // 2. 绘制玩家 Solid / Hurtbox
    if (world.player) {
      this.drawPlayer(world.player);
    }

    // 3. 绘制投射物：炸弹爆炸范围与落点
    for (const bomb of world.bombs) {
      this.drawBomb(bomb);
    }

    // 4. 绘制投射物：长矛 Solid & Hitbox
    for (const spear of world.spears) {
      this.drawSpear(spear);
    }
  }



  /** 绘制玩家碰撞体、受击体与标签 */
  private drawPlayer(player: PlayerCharacterBase): void {
    const x = player.worldX;
    const y = player.worldY;

    // A. 碰撞体 Solid Circle: 亮绿
    this.gfx
      .circle(x, y, player.bodyR)
      .fill({ color: 0x00ff66, alpha: 0.16 })
      .stroke({ width: 2.5, color: 0x00ff66, alpha: 0.95 });

    // B. 受击体 Hurtbox Circle: 金黄
    this.gfx
      .circle(x, y, player.hurtR)
      .fill({ color: 0xffea00, alpha: 0.14 })
      .stroke({ width: 2, color: 0xffea00, alpha: 0.9 });

    // 脚底中心十字符号
    this.drawCross(x, y, 6, 0x00ff66, 1);

    // 绘制标签 (放置在脚底上方 75 像素)
    const labelText = `[玩家] Solid:R${player.bodyR} | Hurt:R${player.hurtR}`;
    this.addLabel(x, y - 75, labelText, 0x00ff66);
  }

  /** 绘制蜘蛛碰撞体、受击体、攻击范围与标签 */
  private drawSpider(spider: Spider): void {
    const x = spider.worldX;
    const y = spider.worldY;

    // A. 碰撞体 Solid Circle: 青蓝
    this.gfx
      .circle(x, y, spider.bodyR)
      .fill({ color: 0x00e5ff, alpha: 0.16 })
      .stroke({ width: 2, color: 0x00e5ff, alpha: 0.9 });

    // B. 受击体 Hurtbox Circle: 鲜橙
    this.gfx
      .circle(x, y, spider.hurtR)
      .fill({ color: 0xff9100, alpha: 0.14 })
      .stroke({ width: 2, color: 0xff9100, alpha: 0.9 });

    // C. 攻击范围 Hitbox Circle: 如果处于扑咬攻击中，高亮显示
    if (spider.isAttacking) {
      this.gfx
        .circle(x, y, spider.attackHitR)
        .fill({ color: 0xff0055, alpha: 0.25 })
        .stroke({ width: 3, color: 0xff0055, alpha: 1.0 });
    }

    // 脚底中心十字符号
    this.drawCross(x, y, 5, 0x00e5ff, 0.9);

    // 绘制标签
    const name =
      spider.label === 'WoodenDummy'
        ? '木桩'
        : spider.label === 'FlameFlower'
          ? '火焰花'
          : '蜘蛛';
    const hpStr = spider.invincible
      ? '无敌'
      : `HP:${Math.ceil(spider.currentHp)}`;
    const labelText = `[${name}] ${hpStr} | Solid:R${spider.bodyR} | Hurt:R${spider.hurtR}`;
    this.addLabel(x, y - 48, labelText, 0xff9100);
  }

  /** 绘制炸弹爆心、轨迹与 Blast 半径 */
  private drawBomb(bomb: BombProjectile): void {
    const gx = bomb.groundX;
    const gy = bomb.groundY;
    const radius = bomb.blast.radius;

    // A. 爆炸伤害半径大圈 Blast Radius: 红色
    this.gfx
      .circle(gx, gy, radius)
      .fill({ color: 0xff0033, alpha: 0.12 })
      .stroke({ width: 2, color: 0xff0033, alpha: 0.85 });

    // B. 落点 / 爆心十字标记
    this.drawCross(gx, gy, 8, 0xff0033, 1);

    // C. 标签
    const labelText = `[炸弹] 爆破半径:R${Math.round(radius)} | 伤害:${bomb.blast.maxDamage}`;
    this.addLabel(gx, gy - radius - 12, labelText, 0xff3366);
  }

  /** 绘制长矛 Solid 与 Hitbox */
  private drawSpear(spear: SpearProjectile): void {
    const gx = spear.groundX;
    const gy = spear.groundY;

    // A. 长矛 Solid 圆: 青色
    this.gfx
      .circle(gx, gy, SPEAR_BODY_R)
      .fill({ color: 0x00ffff, alpha: 0.18 })
      .stroke({ width: 1.5, color: 0x00ffff, alpha: 0.9 });

    // B. 长矛 Hitbox 命中圆: 品红
    this.gfx
      .circle(gx, gy, SPEAR_HIT_R)
      .fill({ color: 0xff00ff, alpha: 0.16 })
      .stroke({ width: 2, color: 0xff00ff, alpha: 0.9 });

    // C. 矛尖方向点
    this.drawCross(gx, gy, 4, 0xff00ff, 1);

    // D. 标签
    this.addLabel(gx, gy - 20, `[矛] Hit:R${SPEAR_HIT_R}`, 0xff00ff);
  }

  /** 绘制中心十字符号 */
  private drawCross(
    cx: number,
    cy: number,
    size: number,
    color: number,
    alpha: number,
  ): void {
    this.gfx
      .moveTo(cx - size, cy)
      .lineTo(cx + size, cy)
      .stroke({ width: 1.5, color, alpha })
      .moveTo(cx, cy - size)
      .lineTo(cx, cy + size)
      .stroke({ width: 1.5, color, alpha });
  }

  /** 获取或复用 Label Text */
  private addLabel(
    x: number,
    y: number,
    content: string,
    color: number,
  ): void {
    let labelText: Text;
    if (this.activeLabelCount < this.labelPool.length) {
      labelText = this.labelPool[this.activeLabelCount]!;
    } else {
      labelText = new Text({
        text: '',
        style: { ...LABEL_STYLE },
      });
      labelText.anchor.set(0.5, 0.5);
      this.labelContainer.addChild(labelText);
      this.labelPool.push(labelText);
    }
    this.activeLabelCount++;

    labelText.text = content;
    labelText.style.fill = color;
    labelText.position.set(x, y);
    labelText.visible = true;
  }

  private resetLabels(): void {
    for (let i = 0; i < this.labelPool.length; i++) {
      this.labelPool[i]!.visible = false;
    }
    this.activeLabelCount = 0;
  }
}
