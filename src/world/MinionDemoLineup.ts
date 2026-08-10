import type { Scene, ShadowGenerator } from '@babylonjs/core';
import { FootRingBuff } from './FootRingBuff';
import { Minion, type MinionOptions } from './Minion';
import type { FaceStyle } from './minion/faces';

/** 单条展示副本的外观预设（与布局解耦） */
export interface DemoPreset {
  label: string;
  options: Omit<MinionOptions, 'facePositiveX' | 'shadowGenerator'>;
}

/**
 * 10 个展示预设：只描述「长什么样」，不关心落点。
 * 增删改外观只改这里。
 */
export const DEMO_PRESETS: readonly DemoPreset[] = [
  { label: '默认纯白 + 脚底红环', options: {} },
  { label: '全身灰黑', options: { allBlack: true } },
  { label: '缩小一半', options: { scaleMultiplier: 0.5 } },
  { label: '红色巫师帽', options: { redHat: true } },
  { label: '浮夸魔法杖', options: { magicStaff: true } },
  { label: '凶狠脸', options: { face: 'fierce' } },
  {
    label: '低面数 + 可爱脸马赛克',
    options: { lowPolyFlat: true, mosaicFace: true, face: 'cute' },
  },
  { label: '呆萌浓眉', options: { face: 'dumb' } },
  { label: '悲伤', options: { face: 'sad' } },
  { label: '面无表情', options: { face: 'blank' } },
] as const;

export interface DemoLineupConfig {
  /** 统一 X */
  x?: number;
  /** Z 范围 [min, max]，在预设数量上均匀分布 */
  zMin?: number;
  zMax?: number;
  facePositiveX?: boolean;
}

export interface DemoLineup {
  minions: Minion[];
  /** 第一个副本的脚底 buff（若有） */
  firstBuff: FootRingBuff | null;
  /** 每帧调用：静止站立 + 驱动法杖等特效 */
  update(dt: number): void;
}

/**
 * 生成展示副本阵列，并挂上第一个的脚底红环。
 * main 只负责调用 spawn + update，不内联分支配置。
 */
export function spawnMinionDemoLineup(
  scene: Scene,
  shadowGenerator?: ShadowGenerator,
  config: DemoLineupConfig = {},
): DemoLineup {
  const x = config.x ?? 1;
  const zMin = config.zMin ?? -5;
  const zMax = config.zMax ?? 5;
  const facePositiveX = config.facePositiveX ?? true;
  const n = DEMO_PRESETS.length;

  const minions: Minion[] = DEMO_PRESETS.map((preset, i) => {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const z = zMin + t * (zMax - zMin);
    return new Minion(scene, x, z, {
      facePositiveX,
      shadowGenerator,
      ...preset.options,
    });
  });

  const firstBuff =
    minions.length > 0 ? new FootRingBuff(scene, minions[0]!.root) : null;

  return {
    minions,
    firstBuff,
    update(dt: number): void {
      for (const m of minions) {
        m.update(dt, false);
      }
      firstBuff?.update(dt);
    },
  };
}

/** 便于外部只取 face 字面量时不直接依赖 faces 路径 */
export type { FaceStyle };
