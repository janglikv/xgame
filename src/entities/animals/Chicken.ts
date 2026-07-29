import { ANIMAL_SCALE, ANIMAL_WALK_BOB, animalOptions, type FarmAnimalOptions } from './animalCommon';
import { RoamingAnimal } from './RoamingAnimal';

export class Chicken extends RoamingAnimal {
  constructor(worldX: number, worldY: number, options: FarmAnimalOptions = {}) {
    super(
      worldX,
      worldY,
      animalOptions(
        options,
        ANIMAL_SCALE.chicken,
        'chicken',
        {
          textureUrl: '/assets/chicken/chicken.png',
          label: 'Chicken',
          spriteLabel: 'ChickenSprite',
        },
        ANIMAL_WALK_BOB.chicken,
      ),
    );
  }
}

