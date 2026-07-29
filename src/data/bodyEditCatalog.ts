/**
 * 碰撞编辑器主体目录（视觉预览 + 脚底锚点）。
 *
 * 列表自动来自：
 *   CHARACTER_IDS → CHARACTER_SUBJECTS
 *   ENEMY_KINDS   → CREATURE_SUBJECTS
 *   ENV_SUBJECTS
 *
 * 新增动物：在 maps/types ENEMY_KINDS 追加后，本文件 CREATURE_SUBJECTS
 * 会因 `Record<EnemyKind, …>` 缺 key 编译失败，补上 url/scale 即可自动进列表。
 * 同时需在 bodyProfiles.BODY_PROFILES 补默认 solid/hurt。
 */

import { ANIMAL_SCALE } from '../entities/animals/animalCommon';
import { CHARACTER_IDS, type CharacterId } from '../entities/types';
import {
  ENV_BODY_PROFILE_IDS,
  type BodyProfileId,
} from './bodyProfiles';
import {
  isCharacterEnabled,
  isEnemyKindEnabled,
} from './contentDisable';
import { GRASS_SIZE_PROFILE } from './grassProfiles';
import { ENEMY_KINDS, type EnemyKind } from './maps/types';
import { TREE_SIZE_PROFILE } from './treeProfiles';

export type BodyEditSubjectDef =
  | {
      id: BodyProfileId;
      kind: 'sprite';
      url: string;
      scale: number;
      footY: number;
    }
  | {
      id: BodyProfileId;
      kind: 'pine';
      pineScale: number;
      tint: number;
    }
  | {
      id: BodyProfileId;
      kind: 'apple';
      pineScale: number;
      tint: number;
    }
  | {
      id: BodyProfileId;
      kind: 'grass';
      grassScale: number;
      tint: number;
    };

/** 玩家角色预览 */
const CHARACTER_SUBJECTS = {
  'bomb-girl': {
    id: 'bomb-girl',
    kind: 'sprite',
    url: '/assets/bomb-girl/preview.png',
    scale: 0.07,
    footY: 0.92,
  },
  'ice-ranger': {
    id: 'ice-ranger',
    kind: 'sprite',
    url: '/assets/ice-ranger/preview.png',
    scale: 0.066,
    footY: 0.92,
  },
} as const satisfies Record<CharacterId, BodyEditSubjectDef>;

/**
 * 全部敌人 / 动物预览。
 * 必须覆盖每一个 EnemyKind —— 漏写会直接 tsc 报错。
 */
const CREATURE_SUBJECTS = {
  spider: {
    id: 'spider',
    kind: 'sprite',
    url: '/assets/spider/spider.png',
    scale: 0.1,
    footY: 0.88,
  },
  'flame-flower': {
    id: 'flame-flower',
    kind: 'sprite',
    url: '/assets/flame-flower/flame-flower.png',
    scale: 0.09,
    footY: 0.94,
  },
  'wooden-dummy': {
    id: 'wooden-dummy',
    kind: 'sprite',
    url: '/assets/wooden-dummy/wooden-dummy.png',
    scale: 0.09,
    footY: 0.96,
  },
  chicken: {
    id: 'chicken',
    kind: 'sprite',
    url: '/assets/chicken/chicken.png',
    scale: ANIMAL_SCALE.chicken,
    footY: 0.92,
  },
  pig: {
    id: 'pig',
    kind: 'sprite',
    url: '/assets/pig/pig.png',
    scale: ANIMAL_SCALE.pig,
    footY: 0.92,
  },
  cow: {
    id: 'cow',
    kind: 'sprite',
    url: '/assets/cow/cow.png',
    scale: ANIMAL_SCALE.cow,
    footY: 0.92,
  },
  horse: {
    id: 'horse',
    kind: 'sprite',
    url: '/assets/horse/horse.png',
    scale: ANIMAL_SCALE.horse,
    footY: 0.92,
  },
  wolf: {
    id: 'wolf',
    kind: 'sprite',
    url: '/assets/wolf/wolf.png',
    scale: ANIMAL_SCALE.wolf,
    footY: 0.92,
  },
  bear: {
    id: 'bear',
    kind: 'sprite',
    url: '/assets/bear/bear.png',
    scale: ANIMAL_SCALE.bear,
    footY: 0.92,
  },
} as const satisfies Record<EnemyKind, BodyEditSubjectDef>;

/** 环境主体（树 / 草）：不在 EnemyKind 内 */
const ENV_SUBJECTS = {
  tree: {
    id: 'tree',
    kind: 'pine',
    pineScale: TREE_SIZE_PROFILE.medium.scale,
    tint: TREE_SIZE_PROFILE.medium.tint,
  },
  'apple-tree': {
    id: 'apple-tree',
    kind: 'apple',
    pineScale: TREE_SIZE_PROFILE.medium.scale,
    tint: TREE_SIZE_PROFILE.medium.tint,
  },
  grass: {
    id: 'grass',
    kind: 'grass',
    grassScale: GRASS_SIZE_PROFILE.medium.scale,
    tint: GRASS_SIZE_PROFILE.medium.tint,
  },
} as const satisfies Record<(typeof ENV_BODY_PROFILE_IDS)[number], BodyEditSubjectDef>;

/**
 * 碰撞编辑器主体列表（有序）。
 * 角色 / 敌人受 contentDisable 控制（下线则不进列表、也不上场）。
 * BodyEditScene 只读此函数，勿再手写 SUBJECTS。
 */
export function getBodyEditSubjects(): BodyEditSubjectDef[] {
  const list: BodyEditSubjectDef[] = [];
  for (const id of CHARACTER_IDS) {
    if (isCharacterEnabled(id)) list.push(CHARACTER_SUBJECTS[id]);
  }
  for (const id of ENEMY_KINDS) {
    if (isEnemyKindEnabled(id)) list.push(CREATURE_SUBJECTS[id]);
  }
  for (const id of ENV_BODY_PROFILE_IDS) {
    list.push(ENV_SUBJECTS[id]);
  }
  return list;
}

/**
 * 编译期：目录 id 必须覆盖全部 BodyProfileId。
 * 漏登记时 tsc 报 “Type 'false' is not assignable to type 'true'”。
 */
type CatalogIds =
  | keyof typeof CHARACTER_SUBJECTS
  | keyof typeof CREATURE_SUBJECTS
  | keyof typeof ENV_SUBJECTS;

({}) as Record<CatalogIds, unknown> satisfies Record<BodyProfileId, unknown>;
({}) as Record<BodyProfileId, unknown> satisfies Record<CatalogIds, unknown>;
