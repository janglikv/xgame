import type { Container } from 'pixi.js';
import type { EntranceContext } from '../../entities/CharacterEntrance';
import type { WorldCreature } from '../../entities/WorldCreature';
import type { CombatSystem } from '../../systems/CombatSystem';

export type LevelServicesDeps = {
  sortLayer: Container;
  combat: CombatSystem;
  getCreatures: () => readonly WorldCreature[];
};

/**
 * 关卡向角色/系统暴露的轻量服务（出场上下文等）。
 */
export class LevelServices {
  private readonly deps: LevelServicesDeps;

  constructor(deps: LevelServicesDeps) {
    this.deps = deps;
  }

  entranceContext(): EntranceContext {
    const { sortLayer, combat, getCreatures } = this.deps;
    return {
      addWorldFx: (node, zIndex) => {
        node.zIndex = zIndex;
        sortLayer.addChild(node);
      },
      combat: {
        fireFreeAutoAimSpearVolley: (player, targets, count) => {
          combat.fireFreeAutoAimSpearVolley(player, targets, count);
        },
        throwBombBurst: (player, landings, options, onFirstBlast) => {
          combat.throwBombBurst(player, landings, options, onFirstBlast);
        },
        cancelScriptedAttacks: (player) => {
          combat.cancelScriptedAttacks(player);
        },
      },
      getTargets: () => getCreatures(),
    };
  }
}
