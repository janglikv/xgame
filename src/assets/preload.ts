import { loadBombTextures } from '../entities/BombProjectile';
import { loadSpearTexture } from '../entities/SpearProjectile';
import { loadSpiderTexture } from '../entities/Spider';

export type LevelPreloadOptions = {
  /** 地图贴图 / 生成资源 */
  loadMap: () => Promise<void>;
  /** 角色实体 load() */
  loadCharacters: Array<() => Promise<void>>;
  /** 黑夜关等需要蜘蛛贴图时 */
  spiders?: boolean;
};

/**
 * 关卡共用资源并行预加载。
 * 炸弹 / 飞剑 /（可选）蜘蛛贴图与地图、角色一起拉，避免各处零散 load*。
 */
export async function preloadLevelAssets(
  options: LevelPreloadOptions,
): Promise<void> {
  const loads: Promise<void>[] = [
    options.loadMap(),
    ...options.loadCharacters.map((fn) => fn()),
    loadBombTextures(),
    loadSpearTexture(),
  ];
  if (options.spiders) {
    loads.push(loadSpiderTexture());
  }
  await Promise.all(loads);
}
