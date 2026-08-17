import { playSfx } from './Sfx';

export type HitSfxId =
  | 'original'
  | 'pack1'
  | 'pack2'
  | 'pack3'
  | 'pack4'
  | 'pack5'
  | 'pack6'
  | 'pack7'
  | 'pack8'
  | 'pack9'
  | 'pack10';

export interface HitSfxOption {
  id: HitSfxId;
  label: string;
  src: string;
}

export const HIT_SFX_OPTIONS: readonly HitSfxOption[] = [
  { id: 'original', label: '原版', src: '/audio/player_hit.mp3' },
  { id: 'pack1', label: '1', src: '/audio/hit/hit_01.mp3' },
  { id: 'pack2', label: '2', src: '/audio/hit/hit_02.mp3' },
  { id: 'pack3', label: '3', src: '/audio/hit/hit_03.mp3' },
  { id: 'pack4', label: '4', src: '/audio/hit/hit_04.mp3' },
  { id: 'pack5', label: '5', src: '/audio/hit/hit_05.mp3' },
  { id: 'pack6', label: '6', src: '/audio/hit/hit_06.mp3' },
  { id: 'pack7', label: '7', src: '/audio/hit/hit_07.mp3' },
  { id: 'pack8', label: '8', src: '/audio/hit/hit_08.mp3' },
  { id: 'pack9', label: '9', src: '/audio/hit/hit_09.mp3' },
  { id: 'pack10', label: '10', src: '/audio/hit/hit_10.mp3' },
];

const IDS = new Set<string>(HIT_SFX_OPTIONS.map((o) => o.id));

export function isHitSfxId(v: unknown): v is HitSfxId {
  return typeof v === 'string' && IDS.has(v);
}

let currentId: HitSfxId = 'original';

export function getHitSfxId(): HitSfxId {
  return currentId;
}

export function setHitSfxId(id: HitSfxId): void {
  currentId = id;
}

function srcFor(id: HitSfxId): string {
  return HIT_SFX_OPTIONS.find((o) => o.id === id)?.src ?? HIT_SFX_OPTIONS[0]!.src;
}

/** 玩家掉血 / 挨打 */
export function playPlayerHitSfx(volume = 0.55): void {
  playSfx(srcFor(currentId), volume);
}

/** 设置里点选时试听 */
export function previewHitSfx(id: HitSfxId): void {
  playSfx(srcFor(id), 0.55);
}
