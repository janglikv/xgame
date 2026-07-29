import { Container, Text } from 'pixi.js';
import {
  Spider,
  type CreatureEcologyContext,
  type EcologyTree,
  type SpiderAttackHit,
  type SpiderOptions,
  type WalkBobConfig,
} from './Spider';
import type { BodyProfileId } from '../data/bodyProfiles';
import { GRASS_ANIMAL_RETARGET_SEC } from '../data/grassProfiles';
import { getRuntimeTreeObstacles, isOnGreenLand, landRectOf } from '../data/maps';

export type FarmAnimalOptions = Pick<SpiderOptions, 'scale' | 'maxHp'>;

/** 相对贴图默认缩放：鸡小、猪/牛中、马/熊大 */
export const ANIMAL_SCALE = {
  chicken: 0.042,
  pig: 0.115,
  cow: 0.125,
  horse: 0.155,
  wolf: 0.06,
  bear: 0.175,
} as const;

/**
 * 按体型分档走路晃动：体型越大 period 越长、幅度越小。
 * （比蜘蛛默认更稳，避免农场动物「抖」）
 */
const ANIMAL_WALK_BOB = {
  /** 鸡：碎步，略活泼但仍远慢于旧 0.22 抖 */
  chicken: {
    period: 0.36,
    ampY: 2.0,
    ampX: 0.9,
    ampRot: 0.02,
    settle: 11,
  },
  /** 猪 / 狼：中等 */
  medium: {
    period: 0.48,
    ampY: 1.6,
    ampX: 0.8,
    ampRot: 0.016,
    settle: 9,
  },
  /** 牛 / 马 / 熊：沉稳 */
  large: {
    period: 0.64,
    ampY: 1.2,
    ampX: 0.6,
    ampRot: 0.01,
    settle: 8,
  },
} as const satisfies Record<string, WalkBobConfig>;

/** 动物脱战距离（世界像素）；超出后取消追击，回游荡 */
const ANIMAL_LEASH_RANGE = 380;
/** 兼容旧字段：日常游荡参考半径 */
const ANIMAL_TERRITORY = 320;
/** 个人空间：靠近同伴时软推开（世界像素） */
const ANIMAL_PERSONAL_SPACE = 86;
/** 软分散移速 */
const ANIMAL_SEPARATION_SPEED = 78;

const FOOT_ANCHOR_Y = 0.92;
const HP_BAR_OFFSET_Y = 720;

/** 日常闲逛（当前位置滚动） */
const ANIMAL_ROAM = {
  idleRadius: 340,
  idleSpeed: 64,
  idlePauseMin: 0.2,
  idlePauseMax: 0.95,
} as const;

/** 猪：找苹果树睡觉 + 饿了吃掉落苹果 */
const PIG_ECO = {
  /** 饥饿增长：约 90 秒从 0→1；树下睡觉时更慢 */
  hungerPerSec: 0.011,
  hungerPerSecSleep: 0.004,
  /** 开始吃地上苹果 */
  seekAppleAt: 0.4,
  /** 极饿且没树/苹果才吃鸡 */
  seekChickenAt: 0.88,
  /** 感知苹果 / 苹果树 */
  appleSense: 620,
  treeSense: 720,
  chickenSense: 400,
  eatRange: 44,
  walkSpeed: 78,
  appleFeed: 0.6,
  startHunger: 0.12,
  retargetCd: 0.4,
  /** 到树下睡觉的到达距离 */
  napArrive: 18,
  /** 睡觉时脚下相对树干的偏移（树前方略偏下） */
  napOffsetY: 36,
} as const;

/** 睡觉 Z 气泡参数 */
const SLEEP_FX = {
  spawnEvery: 0.55,
  life: 1.35,
  rise: 28,
  drift: 18,
  fontSize: 13,
} as const;



/**
 * 把目标点推出所有树干 solid（再加 body 裕量）。
 * 猪走向苹果时用，避免钻进树碰撞体来回顶。
 */
function clearOfTreeSolids(
  x: number,
  y: number,
  bodyR: number,
): { x: number; y: number } {
  let px = x;
  let py = y;
  const trees = getRuntimeTreeObstacles();
  for (let iter = 0; iter < 5; iter++) {
    let moved = false;
    for (const t of trees) {
      const dx = px - t.x;
      const dy = py - t.y;
      const d = Math.hypot(dx, dy);
      const need = t.r + bodyR + 6;
      if (d >= need) continue;
      moved = true;
      if (d < 1e-3) {
        // 正好在圆心：偏到下方（苹果常见落点侧）
        px = t.x;
        py = t.y + need;
      } else {
        const inv = 1 / d;
        px = t.x + dx * inv * need;
        py = t.y + dy * inv * need;
      }
    }
    if (!moved) break;
  }
  return { x: px, y: py };
}

/**
 * 农场动物基础选项：默认游荡；玩家不打则完全忽略。
 * 被打后短追但不近战；超出脱战距离回游荡。
 * 猪 / 牛 / 马另有觅食 AI（见各类）。
 */
function animalOptions(
  options: FarmAnimalOptions,
  defaultScale: number,
  appearance: {
    textureUrl: string;
    label: string;
    spriteLabel: string;
  },
  walkBob: WalkBobConfig,
): SpiderOptions {
  return {
    scale: options.scale ?? defaultScale,
    maxHp: options.maxHp,
    canAttack: false,
    aggroOnDetect: false,
    leashRange: ANIMAL_LEASH_RANGE,
    territoryRadius: ANIMAL_TERRITORY,
    personalSpace: ANIMAL_PERSONAL_SPACE,
    separationSpeed: ANIMAL_SEPARATION_SPEED,
    walkBob,
    appearance: {
      textureUrl: appearance.textureUrl,
      label: appearance.label,
      spriteLabel: appearance.spriteLabel,
      footAnchorY: FOOT_ANCHOR_Y,
      hpBarOffsetY: HP_BAR_OFFSET_Y,
    },
  };
}

/**
 * 只会走的动物：不守出生点，日常到处踱步。
 */
abstract class RoamingAnimal extends Spider {
  protected override updateAI(
    dt: number,
    playerX: number,
    playerY: number,
    playerBodyProfileId: BodyProfileId | null = null,
  ): { moved: boolean; attackHit: SpiderAttackHit | null } {
    if (this.locked) {
      return super.updateAI(dt, playerX, playerY, playerBodyProfileId);
    }
    return {
      moved: this.updateSearchRoam(dt, {
        radius: ANIMAL_ROAM.idleRadius,
        speed: ANIMAL_ROAM.idleSpeed,
        pauseMin: ANIMAL_ROAM.idlePauseMin,
        pauseMax: ANIMAL_ROAM.idlePauseMax,
        preferFar: 0.62,
        leisurely: true,
      }),
      attackHit: null,
    };
  }
}

export class Chicken extends RoamingAnimal {
  constructor(worldX: number, worldY: number, options: FarmAnimalOptions = {}) {
    super(
      worldX,
      worldY,
      animalOptions(
        options,
        ANIMAL_SCALE.chicken,
        {
          textureUrl: '/assets/chicken/chicken.png',
          label: 'Chicken',
          spriteLabel: 'ChickenSprite',
        },
        ANIMAL_WALK_BOB.chicken,
      ),
    );
  }
}

/**
 * 猪：找到苹果树就去树下站着睡觉（Zzz 气泡）；
 * 饿了吃地上苹果，吃完继续睡；极饿没吃的才追鸡。
 */
export class Pig extends Spider {
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
        if (c === this || !c.isAlive || c.label !== 'Pig') continue;
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
  ): Spider | null {
    let best: Spider | null = null;
    let bestD = senseRange;
    for (const c of eco.creatures) {
      if (c === this || !c.isAlive || c.label !== 'Chicken') continue;
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
    chicken: Spider,
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

/** 食草动物（牛 / 马）共用参数 */
type HerbivoreEco = {
  hungerPerSec: number;
  eatRange: number;
  /** 饿时移速 */
  forageSpeed: number;
  /** 饱时移速（更慢） */
  fullSpeed: number;
  grassFeed: { small: number; medium: number; large: number };
  startHunger: number;
};

const COW_ECO: HerbivoreEco = {
  hungerPerSec: 0.02,
  eatRange: 38,
  forageSpeed: 72,
  fullSpeed: 28,
  grassFeed: { small: 0.22, medium: 0.4, large: 0.62 },
  startHunger: 0.25,
};

const HORSE_ECO: HerbivoreEco = {
  hungerPerSec: 0.024,
  eatRange: 36,
  forageSpeed: 108,
  fullSpeed: 42,
  grassFeed: { small: 0.18, medium: 0.34, large: 0.52 },
  startHunger: 0.25,
};

/**
 * 食草基类：只找最近的大草吃；饱了走慢、饿了走快；没草会饿死。
 * 无闲逛。
 */
abstract class GrassEater extends Spider {
  private hunger: number;
  private readonly ecoCfg: HerbivoreEco;
  /** 锁定的大草目标（降频重选） */
  private grassTarget: CreatureEcologyContext['grasses'][number] | null = null;
  private retargetT = 0;

  protected constructor(
    worldX: number,
    worldY: number,
    options: FarmAnimalOptions,
    scale: number,
    appearance: { textureUrl: string; label: string; spriteLabel: string },
    ecoCfg: HerbivoreEco,
    walkBob: WalkBobConfig = ANIMAL_WALK_BOB.large,
  ) {
    super(worldX, worldY, animalOptions(options, scale, appearance, walkBob));
    this.ecoCfg = ecoCfg;
    this.hunger = ecoCfg.startHunger;
  }

  get hunger01(): number {
    return this.hunger;
  }

  /** 越饿越快：hunger 0→fullSpeed，1→forageSpeed */
  private moveSpeed(): number {
    const cfg = this.ecoCfg;
    const t = Math.min(1, Math.max(0, this.hunger));
    return cfg.fullSpeed + t * (cfg.forageSpeed - cfg.fullSpeed);
  }

  /** 场上最近一丛可啃的大草（优先网格） */
  private findNearestGrass(
    eco: CreatureEcologyContext,
  ): { grass: CreatureEcologyContext['grasses'][number]; dist: number } | null {
    if (eco.findNearestLargeGrass) {
      return eco.findNearestLargeGrass(this.worldX, this.worldY);
    }
    let best: CreatureEcologyContext['grasses'][number] | null = null;
    let bestD = Infinity;
    for (const g of eco.grasses) {
      if (g.size !== 'large') continue;
      const grazable =
        'isGrazable' in g ? (g as { isGrazable: boolean }).isGrazable : true;
      if (!grazable) continue;
      const d = Math.hypot(g.worldX - this.worldX, g.worldY - this.worldY);
      if (d < bestD) {
        bestD = d;
        best = g;
      }
    }
    return best ? { grass: best, dist: bestD } : null;
  }

  private refreshGrassTarget(
    eco: CreatureEcologyContext,
    force: boolean,
  ): { grass: CreatureEcologyContext['grasses'][number]; dist: number } | null {
    if (!force && this.grassTarget) {
      const g = this.grassTarget;
      const still =
        g.size === 'large' &&
        ('isGrazable' in g ? (g as { isGrazable: boolean }).isGrazable : true) &&
        eco.grasses.includes(g as (typeof eco.grasses)[number]);
      if (still) {
        const dist = Math.hypot(g.worldX - this.worldX, g.worldY - this.worldY);
        return { grass: g, dist };
      }
      this.grassTarget = null;
    }
    const nearest = this.findNearestGrass(eco);
    this.grassTarget = nearest?.grass ?? null;
    return nearest;
  }

  protected override updateAI(
    dt: number,
    playerX: number,
    playerY: number,
    playerBodyProfileId: BodyProfileId | null = null,
  ): { moved: boolean; attackHit: SpiderAttackHit | null } {
    if (this.locked) {
      this.grassTarget = null;
      return super.updateAI(dt, playerX, playerY, playerBodyProfileId);
    }

    const cfg = this.ecoCfg;
    this.hunger = Math.min(1, this.hunger + cfg.hungerPerSec * dt);
    const eco = this.ecology;
    const speed = this.moveSpeed();

    if (eco && this.hunger >= 1) {
      this.applyDamage(this.maximumHp + 1);
      if (!this.isAlive) eco.removeCreature(this);
      return { moved: false, attackHit: null };
    }

    if (!eco) {
      return { moved: false, attackHit: null };
    }

    this.retargetT -= dt;
    const forceRetarget = this.retargetT <= 0 || !this.grassTarget;
    if (forceRetarget) {
      this.retargetT = GRASS_ANIMAL_RETARGET_SEC;
    }
    const nearest = this.refreshGrassTarget(eco, forceRetarget);

    if (nearest) {
      const { grass, dist } = nearest;
      if (dist <= cfg.eatRange) {
        const sizeBefore = grass.size;
        const result = eco.consumeGrass(grass);
        if (result) {
          const feed =
            cfg.grassFeed[result] ??
            cfg.grassFeed[sizeBefore] ??
            cfg.grassFeed.medium;
          this.hunger = Math.max(0, this.hunger - feed);
        }
        this.grassTarget = null;
        this.retargetT = 0;
        return { moved: false, attackHit: null };
      }
      this.aiState = 'chase';
      const moved = this.moveTowardAvoidingTrees(
        grass.worldX,
        grass.worldY,
        speed,
        dt,
        8,
        20,
      );
      return { moved, attackHit: null };
    }

    // 没草：若在沙滩，慢走回岛中心；否则站着等草长
    if (eco.mapDef && !isOnGreenLand(this.worldX, this.worldY, eco.mapDef)) {
      const land = landRectOf(eco.mapDef);
      this.aiState = 'chase';
      const moved = this.moveTowardAvoidingTrees(
        land.x + land.w * 0.5,
        land.y + land.h * 0.5,
        speed,
        dt,
        8,
        20,
      );
      return { moved, attackHit: null };
    }

    return { moved: false, attackHit: null };
  }
}

/** 牛：只找最近大草吃，饱了走慢；没草会饿死 */
export class Cow extends GrassEater {
  constructor(worldX: number, worldY: number, options: FarmAnimalOptions = {}) {
    super(
      worldX,
      worldY,
      options,
      ANIMAL_SCALE.cow,
      {
        textureUrl: '/assets/cow/cow.png',
        label: 'Cow',
        spriteLabel: 'CowSprite',
      },
      COW_ECO,
    );
  }
}

/** 马：只找最近大草吃，饱了走慢、饿了跑快；没草会饿死 */
export class Horse extends GrassEater {
  constructor(worldX: number, worldY: number, options: FarmAnimalOptions = {}) {
    super(
      worldX,
      worldY,
      options,
      ANIMAL_SCALE.horse,
      {
        textureUrl: '/assets/horse/horse.png',
        label: 'Horse',
        spriteLabel: 'HorseSprite',
      },
      HORSE_ECO,
    );
  }
}

/** 狼：有限视野觅食；吃完后视野内就近找松树休息 */
const WOLF_ECO = {
  /** 饥饿增长（很慢，长时间休息） */
  hungerPerSec: 0.003,
  /** 开始猎食 */
  seekPreyAt: 0.18,
  /**
   * 视野半径：发现猎物 / 发现歇脚松树（无透视，只认范围内的）
   */
  visionRange: 300,
  /**
   * 已锁定目标的追击记忆半径：略大于视野，贴边不立刻丢；
   * 超出则彻底丢失，需重新进入视野才能锁定。
   */
  chaseMemory: 380,
  eatRange: 54,
  /** 扑杀移速（高于牛马） */
  huntSpeed: 188,
  /** 觅食巡游移速（视野内无猎物时） */
  forageSpeed: 118,
  /** 觅食巡游半径 */
  forageRadius: 200,
  walkSpeed: 96,
  startHunger: 0.55,
  /** 吃一顿回饱量 */
  mealFeed: 0.55,
  restArrive: 28,
  restOffsetY: 40,
  retargetCd: 0.22,
  maxHp: 120,
} as const;

/** 可被狼吃的农场动物 label */
const WOLF_PREY_LABELS = new Set(['Chicken', 'Pig', 'Cow', 'Horse']);

/**
 * 狼：视野内觅食猎杀；成功后在视野内就近找松树休息。
 * 无「全图透视」。
 */
export class Wolf extends Spider {
  private hunger: number = WOLF_ECO.startHunger;
  private prey: Spider | null = null;
  private restTree: EcologyTree | null = null;
  private retargetCd = 0;
  /** 刚吃完，优先在视野内找树歇 */
  private wantRest = false;

  constructor(worldX: number, worldY: number, options: FarmAnimalOptions = {}) {
    super(
      worldX,
      worldY,
      animalOptions(
        { ...options, maxHp: options.maxHp ?? WOLF_ECO.maxHp },
        ANIMAL_SCALE.wolf,
        {
          textureUrl: '/assets/wolf/wolf.png',
          label: 'Wolf',
          spriteLabel: 'WolfSprite',
        },
        ANIMAL_WALK_BOB.medium,
      ),
    );
  }

  get hunger01(): number {
    return this.hunger;
  }

  /** 点是否在给定半径内（默认视野） */
  private inVision(tx: number, ty: number, range?: number): boolean {
    const r = range ?? WOLF_ECO.visionRange;
    const dx = tx - this.worldX;
    const dy = ty - this.worldY;
    return dx * dx + dy * dy <= r * r;
  }

  protected override updateAI(
    dt: number,
    playerX: number,
    playerY: number,
    playerBodyProfileId: BodyProfileId | null = null,
  ): { moved: boolean; attackHit: SpiderAttackHit | null } {
    if (this.locked) {
      this.prey = null;
      return super.updateAI(dt, playerX, playerY, playerBodyProfileId);
    }

    this.hunger = Math.min(1, this.hunger + WOLF_ECO.hungerPerSec * dt);
    if (this.retargetCd > 0) {
      this.retargetCd = Math.max(0, this.retargetCd - dt);
    }

    const eco = this.ecology;
    if (!eco) {
      return { moved: false, attackHit: null };
    }

    // 1) 饿了：视野内觅食 / 追击
    if (this.hunger >= WOLF_ECO.seekPreyAt) {
      this.wantRest = false;
      this.refreshPrey(eco);
      if (this.prey) {
        return this.huntPrey(dt, eco);
      }
      // 视野内无猎物：扩大巡游寻找（仍不是透视）
      return this.forageRoam(dt);
    }

    this.prey = null;

    // 2) 不饿 / 刚吃完：视野内就近松树休息
    this.refreshRestTree(eco);
    if (this.restTree) {
      return this.goRestNearPine(dt, this.restTree);
    }

    // 3) 视野内没树：小范围走着找（与觅食同机制）
    return this.forageRoam(dt, /* lookingForRest */ true);
  }

  /** 视野内觅食 / 找歇脚点游荡 */
  private forageRoam(
    dt: number,
    lookingForRest = false,
  ): { moved: boolean; attackHit: SpiderAttackHit | null } {
    return {
      moved: this.updateSearchRoam(dt, {
        radius: lookingForRest
          ? WOLF_ECO.forageRadius * 0.85
          : WOLF_ECO.forageRadius,
        speed: lookingForRest
          ? WOLF_ECO.walkSpeed
          : WOLF_ECO.forageSpeed,
        pauseMin: 0.12,
        pauseMax: lookingForRest ? 0.55 : 0.35,
        preferFar: 0.62,
        leisurely: lookingForRest,
      }),
      attackHit: null,
    };
  }

  /**
   * 刷新猎物：
   * - 新锁定：必须在 visionRange 内
   * - 已锁定：chaseMemory 内可继续追，超出则丢失
   */
  private refreshPrey(eco: CreatureEcologyContext): void {
    if (this.prey) {
      if (
        this.prey.isAlive &&
        !this.prey.destroyed &&
        eco.creatures.includes(this.prey) &&
        this.inVision(
          this.prey.worldX,
          this.prey.worldY,
          WOLF_ECO.chaseMemory,
        )
      ) {
        return;
      }
      this.prey = null;
      this.retargetCd = WOLF_ECO.retargetCd;
    }
    if (this.retargetCd > 0) return;

    let best: Spider | null = null;
    let bestD: number = WOLF_ECO.visionRange;
    for (const c of eco.creatures) {
      if (c === this || !c.isAlive || c.destroyed) continue;
      if (!WOLF_PREY_LABELS.has(c.label ?? '')) continue;
      const d = Math.hypot(c.worldX - this.worldX, c.worldY - this.worldY);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    this.prey = best;
  }

  private huntPrey(
    dt: number,
    eco: CreatureEcologyContext,
  ): { moved: boolean; attackHit: SpiderAttackHit | null } {
    const prey = this.prey;
    if (!prey || !prey.isAlive || prey.destroyed) {
      this.prey = null;
      return { moved: false, attackHit: null };
    }

    // 追击中超出记忆距离 → 丢失
    if (!this.inVision(prey.worldX, prey.worldY, WOLF_ECO.chaseMemory)) {
      this.prey = null;
      this.retargetCd = WOLF_ECO.retargetCd;
      return this.forageRoam(dt);
    }

    const dist = Math.hypot(
      prey.worldX - this.worldX,
      prey.worldY - this.worldY,
    );
    if (dist <= WOLF_ECO.eatRange) {
      prey.applyDamage(prey.maximumHp + 1);
      if (!prey.isAlive) {
        eco.removeCreature(prey);
      }
      this.hunger = Math.max(0, this.hunger - WOLF_ECO.mealFeed);
      this.wantRest = true;
      this.prey = null;
      this.restTree = null;
      this.retargetCd = WOLF_ECO.retargetCd;
      this.aiState = 'patrol';
      return { moved: false, attackHit: null };
    }

    this.aiState = 'chase';
    this.patrolPause = 0;
    const moved = this.moveTowardAvoidingTrees(
      prey.worldX,
      prey.worldY,
      WOLF_ECO.huntSpeed,
      dt,
      WOLF_ECO.eatRange * 0.4,
      22,
    );
    return { moved, attackHit: null };
  }

  /**
   * 刷新歇脚松树：与觅食同一套视野。
   * - 新目标：必须在 visionRange 内就近
   * - 已锁定：chaseMemory 内可继续走向该树
   */
  private refreshRestTree(eco: CreatureEcologyContext): void {
    if (this.restTree) {
      const live = eco.trees.find(
        (t) =>
          t.kind === 'pine' &&
          t.isAlive &&
          Math.hypot(
            t.worldX - this.restTree!.worldX,
            t.worldY - this.restTree!.worldY,
          ) < 12,
      );
      if (
        live &&
        this.inVision(live.worldX, live.worldY, WOLF_ECO.chaseMemory)
      ) {
        this.restTree = live;
        return;
      }
      this.restTree = null;
    }

    let best: EcologyTree | null = null;
    let bestD: number = WOLF_ECO.visionRange;
    for (const t of eco.trees) {
      if (!t.isAlive || t.kind !== 'pine') continue;
      const d = Math.hypot(t.worldX - this.worldX, t.worldY - this.worldY);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    this.restTree = best;
  }

  private restSpot(tree: EcologyTree): { x: number; y: number } {
    const hash =
      (Math.abs(Math.sin(this.worldX * 12.9898 + this.worldY * 78.233)) *
        43758.5453) %
      1;
    const offsetX = (hash - 0.5) * 40;
    const offsetY = WOLF_ECO.restOffsetY + (((hash * 17) % 1) - 0.5) * 14;
    return clearOfTreeSolids(
      tree.worldX + offsetX,
      tree.worldY + offsetY,
      22,
    );
  }

  private goRestNearPine(
    dt: number,
    tree: EcologyTree,
  ): { moved: boolean; attackHit: SpiderAttackHit | null } {
    if (!tree.isAlive) {
      this.restTree = null;
      return { moved: false, attackHit: null };
    }

    // 走向歇脚点途中若树已远超记忆距离，放弃重觅
    if (!this.inVision(tree.worldX, tree.worldY, WOLF_ECO.chaseMemory)) {
      this.restTree = null;
      return this.forageRoam(dt, true);
    }

    const spot = this.restSpot(tree);
    const dist = Math.hypot(spot.x - this.worldX, spot.y - this.worldY);

    if (dist <= WOLF_ECO.restArrive) {
      this.aiState = 'patrol';
      this.patrolPause = 1;
      this.wantRest = false;
      this.faceToward(tree.worldX, tree.worldY);
      return { moved: false, attackHit: null };
    }

    this.aiState = 'chase';
    this.patrolPause = 0;
    const speed = this.wantRest
      ? WOLF_ECO.walkSpeed * 1.1
      : WOLF_ECO.walkSpeed;
    const moved = this.moveTowardAvoidingTrees(
      spot.x,
      spot.y,
      speed,
      dt,
      WOLF_ECO.restArrive * 0.65,
      22,
    );
    return { moved, attackHit: null };
  }
}

export class Bear extends RoamingAnimal {
  constructor(worldX: number, worldY: number, options: FarmAnimalOptions = {}) {
    super(
      worldX,
      worldY,
      animalOptions(
        options,
        ANIMAL_SCALE.bear,
        {
          textureUrl: '/assets/bear/bear.png',
          label: 'Bear',
          spriteLabel: 'BearSprite',
        },
        ANIMAL_WALK_BOB.large,
      ),
    );
  }
}
