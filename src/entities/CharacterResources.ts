import type { BombAmmoSnapshot } from './BombAmmo';
import type { SpearAmmoSnapshot } from './SpearAmmo';

/**
 * 角色弹药 HUD 数据模型。
 * 场景按 kind 切换 UI 组件，不依赖 instanceof 具体角色类。
 */
export type AmmoHudModel =
  | { kind: 'none' }
  | { kind: 'spear'; snap: SpearAmmoSnapshot }
  | { kind: 'bomb'; snap: BombAmmoSnapshot };

export const AMMO_HUD_NONE: AmmoHudModel = { kind: 'none' };
