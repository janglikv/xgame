import {
  MeshBuilder,
  type Scene,
  ShadowGenerator,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { cast, emissiveMat, mat } from './materials';

/** 兼容旧导出：红色巫师帽主色 */
export const HAT_RED = 0xef4444;
/** 帽环深红色 */
export const HAT_RED_BAND = 0xb91c1c;

/** 帽子款式（配件行展示） */
export type HatStyle =
  | 'wizard'
  | 'beanie'
  | 'tophat'
  | 'crown'
  | 'horns'
  | 'party'
  | 'pirate'
  | 'helmet'
  | 'propeller'
  | 'mushroom'
  | 'cowboy'
  | 'santa'
  | 'flower'
  | 'chef'
  | 'jester'
  | 'halo'
  | 'catears';

export const HAT_STYLES: readonly HatStyle[] = [
  'wizard',
  'beanie',
  'tophat',
  'crown',
  'horns',
  'party',
  'pirate',
  'helmet',
  'propeller',
  'mushroom',
  'cowboy',
  'santa',
  'flower',
  'chef',
  'jester',
  'halo',
  'catears',
] as const;

export const HAT_LABELS: Record<HatStyle, string> = {
  wizard: '红色巫师帽',
  beanie: '毛线帽',
  tophat: '高礼帽',
  crown: '皇冠',
  horns: '双角盔',
  party: '派对尖帽',
  pirate: '海盗帽',
  helmet: '骑士盔',
  propeller: '螺旋桨帽',
  mushroom: '蘑菇帽',
  cowboy: '牛仔帽',
  santa: '圣诞帽',
  flower: '花环',
  chef: '厨师帽',
  jester: '小丑帽',
  halo: '天使光环',
  catears: '猫耳',
};

/**
 * 按款式挂帽子。
 * parent 应为身体球心锚点（torso）：与身体同节点呼吸缩放，避免相对滑动穿模。
 * 帽子本地坐标相对球心，不再叠加 BODY_LOCAL_Y。
 */
export function attachHat(
  scene: Scene,
  parent: TransformNode,
  style: HatStyle,
  shadowGen?: ShadowGenerator,
): void {
  switch (style) {
    case 'beanie':
      attachBeanie(scene, parent, shadowGen);
      break;
    case 'tophat':
      attachTopHat(scene, parent, shadowGen);
      break;
    case 'crown':
      attachCrown(scene, parent, shadowGen);
      break;
    case 'horns':
      attachHorns(scene, parent, shadowGen);
      break;
    case 'party':
      attachPartyHat(scene, parent, shadowGen);
      break;
    case 'pirate':
      attachPirateHat(scene, parent, shadowGen);
      break;
    case 'helmet':
      attachHelmet(scene, parent, shadowGen);
      break;
    case 'propeller':
      attachPropellerHat(scene, parent, shadowGen);
      break;
    case 'mushroom':
      attachMushroomHat(scene, parent, shadowGen);
      break;
    case 'cowboy':
      attachCowboyHat(scene, parent, shadowGen);
      break;
    case 'santa':
      attachSantaHat(scene, parent, shadowGen);
      break;
    case 'flower':
      attachFlowerCrown(scene, parent, shadowGen);
      break;
    case 'chef':
      attachChefHat(scene, parent, shadowGen);
      break;
    case 'jester':
      attachJesterHat(scene, parent, shadowGen);
      break;
    case 'halo':
      attachHalo(scene, parent, shadowGen);
      break;
    case 'catears':
      attachCatEars(scene, parent, shadowGen);
      break;
    case 'wizard':
    default:
      attachWizardHat(scene, parent, shadowGen);
      break;
  }
}

/** 帽子根节点：相对 parent（身体球心）定位 */
function hatRoot(
  scene: Scene,
  name: string,
  parent: TransformNode,
  opts?: { y?: number; z?: number; rx?: number; rz?: number },
): TransformNode {
  const root = new TransformNode(name, scene);
  root.parent = parent;
  root.position = new Vector3(0, opts?.y ?? 0.16, opts?.z ?? -0.14);
  root.rotation.x = opts?.rx ?? -0.54;
  root.rotation.z = opts?.rz ?? -0.04;
  return root;
}

// ═══════════════════════════════════════════════════════════
// 红色巫师帽：宽檐 + 饰带 + 半球顶
// ═══════════════════════════════════════════════════════════
export function attachWizardHat(
  scene: Scene,
  parent: TransformNode,
  shadowGen?: ShadowGenerator,
): void {
  const p = 'hatWizard';
  const root = hatRoot(scene, 'wizardHat', parent);

  const hatMat = mat(scene, `${p}Main`, HAT_RED);
  const bandMat = mat(scene, `${p}Band`, HAT_RED_BAND);

  const brimGroup = new TransformNode(`${p}BrimGroup`, scene);
  brimGroup.parent = root;
  brimGroup.rotation.x = -0.08;

  const brimRadius = 0.52;
  const brimDisk = MeshBuilder.CreateCylinder(
    `${p}Brim`,
    { diameter: brimRadius * 2, height: 0.05, tessellation: 32 },
    scene,
  );
  brimDisk.material = hatMat;
  brimDisk.parent = brimGroup;
  cast(brimDisk, shadowGen);

  const brimRim = MeshBuilder.CreateTorus(
    `${p}Rim`,
    { diameter: brimRadius * 2, thickness: 0.06, tessellation: 32 },
    scene,
  );
  brimRim.material = hatMat;
  brimRim.parent = brimGroup;
  cast(brimRim, shadowGen);

  const band = MeshBuilder.CreateTorus(
    `${p}Band`,
    { diameter: 0.84, thickness: 0.076, tessellation: 32 },
    scene,
  );
  band.position.y = 0.03;
  band.material = bandMat;
  band.parent = root;
  cast(band, shadowGen);

  const dome = MeshBuilder.CreateSphere(
    `${p}Dome`,
    { diameter: 0.84, segments: 28, slice: 0.5 },
    scene,
  );
  dome.scaling = new Vector3(1, 0.85, 1);
  dome.position.y = 0.025;
  dome.material = hatMat;
  dome.parent = root;
  cast(dome, shadowGen);
}

// ═══════════════════════════════════════════════════════════
// 毛线帽：紧扣半球 + 翻边 + 顶球
// ═══════════════════════════════════════════════════════════
function attachBeanie(
  scene: Scene,
  parent: TransformNode,
  shadowGen?: ShadowGenerator,
): void {
  const p = 'hatBeanie';
  const root = hatRoot(scene, 'beanieHat', parent, {
    y: 0.18,
    z: -0.08,
    rx: -0.35,
  });

  const mainMat = mat(scene, `${p}Main`, 0x3b82f6);
  const cuffMat = mat(scene, `${p}Cuff`, 0x1e3a8a);
  const pomMat = mat(scene, `${p}Pom`, 0xf8fafc);

  const dome = MeshBuilder.CreateSphere(
    `${p}Dome`,
    { diameter: 0.78, segments: 22, slice: 0.55 },
    scene,
  );
  dome.scaling = new Vector3(1.05, 0.9, 1.05);
  dome.position.y = 0.02;
  dome.material = mainMat;
  dome.parent = root;
  cast(dome, shadowGen);

  const cuff = MeshBuilder.CreateTorus(
    `${p}Cuff`,
    { diameter: 0.78, thickness: 0.1, tessellation: 28 },
    scene,
  );
  cuff.position.y = 0.01;
  cuff.rotation.x = Math.PI / 2;
  cuff.material = cuffMat;
  cuff.parent = root;
  cast(cuff, shadowGen);

  const pom = MeshBuilder.CreateSphere(
    `${p}Pom`,
    { diameter: 0.16, segments: 12 },
    scene,
  );
  pom.position.y = 0.38;
  pom.material = pomMat;
  pom.parent = root;
  cast(pom, shadowGen);
}

// ═══════════════════════════════════════════════════════════
// 高礼帽：高筒 + 宽平檐 + 丝带
// ═══════════════════════════════════════════════════════════
function attachTopHat(
  scene: Scene,
  parent: TransformNode,
  shadowGen?: ShadowGenerator,
): void {
  const p = 'hatTop';
  const root = hatRoot(scene, 'topHat', parent, {
    y: 0.2,
    z: -0.1,
    rx: -0.4,
  });

  const blackMat = mat(scene, `${p}Black`, 0x1a1a22);
  const bandMat = mat(scene, `${p}Band`, 0x7f1d1d);

  const brim = MeshBuilder.CreateCylinder(
    `${p}Brim`,
    { diameter: 0.95, height: 0.04, tessellation: 28 },
    scene,
  );
  brim.material = blackMat;
  brim.parent = root;
  cast(brim, shadowGen);

  const crown = MeshBuilder.CreateCylinder(
    `${p}Crown`,
    {
      height: 0.42,
      diameterTop: 0.48,
      diameterBottom: 0.52,
      tessellation: 24,
    },
    scene,
  );
  crown.position.y = 0.23;
  crown.material = blackMat;
  crown.parent = root;
  cast(crown, shadowGen);

  const band = MeshBuilder.CreateTorus(
    `${p}Band`,
    { diameter: 0.52, thickness: 0.055, tessellation: 24 },
    scene,
  );
  band.position.y = 0.06;
  band.rotation.x = Math.PI / 2;
  band.material = bandMat;
  band.parent = root;
  cast(band, shadowGen);

  const top = MeshBuilder.CreateCylinder(
    `${p}Lid`,
    { diameter: 0.5, height: 0.03, tessellation: 24 },
    scene,
  );
  top.position.y = 0.45;
  top.material = blackMat;
  top.parent = root;
  cast(top, shadowGen);
}

// ═══════════════════════════════════════════════════════════
// 皇冠：金环 + 尖齿 + 宝石
// ═══════════════════════════════════════════════════════════
function attachCrown(
  scene: Scene,
  parent: TransformNode,
  shadowGen?: ShadowGenerator,
): void {
  const p = 'hatCrown';
  const root = hatRoot(scene, 'crownHat', parent, {
    y: 0.22,
    z: -0.06,
    rx: -0.25,
  });

  const goldMat = emissiveMat(scene, `${p}Gold`, 0xffd700, 0.55);
  const gemMat = emissiveMat(scene, `${p}Gem`, 0xef4444, 0.9);
  const gemMat2 = emissiveMat(scene, `${p}Gem2`, 0x3b82f6, 0.9);

  const band = MeshBuilder.CreateCylinder(
    `${p}Band`,
    { height: 0.1, diameter: 0.78, tessellation: 24 },
    scene,
  );
  band.position.y = 0.04;
  band.material = goldMat;
  band.parent = root;
  cast(band, shadowGen);

  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const tall = i % 2 === 0;
    const spike = MeshBuilder.CreateCylinder(
      `${p}Spike_${i}`,
      {
        height: tall ? 0.2 : 0.12,
        diameterTop: 0,
        diameterBottom: tall ? 0.1 : 0.07,
        tessellation: 6,
      },
      scene,
    );
    spike.position.set(Math.cos(a) * 0.32, tall ? 0.2 : 0.15, Math.sin(a) * 0.32);
    spike.material = goldMat;
    spike.parent = root;
    cast(spike, shadowGen);

    if (tall) {
      const gem = MeshBuilder.CreateSphere(
        `${p}Gem_${i}`,
        { diameter: 0.07, segments: 8 },
        scene,
      );
      gem.position.set(Math.cos(a) * 0.32, 0.32, Math.sin(a) * 0.32);
      gem.material = i % 4 === 0 ? gemMat : gemMat2;
      gem.parent = root;
      cast(gem, shadowGen);
    }
  }

  const frontGem = MeshBuilder.CreatePolyhedron(
    `${p}FrontGem`,
    { type: 2, size: 0.055 },
    scene,
  );
  frontGem.position.set(0, 0.08, 0.38);
  frontGem.material = gemMat;
  frontGem.parent = root;
  cast(frontGem, shadowGen);
}

// ═══════════════════════════════════════════════════════════
// 双角盔：深色盔底 + 一对弯曲角
// ═══════════════════════════════════════════════════════════
function attachHorns(
  scene: Scene,
  parent: TransformNode,
  shadowGen?: ShadowGenerator,
): void {
  const p = 'hatHorns';
  const root = hatRoot(scene, 'hornsHat', parent, {
    y: 0.2,
    z: -0.08,
    rx: -0.3,
  });

  const helmMat = mat(scene, `${p}Helm`, 0x374151);
  const hornMat = mat(scene, `${p}Horn`, 0xf5f5f4);
  const tipMat = mat(scene, `${p}Tip`, 0xe7e5e4);

  const helm = MeshBuilder.CreateSphere(
    `${p}Helm`,
    { diameter: 0.72, segments: 18, slice: 0.55 },
    scene,
  );
  helm.scaling = new Vector3(1.05, 0.75, 1.05);
  helm.position.y = 0.02;
  helm.material = helmMat;
  helm.parent = root;
  cast(helm, shadowGen);

  for (const side of [-1, 1] as const) {
    const base = MeshBuilder.CreateCylinder(
      `${p}HornBase_${side}`,
      {
        height: 0.22,
        diameterTop: 0.06,
        diameterBottom: 0.12,
        tessellation: 10,
      },
      scene,
    );
    base.position.set(side * 0.28, 0.18, -0.05);
    base.rotation.z = side * -0.55;
    base.rotation.x = -0.25;
    base.material = hornMat;
    base.parent = root;
    cast(base, shadowGen);

    const tip = MeshBuilder.CreateCylinder(
      `${p}HornTip_${side}`,
      {
        height: 0.18,
        diameterTop: 0,
        diameterBottom: 0.06,
        tessellation: 8,
      },
      scene,
    );
    tip.position.set(side * 0.4, 0.34, -0.1);
    tip.rotation.z = side * -0.85;
    tip.rotation.x = -0.35;
    tip.material = tipMat;
    tip.parent = root;
    cast(tip, shadowGen);
  }
}

// ═══════════════════════════════════════════════════════════
// 派对尖帽：彩锥 + 顶球 + 条纹环
// ═══════════════════════════════════════════════════════════
function attachPartyHat(
  scene: Scene,
  parent: TransformNode,
  shadowGen?: ShadowGenerator,
): void {
  const p = 'hatParty';
  const root = hatRoot(scene, 'partyHat', parent, {
    y: 0.2,
    z: -0.08,
    rx: -0.35,
  });

  const coneMat = mat(scene, `${p}Cone`, 0xf43f5e);
  const stripeMat = mat(scene, `${p}Stripe`, 0xfbbf24);
  const pomMat = mat(scene, `${p}Pom`, 0xffffff);

  const cone = MeshBuilder.CreateCylinder(
    `${p}Cone`,
    {
      height: 0.48,
      diameterTop: 0,
      diameterBottom: 0.55,
      tessellation: 20,
    },
    scene,
  );
  cone.position.y = 0.26;
  cone.material = coneMat;
  cone.parent = root;
  cast(cone, shadowGen);

  for (let i = 0; i < 3; i++) {
    const ring = MeshBuilder.CreateTorus(
      `${p}Stripe_${i}`,
      { diameter: 0.42 - i * 0.1, thickness: 0.035, tessellation: 18 },
      scene,
    );
    ring.position.y = 0.1 + i * 0.12;
    ring.rotation.x = Math.PI / 2;
    ring.material = stripeMat;
    ring.parent = root;
    cast(ring, shadowGen);
  }

  const pom = MeshBuilder.CreateSphere(
    `${p}Pom`,
    { diameter: 0.12, segments: 10 },
    scene,
  );
  pom.position.y = 0.52;
  pom.material = pomMat;
  pom.parent = root;
  cast(pom, shadowGen);
}

// ═══════════════════════════════════════════════════════════
// 海盗帽：三角宽檐 + 骷髅徽
// ═══════════════════════════════════════════════════════════
function attachPirateHat(
  scene: Scene,
  parent: TransformNode,
  shadowGen?: ShadowGenerator,
): void {
  const p = 'hatPirate';
  const root = hatRoot(scene, 'pirateHat', parent, {
    y: 0.2,
    z: -0.1,
    rx: -0.45,
  });

  const blackMat = mat(scene, `${p}Black`, 0x111827);
  const boneMat = mat(scene, `${p}Bone`, 0xf3f4f6);
  const bandMat = mat(scene, `${p}Band`, 0x991b1b);

  // 三角檐：三块斜盘近似
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 - Math.PI / 2;
    const flap = MeshBuilder.CreateCylinder(
      `${p}Flap_${i}`,
      { diameter: 0.55, height: 0.04, tessellation: 16 },
      scene,
    );
    flap.position.set(Math.cos(a) * 0.22, 0.04, Math.sin(a) * 0.22);
    flap.rotation.x = Math.cos(a) * 0.55;
    flap.rotation.z = Math.sin(a) * 0.55;
    flap.scaling = new Vector3(1.1, 1, 0.55);
    flap.material = blackMat;
    flap.parent = root;
    cast(flap, shadowGen);
  }

  const crown = MeshBuilder.CreateSphere(
    `${p}Crown`,
    { diameter: 0.55, segments: 16, slice: 0.5 },
    scene,
  );
  crown.scaling = new Vector3(1, 0.7, 1);
  crown.position.y = 0.05;
  crown.material = blackMat;
  crown.parent = root;
  cast(crown, shadowGen);

  const band = MeshBuilder.CreateTorus(
    `${p}Band`,
    { diameter: 0.55, thickness: 0.045, tessellation: 18 },
    scene,
  );
  band.position.y = 0.02;
  band.rotation.x = Math.PI / 2;
  band.material = bandMat;
  band.parent = root;
  cast(band, shadowGen);

  // 骷髅：两眼 + 小椭圆
  const skull = MeshBuilder.CreateSphere(
    `${p}Skull`,
    { diameter: 0.12, segments: 10 },
    scene,
  );
  skull.position.set(0, 0.12, 0.28);
  skull.material = boneMat;
  skull.parent = root;
  cast(skull, shadowGen);

  for (const sx of [-1, 1] as const) {
    const eye = MeshBuilder.CreateSphere(
      `${p}Eye_${sx}`,
      { diameter: 0.035, segments: 6 },
      scene,
    );
    eye.position.set(sx * 0.03, 0.13, 0.34);
    eye.material = blackMat;
    eye.parent = root;
  }
}

// ═══════════════════════════════════════════════════════════
// 骑士盔：金属盔 + 护鼻 + 羽饰
// ═══════════════════════════════════════════════════════════
function attachHelmet(
  scene: Scene,
  parent: TransformNode,
  shadowGen?: ShadowGenerator,
): void {
  const p = 'hatHelmet';
  const root = hatRoot(scene, 'helmetHat', parent, {
    y: 0.18,
    z: -0.06,
    rx: -0.28,
  });

  const metalMat = emissiveMat(scene, `${p}Metal`, 0x9ca3af, 0.35);
  const darkMat = mat(scene, `${p}Dark`, 0x4b5563);
  const plumeMat = mat(scene, `${p}Plume`, 0xdc2626);

  const shell = MeshBuilder.CreateSphere(
    `${p}Shell`,
    { diameter: 0.8, segments: 20, slice: 0.62 },
    scene,
  );
  shell.scaling = new Vector3(1.05, 0.95, 1.1);
  shell.position.y = 0.02;
  shell.material = metalMat;
  shell.parent = root;
  cast(shell, shadowGen);

  // 护鼻
  const noseguard = MeshBuilder.CreateBox(
    `${p}Nose`,
    { width: 0.06, height: 0.22, depth: 0.08 },
    scene,
  );
  noseguard.position.set(0, -0.02, 0.38);
  noseguard.material = darkMat;
  noseguard.parent = root;
  cast(noseguard, shadowGen);

  // 护额条
  const brow = MeshBuilder.CreateBox(
    `${p}Brow`,
    { width: 0.55, height: 0.08, depth: 0.1 },
    scene,
  );
  brow.position.set(0, 0.12, 0.32);
  brow.material = darkMat;
  brow.parent = root;
  cast(brow, shadowGen);

  // 顶羽
  const plume = MeshBuilder.CreateCylinder(
    `${p}Plume`,
    {
      height: 0.32,
      diameterTop: 0.02,
      diameterBottom: 0.1,
      tessellation: 8,
    },
    scene,
  );
  plume.position.set(0, 0.42, -0.05);
  plume.rotation.x = 0.35;
  plume.material = plumeMat;
  plume.parent = root;
  cast(plume, shadowGen);
}

// ═══════════════════════════════════════════════════════════
// 螺旋桨帽：彩色帽 + 顶座 + 双叶桨
// ═══════════════════════════════════════════════════════════
function attachPropellerHat(
  scene: Scene,
  parent: TransformNode,
  shadowGen?: ShadowGenerator,
): void {
  const p = 'hatProp';
  const root = hatRoot(scene, 'propellerHat', parent, {
    y: 0.2,
    z: -0.08,
    rx: -0.32,
  });

  const capMat = mat(scene, `${p}Cap`, 0x22c55e);
  const bandMat = mat(scene, `${p}Band`, 0xfacc15);
  const hubMat = mat(scene, `${p}Hub`, 0x6b7280);
  const bladeMat = mat(scene, `${p}Blade`, 0xf8fafc);

  const cap = MeshBuilder.CreateSphere(
    `${p}Cap`,
    { diameter: 0.72, segments: 18, slice: 0.5 },
    scene,
  );
  cap.scaling = new Vector3(1.08, 0.7, 1.08);
  cap.position.y = 0.02;
  cap.material = capMat;
  cap.parent = root;
  cast(cap, shadowGen);

  const band = MeshBuilder.CreateTorus(
    `${p}Band`,
    { diameter: 0.72, thickness: 0.06, tessellation: 22 },
    scene,
  );
  band.position.y = 0.01;
  band.rotation.x = Math.PI / 2;
  band.material = bandMat;
  band.parent = root;
  cast(band, shadowGen);

  const hub = MeshBuilder.CreateCylinder(
    `${p}Hub`,
    { height: 0.08, diameter: 0.1, tessellation: 12 },
    scene,
  );
  hub.position.y = 0.28;
  hub.material = hubMat;
  hub.parent = root;
  cast(hub, shadowGen);

  for (const rot of [0, Math.PI / 2] as const) {
    const blade = MeshBuilder.CreateBox(
      `${p}Blade_${rot}`,
      { width: 0.42, height: 0.03, depth: 0.1 },
      scene,
    );
    blade.position.y = 0.34;
    blade.rotation.y = rot;
    blade.material = bladeMat;
    blade.parent = root;
    cast(blade, shadowGen);
  }
}

// ═══════════════════════════════════════════════════════════
// 蘑菇帽：粗柄环 + 大红伞盖 + 白斑点
// ═══════════════════════════════════════════════════════════
function attachMushroomHat(
  scene: Scene,
  parent: TransformNode,
  shadowGen?: ShadowGenerator,
): void {
  const p = 'hatMush';
  const root = hatRoot(scene, 'mushroomHat', parent, {
    y: 0.18,
    z: -0.08,
    rx: -0.3,
  });

  const capMat = mat(scene, `${p}Cap`, 0xdc2626);
  const spotMat = mat(scene, `${p}Spot`, 0xfafafa);
  const stemMat = mat(scene, `${p}Stem`, 0xf5f5f4);

  const stem = MeshBuilder.CreateCylinder(
    `${p}Stem`,
    { height: 0.1, diameter: 0.55, tessellation: 18 },
    scene,
  );
  stem.position.y = 0.04;
  stem.material = stemMat;
  stem.parent = root;
  cast(stem, shadowGen);

  const cap = MeshBuilder.CreateSphere(
    `${p}Cap`,
    { diameter: 1.0, segments: 22, slice: 0.48 },
    scene,
  );
  cap.scaling = new Vector3(1.15, 0.65, 1.15);
  cap.position.y = 0.1;
  cap.material = capMat;
  cap.parent = root;
  cast(cap, shadowGen);

  const spots: Array<[number, number, number, number]> = [
    [0.18, 0.28, 0.15, 0.12],
    [-0.22, 0.26, 0.1, 0.1],
    [0.05, 0.32, -0.22, 0.11],
    [-0.12, 0.24, -0.18, 0.09],
    [0.28, 0.22, -0.08, 0.08],
  ];
  for (const [i, [x, y, z, d]] of spots.entries()) {
    const spot = MeshBuilder.CreateSphere(
      `${p}Spot_${i}`,
      { diameter: d, segments: 8 },
      scene,
    );
    spot.position.set(x, y, z);
    spot.material = spotMat;
    spot.parent = root;
    cast(spot, shadowGen);
  }
}

// ═══════════════════════════════════════════════════════════
// 牛仔帽：宽檐微翘 + 顶窝
// ═══════════════════════════════════════════════════════════
function attachCowboyHat(
  scene: Scene,
  parent: TransformNode,
  shadowGen?: ShadowGenerator,
): void {
  const p = 'hatCowboy';
  const root = hatRoot(scene, 'cowboyHat', parent, {
    y: 0.2,
    z: -0.1,
    rx: -0.42,
  });

  const brownMat = mat(scene, `${p}Brown`, 0x92400e);
  const darkMat = mat(scene, `${p}Dark`, 0x78350f);

  const brim = MeshBuilder.CreateCylinder(
    `${p}Brim`,
    { diameter: 1.15, height: 0.035, tessellation: 28 },
    scene,
  );
  brim.material = brownMat;
  brim.parent = root;
  cast(brim, shadowGen);

  // 左右檐微翘
  for (const side of [-1, 1] as const) {
    const curl = MeshBuilder.CreateTorus(
      `${p}Curl_${side}`,
      { diameter: 0.35, thickness: 0.04, tessellation: 14 },
      scene,
    );
    curl.position.set(side * 0.42, 0.04, 0);
    curl.rotation.z = side * 0.9;
    curl.scaling = new Vector3(1, 0.5, 1.2);
    curl.material = brownMat;
    curl.parent = root;
    cast(curl, shadowGen);
  }

  const crown = MeshBuilder.CreateCylinder(
    `${p}Crown`,
    {
      height: 0.22,
      diameterTop: 0.38,
      diameterBottom: 0.48,
      tessellation: 20,
    },
    scene,
  );
  crown.position.y = 0.13;
  crown.material = brownMat;
  crown.parent = root;
  cast(crown, shadowGen);

  // 顶窝压痕
  const dent = MeshBuilder.CreateBox(
    `${p}Dent`,
    { width: 0.08, height: 0.06, depth: 0.35 },
    scene,
  );
  dent.position.y = 0.25;
  dent.material = darkMat;
  dent.parent = root;
  cast(dent, shadowGen);

  const band = MeshBuilder.CreateTorus(
    `${p}Band`,
    { diameter: 0.48, thickness: 0.04, tessellation: 18 },
    scene,
  );
  band.position.y = 0.05;
  band.rotation.x = Math.PI / 2;
  band.material = darkMat;
  band.parent = root;
  cast(band, shadowGen);
}

// ═══════════════════════════════════════════════════════════
// 圣诞帽：软锥后倾 + 白毛边 + 顶球
// ═══════════════════════════════════════════════════════════
function attachSantaHat(
  scene: Scene,
  parent: TransformNode,
  shadowGen?: ShadowGenerator,
): void {
  const p = 'hatSanta';
  const root = hatRoot(scene, 'santaHat', parent, {
    y: 0.18,
    z: -0.08,
    rx: -0.4,
  });

  const redMat = mat(scene, `${p}Red`, 0xdc2626);
  const furMat = mat(scene, `${p}Fur`, 0xf8fafc);

  const cone = MeshBuilder.CreateCylinder(
    `${p}Cone`,
    {
      height: 0.5,
      diameterTop: 0.06,
      diameterBottom: 0.7,
      tessellation: 20,
    },
    scene,
  );
  cone.position.set(0.05, 0.28, -0.08);
  cone.rotation.z = -0.45;
  cone.rotation.x = -0.2;
  cone.material = redMat;
  cone.parent = root;
  cast(cone, shadowGen);

  const cuff = MeshBuilder.CreateTorus(
    `${p}Cuff`,
    { diameter: 0.7, thickness: 0.1, tessellation: 22 },
    scene,
  );
  cuff.position.y = 0.02;
  cuff.rotation.x = Math.PI / 2;
  cuff.material = furMat;
  cuff.parent = root;
  cast(cuff, shadowGen);

  const pom = MeshBuilder.CreateSphere(
    `${p}Pom`,
    { diameter: 0.16, segments: 12 },
    scene,
  );
  pom.position.set(0.22, 0.48, -0.18);
  pom.material = furMat;
  pom.parent = root;
  cast(pom, shadowGen);
}

// ═══════════════════════════════════════════════════════════
// 花环：绿藤环 + 彩色花瓣簇
// ═══════════════════════════════════════════════════════════
function attachFlowerCrown(
  scene: Scene,
  parent: TransformNode,
  shadowGen?: ShadowGenerator,
): void {
  const p = 'hatFlower';
  const root = hatRoot(scene, 'flowerHat', parent, {
    y: 0.22,
    z: -0.05,
    rx: -0.2,
  });

  const vineMat = mat(scene, `${p}Vine`, 0x15803d);
  const colors = [0xf472b6, 0xfbbf24, 0x60a5fa, 0xf87171, 0xc084fc, 0x34d399];

  const ring = MeshBuilder.CreateTorus(
    `${p}Ring`,
    { diameter: 0.82, thickness: 0.055, tessellation: 28 },
    scene,
  );
  ring.rotation.x = Math.PI / 2;
  ring.material = vineMat;
  ring.parent = root;
  cast(ring, shadowGen);

  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const flower = MeshBuilder.CreateSphere(
      `${p}Flower_${i}`,
      { diameter: 0.1, segments: 8 },
      scene,
    );
    flower.position.set(Math.cos(a) * 0.41, 0.04 + (i % 2) * 0.03, Math.sin(a) * 0.41);
    flower.material = mat(scene, `${p}Petal_${i}`, colors[i % colors.length]!);
    flower.parent = root;
    cast(flower, shadowGen);

    const center = MeshBuilder.CreateSphere(
      `${p}Center_${i}`,
      { diameter: 0.04, segments: 6 },
      scene,
    );
    center.position.set(Math.cos(a) * 0.41, 0.08 + (i % 2) * 0.03, Math.sin(a) * 0.41);
    center.material = mat(scene, `${p}CenterMat_${i}`, 0xfef08a);
    center.parent = root;
  }

  // 几片叶子
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    const leaf = MeshBuilder.CreateCylinder(
      `${p}Leaf_${i}`,
      {
        height: 0.12,
        diameterTop: 0,
        diameterBottom: 0.07,
        tessellation: 5,
      },
      scene,
    );
    leaf.position.set(Math.cos(a) * 0.38, 0.02, Math.sin(a) * 0.38);
    leaf.rotation.z = Math.cos(a) * 1.2;
    leaf.rotation.x = -Math.sin(a) * 1.2;
    leaf.material = vineMat;
    leaf.parent = root;
    cast(leaf, shadowGen);
  }
}

// ═══════════════════════════════════════════════════════════
// 厨师帽：白筒 + 蓬松顶
// ═══════════════════════════════════════════════════════════
function attachChefHat(
  scene: Scene,
  parent: TransformNode,
  shadowGen?: ShadowGenerator,
): void {
  const p = 'hatChef';
  const root = hatRoot(scene, 'chefHat', parent, {
    y: 0.2,
    z: -0.08,
    rx: -0.3,
  });

  const whiteMat = mat(scene, `${p}White`, 0xf8fafc);
  const bandMat = mat(scene, `${p}Band`, 0xe5e7eb);

  const band = MeshBuilder.CreateCylinder(
    `${p}Band`,
    { height: 0.12, diameter: 0.72, tessellation: 22 },
    scene,
  );
  band.position.y = 0.05;
  band.material = bandMat;
  band.parent = root;
  cast(band, shadowGen);

  const puff = MeshBuilder.CreateSphere(
    `${p}Puff`,
    { diameter: 0.85, segments: 20 },
    scene,
  );
  puff.scaling = new Vector3(1.05, 0.85, 1.05);
  puff.position.y = 0.35;
  puff.material = whiteMat;
  puff.parent = root;
  cast(puff, shadowGen);

  // 顶上小起伏
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const bump = MeshBuilder.CreateSphere(
      `${p}Bump_${i}`,
      { diameter: 0.22, segments: 10 },
      scene,
    );
    bump.position.set(Math.cos(a) * 0.22, 0.48, Math.sin(a) * 0.22);
    bump.material = whiteMat;
    bump.parent = root;
    cast(bump, shadowGen);
  }
}

// ═══════════════════════════════════════════════════════════
// 小丑帽：三尖角 + 铃铛
// ═══════════════════════════════════════════════════════════
function attachJesterHat(
  scene: Scene,
  parent: TransformNode,
  shadowGen?: ShadowGenerator,
): void {
  const p = 'hatJester';
  const root = hatRoot(scene, 'jesterHat', parent, {
    y: 0.18,
    z: -0.08,
    rx: -0.32,
  });

  const colors = [0xef4444, 0x3b82f6, 0xfbbf24];
  const baseMat = mat(scene, `${p}Base`, 0x7c3aed);
  const bellMat = emissiveMat(scene, `${p}Bell`, 0xfbbf24, 0.7);

  const base = MeshBuilder.CreateSphere(
    `${p}Base`,
    { diameter: 0.7, segments: 16, slice: 0.45 },
    scene,
  );
  base.scaling = new Vector3(1.05, 0.55, 1.05);
  base.position.y = 0.02;
  base.material = baseMat;
  base.parent = root;
  cast(base, shadowGen);

  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 - Math.PI / 2;
    const horn = MeshBuilder.CreateCylinder(
      `${p}Horn_${i}`,
      {
        height: 0.38,
        diameterTop: 0.04,
        diameterBottom: 0.16,
        tessellation: 10,
      },
      scene,
    );
    horn.position.set(Math.cos(a) * 0.18, 0.28, Math.sin(a) * 0.18);
    horn.rotation.z = Math.cos(a) * 0.7;
    horn.rotation.x = -Math.sin(a) * 0.7 + 0.15;
    horn.material = mat(scene, `${p}HornMat_${i}`, colors[i]!);
    horn.parent = root;
    cast(horn, shadowGen);

    const bell = MeshBuilder.CreateSphere(
      `${p}Bell_${i}`,
      { diameter: 0.1, segments: 8 },
      scene,
    );
    bell.position.set(Math.cos(a) * 0.38, 0.48, Math.sin(a) * 0.38);
    bell.material = bellMat;
    bell.parent = root;
    cast(bell, shadowGen);
  }
}

// ═══════════════════════════════════════════════════════════
// 天使光环：悬浮金环（略高于头顶）
// ═══════════════════════════════════════════════════════════
function attachHalo(
  scene: Scene,
  parent: TransformNode,
  shadowGen?: ShadowGenerator,
): void {
  const p = 'hatHalo';
  // 光环更正、略高，少后倾
  const root = hatRoot(scene, 'haloHat', parent, {
    y: 0.42,
    z: -0.02,
    rx: -0.12,
  });

  const goldMat = emissiveMat(scene, `${p}Gold`, 0xfde68a, 0.95);
  const coreMat = emissiveMat(scene, `${p}Core`, 0xffffff, 1.1);

  const ring = MeshBuilder.CreateTorus(
    `${p}Ring`,
    { diameter: 0.55, thickness: 0.045, tessellation: 32 },
    scene,
  );
  ring.rotation.x = Math.PI / 2;
  ring.material = goldMat;
  ring.parent = root;
  cast(ring, shadowGen);

  const glow = MeshBuilder.CreateTorus(
    `${p}Glow`,
    { diameter: 0.55, thickness: 0.08, tessellation: 28 },
    scene,
  );
  glow.rotation.x = Math.PI / 2;
  glow.material = coreMat;
  // 略透明感：用 emissive 即可
  glow.parent = root;
  cast(glow, shadowGen);
}

// ═══════════════════════════════════════════════════════════
// 猫耳：发箍 + 三角耳
// ═══════════════════════════════════════════════════════════
function attachCatEars(
  scene: Scene,
  parent: TransformNode,
  shadowGen?: ShadowGenerator,
): void {
  const p = 'hatCat';
  const root = hatRoot(scene, 'catEarsHat', parent, {
    y: 0.28,
    z: -0.05,
    rx: -0.22,
  });

  const bandMat = mat(scene, `${p}Band`, 0x1f2937);
  const earMat = mat(scene, `${p}Ear`, 0x111827);
  const innerMat = mat(scene, `${p}Inner`, 0xf9a8d4);

  const band = MeshBuilder.CreateTorus(
    `${p}Band`,
    { diameter: 0.78, thickness: 0.04, tessellation: 24 },
    scene,
  );
  band.rotation.x = Math.PI / 2;
  band.material = bandMat;
  band.parent = root;
  cast(band, shadowGen);

  for (const side of [-1, 1] as const) {
    const ear = MeshBuilder.CreateCylinder(
      `${p}Ear_${side}`,
      {
        height: 0.22,
        diameterTop: 0,
        diameterBottom: 0.16,
        tessellation: 3,
      },
      scene,
    );
    ear.position.set(side * 0.22, 0.16, -0.05);
    ear.rotation.z = side * -0.25;
    ear.rotation.x = 0.15;
    ear.material = earMat;
    ear.parent = root;
    cast(ear, shadowGen);

    const inner = MeshBuilder.CreateCylinder(
      `${p}Inner_${side}`,
      {
        height: 0.12,
        diameterTop: 0,
        diameterBottom: 0.08,
        tessellation: 3,
      },
      scene,
    );
    inner.position.set(side * 0.22, 0.12, -0.02);
    inner.rotation.z = side * -0.25;
    inner.rotation.x = 0.15;
    inner.material = innerMat;
    inner.parent = root;
    cast(inner, shadowGen);
  }
}
