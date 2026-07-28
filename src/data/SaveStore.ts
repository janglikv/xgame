import type { CharacterId } from '../entities/types';
import { createDefaultSave } from './defaults';
import type { SaveData, SavedScene } from './types';

const STORAGE_KEY = 'lu-o-lu:save:v1';

function isCharacterId(value: unknown): value is CharacterId {
  return value === 'bomb-girl' || value === 'ice-ranger';
}

function parseSavedScene(raw: unknown): SavedScene | null {
  if (!raw || typeof raw !== 'object') return null;
  const scene = raw as { kind?: unknown; levelId?: unknown };
  if (scene.kind === 'main') return { kind: 'main' };
  if (scene.kind === 'level') {
    const levelId =
      typeof scene.levelId === 'string' && scene.levelId.length > 0
        ? scene.levelId
        : 'level-1';
    return { kind: 'level', levelId };
  }
  return null;
}

function parseLastCharacter(raw: unknown): CharacterId {
  return isCharacterId(raw) ? raw : 'bomb-girl';
}

/** 校验并归一化原始 JSON；无法识别则返回 null */
function parseSaveData(raw: unknown): SaveData | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as {
    version?: unknown;
    progress?: { scene?: unknown; lastCharacter?: unknown };
  };
  if (data.version !== 1) return null;
  const scene = parseSavedScene(data.progress?.scene);
  if (!scene) return null;
  return {
    version: 1,
    progress: {
      scene,
      lastCharacter: parseLastCharacter(data.progress?.lastCharacter),
    },
  };
}

/**
 * localStorage 存档读写。
 * 失败时静默回退，不打断开局。
 */
export class LocalSaveStore {
  load(): SaveData {
    try {
      const text = localStorage.getItem(STORAGE_KEY);
      if (!text) return createDefaultSave();
      const parsed: unknown = JSON.parse(text);
      return parseSaveData(parsed) ?? createDefaultSave();
    } catch {
      return createDefaultSave();
    }
  }

  save(data: SaveData): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (err) {
      console.warn('[SaveStore] save failed:', err);
    }
  }

  /** 只更新场景位置并立刻落盘 */
  saveScene(scene: SavedScene): void {
    const data = this.load();
    data.progress.scene = scene;
    this.save(data);
  }

  getLastCharacter(): CharacterId {
    return this.load().progress.lastCharacter;
  }

  /** 更新上次操控角色并立刻落盘 */
  saveLastCharacter(id: CharacterId): void {
    const data = this.load();
    data.progress.lastCharacter = id;
    this.save(data);
  }

  clear(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
}
