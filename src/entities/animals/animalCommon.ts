import type { CreatureKind } from '../creatureKinds';
import type {
  WalkBobConfig,
  WorldCreatureOptions,
} from '../WorldCreature';
import { getRuntimeTreeObstacles } from '../../data/maps';

export type FarmAnimalOptions = Pick<WorldCreatureOptions, 'scale' | 'maxHp'>;

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
export const ANIMAL_WALK_BOB = {
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
export const ANIMAL_LEASH_RANGE = 380;
/** 兼容旧字段：日常游荡参考半径 */
export const ANIMAL_TERRITORY = 320;
/** 个人空间：靠近同伴时软推开（世界像素） */
export const ANIMAL_PERSONAL_SPACE = 86;
/** 软分散移速 */
export const ANIMAL_SEPARATION_SPEED = 78;

export const FOOT_ANCHOR_Y = 0.92;
export const HP_BAR_OFFSET_Y = 720;

/** 日常闲逛（当前位置滚动） */
export const ANIMAL_ROAM = {
  idleRadius: 340,
  idleSpeed: 64,
  idlePauseMin: 0.2,
  idlePauseMax: 0.95,
} as const;

/** 猪：找苹果树睡觉 + 饿了吃掉落苹果 */
export const PIG_ECO = {
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
export const SLEEP_FX = {
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
export function clearOfTreeSolids(
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
export function animalOptions(
  options: FarmAnimalOptions,
  defaultScale: number,
  kind: CreatureKind,
  appearance: {
    textureUrl: string;
    label: string;
    spriteLabel: string;
  },
  walkBob: WalkBobConfig,
): WorldCreatureOptions {
  return {
    scale: options.scale ?? defaultScale,
    maxHp: options.maxHp,
    kind,
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
