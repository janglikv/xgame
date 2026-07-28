import { Container, Text } from 'pixi.js';
import {
  Spider,
  type CreatureEcologyContext,
  type EcologyTree,
  type SpiderAttackHit,
  type SpiderOptions,
} from './Spider';
import type { BodyProfileId } from '../data/bodyProfiles';
import { getRuntimeTreeObstacles } from '../data/maps';

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

/**
 * 日常移动：
 * - 有食物 → 在食物周围转悠（路过够近且饿了就吃）
 * - 没食物 → 更大范围到处走着找
 * - 饿急了 → 更快、更远
 */
const ANIMAL_ROAM = {
  /** 日常闲逛（当前位置滚动） */
  idleRadius: 340,
  idleSpeed: 64,
  idlePauseMin: 0.2,
  idlePauseMax: 0.95,
  /** 有食物时在食物区踱步 */
  grazeRadius: 150,
  grazeSpeed: 58,
  grazePauseMin: 0.28,
  grazePauseMax: 1.15,
  /** 进入「围着食物转」的距离（比 graze 略大） */
  foodZoneEnter: 200,
  /** 无食物时的搜索游荡 */
  searchRadius: 560,
  searchSpeed: 82,
  searchPauseMin: 0.08,
  searchPauseMax: 0.4,
  /** 开始扩大搜索 / 极饿（阈值抬高，平时不狂奔） */
  panicAt: 0.68,
  desperateAt: 0.88,
  sensePanicMul: 1.35,
  senseDesperateMul: 1.9,
  searchRadiusPanic: 640,
  searchRadiusDesperate: 820,
  speedPanicMul: 1.2,
  speedDesperateMul: 1.45,
  pauseMaxDesperate: 0.22,
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

/** 按饥饿程度缩放感知与无食物搜索强度 */
function hungerSenseAndSearch(
  hunger: number,
  baseSense: number,
  baseForageSpeed: number,
): {
  sense: number;
  searchRadius: number;
  searchSpeed: number;
  pauseMin: number;
  pauseMax: number;
  approachSpeed: number;
  panicking: boolean;
  desperate: boolean;
} {
  const desperate = hunger >= ANIMAL_ROAM.desperateAt;
  const panicking = hunger >= ANIMAL_ROAM.panicAt;
  if (!panicking) {
    return {
      sense: baseSense,
      searchRadius: ANIMAL_ROAM.searchRadius,
      searchSpeed: ANIMAL_ROAM.searchSpeed,
      pauseMin: ANIMAL_ROAM.searchPauseMin,
      pauseMax: ANIMAL_ROAM.searchPauseMax,
      approachSpeed: baseForageSpeed,
      panicking: false,
      desperate: false,
    };
  }
  const t = desperate
    ? 1
    : (hunger - ANIMAL_ROAM.panicAt) /
      (ANIMAL_ROAM.desperateAt - ANIMAL_ROAM.panicAt);
  const senseMul =
    ANIMAL_ROAM.sensePanicMul +
    t * (ANIMAL_ROAM.senseDesperateMul - ANIMAL_ROAM.sensePanicMul);
  const speedMul =
    ANIMAL_ROAM.speedPanicMul +
    t * (ANIMAL_ROAM.speedDesperateMul - ANIMAL_ROAM.speedPanicMul);
  return {
    sense: baseSense * senseMul,
    searchRadius:
      ANIMAL_ROAM.searchRadiusPanic +
      t *
        (ANIMAL_ROAM.searchRadiusDesperate - ANIMAL_ROAM.searchRadiusPanic),
    searchSpeed: ANIMAL_ROAM.searchSpeed * speedMul,
    pauseMin: 0.03,
    pauseMax: desperate
      ? ANIMAL_ROAM.pauseMaxDesperate
      : ANIMAL_ROAM.searchPauseMax * 0.7,
    approachSpeed: baseForageSpeed * speedMul,
    panicking: true,
    desperate,
  };
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
      animalOptions(options, ANIMAL_SCALE.chicken, {
        textureUrl: '/assets/chicken/chicken.png',
        label: 'Chicken',
        spriteLabel: 'ChickenSprite',
      }),
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
      animalOptions(options, ANIMAL_SCALE.pig, {
        textureUrl: '/assets/pig/pig.png',
        label: 'Pig',
        spriteLabel: 'PigSprite',
      }),
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

/** 食草动物（牛 / 马）共用觅食参数 */
type HerbivoreEco = {
  /** 饥饿增长速度：约 1/hungerPerSec 秒从 0→1 */
  hungerPerSec: number;
  /** 开始找草 */
  seekGrassAt: number;
  /** 感知草半径 */
  grassSense: number;
  /** 吃到距离 */
  eatRange: number;
  /** 觅食移速 */
  forageSpeed: number;
  /** 啃不同体型草（按啃前体型）减少的饥饿 */
  grassFeed: { small: number; medium: number; large: number };
  /** 开局饥饿 */
  startHunger: number;
};

const COW_ECO: HerbivoreEco = {
  hungerPerSec: 0.02,
  seekGrassAt: 0.28,
  grassSense: 580,
  eatRange: 38,
  forageSpeed: 72,
  grassFeed: { small: 0.22, medium: 0.4, large: 0.62 },
  startHunger: 0.25,
};

const HORSE_ECO: HerbivoreEco = {
  hungerPerSec: 0.024,
  seekGrassAt: 0.26,
  grassSense: 640,
  eatRange: 36,
  forageSpeed: 108,
  grassFeed: { small: 0.18, medium: 0.34, large: 0.52 },
  startHunger: 0.25,
};

/** 一头牛/马认领的草数量 */
const PASTURE_GRASS_COUNT = 4;

/**
 * 草场舒适度：在自己认领的 4 棵草内部活动。
 */
const GRASS_COMFORT = {
  /** 组牧场时邻草搜索半径 */
  clusterR: 200,
  coreR: 48,
  strollR: 92,
  enterR: 180,
  nestR: 100,
  densityScore: 42,
  centerScore: 55,
  restPauseMin: 0.55,
  restPauseMax: 1.9,
  strollSpeed: 46,
  centerPull: 28,
  waypointSamples: 10,
} as const;

/** grassId → 认领的食草动物（牛马互斥，一草一主） */
const grassClaims = new Map<string, GrassEater>();

function releaseGrassClaims(owner: GrassEater): void {
  for (const [id, who] of grassClaims) {
    if (who === owner) grassClaims.delete(id);
  }
}

function isGrassFreeOrMine(
  grassId: string,
  self: GrassEater,
): boolean {
  if (!grassId) return false;
  const owner = grassClaims.get(grassId);
  if (!owner || owner === self) return true;
  if (!owner.isAlive || owner.destroyed) {
    grassClaims.delete(grassId);
    return true;
  }
  return false;
}

type GrassPatch = {
  members: CreatureEcologyContext['grasses'][number][];
  centerX: number;
  centerY: number;
};

/**
 * 食草基类：认领 4 棵草作牧场；在内部踱步啃草（草变小不消失）；饿死。
 */
abstract class GrassEater extends Spider {
  private hunger: number;
  private readonly ecoCfg: HerbivoreEco;
  /** 认领的草 id（最多 4） */
  private pastureIds: string[] = [];
  /** 排泄粑粑倒计时（15s ~ 30s，频率翻倍） */
  private poopTimer = 10 + Math.random() * 12.5;

  protected constructor(
    worldX: number,
    worldY: number,
    options: FarmAnimalOptions,
    scale: number,
    appearance: { textureUrl: string; label: string; spriteLabel: string },
    ecoCfg: HerbivoreEco,
  ) {
    super(
      worldX,
      worldY,
      animalOptions(options, scale, appearance),
    );
    this.ecoCfg = ecoCfg;
    this.hunger = ecoCfg.startHunger;
  }

  get hunger01(): number {
    return this.hunger;
  }

  override update(
    deltaMS: number,
    playerWorldX: number,
    playerWorldY: number,
    playerBodyProfileId: BodyProfileId | null = null,
    ecology: CreatureEcologyContext | null = null,
  ) {
    if (!this.isAlive || this.destroyed) {
      releaseGrassClaims(this);
      this.pastureIds = [];
    }
    return super.update(
      deltaMS,
      playerWorldX,
      playerWorldY,
      playerBodyProfileId,
      ecology,
    );
  }

  private tickPoop(dt: number): void {
    if (!this.isAlive || this.destroyed || !this.ecology?.spawnDung) return;
    this.poopTimer -= dt;
    if (this.poopTimer <= 0) {
      this.poopTimer = 17.5 + Math.random() * 12.5;
      const backAngle = (this.facingDir > 0 ? Math.PI : 0) + (Math.random() - 0.5) * 0.5;
      const dungX = this.worldX + Math.cos(backAngle) * 12;
      const dungY = this.worldY + Math.sin(backAngle) * 12;
      this.ecology.spawnDung(dungX, dungY);
    }
  }

  protected override updateAI(
    dt: number,
    playerX: number,
    playerY: number,
    playerBodyProfileId: BodyProfileId | null = null,
  ): { moved: boolean; attackHit: SpiderAttackHit | null } {
    if (this.locked) {
      return super.updateAI(dt, playerX, playerY, playerBodyProfileId);
    }

    this.tickPoop(dt);

    const cfg = this.ecoCfg;
    this.hunger = Math.min(1, this.hunger + cfg.hungerPerSec * dt);

    const eco = this.ecology;
    if (eco && this.hunger >= 1) {
      releaseGrassClaims(this);
      this.pastureIds = [];
      this.applyDamage(this.maximumHp + 1);
      if (!this.isAlive) {
        eco.removeCreature(this);
      }
      return { moved: false, attackHit: null };
    }

    const hs = hungerSenseAndSearch(
      this.hunger,
      cfg.grassSense,
      cfg.forageSpeed,
    );

    if (eco) {
      const patch = this.refreshPasture(eco, hs.sense);
      if (patch) {
        return this.liveInGrassPatch(dt, patch, eco, hs);
      }
    }

    // 没有空闲牧场：找草
    return {
      moved: this.updateSearchRoam(dt, {
        radius: hs.searchRadius,
        speed: hs.panicking ? hs.searchSpeed : ANIMAL_ROAM.idleSpeed,
        pauseMin: hs.panicking ? hs.pauseMin : ANIMAL_ROAM.idlePauseMin,
        pauseMax: hs.panicking ? hs.pauseMax : ANIMAL_ROAM.idlePauseMax,
        preferFar: hs.panicking ? 0.72 : 0.58,
        leisurely: !hs.panicking,
      }),
      attackHit: null,
    };
  }

  /**
   * 维护 4 草牧场：只占无人认领的草；牛马之间也互斥。
   */
  private refreshPasture(
    eco: CreatureEcologyContext,
    senseRange: number,
  ): GrassPatch | null {
    // 同步已有认领：草还在、仍为大草 (large) 且仍归自己
    const stillMembers: CreatureEcologyContext['grasses'][number][] = [];
    for (const id of this.pastureIds) {
      const g = eco.grasses.find((x) => x.grassId === id);
      if (!g || g.size !== 'large') {
        grassClaims.delete(id);
        continue;
      }
      if (!isGrassFreeOrMine(id, this)) continue;
      grassClaims.set(id, this);
      stillMembers.push(g);
    }
    this.pastureIds = stillMembers.map((g) => g.grassId);

    // 补满到 4 棵：在现有中心附近找空闲大草
    if (this.pastureIds.length < PASTURE_GRASS_COUNT) {
      this.fillPasture(eco, senseRange, stillMembers);
    }

    if (this.pastureIds.length === 0) return null;

    const members = this.pastureIds
      .map((id) => eco.grasses.find((g) => g.grassId === id))
      .filter((g): g is CreatureEcologyContext['grasses'][number] => !!g);

    if (members.length === 0) {
      releaseGrassClaims(this);
      this.pastureIds = [];
      return null;
    }

    let sumX = 0;
    let sumY = 0;
    let wSum = 0;
    for (const g of members) {
      const w = 1.5;
      sumX += g.worldX * w;
      sumY += g.worldY * w;
      wSum += w;
    }

    return {
      members,
      centerX: sumX / wSum,
      centerY: sumY / wSum,
    };
  }

  /** 从空闲大草中凑满 4 棵 */
  private fillPasture(
    eco: CreatureEcologyContext,
    senseRange: number,
    current: CreatureEcologyContext['grasses'][number][],
  ): void {
    const free = eco.grasses.filter(
      (g) =>
        g.size === 'large' &&
        g.grassId &&
        isGrassFreeOrMine(g.grassId, this) &&
        !this.pastureIds.includes(g.grassId),
    );
    if (free.length === 0) return;

    // 有现有成员：围着它们补；否则以自己为中心找种子
    let seed: CreatureEcologyContext['grasses'][number] | null =
      current[0] ?? null;
    if (!seed) {
      let bestD = senseRange;
      for (const g of free) {
        const d = Math.hypot(g.worldX - this.worldX, g.worldY - this.worldY);
        if (d < bestD) {
          bestD = d;
          seed = g;
        }
      }
    }
    if (!seed) return;

    // 以种子为中心，按距离收纳空闲草直到 4
    const ordered = free
      .map((g) => ({
        g,
        d: Math.hypot(g.worldX - seed!.worldX, g.worldY - seed!.worldY),
      }))
      .filter((x) => x.d <= GRASS_COMFORT.clusterR * 1.35)
      .sort((a, b) => a.d - b.d);

    // 种子优先
    if (seed.grassId && isGrassFreeOrMine(seed.grassId, this)) {
      if (!this.pastureIds.includes(seed.grassId)) {
        this.pastureIds.push(seed.grassId);
        grassClaims.set(seed.grassId, this);
      }
    }

    for (const { g } of ordered) {
      if (this.pastureIds.length >= PASTURE_GRASS_COUNT) break;
      if (!g.grassId || this.pastureIds.includes(g.grassId)) continue;
      if (!isGrassFreeOrMine(g.grassId, this)) continue;
      this.pastureIds.push(g.grassId);
      grassClaims.set(g.grassId, this);
    }
  }

  private grassNestScore(
    x: number,
    y: number,
    members: CreatureEcologyContext['grasses'][number][],
    centerX: number,
    centerY: number,
  ): number {
    let near = 0;
    for (const g of members) {
      const d = Math.hypot(g.worldX - x, g.worldY - y);
      if (d <= GRASS_COMFORT.nestR) {
        near += 1 + (1 - d / GRASS_COMFORT.nestR) * 0.35;
      }
    }
    const toCenter = Math.hypot(x - centerX, y - centerY);
    const centerBonus =
      GRASS_COMFORT.centerScore *
      Math.max(0, 1 - toCenter / (GRASS_COMFORT.strollR * 1.25));
    return near * GRASS_COMFORT.densityScore + centerBonus;
  }

  private pickGrassInteriorWaypoint(patch: GrassPatch): void {
    const eco = this.ecology;
    let bestX = patch.centerX;
    let bestY = patch.centerY;
    let bestScore = -Infinity;

    for (let i = 0; i < GRASS_COMFORT.waypointSamples; i++) {
      const u = Math.random();
      const band =
        u < 0.55
          ? Math.random() * GRASS_COMFORT.coreR
          : GRASS_COMFORT.coreR +
            Math.random() * (GRASS_COMFORT.strollR - GRASS_COMFORT.coreR);
      const ang = Math.random() * Math.PI * 2;
      const x = patch.centerX + Math.cos(ang) * band;
      const y = patch.centerY + Math.sin(ang) * band;

      let score =
        this.grassNestScore(
          x,
          y,
          patch.members,
          patch.centerX,
          patch.centerY,
        ) +
        Math.random() * 12;

      if (eco) {
        let minPeer = Infinity;
        for (const c of eco.creatures) {
          if (c === this || !c.isAlive) continue;
          const d = Math.hypot(c.worldX - x, c.worldY - y);
          if (d < minPeer) minPeer = d;
        }
        if (Number.isFinite(minPeer)) {
          score += Math.min(minPeer, 100) * 0.25;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestX = x;
        bestY = y;
      }
    }

    this.patrolTargetX = bestX;
    this.patrolTargetY = bestY;
  }

  /** 在自己的 4 草牧场内活动；啃草变小不消失 */
  private liveInGrassPatch(
    dt: number,
    patch: GrassPatch,
    eco: CreatureEcologyContext,
    hs: ReturnType<typeof hungerSenseAndSearch>,
  ): { moved: boolean; attackHit: SpiderAttackHit | null } {
    const cfg = this.ecoCfg;
    const distCenter = Math.hypot(
      patch.centerX - this.worldX,
      patch.centerY - this.worldY,
    );
    const hungry = this.hunger >= cfg.seekGrassAt;
    const nestHere = this.grassNestScore(
      this.worldX,
      this.worldY,
      patch.members,
      patch.centerX,
      patch.centerY,
    );

    const tryEat = (): boolean => {
      if (!hungry) return false;
      let best: CreatureEcologyContext['grasses'][number] | null = null;
      let bestD = cfg.eatRange;
      for (const g of patch.members) {
        // 只啃自己牧场里的草，且只能吃成熟的大草 (large)
        if (!g.grassId || !this.pastureIds.includes(g.grassId)) continue;
        const live = eco.grasses.find((x) => x.grassId === g.grassId);
        if (!live || live.size !== 'large') continue;
        // GrassEntity 才有 isGrazable
        const grazable =
          'isGrazable' in live
            ? (live as { isGrazable: boolean }).isGrazable
            : true;
        if (!grazable) continue;
        const d = Math.hypot(
          live.worldX - this.worldX,
          live.worldY - this.worldY,
        );
        if (d <= bestD) {
          bestD = d;
          best = live;
        }
      }
      if (!best) return false;
      // 按啃前体型回饱；草只会变小
      const sizeBefore = best.size;
      const result = eco.consumeGrass(best);
      if (!result) return false;
      const feed =
        cfg.grassFeed[result] ??
        cfg.grassFeed[sizeBefore] ??
        cfg.grassFeed.medium;
      this.hunger = Math.max(0, this.hunger - feed);
      return true;
    };

    if (tryEat()) {
      return { moved: false, attackHit: null };
    }

    if (distCenter > GRASS_COMFORT.enterR) {
      this.aiState = 'chase';
      this.patrolPause = 0;
      const moved = this.moveTowardAvoidingTrees(
        patch.centerX,
        patch.centerY,
        hungry ? hs.approachSpeed : GRASS_COMFORT.strollSpeed * 1.15,
        dt,
        GRASS_COMFORT.coreR * 0.6,
        26,
      );
      return { moved, attackHit: null };
    }

    this.aiState = 'patrol';

    const targetOut =
      Math.hypot(
        this.patrolTargetX - patch.centerX,
        this.patrolTargetY - patch.centerY,
      ) >
      GRASS_COMFORT.strollR * 1.35;
    if (targetOut) {
      this.pickGrassInteriorWaypoint(patch);
      this.patrolPause = 0;
    }

    if (distCenter > GRASS_COMFORT.coreR * 0.85) {
      const pull = GRASS_COMFORT.centerPull * (hungry ? 1.15 : 1) * dt;
      const inv = 1 / distCenter;
      this.worldX += (patch.centerX - this.worldX) * inv * pull;
      this.worldY += (patch.centerY - this.worldY) * inv * pull;
    }

    const cozy = nestHere >= GRASS_COMFORT.densityScore * 1.2;
    const pauseMin = cozy
      ? GRASS_COMFORT.restPauseMin
      : ANIMAL_ROAM.grazePauseMin * 0.7;
    const pauseMax = cozy
      ? GRASS_COMFORT.restPauseMax
      : hungry
        ? ANIMAL_ROAM.grazePauseMax * 0.45
        : GRASS_COMFORT.restPauseMax * 0.75;

    if (this.patrolPause > 0) {
      this.patrolPause = Math.max(0, this.patrolPause - dt);
      if (this.patrolPause <= 0) {
        this.pickGrassInteriorWaypoint(patch);
      }
      tryEat();
      return { moved: false, attackHit: null };
    }

    const dx = this.patrolTargetX - this.worldX;
    const dy = this.patrolTargetY - this.worldY;
    const dist = Math.hypot(dx, dy);
    if (dist <= 12) {
      this.patrolPause =
        pauseMin + Math.random() * Math.max(0, pauseMax - pauseMin);
      this.pickGrassInteriorWaypoint(patch);
      tryEat();
      return { moved: false, attackHit: null };
    }

    const speed = hungry
      ? hs.approachSpeed * 0.7
      : GRASS_COMFORT.strollSpeed;
    const step = Math.min(speed * dt, dist);
    const inv = 1 / dist;
    this.worldX += dx * inv * step;
    this.worldY += dy * inv * step;
    this.faceToward(this.patrolTargetX, this.patrolTargetY);
    tryEat();
    return { moved: true, attackHit: null };
  }
}

/** 牛：慢步觅食，大草更顶饱；没草可吃会饿死 */
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

/** 马：跑得快、饿得也快；没草可吃会饿死 */
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

export class Wolf extends RoamingAnimal {
  constructor(worldX: number, worldY: number, options: FarmAnimalOptions = {}) {
    super(
      worldX,
      worldY,
      animalOptions(options, ANIMAL_SCALE.wolf, {
        textureUrl: '/assets/wolf/wolf.png',
        label: 'Wolf',
        spriteLabel: 'WolfSprite',
      }),
    );
  }
}

export class Bear extends RoamingAnimal {
  constructor(worldX: number, worldY: number, options: FarmAnimalOptions = {}) {
    super(
      worldX,
      worldY,
      animalOptions(options, ANIMAL_SCALE.bear, {
        textureUrl: '/assets/bear/bear.png',
        label: 'Bear',
        spriteLabel: 'BearSprite',
      }),
    );
  }
}
