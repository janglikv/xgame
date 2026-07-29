import {
  Spider,
  type SpiderAttackHit,
} from '../Spider';
import type { BodyProfileId } from '../../data/bodyProfiles';
import { ANIMAL_ROAM } from './animalCommon';

/**
 * 只会走的动物：不守出生点，日常到处踱步。
 */
export abstract class RoamingAnimal extends Spider {
  protected override updateAI(
    dt: number,
    playerX: number,
    playerY: number,
    playerBodyProfileId: BodyProfileId | null = null,
  ): { moved: boolean; attackHit: SpiderAttackHit | null } {
    if (this.locked) {
      return super.updateAI(dt, playerX, playerY, playerBodyProfileId);
    }
    return {
      moved: this.updateSearchRoam(dt, {
        radius: ANIMAL_ROAM.idleRadius,
        speed: ANIMAL_ROAM.idleSpeed,
        pauseMin: ANIMAL_ROAM.idlePauseMin,
        pauseMax: ANIMAL_ROAM.idlePauseMax,
        preferFar: 0.62,
        leisurely: true,
      }),
      attackHit: null,
    };
  }
}
