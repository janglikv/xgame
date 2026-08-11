import {
  HavokPlugin,
  type Scene,
  Vector3,
} from '@babylonjs/core';
import HavokPhysics from '@babylonjs/havok';
// Vite 以 URL 形式解析 wasm，打包/dev 都能找到
import havokWasmUrl from '@babylonjs/havok/lib/esm/HavokPhysics.wasm?url';

/** 世界重力（Y-up） */
export const PHYSICS_GRAVITY = new Vector3(0, -9.81, 0);

/**
 * 初始化 Havok 并挂到 scene。
 * 必须在创建任何 PhysicsAggregate / PhysicsBody 之前 await。
 */
export async function initPhysics(scene: Scene): Promise<HavokPlugin> {
  const havok = await HavokPhysics({
    locateFile: (path) => {
      if (path.endsWith('.wasm')) return havokWasmUrl;
      return path;
    },
  });
  // true = 用帧 dt 步进（适合游戏主循环）
  const plugin = new HavokPlugin(true, havok);
  scene.enablePhysics(PHYSICS_GRAVITY, plugin);
  return plugin;
}
