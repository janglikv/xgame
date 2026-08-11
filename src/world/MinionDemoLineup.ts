import { Vector3, type Scene, type ShadowGenerator } from '@babylonjs/core';
import {
  FORMATION_LABELS,
  FORMATION_STYLES,
  type FormationStyle,
} from './FootRingBuff';
import {
  Minion,
  type AppearanceSlot,
  type MinionOptions,
} from './Minion';
import type { FaceStyle } from './minion/faces';
import { HAT_LABELS, HAT_STYLES } from './minion/hat';
import { STAFF_LABELS, STAFF_STYLES } from './minion/staff';
import { MinionPhysicsProxy } from './physics/MinionPhysicsProxy';

const _demoVel = new Vector3();

/** 展示行 category → E 键部分替换槽位 */
const CATEGORY_PARTIAL_SLOTS: Record<string, readonly AppearanceSlot[]> = {
  表情: ['face'],
  特殊效果: ['mosaicFace'],
  阵法: ['formation'],
  肤色: ['bodyColor'],
  武器: ['staff'],
  帽子: ['hat'],
  体型: ['scaleMultiplier', 'lowPolyFlat'],
};

/** 单条展示副本的外观预设（与布局解耦） */
export interface DemoPreset {
  label: string;
  options: Omit<
    MinionOptions,
    'facePositiveX' | 'shadowGenerator' | 'partialSlots' | 'formation'
  >;
  /** 脚底阵法样式；不设则无阵 */
  formation?: FormationStyle;
}

/** 同一类外观排成一排 */
export interface DemoRow {
  /** 类别：表情 / 阵法 / 肤色 / 武器 … */
  category: string;
  presets: readonly DemoPreset[];
}

/** 阵法排：全部复杂样式（去除无阵原皮） */
const FORMATION_ROW_PRESETS: DemoPreset[] = FORMATION_STYLES.map((style) => ({
  label: FORMATION_LABELS[style],
  options: {},
  formation: style,
}));

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
    ],
  },
  {
    category: '特殊效果',
    presets: [
      { label: '马赛克', options: { face: 'cute', mosaicFace: true } },
    ],
  },
  {
    category: '阵法',
    presets: FORMATION_ROW_PRESETS,
  },
  {
    category: '肤色',
    presets: [
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
    presets: STAFF_STYLES.map((style) => ({
      label: STAFF_LABELS[style],
      options: { staff: style },
    })),
  },
  {
    category: '帽子',
    presets: HAT_STYLES.map((style) => ({
      label: HAT_LABELS[style],
      options: { hat: style },
    })),
  },
  {
    category: '体型',
    presets: [
      { label: '缩小一半', options: { scaleMultiplier: 0.5 } },
      { label: '低面数', options: { lowPolyFlat: true } },
    ],
  },
] as const;

export interface DemoLineupConfig {
  /** 第一排的 X（沿 +X 逐排展开） */
  x0?: number;
  /** 排与排之间的 X 间距（固定） */
  rowGap?: number;
  /**
   * 每排右端对齐的 Z（该排最后一个角色的 Z）。
   * 同排内第 i 个（共 n 个）：z = zEnd - (n - 1 - i) * colGap
   */
  zEnd?: number;
  /** 同排内相邻角色固定间距 */
  colGap?: number;
  facePositiveX?: boolean;
  /**
   * 是否为每个展示小兵挂物理胶囊（默认 true）。
   * 须在 initPhysics 之后调用。
   */
  physics?: boolean;
  /** 物理胶囊参数；不设则用默认 */
  physicsRadius?: number;
  physicsHeight?: number;
}

export interface DemoLineup {
  minions: Minion[];
  /** 物理代理（与 minions 一一对应；physics=false 时为空） */
  physicsProxies: MinionPhysicsProxy[];
  /** 每帧调用：静止站立 + 驱动法杖 / 阵法 / 同步物理代理 */
  update(dt: number): void;
}

/**
 * 生成多排展示副本（每排同类），右对齐固定间距。
 * 每单位带 partialSlots，供悬停后 E 部分替换 / R 全量替换。
 */
export function spawnMinionDemoLineup(
  scene: Scene,
  shadowGenerator?: ShadowGenerator,
  config: DemoLineupConfig = {},
): DemoLineup {
  const x0 = config.x0 ?? 1;
  const rowGap = config.rowGap ?? 1.6;
  const zEnd = config.zEnd ?? 5;
  const colGap = config.colGap ?? 1.1;
  const facePositiveX = config.facePositiveX ?? true;
  const usePhysics = config.physics ?? true;
  const physicsRadius = config.physicsRadius ?? 0.16;
  const physicsHeight = config.physicsHeight ?? 0.55;

  const minions: Minion[] = [];
  const physicsProxies: MinionPhysicsProxy[] = [];

  DEMO_ROWS.forEach((row, rowIndex) => {
    const x = x0 + rowIndex * rowGap;
    const n = row.presets.length;
    const partialSlots = CATEGORY_PARTIAL_SLOTS[row.category] ?? [];
    row.presets.forEach((preset, colIndex) => {
      // 右对齐：每排最后一个落在 zEnd，向前按固定 colGap 排布
      const z = zEnd - (n - 1 - colIndex) * colGap;
      const minion = new Minion(scene, x, z, {
        facePositiveX,
        shadowGenerator,
        ...preset.options,
        // 阵法行：显式 formation（含 undefined→无阵，由 resolve 成 null）
        formation: preset.formation ?? null,
        partialSlots,
      });
      minions.push(minion);

      if (usePhysics) {
        // 体型缩小的展示位用略矮胶囊；pushable 才能被主角推走
        const scaleMul = preset.options.scaleMultiplier ?? 1;
        const proxy = new MinionPhysicsProxy(scene, minion.root, {
          mode: 'pushable',
          radius: physicsRadius * Math.max(0.55, scaleMul),
          height: physicsHeight * Math.max(0.55, scaleMul),
          mass: 0.5 * Math.max(0.55, scaleMul),
        });
        proxy.teleportToTarget();
        physicsProxies.push(proxy);
      }
    });
  });

  return {
    minions,
    physicsProxies,
    update(dt: number): void {
      // 上一帧物理结果 → 表现位姿；被推时跟着动、转向、走路动画
      if (physicsProxies.length > 0) {
        for (let i = 0; i < physicsProxies.length; i++) {
          const proxy = physicsProxies[i]!;
          const m = minions[i]!;
          proxy.syncToTarget();
          const spd = proxy.getHorizontalSpeed();
          const moving = spd > 0.12;
          if (moving) {
            proxy.getHorizontalVelocityToRef(_demoVel);
            m.faceToward(_demoVel.x, _demoVel.z);
          }
          m.update(dt, moving);
        }
        for (let i = physicsProxies.length; i < minions.length; i++) {
          minions[i]!.update(dt, false);
        }
      } else {
        for (const m of minions) m.update(dt, false);
      }
    },
  };
}

/** 便于外部只取 face 字面量时不直接依赖 faces 路径 */
export type { FaceStyle, FormationStyle };
