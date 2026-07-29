import type { Container } from 'pixi.js';
import { IceRanger } from '../entities/IceRanger';
import type { EntranceContext } from '../entities/CharacterEntrance';
import type { PlayerCharacterBase } from '../entities/PlayerCharacterBase';
import type { CharacterId } from '../entities/types';
import type { CombatSystem } from './CombatSystem';
import type { LevelCamera } from '../scenes/LevelCamera';

/** 角色出场默认缩放 */
export const CHAR_SCALE: Record<CharacterId, number> = {
  'bomb-girl': 0.07,
  'ice-ranger': 0.066,
};

export type ActivateCharacterOptions = {
  worldX: number;
  worldY: number;
  facing: 1 | -1;
  /** 是否写入 lastCharacter 存档 */
  persist: boolean;
};

export type ActivateCharacterHooks = {
  combat: CombatSystem;
  entranceContext: () => EntranceContext;
  camera: LevelCamera;
  syncWorldActors: () => void;
  sortDepth: () => void;
  /** 激活后同步弹药 HUD / 光标 */
  onActivated: (player: PlayerCharacterBase) => void;
};

/**
 * 场上角色池：固定使用冰冰（ice-ranger）。
 */
export class CharacterRoster {
  private readonly roster = new Map<CharacterId, PlayerCharacterBase>();
  private _player: PlayerCharacterBase | null = null;

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

  /** 创建角色实体（先不挂到 sortLayer） */
  mount(): void {
    const iceRanger = new IceRanger(CHAR_SCALE['ice-ranger']);
    iceRanger.eventMode = 'none';
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
    hooks: Pick<ActivateCharacterHooks, 'onActivated'>,
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
  }
}
