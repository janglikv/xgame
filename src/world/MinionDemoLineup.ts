import type { Scene, ShadowGenerator } from '@babylonjs/core';
import {
  FootRingBuff,
  FORMATION_LABELS,
  FORMATION_STYLES,
  type FormationStyle,
} from './FootRingBuff';
import { Minion, type MinionOptions } from './Minion';
import type { FaceStyle } from './minion/faces';

/** 单条展示副本的外观预设（与布局解耦） */
export interface DemoPreset {
  label: string;
  options: Omit<MinionOptions, 'facePositiveX' | 'shadowGenerator'>;
  /** 脚底阵法样式；不设则无阵 */
  formation?: FormationStyle;
}

/** 同一类外观排成一排 */
export interface DemoRow {
  /** 类别：表情 / 阵法 / 肤色 / 武器 … */
  category: string;
  presets: readonly DemoPreset[];
}

/** 阵法排：无阵 + 全部复杂样式 */
const FORMATION_ROW_PRESETS: DemoPreset[] = [
  { label: '无阵', options: {} },
  ...FORMATION_STYLES.map((style) => ({
    label: FORMATION_LABELS[style],
    options: {},
    formation: style,
  })),
];

/**
 * 多排展示：每排只变一类属性，便于对比。
 * 增删改外观只改这里。
 */
export const DEMO_ROWS: readonly DemoRow[] = [
  {
    category: '表情',
    presets: [
      { label: '可爱', options: { face: 'cute' } },
      { label: '凶狠', options: { face: 'fierce' } },
      { label: '呆萌浓眉', options: { face: 'dumb' } },
      { label: '悲伤', options: { face: 'sad' } },
      { label: '面无表情', options: { face: 'blank' } },
      { label: '马赛克可爱', options: { face: 'cute', mosaicFace: true } },
    ],
  },
  {
    category: '阵法',
    presets: FORMATION_ROW_PRESETS,
  },
  {
    category: '肤色',
    // 无色（纯白）+ 灰黑 + 六色，身体/手脚/脸底同色
    presets: [
      { label: '纯白', options: { bodyColor: 0xffffff } },
      { label: '灰黑', options: { bodyColor: 0x3a3a42 } },
      { label: '红', options: { bodyColor: 0xe85d5d } },
      { label: '橙', options: { bodyColor: 0xf0a04b } },
      { label: '黄', options: { bodyColor: 0xf2d35b } },
      { label: '绿', options: { bodyColor: 0x5fbf6b } },
      { label: '蓝', options: { bodyColor: 0x5b9dff } },
      { label: '紫', options: { bodyColor: 0xb07cff } },
    ],
  },
  {
    category: '武器',
    presets: [
      { label: '空手', options: {} },
      { label: '魔法杖', options: { magicStaff: true } },
    ],
  },
  {
    category: '配件',
    presets: [
      { label: '无帽', options: {} },
      { label: '红色巫师帽', options: { redHat: true } },
    ],
  },
  {
    category: '体型',
    presets: [
      { label: '正常', options: {} },
      { label: '缩小一半', options: { scaleMultiplier: 0.5 } },
      { label: '低面数', options: { lowPolyFlat: true } },
    ],
  },
] as const;

export interface DemoLineupConfig {
  /** 第一排的 X（沿 +X 逐排展开） */
  x0?: number;
  /** 排与排之间的 X 间距 */
  rowGap?: number;
  /** 同一排内 Z 范围 [min, max]，按该排人数均匀分布 */
  zMin?: number;
  zMax?: number;
  facePositiveX?: boolean;
}

export interface DemoLineup {
  minions: Minion[];
  /** 所有挂了脚底阵法的 buff */
  buffs: FootRingBuff[];
  /** 兼容旧字段：第一个脚底 buff（若有） */
  firstBuff: FootRingBuff | null;
  /** 每帧调用：静止站立 + 驱动法杖 / 阵法等特效 */
  update(dt: number): void;
}

/**
 * 生成多排展示副本（每排同类），并按预设挂脚底阵法。
 * main 只负责调用 spawn + update，不内联分支配置。
 */
export function spawnMinionDemoLineup(
  scene: Scene,
  shadowGenerator?: ShadowGenerator,
  config: DemoLineupConfig = {},
): DemoLineup {
  const x0 = config.x0 ?? 1;
  const rowGap = config.rowGap ?? 1.6;
  const zMin = config.zMin ?? -5;
  const zMax = config.zMax ?? 5;
  const facePositiveX = config.facePositiveX ?? true;

  const minions: Minion[] = [];
  const buffs: FootRingBuff[] = [];

  DEMO_ROWS.forEach((row, rowIndex) => {
    const x = x0 + rowIndex * rowGap;
    const n = row.presets.length;
    row.presets.forEach((preset, colIndex) => {
      const t = n === 1 ? 0.5 : colIndex / (n - 1);
      const z = zMin + t * (zMax - zMin);
      const minion = new Minion(scene, x, z, {
        facePositiveX,
        shadowGenerator,
        ...preset.options,
      });
      minions.push(minion);
      if (preset.formation) {
        buffs.push(new FootRingBuff(scene, minion.root, preset.formation));
      }
    });
  });

  return {
    minions,
    buffs,
    firstBuff: buffs[0] ?? null,
    update(dt: number): void {
      for (const m of minions) {
        m.update(dt, false);
      }
      for (const b of buffs) {
        b.update(dt);
      }
    },
  };
}

/** 便于外部只取 face 字面量时不直接依赖 faces 路径 */
export type { FaceStyle, FormationStyle };
