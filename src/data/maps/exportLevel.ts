import type { LevelMapDef } from './types';
import { normalizeGrasses, normalizeTrees, seaMarginPx } from './walkMask';

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
  const trees = normalizeTrees(def);
  const grasses = normalizeGrasses(def);
  const lines: string[] = [];
  lines.push(`import type { LevelMapDef } from './types';`);
  lines.push('');
  lines.push(
    `/** 上帝模式导出 — id: ${def.id} · 树 ${trees.length} · 草 ${grasses.length} · 海缘 ${seaMarginPx(def)}px */`,
  );
  lines.push(`export const ${exportName}: LevelMapDef = {`);
  lines.push(`  id: ${JSON.stringify(def.id)},`);
  lines.push(`  mapSize: ${roundN(def.mapSize, 0)},`);
  lines.push(`  seaMargin: ${roundN(seaMarginPx(def), 0)},`);
  lines.push(
    `  spawn: { x: ${roundN(def.spawn.x)}, y: ${roundN(def.spawn.y)} },`,
  );
  lines.push(`  trees: [`);
  for (const t of trees) {
    const size =
      t.size && t.size !== 'medium' ? `, size: ${JSON.stringify(t.size)}` : '';
    const id = t.id ? `, id: ${JSON.stringify(t.id)}` : '';
    lines.push(
      `    { x: ${roundN(t.x)}, y: ${roundN(t.y)}${size}${id} },`,
    );
  }
  lines.push(`  ],`);
  lines.push(`  grasses: [`);
  for (const g of grasses) {
    const size =
      g.size && g.size !== 'medium' ? `, size: ${JSON.stringify(g.size)}` : '';
    const id = g.id ? `, id: ${JSON.stringify(g.id)}` : '';
    lines.push(
      `    { x: ${roundN(g.x)}, y: ${roundN(g.y)}${size}${id} },`,
    );
  }
  lines.push(`  ],`);
  lines.push(`  enemies: [`);
  lines.push(`  enemies: [`);
  for (const e of def.enemies) {
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
