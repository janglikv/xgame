import { getActiveMapDef, setActiveMapDef } from './activeMap';
import { LEVEL_CATALOG, getLevelById as getCatalogLevelById } from './catalog';
import { LEVEL_1 } from './level-1';
import type { LevelMapDef, MapTree } from './types';
import { cloneLevelDef, emptyIslandDef } from './walkMask';

/** v2：海岛 + trees，旧 walk 草稿丢弃 */
const STORAGE_KEY = 'lu-o-lu:map-drafts:v2';

const drafts = new Map<string, LevelMapDef>();

let storageLoaded = false;

function isLevelMapDef(raw: unknown): raw is LevelMapDef {
  if (!raw || typeof raw !== 'object') return false;
  const d = raw as LevelMapDef;
  return (
    typeof d.id === 'string' &&
    typeof d.mapSize === 'number' &&
    typeof d.cellSize === 'number' &&
    typeof d.seaMarginCells === 'number' &&
    !!d.spawn &&
    typeof d.spawn.x === 'number' &&
    typeof d.spawn.y === 'number' &&
    Array.isArray(d.trees)
  );
}

function sanitizeTrees(raw: unknown): MapTree[] {
  if (!Array.isArray(raw)) return [];
  const out: MapTree[] = [];
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue;
    const o = t as MapTree;
    if (typeof o.c !== 'number' || typeof o.r !== 'number') continue;
    out.push({
      c: o.c,
      r: o.r,
      kind: o.kind === 'pine' || o.kind === 'harvest' ? o.kind : undefined,
    });
  }
  return out;
}

/** 启动时读 localStorage；失败静默忽略 */
export function loadMapDraftsFromStorage(): void {
  if (storageLoaded) return;
  storageLoaded = true;
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    if (!text) return;
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') return;
    for (const [id, def] of Object.entries(parsed as Record<string, unknown>)) {
      if (isLevelMapDef(def) && def.id === id) {
        const next = cloneLevelDef(def);
        next.trees = sanitizeTrees(def.trees);
        drafts.set(id, next);
      }
    }
  } catch {
    /* ignore corrupt drafts */
  }
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

/** 编辑器打开时的默认关 */
export function getDefaultEditLevel(): LevelMapDef {
  loadMapDraftsFromStorage();
  const activeId = getActiveMapDef().id;
  return (
    getPlayableLevelById(activeId) ??
    getPlayableLevelById(LEVEL_1.id) ??
    emptyIslandDef(LEVEL_1.id)
  );
}

/** 目录中某一关的可玩版（草稿优先） */
export function getPlayableCatalog(): LevelMapDef[] {
  loadMapDraftsFromStorage();
  return LEVEL_CATALOG.map((m) => getPlayableLevelById(m.id) ?? cloneLevelDef(m));
}
