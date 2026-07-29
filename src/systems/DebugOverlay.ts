import { Container, Graphics, Text } from 'pixi.js';
import type { BombProjectile } from '../entities/BombProjectile';
import type { PlayerCharacterBase } from '../entities/PlayerCharacterBase';
import type { SpearProjectile } from '../entities/SpearProjectile';
import type { WorldCreature } from '../entities/WorldCreature';
import { SPEAR_BODY_R, SPEAR_HIT_R } from '../entities/SpearProjectile';
import {
  getBodyProfile,
  type BodyProfileId,
  type BodyShape,
} from '../data/bodyProfiles';
import { DebugConfig } from '../utils/DebugConfig';

const LABEL_STYLE = {
  fontFamily: 'system-ui, -apple-system, sans-serif',
  fontSize: 11,
  fontWeight: '700',
  fill: 0xffffff,
  stroke: { color: 0x000000, width: 3 },
} as const;

export type DebugRenderWorld = {
  player: PlayerCharacterBase | null;
  creatures: WorldCreature[];
  bombs: ReadonlyArray<BombProjectile>;
  spears: ReadonlyArray<SpearProjectile>;
};

/**
 * 受击体 / 碰撞体 Debug 绘制（只读可视化，编辑在 BodyEditScene）。
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

    for (const spider of world.creatures) {
      if (!spider.isAlive) continue;
      this.drawProfile(spider.worldX, spider.worldY, spider.bodyProfileId, {
        solidColor: 0x00e5ff,
        hurtColor: 0xff9100,
      });
      const nameByLabel: Record<string, string> = {
        WoodenDummy: '木桩',
        FlameFlower: '火焰花',
        Chicken: '鸡',
        Pig: '猪',
        Cow: '牛',
        Horse: '马',
        Wolf: '狼',
        Bear: '熊',
        Spider: '蜘蛛',
      };
      const name = nameByLabel[spider.label] ?? spider.label;
      const hpStr = spider.invincible
        ? '无敌'
        : `HP:${Math.ceil(spider.currentHp)}`;
      const p = getBodyProfile(spider.bodyProfileId);
      this.addLabel(
        spider.worldX,
        spider.worldY - 48,
        `[${name}] ${hpStr} | S:${p.solid.length} H:${p.hurt.length}`,
        0xff9100,
      );

      if (spider.isAttacking) {
        this.gfx
          .circle(spider.worldX, spider.worldY, spider.attackHitR)
          .fill({ color: 0xff0055, alpha: 0.25 })
          .stroke({ width: 3, color: 0xff0055, alpha: 1.0 });
      }
    }

    if (world.player) {
      const player = world.player;
      this.drawProfile(player.worldX, player.worldY, player.bodyProfileId, {
        solidColor: 0x00ff66,
        hurtColor: 0xffea00,
      });
      const p = getBodyProfile(player.bodyProfileId);
      this.addLabel(
        player.worldX,
        player.worldY - 75,
        `[玩家] S:${p.solid.length} H:${p.hurt.length}`,
        0x00ff66,
      );
    }

    for (const bomb of world.bombs) {
      this.drawBomb(bomb);
    }
    for (const spear of world.spears) {
      this.drawSpear(spear);
    }
  }

  private drawProfile(
    feetX: number,
    feetY: number,
    profileId: BodyProfileId,
    style: { solidColor: number; hurtColor: number },
  ): void {
    const p = getBodyProfile(profileId);
    for (const s of p.solid) {
      this.drawShape(feetX, feetY, s, style.solidColor);
    }
    for (const s of p.hurt) {
      this.drawShape(feetX, feetY, s, style.hurtColor);
    }
    this.drawCross(feetX, feetY, 6, style.solidColor, 1);
  }

  private drawShape(
    feetX: number,
    feetY: number,
    s: BodyShape,
    color: number,
  ): void {
    const cx = feetX + s.ox;
    const cy = feetY + s.oy;
    if (s.type === 'circle') {
      this.gfx
        .circle(cx, cy, s.r)
        .fill({ color, alpha: 0.14 })
        .stroke({ width: 2, color, alpha: 0.92 });
    } else {
      this.gfx
        .rect(cx - s.w * 0.5, cy - s.h * 0.5, s.w, s.h)
        .fill({ color, alpha: 0.14 })
        .stroke({ width: 2, color, alpha: 0.92 });
    }
  }

  private drawBomb(bomb: BombProjectile): void {
    const gx = bomb.groundX;
    const gy = bomb.groundY;
    const radius = bomb.blast.radius;
    this.gfx
      .circle(gx, gy, radius)
      .fill({ color: 0xff0033, alpha: 0.12 })
      .stroke({ width: 2, color: 0xff0033, alpha: 0.85 });
    this.drawCross(gx, gy, 8, 0xff0033, 1);
    this.addLabel(
      gx,
      gy - radius - 12,
      `[炸弹] R${Math.round(radius)}`,
      0xff3366,
    );
  }

  private drawSpear(spear: SpearProjectile): void {
    const gx = spear.groundX;
    const gy = spear.groundY;
    this.gfx
      .circle(gx, gy, SPEAR_BODY_R)
      .fill({ color: 0x00ffff, alpha: 0.18 })
      .stroke({ width: 1.5, color: 0x00ffff, alpha: 0.9 });
    this.gfx
      .circle(gx, gy, SPEAR_HIT_R)
      .fill({ color: 0xff00ff, alpha: 0.16 })
      .stroke({ width: 2, color: 0xff00ff, alpha: 0.9 });
    this.drawCross(gx, gy, 4, 0xff00ff, 1);
    this.addLabel(gx, gy - 20, `[矛] Hit:R${SPEAR_HIT_R}`, 0xff00ff);
  }

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
