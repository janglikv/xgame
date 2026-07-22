import { createDefaultSave } from './defaults';
import type { SaveData, SavedScene } from './types';

const STORAGE_KEY = 'lu-o-lu:save:v1';

function isLevelTheme(value: unknown): value is 'day' | 'night' {
  return value === 'day' || value === 'night';
}

function parseSavedScene(raw: unknown): SavedScene | null {
  if (!raw || typeof raw !== 'object') return null;
  const scene = raw as { kind?: unknown; theme?: unknown };
  if (scene.kind === 'main') return { kind: 'main' };
  if (scene.kind === 'level' && isLevelTheme(scene.theme)) {
    return { kind: 'level', theme: scene.theme };
  }
  return null;
}

/** 校验并归一化原始 JSON；无法识别则返回 null */
function parseSaveData(raw: unknown): SaveData | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as { version?: unknown; progress?: { scene?: unknown } };
  if (data.version !== 1) return null;
  const scene = parseSavedScene(data.progress?.scene);
  if (!scene) return null;
  return {
    version: 1,
    progress: { scene },
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

  clear(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
}
