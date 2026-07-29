import type { HealthBar } from './HealthBar';
import type { SpearAmmoHud } from './SpearAmmoHud';
import type { BombAmmoHud } from './BombAmmoHud';
import type { CharacterSwitchHud } from './CharacterSwitchHud';
import type { InventoryHud } from './InventoryHud';

export type LevelHudLayoutOptions = {
  healthBar: HealthBar;
  spearAmmoHud: SpearAmmoHud;
  bombAmmoHud: BombAmmoHud;
  characterHud: CharacterSwitchHud;
  inventoryHud: InventoryHud;
};

/**
 * 关卡 UI 面板布局控制器：负责管理并更新 HUD 在屏幕分辨率改变时的响应式对齐
 */
export class LevelHudLayout {
  /** 玩家 HUD 血条尺寸 / 底边边距（屏幕像素） */
  public static readonly HUD_HP_WIDTH = 240;
  public static readonly HUD_HP_HEIGHT = 14;
  public static readonly HUD_HP_MARGIN_BOTTOM = 28;
  /** 弹药数量相对血条上沿再上移（屏幕像素） */
  public static readonly HUD_AMMO_GAP = 22;
  /** 炸药 HUD 相对血条左缘再左移（屏幕像素） */
  public static readonly HUD_BOMB_AMMO_NUDGE_X = -6;
  /** 炸药 HUD 相对弹药基线再下移（屏幕像素） */
  public static readonly HUD_BOMB_AMMO_NUDGE_Y = 8;

  constructor(
    private readonly components: LevelHudLayoutOptions,
  ) {}

  /** 重新对齐与排布所有 HUD 组件在屏幕中的物理位置 */
  public updateLayout(screenW: number, screenH: number): void {
    const hpX = Math.round((screenW - LevelHudLayout.HUD_HP_WIDTH) / 2);
    const hpY = screenH - LevelHudLayout.HUD_HP_MARGIN_BOTTOM - LevelHudLayout.HUD_HP_HEIGHT;

    this.components.healthBar.position.set(hpX, hpY);
    this.components.spearAmmoHud.position.set(
      hpX,
      hpY - LevelHudLayout.HUD_AMMO_GAP,
    );
    this.components.bombAmmoHud.position.set(
      hpX + LevelHudLayout.HUD_BOMB_AMMO_NUDGE_X,
      hpY - LevelHudLayout.HUD_AMMO_GAP + LevelHudLayout.HUD_BOMB_AMMO_NUDGE_Y,
    );
    this.components.characterHud.position.set(screenW - 20, 20);
    this.components.inventoryHud.position.set(16, screenH - 16);
  }
}
