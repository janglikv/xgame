import { Container, Text } from 'pixi.js';
import {
  WorldCreature,
  type CreatureEcologyContext,
  type EcologyTree,
  type SpiderAttackHit,
} from '../WorldCreature';
import type { BodyProfileId } from '../../data/bodyProfiles';
import {
  ANIMAL_ROAM,
  ANIMAL_SCALE,
  ANIMAL_WALK_BOB,
  PIG_ECO,
  SLEEP_FX,
  animalOptions,
  clearOfTreeSolids,
  type FarmAnimalOptions,
} from './animalCommon';

/**
 * 猪：找到苹果树就去树下站着睡觉（Zzz 气泡）；
 * 饿了吃地上苹果，吃完继续睡；极饿没吃的才追鸡。
 */
export class Pig extends WorldCreature {
  /** 0 饱 → 1 极饿 */
  private hunger: number = PIG_ECO.startHunger;
  /** 锁定的地上苹果 */
  private foodTarget: CreatureEcologyContext['pickups'][number] | null = null;
  /** 认领的苹果树（睡觉基地） */
  private homeTree: EcologyTree | null = null;
  private retargetCd = 0;
  private stuckT = 0;
  private stuckX = 0;
  private stuckY = 0;
  /** 是否在树下睡觉 */
  private sleeping = false;

  private readonly sleepLayer: Container;
  private sleepSpawnT = 0;
  private readonly sleepBubbles: Array<{
    text: Text;
    age: number;
    ox: number;
    phase: number;
  }> = [];

  constructor(worldX: number, worldY: number, options: FarmAnimalOptions = {}) {
    super(
      worldX,
      worldY,
      animalOptions(
        options,
        ANIMAL_SCALE.pig,
        'pig',
        {
          textureUrl: '/assets/pig/pig.png',
          label: 'Pig',
          spriteLabel: 'PigSprite',
        },
        ANIMAL_WALK_BOB.medium,
      ),
    );
    this.stuckX = worldX;
    this.stuckY = worldY;

    this.sleepLayer = new Container();
    this.sleepLayer.label = 'PigSleepFx';
    this.sleepLayer.eventMode = 'none';
    // 挂在头顶附近（不随贴图翻转）
    this.sleepLayer.position.set(10, -42);
    this.addChild(this.sleepLayer);
  }

  get hunger01(): number {
    return this.hunger;
  }

  get isSleeping(): boolean {
    return this.sleeping;
  }

  protected override updateAI(
    dt: number,
    playerX: number,
    playerY: number,
    playerBodyProfileId: BodyProfileId | null = null,
  ): { moved: boolean; attackHit: SpiderAttackHit | null } {
    if (this.locked) {
      this.wakeUp();
      this.clearFoodTarget();
      return super.updateAI(dt, playerX, playerY, playerBodyProfileId);
    }

    const hungerRate = this.sleeping
      ? PIG_ECO.hungerPerSecSleep
      : PIG_ECO.hungerPerSec;
    this.hunger = Math.min(1, this.hunger + hungerRate * dt);
    if (this.retargetCd > 0) {
      this.retargetCd = Math.max(0, this.retargetCd - dt);
    }

    const eco = this.ecology;
    if (!eco) {
      this.setSleeping(false);
      return { moved: false, attackHit: null };
    }

    // 1) 饿了：优先吃地上苹果（从树旁掉的）
    if (this.hunger >= PIG_ECO.seekAppleAt) {
      this.refreshFoodTarget(eco, PIG_ECO.appleSense);
      if (this.foodTarget) {
        this.setSleeping(false);
        return this.seekLockedApple(dt, eco, PIG_ECO.walkSpeed);
      }
    } else {
      this.clearFoodTarget();
    }

    // 2) 有苹果树：去树下睡觉 / 继续睡
    this.refreshHomeTree(eco);
    if (this.homeTree) {
      return this.goNapOrSleep(dt, this.homeTree);
    }

    // 3) 极饿无树无苹果 → 鸡
    if (this.hunger >= PIG_ECO.seekChickenAt) {
      this.setSleeping(false);
      const chicken = this.findNearestChicken(eco, PIG_ECO.chickenSense);
      if (chicken) {
        return this.seekChicken(dt, chicken, eco, PIG_ECO.walkSpeed * 1.1);
      }
    }

    // 4) 还没找到树：悠闲找树
    this.setSleeping(false);
    return {
      moved: this.updateSearchRoam(dt, {
        radius: ANIMAL_ROAM.idleRadius * 1.15,
        speed: ANIMAL_ROAM.idleSpeed,
        pauseMin: ANIMAL_ROAM.idlePauseMin,
        pauseMax: ANIMAL_ROAM.idlePauseMax,
        preferFar: 0.58,
        leisurely: true,
      }),
      attackHit: null,
    };
  }

  /** 场景每帧会调 update；在 AI 后推进气泡 */
  override update(
    deltaMS: number,
    playerWorldX: number,
    playerWorldY: number,
    playerBodyProfileId: BodyProfileId | null = null,
    ecology: CreatureEcologyContext | null = null,
  ) {
    const result = super.update(
      deltaMS,
      playerWorldX,
      playerWorldY,
      playerBodyProfileId,
      ecology,
    );
    if (this.destroyed) {
      return result;
    }
    this.tickSleepFx(deltaMS / 1000);
    return result;
  }

  private wakeUp(): void {
    this.setSleeping(false);
  }

  private setSleeping(on: boolean): void {
    if (this.sleeping === on) return;
    this.sleeping = on;
    if (!on) {
      this.clearSleepBubbles();
      this.sleepSpawnT = 0;
    }
  }

  private napSpot(tree: EcologyTree): { x: number; y: number } {
    // 根据猪的唯一坐标产生小幅散列偏移（-18~18px），允许多只猪共同围绕同一棵苹果树安睡
    const hash =
      (Math.abs(Math.sin(this.worldX * 12.9898 + this.worldY * 78.233)) *
        43758.5453) %
      1;
    const offsetX = (hash - 0.5) * 36;
    const offsetY = PIG_ECO.napOffsetY + (((hash * 17) % 1) - 0.5) * 12;

    return clearOfTreeSolids(
      tree.worldX + offsetX,
      tree.worldY + offsetY,
      26,
    );
  }

  /** 放弃当前选中的树（树被摧毁 / 死亡） */
  private releaseHomeTree(): void {
    this.homeTree = null;
    this.setSleeping(false);
  }

  /** 走向苹果树下并站着睡 */
  private goNapOrSleep(
    dt: number,
    tree: EcologyTree,
  ): { moved: boolean; attackHit: SpiderAttackHit | null } {
    // 检查树是否仍然存活
    if (!tree.isAlive) {
      this.releaseHomeTree();
      return { moved: false, attackHit: null };
    }

    const spot = this.napSpot(tree);
    const dist = Math.hypot(spot.x - this.worldX, spot.y - this.worldY);

    if (dist <= PIG_ECO.napArrive) {
      // 站定睡觉
      this.aiState = 'patrol';
      this.patrolPause = 1;
      this.setSleeping(true);
      // 轻微面向树干
      this.faceToward(tree.worldX, tree.worldY);
      return { moved: false, attackHit: null };
    }

    this.setSleeping(false);
    this.aiState = 'chase';
    this.patrolPause = 0;
    const moved = this.moveTowardAvoidingTrees(
      spot.x,
      spot.y,
      PIG_ECO.walkSpeed,
      dt,
      PIG_ECO.napArrive * 0.7,
      26,
    );
    return { moved, attackHit: null };
  }

  private refreshHomeTree(eco: CreatureEcologyContext): void {
    // 已有家：校验树还在
    if (this.homeTree) {
      const live = eco.trees.find(
        (t) =>
          t.kind === 'apple' &&
          t.isAlive &&
          Math.hypot(
            t.worldX - this.homeTree!.worldX,
            t.worldY - this.homeTree!.worldY,
          ) < 12,
      );
      if (live) {
        this.homeTree = live;
        return;
      }
      this.releaseHomeTree();
    }

    // 取消独占限制：寻找感知范围内最近的存活苹果树，多只猪可共用同一棵苹果树
    let best: EcologyTree | null = null;
    let bestScore = Infinity;
    for (const t of eco.trees) {
      if (!t.isAlive || t.kind !== 'apple') continue;
      const d = Math.hypot(t.worldX - this.worldX, t.worldY - this.worldY);
      if (d >= PIG_ECO.treeSense) continue;
      if (d < bestScore) {
        bestScore = d;
        best = t;
      }
    }

    this.homeTree = best;
  }

  private clearFoodTarget(): void {
    this.foodTarget = null;
    this.stuckT = 0;
  }

  private refreshFoodTarget(
    eco: CreatureEcologyContext,
    senseRange: number,
  ): void {
    if (this.foodTarget) {
      const still =
        !this.foodTarget.isCollected &&
        eco.pickups.some((p) => p === this.foodTarget);
      if (still) {
        const d = Math.hypot(
          this.foodTarget.worldX - this.worldX,
          this.foodTarget.worldY - this.worldY,
        );
        if (d < senseRange * 1.35) return;
      }
      this.clearFoodTarget();
      this.retargetCd = PIG_ECO.retargetCd;
    }
    if (this.retargetCd > 0) return;
    this.foodTarget = this.findNearestApple(eco, senseRange);
    if (this.foodTarget) {
      this.stuckT = 0;
      this.stuckX = this.worldX;
      this.stuckY = this.worldY;
    }
  }

  private seekLockedApple(
    dt: number,
    eco: CreatureEcologyContext,
    speed: number,
  ): { moved: boolean; attackHit: SpiderAttackHit | null } {
    const apple = this.foodTarget;
    if (!apple || apple.isCollected) {
      this.clearFoodTarget();
      this.retargetCd = PIG_ECO.retargetCd;
      return { moved: false, attackHit: null };
    }

    const distFood = Math.hypot(
      apple.worldX - this.worldX,
      apple.worldY - this.worldY,
    );

    if (distFood <= PIG_ECO.eatRange) {
      eco.consumePickup(apple);
      this.hunger = Math.max(0, this.hunger - PIG_ECO.appleFeed);
      this.clearFoodTarget();
      this.retargetCd = PIG_ECO.retargetCd;
      this.aiState = 'patrol';
      this.faceToward(apple.worldX, apple.worldY);
      return { moved: false, attackHit: null };
    }

    const stand = clearOfTreeSolids(apple.worldX, apple.worldY, 26);
    const distStand = Math.hypot(stand.x - this.worldX, stand.y - this.worldY);

    if (distStand <= 16) {
      this.aiState = 'patrol';
      this.faceToward(apple.worldX, apple.worldY);
      if (distFood <= PIG_ECO.eatRange * 1.3) {
        eco.consumePickup(apple);
        this.hunger = Math.max(0, this.hunger - PIG_ECO.appleFeed);
        this.clearFoodTarget();
        this.retargetCd = PIG_ECO.retargetCd;
      }
      return { moved: false, attackHit: null };
    }

    const movedDist = Math.hypot(
      this.worldX - this.stuckX,
      this.worldY - this.stuckY,
    );
    if (movedDist < 2.5) this.stuckT += dt;
    else {
      this.stuckT = 0;
      this.stuckX = this.worldX;
      this.stuckY = this.worldY;
    }
    if (this.stuckT > 1.1) {
      this.clearFoodTarget();
      this.retargetCd = 0.8;
      const side = this.facingDir > 0 ? 1 : -1;
      this.worldX += side * 18;
      this.worldY += 12;
      this.stuckT = 0;
      return { moved: true, attackHit: null };
    }

    this.aiState = 'chase';
    this.patrolPause = 0;
    const moved = this.moveTowardAvoidingTrees(
      stand.x,
      stand.y,
      speed,
      dt,
      14,
      26,
    );
    return { moved, attackHit: null };
  }

  private findNearestApple(
    eco: CreatureEcologyContext,
    senseRange: number,
  ): CreatureEcologyContext['pickups'][number] | null {
    let best: CreatureEcologyContext['pickups'][number] | null = null;
    let bestScore = Infinity;
    for (const p of eco.pickups) {
      if (p.isCollected || p.itemId !== 'apple') continue;
      const d = Math.hypot(p.worldX - this.worldX, p.worldY - this.worldY);
      if (d >= senseRange) continue;
      let crowd = 0;
      for (const c of eco.creatures) {
        if (c === this || !c.isAlive || c.kind !== 'pig') continue;
        if (Math.hypot(c.worldX - p.worldX, c.worldY - p.worldY) < 90) {
          crowd += 1;
        }
      }
      const score = d + crowd * 50;
      if (score < bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return best;
  }

  private findNearestChicken(
    eco: CreatureEcologyContext,
    senseRange: number,
  ): WorldCreature | null {
    let best: WorldCreature | null = null;
    let bestD = senseRange;
    for (const c of eco.creatures) {
      if (c === this || !c.isAlive || c.kind !== 'chicken') continue;
      const d = Math.hypot(c.worldX - this.worldX, c.worldY - this.worldY);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  private seekChicken(
    dt: number,
    chicken: WorldCreature,
    eco: CreatureEcologyContext,
    speed: number,
  ): { moved: boolean; attackHit: SpiderAttackHit | null } {
    this.aiState = 'chase';
    this.patrolPause = 0;
    if (!chicken.isAlive) {
      return { moved: false, attackHit: null };
    }
    const dist = Math.hypot(
      chicken.worldX - this.worldX,
      chicken.worldY - this.worldY,
    );
    if (dist <= PIG_ECO.eatRange) {
      chicken.applyDamage(chicken.maximumHp + 1);
      if (!chicken.isAlive) {
        eco.removeCreature(chicken);
      }
      this.hunger = 0;
      return { moved: false, attackHit: null };
    }
    const moved = this.moveTowardAvoidingTrees(
      chicken.worldX,
      chicken.worldY,
      speed,
      dt,
      PIG_ECO.eatRange * 0.45,
      26,
    );
    return { moved, attackHit: null };
  }

  // —— 睡觉气泡 Zzz ——

  private tickSleepFx(dt: number): void {
    if (!this.sleeping || this.destroyed) {
      if (this.sleepBubbles.length) this.clearSleepBubbles();
      return;
    }

    this.sleepSpawnT += dt;
    if (this.sleepSpawnT >= SLEEP_FX.spawnEvery) {
      this.sleepSpawnT = 0;
      this.spawnSleepBubble();
    }

    for (let i = this.sleepBubbles.length - 1; i >= 0; i--) {
      const b = this.sleepBubbles[i]!;
      b.age += dt;
      const u = b.age / SLEEP_FX.life;
      if (u >= 1) {
        b.text.destroy();
        this.sleepBubbles.splice(i, 1);
        continue;
      }
      const ease = 1 - (1 - u) * (1 - u);
      b.text.y = -ease * SLEEP_FX.rise;
      b.text.x =
        b.ox +
        Math.sin(b.age * 3.2 + b.phase) * 3 +
        ease * SLEEP_FX.drift * (this.facingDir > 0 ? 1 : -1);
      b.text.alpha = (1 - u) * 0.95;
      b.text.scale.set(0.75 + ease * 0.55);
    }
  }

  private spawnSleepBubble(): void {
    const glyphs = ['z', 'Z', 'Z'];
    const glyph = glyphs[Math.floor(Math.random() * glyphs.length)]!;
    const text = new Text({
      text: glyph,
      style: {
        fontFamily: 'Georgia, "Times New Roman", serif',
        fontSize: SLEEP_FX.fontSize + Math.floor(Math.random() * 5),
        fontWeight: '700',
        fill: 0xffffff,
        stroke: { color: 0x3a5a9a, width: 2.5 },
      },
    });
    text.anchor.set(0.5, 0.5);
    text.alpha = 0.9;
    text.eventMode = 'none';
    this.sleepLayer.addChild(text);
    this.sleepBubbles.push({
      text,
      age: 0,
      ox: (Math.random() - 0.5) * 8,
      phase: Math.random() * Math.PI * 2,
    });
  }

  private clearSleepBubbles(): void {
    for (const b of this.sleepBubbles) {
      b.text.destroy();
    }
    this.sleepBubbles.length = 0;
    this.sleepLayer.removeChildren();
  }
}

