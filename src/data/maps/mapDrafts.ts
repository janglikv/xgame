import { setActiveMapDef } from './activeMap';
import { LEVEL_CATALOG, getLevelById as getCatalogLevelById } from './catalog';
import type { EnemySpawn, LevelMapDef, MapTree } from './types';
import { cloneLevelDef, normalizeTrees, seaMarginPx } from './walkMask';

/** 世界坐标树草稿 */
const STORAGE_KEY = 'lu-o-lu:map-drafts:v3';

const drafts = new Map<string, LevelMapDef>();

let storageLoaded = false;

function isLooseLevelDef(raw: unknown): raw is Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return false;
  const d = raw as Record<string, unknown>;
  return (
    typeof d.id === 'string' &&
    typeof d.mapSize === 'number' &&
    !!d.spawn &&
    typeof (d.spawn as { x?: unknown }).x === 'number' &&
    typeof (d.spawn as { y?: unknown }).y === 'number' &&
    Array.isArray(d.trees)
  );
}

function parseEnemies(raw: unknown): EnemySpawn[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (e): e is EnemySpawn =>
      !!e &&
      typeof e === 'object' &&
      typeof (e as EnemySpawn).x === 'number' &&
      typeof (e as EnemySpawn).y === 'number' &&
      ((e as EnemySpawn).kind === 'spider' ||
        (e as EnemySpawn).kind === 'flame-flower' ||
        (e as EnemySpawn).kind === 'wooden-dummy'),
  );
}

/** 把草稿/目录 JSON 收成当前 LevelMapDef */
export function coerceLevelDef(raw: unknown): LevelMapDef | null {
  if (!isLooseLevelDef(raw)) return null;
  const d = raw as Record<string, unknown>;
  const id = d.id as string;
  const mapSize = d.mapSize as number;
  const spawn = d.spawn as { x: number; y: number };
  const seaMargin =
    typeof d.seaMargin === 'number' && Number.isFinite(d.seaMargin)
      ? Math.max(0, d.seaMargin)
      : 0;

  const stub: LevelMapDef = {
    id,
    mapSize,
    seaMargin,
    spawn: { x: spawn.x, y: spawn.y },
    trees: d.trees as MapTree[],
    enemies: parseEnemies(d.enemies),
  };

  return {
    id,
    mapSize,
    seaMargin: seaMarginPx(stub),
    spawn: { x: spawn.x, y: spawn.y },
    trees: normalizeTrees(stub),
    enemies: parseEnemies(d.enemies),
  };
}

function loadKey(key: string): void {
  try {
    const text = localStorage.getItem(key);
    if (!text) return;
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') return;
    for (const [id, def] of Object.entries(parsed as Record<string, unknown>)) {
      const next = coerceLevelDef(def);
      if (next && next.id === id && !drafts.has(id)) {
        drafts.set(id, next);
      }
    }
  } catch {
    /* ignore corrupt drafts */
  }
}

/** 启动时读 localStorage；失败静默忽略 */
export function loadMapDraftsFromStorage(): void {
  if (storageLoaded) return;
  storageLoaded = true;
  loadKey(STORAGE_KEY);
}

function persistDrafts(): void {
  try {
    const obj: Record<string, LevelMapDef> = {};
    for (const [id, def] of drafts) {
      obj[id] = def;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {
    /* quota / private mode */
  }
}

/** 写入草稿并设为当前激活地图 */
export function saveMapDraft(def: LevelMapDef): LevelMapDef {
  loadMapDraftsFromStorage();
  const next = cloneLevelDef(def);
  drafts.set(next.id, next);
  setActiveMapDef(next);
  persistDrafts();
  return next;
}

export function getMapDraft(id: string): LevelMapDef | null {
  loadMapDraftsFromStorage();
  const d = drafts.get(id);
  return d ? cloneLevelDef(d) : null;
}

export function hasMapDraft(id: string): boolean {
  loadMapDraftsFromStorage();
  return drafts.has(id);
}

export function clearMapDraft(id: string): void {
  loadMapDraftsFromStorage();
  drafts.delete(id);
  persistDrafts();
}

/**
 * 可玩关卡：优先草稿，否则目录原版。
 */
export function getPlayableLevelById(id: string): LevelMapDef | null {
  loadMapDraftsFromStorage();
  const draft = drafts.get(id);
  if (draft) return cloneLevelDef(draft);
  const catalog = getCatalogLevelById(id);
  return catalog ? cloneLevelDef(catalog) : null;
}

/** 目录中某一关的可玩版（草稿优先） */
export function getPlayableCatalog(): LevelMapDef[] {
  loadMapDraftsFromStorage();
  return LEVEL_CATALOG.map((m) => getPlayableLevelById(m.id) ?? cloneLevelDef(m));
}

export function resetMapDraftsInMemory(): void {
  drafts.clear();
  storageLoaded = false;
}

