import type { LevelMapDef } from './types';
import { countWalkCells } from './walkMask';

function roundN(n: number, digits = 2): number {
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

/**
 * 把关卡定义格式化成可粘贴进仓库的 TS 源码。
 */
export function formatLevelDefTs(
  def: LevelMapDef,
  exportName = 'LEVEL_1',
): string {
  const lines: string[] = [];
  lines.push(`import type { LevelMapDef } from './types';`);
  lines.push('');
  lines.push(
    `/** 地图编辑器导出 — id: ${def.id} · ${countWalkCells(def)} 格 · cell=${def.cellSize} */`,
  );
  lines.push(`export const ${exportName}: LevelMapDef = {`);
  lines.push(`  id: ${JSON.stringify(def.id)},`);
  lines.push(`  mapSize: ${roundN(def.mapSize, 0)},`);
  lines.push(`  cellSize: ${roundN(def.cellSize, 0)},`);
  lines.push(
    `  spawn: { x: ${roundN(def.spawn.x)}, y: ${roundN(def.spawn.y)} },`,
  );
  lines.push(`  walk: [`);
  for (const r of def.walk) {
    lines.push(
      `    { c: ${r.c}, r: ${r.r}, w: ${r.w}, h: ${r.h} },`,
    );
  }
  lines.push(`  ],`);
  lines.push(`  enemies: [`);
  for (const e of def.enemies ?? []) {
    lines.push(
      `    { kind: ${JSON.stringify(e.kind)}, x: ${roundN(e.x)}, y: ${roundN(e.y)} },`,
    );
  }
  lines.push(`  ],`);
  lines.push(`};`);
  lines.push('');
  return lines.join('\n');
}

export async function copyLevelDefTs(
  def: LevelMapDef,
  exportName = 'LEVEL_1',
): Promise<{ text: string; copied: boolean }> {
  const text = formatLevelDefTs(def, exportName);
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return { text, copied: true };
    }
  } catch {
    // fall through
  }
  return { text, copied: false };
}
