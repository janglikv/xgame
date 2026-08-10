import {
  MeshBuilder,
  type Scene,
  ShadowGenerator,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { cast, mat } from './materials';

/** 巫师帽主色 */
export const HAT_RED = 0xef4444;
/** 帽环深红色 */
export const HAT_RED_BAND = 0xb91c1c;

/**
 * 巫师帽：圆盘帽檐 + 外侧包边 + 深色饰带 + 饱满圆顶。
 * 相对身体球心深扣并后倾（本地 +Z 为前）。
 */
export function attachWizardHat(
  scene: Scene,
  bodyRoot: TransformNode,
  bodyLocalY: number,
  shadowGen?: ShadowGenerator,
): void {
  const hatGroup = new TransformNode('wizardHat', scene);
  hatGroup.parent = bodyRoot;
  hatGroup.position = new Vector3(0, bodyLocalY + 0.2, -0.05);
  hatGroup.rotation.x = -0.36;
  hatGroup.rotation.z = -0.04;

  const hatMat = mat(scene, 'minionHatRed', HAT_RED);
  const bandMat = mat(scene, 'minionHatBand', HAT_RED_BAND);

  const brimRadius = 0.52;
  const brimDisk = MeshBuilder.CreateCylinder(
    'hatBrim',
    {
      diameter: brimRadius * 2,
      height: 0.05,
      tessellation: 32,
    },
    scene,
  );
  brimDisk.material = hatMat;
  brimDisk.parent = hatGroup;
  cast(brimDisk, shadowGen);

  const brimRim = MeshBuilder.CreateTorus(
    'hatBrimRim',
    {
      diameter: brimRadius * 2,
      thickness: 0.06,
      tessellation: 32,
    },
    scene,
  );
  brimRim.material = hatMat;
  brimRim.parent = hatGroup;
  cast(brimRim, shadowGen);

  const band = MeshBuilder.CreateTorus(
    'hatBand',
    {
      diameter: 0.84,
      thickness: 0.076,
      tessellation: 32,
    },
    scene,
  );
  band.position.y = 0.03;
  band.material = bandMat;
  band.parent = hatGroup;
  cast(band, shadowGen);

  const domeRadius = 0.42;
  const dome = MeshBuilder.CreateSphere(
    'hatDome',
    {
      diameter: domeRadius * 2,
      segments: 28,
    },
    scene,
  );
  dome.scaling = new Vector3(1, 0.85, 1);
  dome.position.y = 0.02;
  dome.material = hatMat;
  dome.parent = hatGroup;
  cast(dome, shadowGen);
}
