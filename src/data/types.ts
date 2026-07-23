import type { CharacterId } from '../entities/types';

/** 可持久化的场景位置 */
export type SavedScene =
  | { kind: 'main' }
  | { kind: 'level'; levelId: string };

/** 本地存档 schema（只扩字段、加 version，不直接塞 Pixi 对象） */
export type SaveData = {
  version: 1;
  progress: {
    scene: SavedScene;
    /** 上次操控的角色（进关默认出场） */
    lastCharacter: CharacterId;
  };
};
