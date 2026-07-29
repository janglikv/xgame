import {
  WorldCreature,
  type CreatureEcologyContext,
  type SpiderAttackHit,
} from '../WorldCreature';
import type { BodyProfileId } from '../../data/bodyProfiles';
import {
  ANIMAL_SCALE,
  ANIMAL_WALK_BOB,
  animalOptions,
  type FarmAnimalOptions,
} from './animalCommon';

import { Graphics } from 'pixi.js';

export const HORSE_KING_ECO = {
  visionRange: 420,
  chaseMemory: 500,
  stampRange: 52,
  huntSpeed: 165,
  walkSpeed: 95,
  maxHp: 650,
  wolfDamage: 85,
};

/**
 * 马王 Boss (Horse King)：
 * 当全岛累计诞生马匹达到 99 匹后降临。
 * 脚底拥有绚丽的绿色魔法阵光环，具备双重强力仇恨：优先践踏野狼，同时攻击玩家！
 */
export class HorseKing extends WorldCreature {
  private targetWolf: WorldCreature | null = null;
  private readonly auraGfx: Graphics;
  private auraTime = 0;

  constructor(worldX: number, worldY: number, options: FarmAnimalOptions = {}) {
    const baseOpts = animalOptions(
      {
        ...options,
        maxHp: options.maxHp ?? HORSE_KING_ECO.maxHp,
      },
      ANIMAL_SCALE.horse_king,
      'horse_king',
      {
        textureUrl: '/assets/horse/horse.png',
        label: 'HorseKing',
        spriteLabel: 'HorseKingSprite',
      },
      ANIMAL_WALK_BOB.large,
    );

    super(worldX, worldY, {
      ...baseOpts,
      canAttack: true,
      aggroOnDetect: true,
    });

    this.auraGfx = new Graphics();
    this.addChildAt(this.auraGfx, 0);
  }

  override async load(): Promise<void> {
    await super.load();
    if (this.sprite) {
      this.sprite.tint = 0xffd700;
    }
    // 确保光环处于最底层（在马王 Sprite 与血条下方）
    if (this.auraGfx && this.children.includes(this.auraGfx)) {
      this.setChildIndex(this.auraGfx, 0);
    }
  }

  /** 绘制脚底震撼的绿色魔法阵光环（含旋转符文与呼吸脉动） */
  private drawGreenMagicAura(dt: number): void {
    if (this.children[0] !== this.auraGfx) {
      this.setChildIndex(this.auraGfx, 0);
    }
    this.auraTime += dt;
    const g = this.auraGfx;
    g.clear();

    const t = this.auraTime;
    const rx = 110;
    const ry = 48;
    const pulse = 1.0 + Math.sin(t * 3.5) * 0.08;
    const alphaPulse = 0.75 + Math.sin(t * 4.0) * 0.2;

    // 1) 最外层弥散光晕
    g.ellipse(0, -8, rx * 1.15 * pulse, ry * 1.15 * pulse).stroke({
      width: 2,
      color: 0x00ff66,
      alpha: alphaPulse * 0.35,
    });

    // 2) 外圈绿色发光主阵环 (0x00ff66 / 0x39ff14)
    g.ellipse(0, -8, rx * pulse, ry * pulse)
      .fill({ color: 0x00ff66, alpha: 0.2 })
      .stroke({ width: 4, color: 0x39ff14, alpha: alphaPulse });

    // 3) 内圈魔法阵同心环 (0x70ff8b)
    g.ellipse(0, -8, rx * 0.68 * pulse, ry * 0.68 * pulse).stroke({
      width: 2,
      color: 0x70ff8b,
      alpha: alphaPulse * 0.85,
    });

    // 4) 动态旋转符文/法阵射线 (8条对称线)
    const rays = 8;
    const rot = t * 1.2;
    for (let i = 0; i < rays; i++) {
      const ang = rot + (i * Math.PI) / (rays / 2);
      const x1 = Math.cos(ang) * rx * 0.2;
      const y1 = Math.sin(ang) * ry * 0.2 - 8;
      const x2 = Math.cos(ang) * rx * 0.85;
      const y2 = Math.sin(ang) * ry * 0.85 - 8;

      g.moveTo(x1, y1)
        .lineTo(x2, y2)
        .stroke({ width: 2, color: 0x00ff88, alpha: 0.5 });
    }

    // 5) 环绕发光粒子 (6颗)
    const dots = 6;
    for (let i = 0; i < dots; i++) {
      const dang = -rot * 1.5 + (i * Math.PI * 2) / dots;
      const dx = Math.cos(dang) * rx * 0.52;
      const dy = Math.sin(dang) * ry * 0.52 - 8;
      g.circle(dx, dy, 3.5).fill({ color: 0x88ffbb, alpha: 0.9 });
    }
  }

  private inRange(tx: number, ty: number, range: number): boolean {
    const dx = tx - this.worldX;
    const dy = ty - this.worldY;
    return dx * dx + dy * dy <= range * range;
  }

  protected override updateAI(
    dt: number,
    playerX: number,
    playerY: number,
    playerBodyProfileId: BodyProfileId | null = null,
  ): { moved: boolean; attackHit: SpiderAttackHit | null } {
    this.drawGreenMagicAura(dt);
    if (this.locked) {
      this.targetWolf = null;
    }

    const eco = this.ecology;
    if (!eco) {
      return super.updateAI(dt, playerX, playerY, playerBodyProfileId);
    }

    // 1. 优先仇恨：寻找并踩踏野狼（Wolf）
    this.refreshWolfTarget(eco);
    if (this.targetWolf) {
      const wolf = this.targetWolf;
      const dist = Math.hypot(
        wolf.worldX - this.worldX,
        wolf.worldY - this.worldY,
      );

      // 踩踏近战结算
      if (dist <= HORSE_KING_ECO.stampRange) {
        wolf.applyDamage(HORSE_KING_ECO.wolfDamage);
        if (!wolf.isAlive && !wolf.isCorpse) {
          wolf.turnIntoCorpse(6.0);
          this.targetWolf = null;
        }
        this.aiState = 'patrol';
        return { moved: false, attackHit: null };
      }

      // 冲向野狼
      this.aiState = 'chase';
      const moved = this.moveTowardAvoidingTrees(
        wolf.worldX,
        wolf.worldY,
        HORSE_KING_ECO.huntSpeed,
        dt,
        HORSE_KING_ECO.stampRange * 0.5,
        28,
      );
      return { moved, attackHit: null };
    }

    // 2. 次要仇恨：对主角/玩家进行踩踏攻击
    return super.updateAI(dt, playerX, playerY, playerBodyProfileId);
  }

  private refreshWolfTarget(eco: CreatureEcologyContext): void {
    if (this.targetWolf) {
      if (
        this.targetWolf.isAlive &&
        !this.targetWolf.destroyed &&
        eco.creatures.includes(this.targetWolf) &&
        this.inRange(
          this.targetWolf.worldX,
          this.targetWolf.worldY,
          HORSE_KING_ECO.chaseMemory,
        )
      ) {
        return;
      }
      this.targetWolf = null;
    }

    let best: WorldCreature | null = null;
    let bestD: number = HORSE_KING_ECO.visionRange;

    for (const c of eco.creatures) {
      if (c === this || !c.isAlive || c.destroyed) continue;
      if (c.kind !== 'wolf') continue;
      const d = Math.hypot(c.worldX - this.worldX, c.worldY - this.worldY);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    this.targetWolf = best;
  }
}
