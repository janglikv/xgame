import {
  BODY_PROFILE_IDS,
  getAllEffectiveBodyProfiles,
  type BodyProfile,
  type BodyProfileId,
  type BodyShape,
  type CircleShape,
  type RectShape,
} from './bodyProfiles';

function roundN(n: number, digits = 2): number {
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

function formatCircle(c: CircleShape): string {
  return `{ type: 'circle', ox: ${roundN(c.ox)}, oy: ${roundN(c.oy)}, r: ${roundN(c.r)} }`;
}

function formatRect(r: RectShape): string {
  return `{ type: 'rect', ox: ${roundN(r.ox)}, oy: ${roundN(r.oy)}, w: ${roundN(r.w)}, h: ${roundN(r.h)} }`;
}

function formatShape(s: BodyShape): string {
  return s.type === 'circle' ? formatCircle(s) : formatRect(s);
}

function formatShapeList(shapes: BodyShape[]): string {
  if (shapes.length === 0) return '[]';
  if (shapes.length === 1) return `[${formatShape(shapes[0]!)}]`;
  return `[\n      ${shapes.map(formatShape).join(',\n      ')},\n    ]`;
}

function formatProfileEntry(p: BodyProfile, key: string): string[] {
  return [
    `  ${JSON.stringify(key)}: {`,
    `    id: ${JSON.stringify(p.id)},`,
    `    label: ${JSON.stringify(p.label)},`,
    `    solid: ${formatShapeList(p.solid)},`,
    `    hurt: ${formatShapeList(p.hurt)},`,
    `  },`,
  ];
}

/**
 * 生成可粘贴进 `src/data/bodyProfiles.ts` 的 BODY_PROFILES 对象字面量。
 */
export function formatBodyProfilesTs(
  profiles: Record<BodyProfileId, BodyProfile> = getAllEffectiveBodyProfiles(),
): string {
  const lines: string[] = [];
  lines.push(`/** 碰撞编辑器导出 — 粘贴替换 BODY_PROFILES */`);
  lines.push(
    `export const BODY_PROFILES: Record<BodyProfileId, BodyProfile> = {`,
  );
  for (const id of BODY_PROFILE_IDS) {
    const p = profiles[id];
    if (!p) continue;
    lines.push(...formatProfileEntry(p, id));
  }
  lines.push(`};`);
  lines.push('');
  return lines.join('\n');
}

export async function copyBodyProfilesTs(
  profiles?: Record<BodyProfileId, BodyProfile>,
): Promise<{ text: string; copied: boolean }> {
  const text = formatBodyProfilesTs(profiles);
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
