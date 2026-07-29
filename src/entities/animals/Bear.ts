import {
  ANIMAL_SCALE,
  ANIMAL_WALK_BOB,
  animalOptions,
  type FarmAnimalOptions,
} from './animalCommon';
import { RoamingAnimal } from './RoamingAnimal';

export class Bear extends RoamingAnimal {
  constructor(worldX: number, worldY: number, options: FarmAnimalOptions = {}) {
    super(
      worldX,
      worldY,
      animalOptions(
        options,
        ANIMAL_SCALE.bear,
        {
          textureUrl: '/assets/bear/bear.png',
          label: 'Bear',
          spriteLabel: 'BearSprite',
        },
        ANIMAL_WALK_BOB.large,
      ),
    );
  }
}
