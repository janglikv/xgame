import type { LevelTheme } from '../scenes/types';

/** 可持久化的场景位置 */
export type SavedScene =
  | { kind: 'main' }
  | { kind: 'level'; theme: LevelTheme };

/** 本地存档 schema（只扩字段、加 version，不直接塞 Pixi 对象） */
export type SaveData = {
  version: 1;
  progress: {
    scene: SavedScene;
  };
};
