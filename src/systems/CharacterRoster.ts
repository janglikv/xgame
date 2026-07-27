import type { Container } from 'pixi.js';
import { BombGirl } from '../entities/BombGirl';
import { IceRanger } from '../entities/IceRanger';
import type { EntranceContext } from '../entities/CharacterEntrance';
import type { PlayerCharacterBase } from '../entities/PlayerCharacterBase';
import type { CharacterId } from '../entities/types';
import type { CombatSystem } from './CombatSystem';
import type { CharacterSwitchHud } from '../ui/CharacterSwitchHud';
import type { LevelCamera } from '../scenes/LevelCamera';

/** 角色出场默认缩放 */
export const CHAR_SCALE: Record<CharacterId, number> = {
  'bomb-girl': 0.07,
  'ice-ranger': 0.066,
};

/** 切换角色冷却（秒） */
export const CHAR_SWITCH_COOLDOWN = 0.3;

export type ActivateCharacterOptions = {
  worldX: number;
  worldY: number;
  facing: 1 | -1;
  /** 是否写入 lastCharacter 存档 */
  persist: boolean;
};

export type SwitchCharacterHooks = {
  paused: boolean;
  combat: CombatSystem;
  entranceContext: () => EntranceContext;
  characterHud: CharacterSwitchHud;
  camera: LevelCamera;
  syncWorldActors: () => void;
  sortDepth: () => void;
  setLastCharacter?: (id: CharacterId) => void;
  /** 激活后同步弹药 HUD / 光标 */
  onActivated: (player: PlayerCharacterBase) => void;
};

/**
 * 场上角色池：始终只挂当前操控者，其余离场保留状态（弹药等）。
 */
export class CharacterRoster {
  private readonly roster = new Map<CharacterId, PlayerCharacterBase>();
  private _player: PlayerCharacterBase | null = null;
  /** 切换角色剩余冷却（秒）；0 表示可切换 */
  private switchCooldownRemaining = 0;

  get player(): PlayerCharacterBase | null {
    return this._player;
  }

  get size(): number {
    return this.roster.size;
  }

  has(id: CharacterId): boolean {
    return this.roster.has(id);
  }

  values(): IterableIterator<PlayerCharacterBase> {
    return this.roster.values();
  }

  /** 创建全角色实体（先不全部挂到 sortLayer） */
  mount(): void {
    const bombGirl = new BombGirl(CHAR_SCALE['bomb-girl']);
    const iceRanger = new IceRanger(CHAR_SCALE['ice-ranger']);
    bombGirl.eventMode = 'none';
    iceRanger.eventMode = 'none';
    this.roster.set('bomb-girl', bombGirl);
    this.roster.set('ice-ranger', iceRanger);
  }

  /**
   * 把指定角色挂上场：脚底坐标 / 朝向从 options 写入，清 knock。
   * 场上始终只有一名角色。
   */
  activate(
    id: CharacterId,
    sortLayer: Container,
    options: ActivateCharacterOptions,
    hooks: Pick<SwitchCharacterHooks, 'setLastCharacter' | 'onActivated'>,
  ): void {
    const next = this.roster.get(id);
    if (!next) return;

    const prev = this._player;
    if (prev && prev !== next) {
      sortLayer.removeChild(prev);
    }

    next.worldX = options.worldX;
    next.worldY = options.worldY;
    next.knock.velX = 0;
    next.knock.velY = 0;
    next.knock.velZ = 0;
    next.knock.height = 0;
    next.setFacingFromMoveX(options.facing);

    if (next.parent !== sortLayer) {
      sortLayer.addChild(next);
    }

    this._player = next;
    hooks.onActivated(next);

    if (options.persist) {
      hooks.setLastCharacter?.(id);
    }
  }

  /** 右侧头像 / Tab：同位置切换操控角色 */
  trySwitch(
    id: CharacterId,
    sortLayer: Container,
    hooks: SwitchCharacterHooks,
  ): boolean {
    if (hooks.paused) return false;
    if (this.switchCooldownRemaining > 0) return false;
    const current = this._player;
    if (!current || current.characterId === id) return false;
    if (!this.roster.has(id)) return false;
    if (current.entranceLocks.switch) return false;

    current.cancelEntrance();
    hooks.combat.cancelScriptedAttacks(current);
    this.activate(
      id,
      sortLayer,
      {
        worldX: current.worldX,
        worldY: current.worldY,
        facing: current.facingDir,
        persist: true,
      },
      hooks,
    );
    this._player?.startEntrance(hooks.entranceContext());
    hooks.characterHud.setActive(id);
    this.switchCooldownRemaining = CHAR_SWITCH_COOLDOWN;
    hooks.characterHud.setSwitchCooldown(
      this.switchCooldownRemaining,
      CHAR_SWITCH_COOLDOWN,
    );
    hooks.camera.boostFollow();
    hooks.syncWorldActors();
    hooks.sortDepth();
    return true;
  }

  /** 推进切换冷却并同步 HUD 遮罩 */
  tickCooldown(dt: number, characterHud: CharacterSwitchHud): void {
    if (this.switchCooldownRemaining <= 0) return;
    this.switchCooldownRemaining = Math.max(
      0,
      this.switchCooldownRemaining - dt,
    );
    characterHud.setSwitchCooldown(
      this.switchCooldownRemaining,
      CHAR_SWITCH_COOLDOWN,
    );
  }
}
