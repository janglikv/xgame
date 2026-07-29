import { DEFAULT_PLAYABLE_CHARACTER } from './contentDisable';
import type { SaveData } from './types';

/** 新档 / 损坏档回退 */
export function createDefaultSave(): SaveData {
  return {
    version: 1,
    progress: {
      scene: { kind: 'main' },
      lastCharacter: DEFAULT_PLAYABLE_CHARACTER,
    },
  };
}
