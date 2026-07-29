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
 * 具备双重强力仇恨：优先撕咬/践踏野狼，同时对附近的玩家进行冲锋踩踏！
 */
export class HorseKing extends WorldCreature {
  private targetWolf: WorldCreature | null = null;

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
  }

  override async load(): Promise<void> {
    await super.load();
    if (this.sprite) {
      this.sprite.tint = 0xffd700;
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
        if (!wolf.isAlive) {
          eco.removeCreature(wolf);
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
