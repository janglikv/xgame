import type { CharacterId } from '../entities/types';
import { createDefaultSave } from './defaults';
import type { SaveData, SavedScene } from './types';

const STORAGE_KEY = 'lu-o-lu:save:v1';
/** 旧版散落 key，读档时迁移一次后删除 */
const LEGACY_CHARACTER_KEY = 'lu_o_lu_last_character';

function isLevelTheme(value: unknown): value is 'day' | 'night' {
  return value === 'day' || value === 'night';
}

function isCharacterId(value: unknown): value is CharacterId {
  return value === 'bomb-girl' || value === 'ice-ranger';
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

function parseLastCharacter(raw: unknown): CharacterId {
  if (isCharacterId(raw)) return raw;
  // 兼容旧版独立 localStorage
  try {
    const legacy = localStorage.getItem(LEGACY_CHARACTER_KEY);
    if (isCharacterId(legacy)) return legacy;
  } catch {
    /* ignore */
  }
  return 'bomb-girl';
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
      if (!text) {
        // 无正式档时仍尝试迁移旧角色 key
        const data = createDefaultSave();
        data.progress.lastCharacter = parseLastCharacter(undefined);
        return data;
      }
      const parsed: unknown = JSON.parse(text);
      return parseSaveData(parsed) ?? createDefaultSave();
    } catch {
      return createDefaultSave();
    }
  }

  save(data: SaveData): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      // 正式档写入后清掉旧 key，避免双源
      try {
        localStorage.removeItem(LEGACY_CHARACTER_KEY);
      } catch {
        /* ignore */
      }
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

  /** 更新上次选角并立刻落盘 */
  saveLastCharacter(id: CharacterId): void {
    const data = this.load();
    data.progress.lastCharacter = id;
    this.save(data);
  }

  clear(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LEGACY_CHARACTER_KEY);
    } catch {
      /* ignore */
    }
  }
}
