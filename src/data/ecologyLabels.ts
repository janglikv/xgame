/** 可被狼猎杀 / 计入食草自然种群的农场动物 display label */
export const FARM_HERBIVORE_LABELS = [
  'Chicken',
  'Pig',
  'Cow',
  'Horse',
] as const;

export type FarmHerbivoreLabel = (typeof FARM_HERBIVORE_LABELS)[number];

/** 自然孕育种群上限与触发阈值 */
export const NATURAL_SPAWN = {
  /** 全场狼上限 */
  maxWolves: 3,
  /** 全场农场食草（鸡猪牛马）自然孕育上限 */
  maxFarmHerbivores: 20,
  /** 草株数达到后才孕育牛马 */
  grassForHerbivores: 60,
  /** 食草动物达到后才引狼 */
  herbivoresForWolf: 8,
} as const;
