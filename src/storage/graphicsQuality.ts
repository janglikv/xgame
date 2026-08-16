import { ShadowGenerator, type Scene, DirectionalLight } from '@babylonjs/core';

export type GraphicsQuality = 'low' | 'medium' | 'high';

export const GRAPHICS_LABELS: Record<GraphicsQuality, string> = {
  low: '低（流畅）',
  medium: '中（均衡）',
  high: '高（精细）',
};

export interface GraphicsPreset {
  /** 设备像素比上限 */
  dprCap: number;
  shadowMapSize: number;
  shadowQuality: number;
  shadowRefresh: number;
  /** 敌军是否投阴影 */
  enemyShadows: 'none' | 'boss' | 'all';
  /** 谁用法杖简模 */
  liteStaff: 'small' | 'nonBoss' | 'none';
  /** 缩小兵是否低面数 */
  smallLowPoly: boolean;
  hideHealthUntilHit: boolean;
}

const PRESETS: Record<GraphicsQuality, GraphicsPreset> = {
  low: {
    dprCap: 1,
    shadowMapSize: 512,
    shadowQuality: ShadowGenerator.QUALITY_LOW,
    shadowRefresh: 4,
    enemyShadows: 'boss',
    liteStaff: 'nonBoss',
    smallLowPoly: true,
    hideHealthUntilHit: true,
  },
  medium: {
    dprCap: 1.5,
    shadowMapSize: 1024,
    shadowQuality: ShadowGenerator.QUALITY_MEDIUM,
    shadowRefresh: 2,
    enemyShadows: 'all',
    liteStaff: 'small',
    smallLowPoly: false,
    hideHealthUntilHit: false,
  },
  high: {
    dprCap: 2,
    shadowMapSize: 2048,
    shadowQuality: ShadowGenerator.QUALITY_HIGH,
    shadowRefresh: 1,
    enemyShadows: 'all',
    liteStaff: 'none',
    smallLowPoly: false,
    hideHealthUntilHit: false,
  },
};

export function getGraphicsPreset(quality: GraphicsQuality): GraphicsPreset {
  return PRESETS[quality] ?? PRESETS.medium;
}

export function isGraphicsQuality(v: unknown): v is GraphicsQuality {
  return v === 'low' || v === 'medium' || v === 'high';
}

/** 已加载场景上立刻改阴影过滤与刷新率（贴图尺寸需重建场景） */
export function applyLiveShadowQuality(scene: Scene, quality: GraphicsQuality): void {
  const p = getGraphicsPreset(quality);
  for (const light of scene.lights) {
    if (!(light instanceof DirectionalLight)) continue;
    const sg = light.getShadowGenerator();
    if (!(sg instanceof ShadowGenerator)) continue;
    sg.filteringQuality = p.shadowQuality;
    const map = sg.getShadowMap();
    if (map) map.refreshRate = p.shadowRefresh;
  }
}
