import {
  Mesh,
  MeshBuilder,
  type Scene,
  ShadowGenerator,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { cast, emissiveMat, mat } from './materials';

/** 法杖款式（武器行展示） */
export type StaffStyle =
  | 'arcane'
  | 'flame'
  | 'frost'
  | 'nature'
  | 'void'
  | 'storm'
  | 'holy';

export const STAFF_STYLES: readonly StaffStyle[] = [
  'arcane',
  'flame',
  'frost',
  'nature',
  'void',
  'storm',
  'holy',
] as const;

export const STAFF_LABELS: Record<StaffStyle, string> = {
  arcane: '魔法杖',
  flame: '烈焰杖',
  frost: '寒冰杖',
  nature: '荆棘杖',
  void: '虚空杖',
  storm: '雷电杖',
  holy: '圣光杖',
};

export interface StaffFx {
  style: StaffStyle;
  root: TransformNode;
  orb: Mesh;
  orbMat: StandardMaterial;
  core: Mesh | null;
  coreMat: StandardMaterial | null;
  halos: Mesh[];
  aura: Mesh | null;
  auraMat: StandardMaterial | null;
  crown: TransformNode | null;
  sparks: Mesh[];
  /** 额外可动部件（火焰舌、冰刺等） */
  extras: Mesh[];
  t: number;
}

function gripRoot(
  scene: Scene,
  name: string,
  rightHand: Mesh,
): TransformNode {
  const root = new TransformNode(name, scene);
  root.parent = rightHand;
  root.position = new Vector3(0, -0.06, 0);
  root.rotation.x = -0.32;
  root.rotation.z = 0.1;
  root.scaling = new Vector3(1.15, 1.15, 1.15);
  return root;
}

function softAuraMat(
  scene: Scene,
  name: string,
  hex: number,
  intensity: number,
  alpha: number,
): StandardMaterial {
  const m = emissiveMat(scene, name, hex, intensity);
  m.alpha = alpha;
  m.transparencyMode = StandardMaterial.MATERIAL_ALPHABLEND;
  m.backFaceCulling = false;
  m.disableDepthWrite = true;
  return m;
}

/**
 * 按款式挂法杖到右手。
 */
export function attachStaff(
  scene: Scene,
  rightHand: Mesh,
  style: StaffStyle,
  shadowGen?: ShadowGenerator,
  lite = false,
): StaffFx {
  if (lite) return attachLiteStaff(scene, rightHand, style);
  switch (style) {
    case 'flame':
      return attachFlameStaff(scene, rightHand, shadowGen);
    case 'frost':
      return attachFrostStaff(scene, rightHand, shadowGen);
    case 'nature':
      return attachNatureStaff(scene, rightHand, shadowGen);
    case 'void':
      return attachVoidStaff(scene, rightHand, shadowGen);
    case 'storm':
      return attachStormStaff(scene, rightHand, shadowGen);
    case 'holy':
      return attachHolyStaff(scene, rightHand, shadowGen);
    case 'arcane':
    default:
      return attachArcaneStaff(scene, rightHand, shadowGen);
  }
}

/** 敌军简化杖：仅杖杆+宝珠，少网格、无阴影、材质按款式缓存 */
const liteStaffCache = new Map<string, { shaft: StandardMaterial; orb: StandardMaterial }>();

function attachLiteStaff(
  scene: Scene,
  rightHand: Mesh,
  style: StaffStyle,
): StaffFx {
  const col = {
    flame: 0xff5500,
    frost: 0x00c8ff,
    nature: 0x20e040,
    void: 0x8811ee,
    storm: 0x00e5ff,
    holy: 0xffcc00,
    arcane: 0xb545ff,
  }[style];

  let mats = liteStaffCache.get(style);
  if (!mats) {
    mats = {
      shaft: mat(scene, `liteStaffShaft_${style}`, 0x2a1c14),
      orb: emissiveMat(scene, `liteStaffOrb_${style}`, col, 1.15),
    };
    liteStaffCache.set(style, mats);
  }

  const root = gripRoot(scene, `liteStaff_${style}`, rightHand);
  const shaft = MeshBuilder.CreateCylinder(
    `liteShaft_${style}`,
    { height: 1.05, diameterTop: 0.035, diameterBottom: 0.055, tessellation: 6 },
    scene,
  );
  shaft.position.y = 0.28;
  shaft.material = mats.shaft;
  shaft.parent = root;
  shaft.receiveShadows = false;
  shaft.isPickable = false;

  const orb = MeshBuilder.CreateSphere(
    `liteOrb_${style}`,
    { diameter: 0.2, segments: 8 },
    scene,
  );
  orb.position.y = 0.92;
  orb.material = mats.orb;
  orb.parent = root;
  orb.receiveShadows = false;
  orb.isPickable = false;

  return {
    style,
    root,
    orb,
    orbMat: mats.orb,
    core: null,
    coreMat: null,
    halos: [],
    aura: null,
    auraMat: null,
    crown: null,
    sparks: [],
    extras: [],
    t: 0,
  };
}

/** 兼容旧名 */
export function attachMagicStaff(
  scene: Scene,
  rightHand: Mesh,
  shadowGen?: ShadowGenerator,
): StaffFx {
  return attachArcaneStaff(scene, rightHand, shadowGen);
}

// ═══════════════════════════════════════════════════════════
// 魔法杖：巨型炫彩水晶 + 三层原子光环 + 双层星轨 + 外光晕 + 尖刺冠
// ═══════════════════════════════════════════════════════════
function attachArcaneStaff(
  scene: Scene,
  rightHand: Mesh,
  shadowGen?: ShadowGenerator,
): StaffFx {
  const p = 'staffArcane';
  const root = gripRoot(scene, 'magicStaff', rightHand);

  const woodMat = mat(scene, `${p}Wood`, 0x1a1210);
  const metalMat = emissiveMat(scene, `${p}Metal`, 0xa8b8d0, 0.4);
  const goldMat = emissiveMat(scene, `${p}Gold`, 0xffd24a, 0.55);
  const orbMat = emissiveMat(scene, `${p}Orb`, 0xb44dff, 1.0);
  const coreMat = emissiveMat(scene, `${p}OrbCore`, 0xffffff, 1.4);
  const sparkMat = emissiveMat(scene, `${p}Spark`, 0xff66ee, 1.2);
  const sparkMat2 = emissiveMat(scene, `${p}Spark2`, 0x66f0ff, 1.2);
  const auraMat = softAuraMat(scene, `${p}Aura`, 0x8844ff, 0.6, 0.22);

  const shaft = MeshBuilder.CreateCylinder(
    `${p}Shaft`,
    { height: 1.25, diameterTop: 0.03, diameterBottom: 0.06, tessellation: 14 },
    scene,
  );
  shaft.position.y = 0.32;
  shaft.material = woodMat;
  shaft.parent = root;
  cast(shaft, shadowGen);

  for (let i = 0; i < 7; i++) {
    const wrap = MeshBuilder.CreateTorus(
      `${p}Wrap_${i}`,
      { diameter: 0.055 + i * 0.004, thickness: 0.014, tessellation: 16 },
      scene,
    );
    wrap.position.y = -0.12 + i * 0.12;
    wrap.rotation.x = 0.35;
    wrap.material = i % 2 === 0 ? goldMat : metalMat;
    wrap.parent = root;
    cast(wrap, shadowGen);
  }

  const pommel = MeshBuilder.CreateSphere(
    `${p}Pommel`,
    { diameter: 0.12, segments: 14 },
    scene,
  );
  pommel.position.y = -0.32;
  pommel.material = goldMat;
  pommel.parent = root;
  cast(pommel, shadowGen);

  const pommelGem = MeshBuilder.CreatePolyhedron(
    `${p}PommelGem`,
    { type: 2, size: 0.035 },
    scene,
  );
  pommelGem.position.y = -0.32;
  pommelGem.material = emissiveMat(scene, `${p}PommelGemMat`, 0xff44aa, 0.9);
  pommelGem.parent = root;

  for (const [i, y, size, hex] of [
    [0, 0.28, 0.04, 0x66f0ff],
    [1, 0.42, 0.05, 0xff66ee],
    [2, 0.56, 0.038, 0xffd24a],
  ] as const) {
    const gem = MeshBuilder.CreatePolyhedron(
      `${p}MidGem_${i}`,
      { type: 1, size },
      scene,
    );
    gem.position.y = y;
    gem.rotation.y = i * 0.7;
    gem.material = emissiveMat(scene, `${p}MidGemMat_${i}`, hex, 0.85);
    gem.parent = root;
    cast(gem, shadowGen);
  }

  const collar = MeshBuilder.CreateCylinder(
    `${p}Collar`,
    { height: 0.06, diameter: 0.12, tessellation: 16 },
    scene,
  );
  collar.position.y = 0.88;
  collar.material = goldMat;
  collar.parent = root;
  cast(collar, shadowGen);

  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const claw = MeshBuilder.CreateCylinder(
      `${p}Claw_${i}`,
      {
        height: 0.2,
        diameterTop: 0.008,
        diameterBottom: 0.028,
        tessellation: 8,
      },
      scene,
    );
    claw.position.set(Math.cos(a) * 0.07, 0.98, Math.sin(a) * 0.07);
    claw.rotation.z = Math.cos(a) * 0.7;
    claw.rotation.x = -Math.sin(a) * 0.7;
    claw.material = goldMat;
    claw.parent = root;
    cast(claw, shadowGen);
  }

  const headY = 1.15;
  const orb = MeshBuilder.CreateSphere(
    `${p}Orb`,
    { diameter: 0.28, segments: 24 },
    scene,
  );
  orb.position.y = headY;
  orb.material = orbMat;
  orb.parent = root;
  cast(orb, shadowGen);

  const crystal = MeshBuilder.CreatePolyhedron(
    `${p}Crystal`,
    { type: 2, size: 0.09 },
    scene,
  );
  crystal.position.y = headY;
  crystal.rotation.z = Math.PI / 5;
  crystal.material = emissiveMat(scene, `${p}CrystalMat`, 0x66f0ff, 1.0);
  crystal.parent = root;
  cast(crystal, shadowGen);

  const core = MeshBuilder.CreateSphere(
    `${p}OrbCore`,
    { diameter: 0.1, segments: 14 },
    scene,
  );
  core.position.y = headY;
  core.material = coreMat;
  core.parent = root;

  const haloSpecs: Array<{ d: number; th: number; hex: number; rx: number }> = [
    { d: 0.38, th: 0.022, hex: 0x66f0ff, rx: Math.PI / 2.2 },
    { d: 0.48, th: 0.02, hex: 0xff44cc, rx: Math.PI / 3.1 },
    { d: 0.58, th: 0.018, hex: 0xffd24a, rx: Math.PI / 4.5 },
  ];
  const halos: Mesh[] = [];
  for (const [i, spec] of haloSpecs.entries()) {
    const halo = MeshBuilder.CreateTorus(
      `${p}Halo_${i}`,
      { diameter: spec.d, thickness: spec.th, tessellation: 36 },
      scene,
    );
    halo.position.y = headY;
    halo.rotation.x = spec.rx;
    halo.rotation.y = i * 1.1;
    halo.material = emissiveMat(scene, `${p}HaloMat_${i}`, spec.hex, 1.0);
    halo.parent = root;
    cast(halo, shadowGen);
    halos.push(halo);
  }

  const aura = MeshBuilder.CreateSphere(
    `${p}Aura`,
    { diameter: 0.55, segments: 20 },
    scene,
  );
  aura.position.y = headY;
  aura.material = auraMat;
  aura.parent = root;

  const crown = new TransformNode(`${p}Crown`, scene);
  crown.parent = root;
  crown.position.y = headY;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const spike = MeshBuilder.CreateCylinder(
      `${p}Spike_${i}`,
      {
        height: 0.18,
        diameterTop: 0,
        diameterBottom: 0.035,
        tessellation: 6,
      },
      scene,
    );
    spike.position.set(Math.cos(a) * 0.12, 0.14, Math.sin(a) * 0.12);
    spike.rotation.z = Math.cos(a) * 0.9;
    spike.rotation.x = -Math.sin(a) * 0.9;
    spike.material = goldMat;
    spike.parent = crown;
    cast(spike, shadowGen);
  }

  const sparks: Mesh[] = [];
  for (let i = 0; i < 12; i++) {
    const s = MeshBuilder.CreateSphere(
      `${p}Spark_${i}`,
      { diameter: i < 6 ? 0.04 : 0.032, segments: 8 },
      scene,
    );
    s.material = i < 6 ? sparkMat : sparkMat2;
    s.parent = orb;
    sparks.push(s);
  }

  return {
    style: 'arcane',
    root,
    orb,
    orbMat,
    core,
    coreMat,
    halos,
    aura,
    auraMat,
    crown,
    sparks,
    extras: [],
    t: 0,
  };
}

// ═══════════════════════════════════════════════════════════
// 烈焰杖：乌铁杖身 + 熔岩箍 + 火球 + 上窜焰舌 + 火星
// ═══════════════════════════════════════════════════════════
function attachFlameStaff(
  scene: Scene,
  rightHand: Mesh,
  shadowGen?: ShadowGenerator,
): StaffFx {
  const p = 'staffFlame';
  const root = gripRoot(scene, 'flameStaff', rightHand);

  const ironMat = mat(scene, `${p}Iron`, 0x1c1210);
  const brassMat = emissiveMat(scene, `${p}Brass`, 0xc45a18, 0.55);
  const magmaMat = emissiveMat(scene, `${p}Magma`, 0xff6a1a, 0.95);
  const orbMat = emissiveMat(scene, `${p}Orb`, 0xff3b10, 1.15);
  const coreMat = emissiveMat(scene, `${p}Core`, 0xffee88, 1.5);
  const emberMat = emissiveMat(scene, `${p}Ember`, 0xffaa33, 1.2);
  const flameMat = emissiveMat(scene, `${p}Tongue`, 0xff5522, 1.1);
  const auraMat = softAuraMat(scene, `${p}Aura`, 0xff4400, 0.7, 0.2);

  // 粗壮乌铁杖
  const shaft = MeshBuilder.CreateCylinder(
    `${p}Shaft`,
    { height: 1.2, diameterTop: 0.04, diameterBottom: 0.075, tessellation: 12 },
    scene,
  );
  shaft.position.y = 0.3;
  shaft.material = ironMat;
  shaft.parent = root;
  cast(shaft, shadowGen);

  // 熔岩箍（水平，偏热）
  for (let i = 0; i < 5; i++) {
    const ring = MeshBuilder.CreateTorus(
      `${p}Ring_${i}`,
      { diameter: 0.07 + i * 0.006, thickness: 0.018, tessellation: 14 },
      scene,
    );
    ring.position.y = -0.08 + i * 0.16;
    ring.rotation.x = Math.PI / 2;
    ring.material = i % 2 === 0 ? magmaMat : brassMat;
    ring.parent = root;
    cast(ring, shadowGen);
  }

  // 底端熔岩球
  const pommel = MeshBuilder.CreateSphere(
    `${p}Pommel`,
    { diameter: 0.14, segments: 12 },
    scene,
  );
  pommel.position.y = -0.34;
  pommel.material = magmaMat;
  pommel.parent = root;
  cast(pommel, shadowGen);

  // 中段熔岩结晶
  for (const [i, y, size] of [
    [0, 0.22, 0.045],
    [1, 0.4, 0.055],
    [2, 0.58, 0.04],
  ] as const) {
    const gem = MeshBuilder.CreatePolyhedron(
      `${p}Gem_${i}`,
      { type: 0, size },
      scene,
    );
    gem.position.y = y;
    gem.rotation.y = i * 0.9;
    gem.material = magmaMat;
    gem.parent = root;
    cast(gem, shadowGen);
  }

  // 托座：四爪托火球
  const collar = MeshBuilder.CreateCylinder(
    `${p}Collar`,
    { height: 0.07, diameter: 0.14, tessellation: 12 },
    scene,
  );
  collar.position.y = 0.86;
  collar.material = brassMat;
  collar.parent = root;
  cast(collar, shadowGen);

  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const claw = MeshBuilder.CreateCylinder(
      `${p}Claw_${i}`,
      {
        height: 0.22,
        diameterTop: 0.01,
        diameterBottom: 0.035,
        tessellation: 6,
      },
      scene,
    );
    claw.position.set(Math.cos(a) * 0.08, 0.98, Math.sin(a) * 0.08);
    claw.rotation.z = Math.cos(a) * 0.85;
    claw.rotation.x = -Math.sin(a) * 0.85;
    claw.material = brassMat;
    claw.parent = root;
    cast(claw, shadowGen);
  }

  const headY = 1.14;
  const orb = MeshBuilder.CreateSphere(
    `${p}Orb`,
    { diameter: 0.26, segments: 20 },
    scene,
  );
  orb.position.y = headY;
  orb.material = orbMat;
  orb.parent = root;
  cast(orb, shadowGen);

  const core = MeshBuilder.CreateSphere(
    `${p}Core`,
    { diameter: 0.11, segments: 12 },
    scene,
  );
  core.position.y = headY;
  core.material = coreMat;
  core.parent = root;

  // 焰舌：竖直朝上的锥体簇
  const crown = new TransformNode(`${p}Crown`, scene);
  crown.parent = root;
  crown.position.y = headY;
  const extras: Mesh[] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const h = 0.16 + (i % 3) * 0.05;
    const tongue = MeshBuilder.CreateCylinder(
      `${p}Tongue_${i}`,
      {
        height: h,
        diameterTop: 0,
        diameterBottom: 0.05 - (i % 3) * 0.008,
        tessellation: 6,
      },
      scene,
    );
    tongue.position.set(Math.cos(a) * 0.06, 0.12 + h * 0.25, Math.sin(a) * 0.06);
    tongue.rotation.z = Math.cos(a) * 0.35;
    tongue.rotation.x = -Math.sin(a) * 0.35;
    tongue.material = flameMat;
    tongue.parent = crown;
    cast(tongue, shadowGen);
    extras.push(tongue);
  }
  // 中心大火舌
  const mainTongue = MeshBuilder.CreateCylinder(
    `${p}MainTongue`,
    { height: 0.32, diameterTop: 0, diameterBottom: 0.07, tessellation: 8 },
    scene,
  );
  mainTongue.position.y = 0.22;
  mainTongue.material = coreMat;
  mainTongue.parent = crown;
  cast(mainTongue, shadowGen);
  extras.push(mainTongue);

  const aura = MeshBuilder.CreateSphere(
    `${p}Aura`,
    { diameter: 0.48, segments: 16 },
    scene,
  );
  aura.position.y = headY;
  aura.scaling = new Vector3(1, 1.25, 1);
  aura.material = auraMat;
  aura.parent = root;

  // 火星：绕火球上漂
  const sparks: Mesh[] = [];
  for (let i = 0; i < 10; i++) {
    const s = MeshBuilder.CreateSphere(
      `${p}Spark_${i}`,
      { diameter: 0.028 + (i % 3) * 0.008, segments: 6 },
      scene,
    );
    s.material = emberMat;
    s.parent = orb;
    sparks.push(s);
  }

  return {
    style: 'flame',
    root,
    orb,
    orbMat,
    core,
    coreMat,
    halos: [],
    aura,
    auraMat,
    crown,
    sparks,
    extras,
    t: 0,
  };
}

// ═══════════════════════════════════════════════════════════
// 寒冰杖：晶柱杖身 + 棱晶簇 + 菱形主晶 + 碎冰环 + 雪尘
// ═══════════════════════════════════════════════════════════
function attachFrostStaff(
  scene: Scene,
  rightHand: Mesh,
  shadowGen?: ShadowGenerator,
): StaffFx {
  const p = 'staffFrost';
  const root = gripRoot(scene, 'frostStaff', rightHand);

  const iceMat = emissiveMat(scene, `${p}Ice`, 0xa8e8ff, 0.55);
  const deepMat = emissiveMat(scene, `${p}Deep`, 0x3a7aa8, 0.45);
  const silverMat = emissiveMat(scene, `${p}Silver`, 0xc8d8e8, 0.5);
  const orbMat = emissiveMat(scene, `${p}Orb`, 0x7ad8ff, 1.1);
  const coreMat = emissiveMat(scene, `${p}Core`, 0xffffff, 1.4);
  const shardMat = emissiveMat(scene, `${p}Shard`, 0x99eeff, 1.0);
  const sparkMat = emissiveMat(scene, `${p}Spark`, 0xe8f8ff, 1.15);
  const auraMat = softAuraMat(scene, `${p}Aura`, 0x66ccff, 0.55, 0.2);

  // 分段晶柱
  for (let i = 0; i < 4; i++) {
    const seg = MeshBuilder.CreateCylinder(
      `${p}Seg_${i}`,
      {
        height: 0.28,
        diameterTop: 0.028 + i * 0.006,
        diameterBottom: 0.034 + i * 0.008,
        tessellation: 6,
      },
      scene,
    );
    seg.position.y = -0.18 + i * 0.28;
    seg.material = i % 2 === 0 ? iceMat : deepMat;
    seg.parent = root;
    cast(seg, shadowGen);
  }

  // 底端冰棱
  const pommel = MeshBuilder.CreatePolyhedron(
    `${p}Pommel`,
    { type: 1, size: 0.055 },
    scene,
  );
  pommel.position.y = -0.36;
  pommel.rotation.z = Math.PI;
  pommel.material = shardMat;
  pommel.parent = root;
  cast(pommel, shadowGen);

  // 中段斜插碎冰
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const shard = MeshBuilder.CreatePolyhedron(
      `${p}MidShard_${i}`,
      { type: 2, size: 0.03 + (i % 2) * 0.012 },
      scene,
    );
    const y = 0.15 + (i % 3) * 0.18;
    shard.position.set(Math.cos(a) * 0.05, y, Math.sin(a) * 0.05);
    shard.rotation.z = Math.cos(a) * 0.9;
    shard.rotation.x = -Math.sin(a) * 0.9;
    shard.material = i % 2 === 0 ? shardMat : silverMat;
    shard.parent = root;
    cast(shard, shadowGen);
  }

  const collar = MeshBuilder.CreateCylinder(
    `${p}Collar`,
    { height: 0.05, diameter: 0.11, tessellation: 8 },
    scene,
  );
  collar.position.y = 0.9;
  collar.material = silverMat;
  collar.parent = root;
  cast(collar, shadowGen);

  const headY = 1.12;
  // 菱形主晶（拉长）
  const orb = MeshBuilder.CreatePolyhedron(
    `${p}Orb`,
    { type: 2, size: 0.12 },
    scene,
  );
  orb.position.y = headY;
  orb.scaling = new Vector3(0.75, 1.35, 0.75);
  orb.material = orbMat;
  orb.parent = root;
  cast(orb, shadowGen);

  const core = MeshBuilder.CreateSphere(
    `${p}Core`,
    { diameter: 0.08, segments: 12 },
    scene,
  );
  core.position.y = headY;
  core.material = coreMat;
  core.parent = root;

  // 水平碎冰环（两层）
  const halos: Mesh[] = [];
  for (const [i, d, th] of [
    [0, 0.36, 0.016],
    [1, 0.48, 0.014],
  ] as const) {
    const halo = MeshBuilder.CreateTorus(
      `${p}Halo_${i}`,
      { diameter: d, thickness: th, tessellation: 28 },
      scene,
    );
    halo.position.y = headY;
    halo.rotation.x = Math.PI / 2 + (i === 0 ? 0.12 : -0.18);
    halo.material = emissiveMat(scene, `${p}HaloMat_${i}`, i === 0 ? 0x88ddff : 0xffffff, 0.95);
    halo.parent = root;
    cast(halo, shadowGen);
    halos.push(halo);
  }

  // 外圈冰刺冠
  const crown = new TransformNode(`${p}Crown`, scene);
  crown.parent = root;
  crown.position.y = headY;
  const extras: Mesh[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const spike = MeshBuilder.CreateCylinder(
      `${p}Spike_${i}`,
      {
        height: 0.2,
        diameterTop: 0,
        diameterBottom: 0.028,
        tessellation: 5,
      },
      scene,
    );
    spike.position.set(Math.cos(a) * 0.14, 0.02, Math.sin(a) * 0.14);
    // 水平外指 + 略上扬
    spike.rotation.z = Math.cos(a) * (Math.PI / 2 - 0.35);
    spike.rotation.x = -Math.sin(a) * (Math.PI / 2 - 0.35);
    spike.material = shardMat;
    spike.parent = crown;
    cast(spike, shadowGen);
    extras.push(spike);
  }

  const aura = MeshBuilder.CreateSphere(
    `${p}Aura`,
    { diameter: 0.5, segments: 16 },
    scene,
  );
  aura.position.y = headY;
  aura.material = auraMat;
  aura.parent = root;

  // 雪尘
  const sparks: Mesh[] = [];
  for (let i = 0; i < 10; i++) {
    const s = MeshBuilder.CreateSphere(
      `${p}Spark_${i}`,
      { diameter: 0.022 + (i % 2) * 0.01, segments: 6 },
      scene,
    );
    s.material = sparkMat;
    s.parent = orb;
    sparks.push(s);
  }

  return {
    style: 'frost',
    root,
    orb,
    orbMat,
    core,
    coreMat,
    halos,
    aura,
    auraMat,
    crown,
    sparks,
    extras,
    t: 0,
  };
}

// ═══════════════════════════════════════════════════════════
// 荆棘杖：扭曲木杆 + 藤蔓环 + 绿宝石 + 叶冠 + 孢子
// ═══════════════════════════════════════════════════════════
function attachNatureStaff(
  scene: Scene,
  rightHand: Mesh,
  shadowGen?: ShadowGenerator,
): StaffFx {
  const p = 'staffNature';
  const root = gripRoot(scene, 'natureStaff', rightHand);

  const woodMat = mat(scene, `${p}Wood`, 0x3a2818);
  const barkMat = mat(scene, `${p}Bark`, 0x2a1c10);
  const vineMat = emissiveMat(scene, `${p}Vine`, 0x3d8b4a, 0.45);
  const leafMat = emissiveMat(scene, `${p}Leaf`, 0x5ecf62, 0.75);
  const gemMat = emissiveMat(scene, `${p}Gem`, 0x2dff88, 1.05);
  const orbMat = emissiveMat(scene, `${p}Orb`, 0x3dff7a, 1.1);
  const coreMat = emissiveMat(scene, `${p}Core`, 0xc8ffd8, 1.35);
  const sparkMat = emissiveMat(scene, `${p}Spark`, 0xa0ff66, 1.1);
  const auraMat = softAuraMat(scene, `${p}Aura`, 0x44cc66, 0.55, 0.2);

  // 略弯的木杆（两段错位近似扭曲）
  const shaftA = MeshBuilder.CreateCylinder(
    `${p}ShaftA`,
    { height: 0.7, diameterTop: 0.04, diameterBottom: 0.065, tessellation: 10 },
    scene,
  );
  shaftA.position.set(0.01, 0.05, 0);
  shaftA.rotation.z = 0.08;
  shaftA.material = woodMat;
  shaftA.parent = root;
  cast(shaftA, shadowGen);

  const shaftB = MeshBuilder.CreateCylinder(
    `${p}ShaftB`,
    { height: 0.62, diameterTop: 0.03, diameterBottom: 0.045, tessellation: 10 },
    scene,
  );
  shaftB.position.set(-0.012, 0.58, 0.01);
  shaftB.rotation.z = -0.1;
  shaftB.material = barkMat;
  shaftB.parent = root;
  cast(shaftB, shadowGen);

  // 藤蔓环
  for (let i = 0; i < 6; i++) {
    const vine = MeshBuilder.CreateTorus(
      `${p}Vine_${i}`,
      { diameter: 0.06 + i * 0.005, thickness: 0.016, tessellation: 14 },
      scene,
    );
    vine.position.y = -0.1 + i * 0.15;
    vine.rotation.x = 0.5 + i * 0.15;
    vine.rotation.z = i * 0.4;
    vine.material = vineMat;
    vine.parent = root;
    cast(vine, shadowGen);
  }

  // 根球
  const pommel = MeshBuilder.CreateSphere(
    `${p}Pommel`,
    { diameter: 0.13, segments: 10 },
    scene,
  );
  pommel.position.y = -0.34;
  pommel.scaling = new Vector3(1, 0.85, 1);
  pommel.material = barkMat;
  pommel.parent = root;
  cast(pommel, shadowGen);

  // 中段小叶 / 宝石
  for (const [i, y, size, isLeaf] of [
    [0, 0.25, 0.04, true],
    [1, 0.42, 0.035, false],
    [2, 0.58, 0.042, true],
  ] as const) {
    const piece = MeshBuilder.CreatePolyhedron(
      `${p}Mid_${i}`,
      { type: isLeaf ? 0 : 1, size },
      scene,
    );
    piece.position.y = y;
    piece.position.x = (i % 2 === 0 ? 1 : -1) * 0.03;
    piece.rotation.z = (i % 2 === 0 ? 1 : -1) * 0.6;
    piece.material = isLeaf ? leafMat : gemMat;
    piece.parent = root;
    cast(piece, shadowGen);
  }

  const collar = MeshBuilder.CreateCylinder(
    `${p}Collar`,
    { height: 0.055, diameter: 0.12, tessellation: 10 },
    scene,
  );
  collar.position.y = 0.88;
  collar.material = vineMat;
  collar.parent = root;
  cast(collar, shadowGen);

  const headY = 1.12;
  const orb = MeshBuilder.CreateSphere(
    `${p}Orb`,
    { diameter: 0.24, segments: 18 },
    scene,
  );
  orb.position.y = headY;
  orb.material = orbMat;
  orb.parent = root;
  cast(orb, shadowGen);

  const core = MeshBuilder.CreateSphere(
    `${p}Core`,
    { diameter: 0.09, segments: 12 },
    scene,
  );
  core.position.y = headY;
  core.material = coreMat;
  core.parent = root;

  // 叶冠：扁锥叶围绕
  const crown = new TransformNode(`${p}Crown`, scene);
  crown.parent = root;
  crown.position.y = headY;
  const extras: Mesh[] = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const leaf = MeshBuilder.CreateCylinder(
      `${p}Leaf_${i}`,
      {
        height: 0.16,
        diameterTop: 0,
        diameterBottom: 0.055,
        tessellation: 5,
      },
      scene,
    );
    leaf.position.set(Math.cos(a) * 0.11, 0.04, Math.sin(a) * 0.11);
    leaf.scaling = new Vector3(0.55, 1, 1);
    leaf.rotation.z = Math.cos(a) * 1.1;
    leaf.rotation.x = -Math.sin(a) * 1.1;
    leaf.material = i % 2 === 0 ? leafMat : vineMat;
    leaf.parent = crown;
    cast(leaf, shadowGen);
    extras.push(leaf);
  }
  // 顶芽
  const bud = MeshBuilder.CreateCylinder(
    `${p}Bud`,
    { height: 0.14, diameterTop: 0, diameterBottom: 0.05, tessellation: 6 },
    scene,
  );
  bud.position.y = 0.16;
  bud.material = gemMat;
  bud.parent = crown;
  cast(bud, shadowGen);
  extras.push(bud);

  // 轻柔绿光环
  const halo = MeshBuilder.CreateTorus(
    `${p}Halo`,
    { diameter: 0.4, thickness: 0.018, tessellation: 24 },
    scene,
  );
  halo.position.y = headY;
  halo.rotation.x = Math.PI / 2.4;
  halo.material = emissiveMat(scene, `${p}HaloMat`, 0x66ff99, 0.9);
  halo.parent = root;
  cast(halo, shadowGen);

  const aura = MeshBuilder.CreateSphere(
    `${p}Aura`,
    { diameter: 0.46, segments: 14 },
    scene,
  );
  aura.position.y = headY;
  aura.material = auraMat;
  aura.parent = root;

  // 孢子
  const sparks: Mesh[] = [];
  for (let i = 0; i < 8; i++) {
    const s = MeshBuilder.CreateSphere(
      `${p}Spark_${i}`,
      { diameter: 0.03, segments: 6 },
      scene,
    );
    s.material = sparkMat;
    s.parent = orb;
    sparks.push(s);
  }

  return {
    style: 'nature',
    root,
    orb,
    orbMat,
    core,
    coreMat,
    halos: [halo],
    aura,
    auraMat,
    crown,
    sparks,
    extras,
    t: 0,
  };
}

// ═══════════════════════════════════════════════════════════
// 虚空杖：细黑杖 + 银环 + 双环黑洞 + 紫雾星尘
// ═══════════════════════════════════════════════════════════
function attachVoidStaff(
  scene: Scene,
  rightHand: Mesh,
  shadowGen?: ShadowGenerator,
): StaffFx {
  const p = 'staffVoid';
  const root = gripRoot(scene, 'voidStaff', rightHand);

  const blackMat = mat(scene, `${p}Black`, 0x0a0a12);
  const boneMat = emissiveMat(scene, `${p}Bone`, 0x6a6a80, 0.35);
  const silverMat = emissiveMat(scene, `${p}Silver`, 0xa0a8c0, 0.5);
  const voidMat = emissiveMat(scene, `${p}Void`, 0x2a0840, 0.9);
  const orbMat = emissiveMat(scene, `${p}Orb`, 0x7b2cff, 1.15);
  const coreMat = emissiveMat(scene, `${p}Core`, 0x120018, 1.0);
  // 核心要偏暗紫，像吸光
  coreMat.emissiveColor.set(0.08, 0.02, 0.14);
  const sparkMat = emissiveMat(scene, `${p}Spark`, 0xcc66ff, 1.2);
  const sparkMat2 = emissiveMat(scene, `${p}Spark2`, 0x6644aa, 1.0);
  const auraMat = softAuraMat(scene, `${p}Aura`, 0x5511aa, 0.65, 0.18);

  // 细长漆黑杖身
  const shaft = MeshBuilder.CreateCylinder(
    `${p}Shaft`,
    { height: 1.28, diameterTop: 0.022, diameterBottom: 0.045, tessellation: 10 },
    scene,
  );
  shaft.position.y = 0.32;
  shaft.material = blackMat;
  shaft.parent = root;
  cast(shaft, shadowGen);

  // 稀疏银环
  for (let i = 0; i < 4; i++) {
    const ring = MeshBuilder.CreateTorus(
      `${p}Ring_${i}`,
      { diameter: 0.05 + i * 0.004, thickness: 0.012, tessellation: 16 },
      scene,
    );
    ring.position.y = -0.05 + i * 0.22;
    ring.rotation.x = Math.PI / 2;
    ring.material = i === 3 ? silverMat : boneMat;
    ring.parent = root;
    cast(ring, shadowGen);
  }

  // 骷髅感底坠：扁球 + 小环
  const pommel = MeshBuilder.CreateSphere(
    `${p}Pommel`,
    { diameter: 0.1, segments: 12 },
    scene,
  );
  pommel.position.y = -0.34;
  pommel.scaling = new Vector3(1, 0.75, 1);
  pommel.material = voidMat;
  pommel.parent = root;
  cast(pommel, shadowGen);

  const pommelRing = MeshBuilder.CreateTorus(
    `${p}PommelRing`,
    { diameter: 0.12, thickness: 0.014, tessellation: 14 },
    scene,
  );
  pommelRing.position.y = -0.34;
  pommelRing.rotation.x = Math.PI / 2;
  pommelRing.material = silverMat;
  pommelRing.parent = root;
  cast(pommelRing, shadowGen);

  // 中段虚空棱晶
  for (const [i, y, size] of [
    [0, 0.3, 0.032],
    [1, 0.5, 0.04],
    [2, 0.7, 0.03],
  ] as const) {
    const gem = MeshBuilder.CreatePolyhedron(
      `${p}Gem_${i}`,
      { type: 2, size },
      scene,
    );
    gem.position.y = y;
    gem.rotation.y = i * 1.1;
    gem.material = i === 1 ? orbMat : voidMat;
    gem.parent = root;
    cast(gem, shadowGen);
  }

  const collar = MeshBuilder.CreateCylinder(
    `${p}Collar`,
    { height: 0.045, diameter: 0.1, tessellation: 12 },
    scene,
  );
  collar.position.y = 0.92;
  collar.material = silverMat;
  collar.parent = root;
  cast(collar, shadowGen);

  // 三爪托住虚空核
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const claw = MeshBuilder.CreateCylinder(
      `${p}Claw_${i}`,
      {
        height: 0.18,
        diameterTop: 0.006,
        diameterBottom: 0.022,
        tessellation: 6,
      },
      scene,
    );
    claw.position.set(Math.cos(a) * 0.06, 1.0, Math.sin(a) * 0.06);
    claw.rotation.z = Math.cos(a) * 0.75;
    claw.rotation.x = -Math.sin(a) * 0.75;
    claw.material = silverMat;
    claw.parent = root;
    cast(claw, shadowGen);
  }

  const headY = 1.14;
  // 外层紫雾球
  const orb = MeshBuilder.CreateSphere(
    `${p}Orb`,
    { diameter: 0.22, segments: 18 },
    scene,
  );
  orb.position.y = headY;
  orb.material = orbMat;
  orb.parent = root;
  cast(orb, shadowGen);

  // 内层「黑洞」——更小更暗
  const core = MeshBuilder.CreateSphere(
    `${p}Core`,
    { diameter: 0.12, segments: 14 },
    scene,
  );
  core.position.y = headY;
  core.material = coreMat;
  core.parent = root;

  // 双倾斜虚空环（像行星环 / 奇点）
  const halos: Mesh[] = [];
  const haloSpecs = [
    { d: 0.42, th: 0.02, hex: 0xaa44ff, rx: Math.PI / 2.1, ry: 0.3 },
    { d: 0.52, th: 0.014, hex: 0x6622aa, rx: Math.PI / 3.2, ry: 1.2 },
  ];
  for (const [i, spec] of haloSpecs.entries()) {
    const halo = MeshBuilder.CreateTorus(
      `${p}Halo_${i}`,
      { diameter: spec.d, thickness: spec.th, tessellation: 32 },
      scene,
    );
    halo.position.y = headY;
    halo.rotation.x = spec.rx;
    halo.rotation.y = spec.ry;
    halo.material = emissiveMat(scene, `${p}HaloMat_${i}`, spec.hex, 1.0);
    halo.parent = root;
    cast(halo, shadowGen);
    halos.push(halo);
  }

  const aura = MeshBuilder.CreateSphere(
    `${p}Aura`,
    { diameter: 0.52, segments: 16 },
    scene,
  );
  aura.position.y = headY;
  aura.material = auraMat;
  aura.parent = root;

  // 无尖冠：用几个小棱晶漂浮作 extras
  const crown = new TransformNode(`${p}Crown`, scene);
  crown.parent = root;
  crown.position.y = headY;
  const extras: Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const shard = MeshBuilder.CreatePolyhedron(
      `${p}Shard_${i}`,
      { type: 2, size: 0.028 },
      scene,
    );
    shard.position.set(Math.cos(a) * 0.16, 0.02, Math.sin(a) * 0.16);
    shard.material = voidMat;
    shard.parent = crown;
    cast(shard, shadowGen);
    extras.push(shard);
  }

  // 紫星尘
  const sparks: Mesh[] = [];
  for (let i = 0; i < 12; i++) {
    const s = MeshBuilder.CreateSphere(
      `${p}Spark_${i}`,
      { diameter: i < 6 ? 0.026 : 0.02, segments: 6 },
      scene,
    );
    s.material = i < 6 ? sparkMat : sparkMat2;
    s.parent = orb;
    sparks.push(s);
  }

  return {
    style: 'void',
    root,
    orb,
    orbMat,
    core,
    coreMat,
    halos,
    aura,
    auraMat,
    crown,
    sparks,
    extras,
    t: 0,
  };
}

// ═══════════════════════════════════════════════════════════
// 雷电杖：铜铁杖身 + 线圈 + 电球 + 锯齿电弧 + 电火花
// ═══════════════════════════════════════════════════════════
function attachStormStaff(
  scene: Scene,
  rightHand: Mesh,
  shadowGen?: ShadowGenerator,
): StaffFx {
  const p = 'staffStorm';
  const root = gripRoot(scene, 'stormStaff', rightHand);

  const ironMat = mat(scene, `${p}Iron`, 0x1a1e28);
  const copperMat = emissiveMat(scene, `${p}Copper`, 0xc8792a, 0.5);
  const brassMat = emissiveMat(scene, `${p}Brass`, 0xe8c050, 0.55);
  const boltMat = emissiveMat(scene, `${p}Bolt`, 0xffee55, 1.25);
  const boltMat2 = emissiveMat(scene, `${p}Bolt2`, 0x66ddff, 1.15);
  const orbMat = emissiveMat(scene, `${p}Orb`, 0xfff066, 1.2);
  const coreMat = emissiveMat(scene, `${p}Core`, 0xffffff, 1.5);
  const sparkMat = emissiveMat(scene, `${p}Spark`, 0xffff88, 1.3);
  const sparkMat2 = emissiveMat(scene, `${p}Spark2`, 0x88eeff, 1.2);
  const auraMat = softAuraMat(scene, `${p}Aura`, 0xffee44, 0.65, 0.18);

  // 细长铜铁杖
  const shaft = MeshBuilder.CreateCylinder(
    `${p}Shaft`,
    { height: 1.22, diameterTop: 0.028, diameterBottom: 0.055, tessellation: 12 },
    scene,
  );
  shaft.position.y = 0.3;
  shaft.material = ironMat;
  shaft.parent = root;
  cast(shaft, shadowGen);

  // 螺旋线圈（倾斜铜环）
  for (let i = 0; i < 8; i++) {
    const coil = MeshBuilder.CreateTorus(
      `${p}Coil_${i}`,
      { diameter: 0.055 + (i % 3) * 0.008, thickness: 0.012, tessellation: 14 },
      scene,
    );
    coil.position.y = -0.12 + i * 0.12;
    coil.rotation.x = 0.55;
    coil.rotation.y = i * 0.55;
    coil.material = i % 2 === 0 ? copperMat : brassMat;
    coil.parent = root;
    cast(coil, shadowGen);
  }

  // 底端铜锤
  const pommel = MeshBuilder.CreateCylinder(
    `${p}Pommel`,
    { height: 0.08, diameter: 0.12, tessellation: 10 },
    scene,
  );
  pommel.position.y = -0.34;
  pommel.material = copperMat;
  pommel.parent = root;
  cast(pommel, shadowGen);

  const pommelTip = MeshBuilder.CreateSphere(
    `${p}PommelTip`,
    { diameter: 0.06, segments: 10 },
    scene,
  );
  pommelTip.position.y = -0.4;
  pommelTip.material = boltMat;
  pommelTip.parent = root;
  cast(pommelTip, shadowGen);

  // 中段晶体电容器
  for (const [i, y, size, hex] of [
    [0, 0.28, 0.035, 0xffee55],
    [1, 0.48, 0.045, 0x66ddff],
    [2, 0.68, 0.032, 0xffee55],
  ] as const) {
    const gem = MeshBuilder.CreatePolyhedron(
      `${p}Gem_${i}`,
      { type: 1, size },
      scene,
    );
    gem.position.y = y;
    gem.rotation.y = i * 0.8;
    gem.material = emissiveMat(scene, `${p}GemMat_${i}`, hex, 1.0);
    gem.parent = root;
    cast(gem, shadowGen);
  }

  // 顶端电极盘
  const collar = MeshBuilder.CreateCylinder(
    `${p}Collar`,
    { height: 0.04, diameter: 0.14, tessellation: 14 },
    scene,
  );
  collar.position.y = 0.9;
  collar.material = brassMat;
  collar.parent = root;
  cast(collar, shadowGen);

  // 四根电极尖刺朝上托电球
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const rod = MeshBuilder.CreateCylinder(
      `${p}Rod_${i}`,
      {
        height: 0.2,
        diameterTop: 0.006,
        diameterBottom: 0.02,
        tessellation: 6,
      },
      scene,
    );
    rod.position.set(Math.cos(a) * 0.07, 1.0, Math.sin(a) * 0.07);
    rod.rotation.z = Math.cos(a) * 0.55;
    rod.rotation.x = -Math.sin(a) * 0.55;
    rod.material = brassMat;
    rod.parent = root;
    cast(rod, shadowGen);
  }

  const headY = 1.16;
  // 电球
  const orb = MeshBuilder.CreateSphere(
    `${p}Orb`,
    { diameter: 0.24, segments: 20 },
    scene,
  );
  orb.position.y = headY;
  orb.material = orbMat;
  orb.parent = root;
  cast(orb, shadowGen);

  const core = MeshBuilder.CreateSphere(
    `${p}Core`,
    { diameter: 0.1, segments: 12 },
    scene,
  );
  core.position.y = headY;
  core.material = coreMat;
  core.parent = root;

  // 锯齿电弧：用细长锥体模拟闪电分支（extras 做闪烁缩放）
  const crown = new TransformNode(`${p}Crown`, scene);
  crown.parent = root;
  crown.position.y = headY;
  const extras: Mesh[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const len = 0.18 + (i % 3) * 0.06;
    const bolt = MeshBuilder.CreateCylinder(
      `${p}Bolt_${i}`,
      {
        height: len,
        diameterTop: 0,
        diameterBottom: 0.022,
        tessellation: 4,
      },
      scene,
    );
    // 从球面向外斜刺，带折角感
    bolt.position.set(
      Math.cos(a) * 0.1,
      (i % 2 === 0 ? 0.08 : -0.04) + len * 0.15,
      Math.sin(a) * 0.1,
    );
    bolt.rotation.z = Math.cos(a) * 1.15;
    bolt.rotation.x = -Math.sin(a) * 1.15;
    bolt.rotation.y = a * 0.3;
    bolt.material = i % 2 === 0 ? boltMat : boltMat2;
    bolt.parent = crown;
    cast(bolt, shadowGen);
    extras.push(bolt);
  }
  // 顶端主电矛
  const mainBolt = MeshBuilder.CreateCylinder(
    `${p}MainBolt`,
    { height: 0.28, diameterTop: 0, diameterBottom: 0.035, tessellation: 5 },
    scene,
  );
  mainBolt.position.y = 0.2;
  mainBolt.material = boltMat;
  mainBolt.parent = crown;
  cast(mainBolt, shadowGen);
  extras.push(mainBolt);

  // 水平电弧环
  const halo = MeshBuilder.CreateTorus(
    `${p}Halo`,
    { diameter: 0.42, thickness: 0.016, tessellation: 28 },
    scene,
  );
  halo.position.y = headY;
  halo.rotation.x = Math.PI / 2.3;
  halo.material = emissiveMat(scene, `${p}HaloMat`, 0x88eeff, 1.1);
  halo.parent = root;
  cast(halo, shadowGen);

  const aura = MeshBuilder.CreateSphere(
    `${p}Aura`,
    { diameter: 0.5, segments: 16 },
    scene,
  );
  aura.position.y = headY;
  aura.material = auraMat;
  aura.parent = root;

  // 电火花
  const sparks: Mesh[] = [];
  for (let i = 0; i < 12; i++) {
    const s = MeshBuilder.CreateSphere(
      `${p}Spark_${i}`,
      { diameter: i < 6 ? 0.03 : 0.022, segments: 6 },
      scene,
    );
    s.material = i < 6 ? sparkMat : sparkMat2;
    s.parent = orb;
    sparks.push(s);
  }

  return {
    style: 'storm',
    root,
    orb,
    orbMat,
    core,
    coreMat,
    halos: [halo],
    aura,
    auraMat,
    crown,
    sparks,
    extras,
    t: 0,
  };
}

// ═══════════════════════════════════════════════════════════
// 圣光杖：象牙白金 + 十字冠 + 圣光球 + 光环 + 金尘
// ═══════════════════════════════════════════════════════════
function attachHolyStaff(
  scene: Scene,
  rightHand: Mesh,
  shadowGen?: ShadowGenerator,
): StaffFx {
  const p = 'staffHoly';
  const root = gripRoot(scene, 'holyStaff', rightHand);

  const ivoryMat = mat(scene, `${p}Ivory`, 0xf0e8d8);
  const goldMat = emissiveMat(scene, `${p}Gold`, 0xffd700, 0.7);
  const paleGoldMat = emissiveMat(scene, `${p}PaleGold`, 0xffe8a0, 0.55);
  const orbMat = emissiveMat(scene, `${p}Orb`, 0xfff8d0, 1.15);
  const coreMat = emissiveMat(scene, `${p}Core`, 0xffffff, 1.5);
  const rayMat = emissiveMat(scene, `${p}Ray`, 0xffe066, 1.1);
  const sparkMat = emissiveMat(scene, `${p}Spark`, 0xfff5c0, 1.2);
  const auraMat = softAuraMat(scene, `${p}Aura`, 0xffeeaa, 0.6, 0.22);

  // 象牙白杖身
  const shaft = MeshBuilder.CreateCylinder(
    `${p}Shaft`,
    { height: 1.22, diameterTop: 0.032, diameterBottom: 0.058, tessellation: 14 },
    scene,
  );
  shaft.position.y = 0.3;
  shaft.material = ivoryMat;
  shaft.parent = root;
  cast(shaft, shadowGen);

  // 金箍饰带
  for (let i = 0; i < 5; i++) {
    const band = MeshBuilder.CreateTorus(
      `${p}Band_${i}`,
      { diameter: 0.055 + i * 0.004, thickness: 0.015, tessellation: 16 },
      scene,
    );
    band.position.y = -0.08 + i * 0.18;
    band.rotation.x = Math.PI / 2;
    band.material = i % 2 === 0 ? goldMat : paleGoldMat;
    band.parent = root;
    cast(band, shadowGen);
  }

  // 底端金球 + 小十字
  const pommel = MeshBuilder.CreateSphere(
    `${p}Pommel`,
    { diameter: 0.11, segments: 14 },
    scene,
  );
  pommel.position.y = -0.34;
  pommel.material = goldMat;
  pommel.parent = root;
  cast(pommel, shadowGen);

  const pommelCrossV = MeshBuilder.CreateBox(
    `${p}PommelCrossV`,
    { width: 0.025, height: 0.1, depth: 0.025 },
    scene,
  );
  pommelCrossV.position.y = -0.42;
  pommelCrossV.material = goldMat;
  pommelCrossV.parent = root;
  cast(pommelCrossV, shadowGen);

  const pommelCrossH = MeshBuilder.CreateBox(
    `${p}PommelCrossH`,
    { width: 0.07, height: 0.022, depth: 0.022 },
    scene,
  );
  pommelCrossH.position.y = -0.4;
  pommelCrossH.material = goldMat;
  pommelCrossH.parent = root;
  cast(pommelCrossH, shadowGen);

  // 中段圣徽宝石
  for (const [i, y, size] of [
    [0, 0.3, 0.038],
    [1, 0.5, 0.048],
    [2, 0.7, 0.036],
  ] as const) {
    const gem = MeshBuilder.CreatePolyhedron(
      `${p}Gem_${i}`,
      { type: 2, size },
      scene,
    );
    gem.position.y = y;
    gem.rotation.y = i * 0.6;
    gem.material = i === 1 ? orbMat : paleGoldMat;
    gem.parent = root;
    cast(gem, shadowGen);
  }

  // 宽金领
  const collar = MeshBuilder.CreateCylinder(
    `${p}Collar`,
    { height: 0.055, diameter: 0.13, tessellation: 16 },
    scene,
  );
  collar.position.y = 0.9;
  collar.material = goldMat;
  collar.parent = root;
  cast(collar, shadowGen);

  const headY = 1.14;
  // 圣光球
  const orb = MeshBuilder.CreateSphere(
    `${p}Orb`,
    { diameter: 0.26, segments: 22 },
    scene,
  );
  orb.position.y = headY;
  orb.material = orbMat;
  orb.parent = root;
  cast(orb, shadowGen);

  const core = MeshBuilder.CreateSphere(
    `${p}Core`,
    { diameter: 0.11, segments: 14 },
    scene,
  );
  core.position.y = headY;
  core.material = coreMat;
  core.parent = root;

  // 十字光冠：竖直 + 水平两根，再加对角射线
  const crown = new TransformNode(`${p}Crown`, scene);
  crown.parent = root;
  crown.position.y = headY;
  const extras: Mesh[] = [];

  const crossV = MeshBuilder.CreateBox(
    `${p}CrossV`,
    { width: 0.04, height: 0.42, depth: 0.04 },
    scene,
  );
  crossV.material = goldMat;
  crossV.parent = crown;
  cast(crossV, shadowGen);
  extras.push(crossV);

  const crossH = MeshBuilder.CreateBox(
    `${p}CrossH`,
    { width: 0.32, height: 0.04, depth: 0.04 },
    scene,
  );
  crossH.material = goldMat;
  crossH.parent = crown;
  cast(crossH, shadowGen);
  extras.push(crossH);

  // 对角光矛
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const ray = MeshBuilder.CreateCylinder(
      `${p}Ray_${i}`,
      {
        height: 0.22,
        diameterTop: 0,
        diameterBottom: 0.03,
        tessellation: 6,
      },
      scene,
    );
    ray.position.set(Math.cos(a) * 0.1, 0.02, Math.sin(a) * 0.1);
    ray.rotation.z = Math.cos(a) * 1.0;
    ray.rotation.x = -Math.sin(a) * 1.0;
    ray.material = rayMat;
    ray.parent = crown;
    cast(ray, shadowGen);
    extras.push(ray);
  }

  // 双层圣光环（水平为主）
  const halos: Mesh[] = [];
  for (const [i, d, th, hex] of [
    [0, 0.4, 0.02, 0xffe066],
    [1, 0.54, 0.014, 0xffffff],
  ] as const) {
    const halo = MeshBuilder.CreateTorus(
      `${p}Halo_${i}`,
      { diameter: d, thickness: th, tessellation: 32 },
      scene,
    );
    halo.position.y = headY + (i === 0 ? 0 : 0.02);
    halo.rotation.x = Math.PI / 2 + (i === 0 ? 0.08 : -0.12);
    halo.material = emissiveMat(scene, `${p}HaloMat_${i}`, hex, 1.05);
    halo.parent = root;
    cast(halo, shadowGen);
    halos.push(halo);
  }

  const aura = MeshBuilder.CreateSphere(
    `${p}Aura`,
    { diameter: 0.55, segments: 18 },
    scene,
  );
  aura.position.y = headY;
  aura.material = auraMat;
  aura.parent = root;

  // 金尘
  const sparks: Mesh[] = [];
  for (let i = 0; i < 10; i++) {
    const s = MeshBuilder.CreateSphere(
      `${p}Spark_${i}`,
      { diameter: 0.028 + (i % 2) * 0.008, segments: 6 },
      scene,
    );
    s.material = sparkMat;
    s.parent = orb;
    sparks.push(s);
  }

  return {
    style: 'holy',
    root,
    orb,
    orbMat,
    core,
    coreMat,
    halos,
    aura,
    auraMat,
    crown,
    sparks,
    extras,
    t: 0,
  };
}

// ═══════════════════════════════════════════════════════════
// 动效：按款式驱动脉动 / 轨道 / 冠旋转
// ═══════════════════════════════════════════════════════════
export function updateStaffFx(fx: StaffFx, dt: number, lite = false): void {
  fx.t += dt;
  const t = fx.t;

  if (lite) {
    const pulse = 0.75 + 0.25 * Math.sin(t * 4);
    fx.orbMat.emissiveColor.set(pulse, pulse * 0.35, pulse * 0.08);
    fx.orb.scaling.setAll(0.96 + 0.08 * Math.sin(t * 3));
    return;
  }

  switch (fx.style) {
    case 'flame':
      updateFlame(fx, t, dt);
      break;
    case 'frost':
      updateFrost(fx, t, dt);
      break;
    case 'nature':
      updateNature(fx, t, dt);
      break;
    case 'void':
      updateVoid(fx, t, dt);
      break;
    case 'storm':
      updateStorm(fx, t, dt);
      break;
    case 'holy':
      updateHoly(fx, t, dt);
      break;
    case 'arcane':
    default:
      updateArcane(fx, t, dt);
      break;
  }
}

function updateArcane(fx: StaffFx, t: number, dt: number): void {
  const pulse = 0.65 + 0.55 * (0.5 + 0.5 * Math.sin(t * 5.5));
  const hue = 0.5 + 0.5 * Math.sin(t * 2.2);
  const r = (0.45 + 0.55 * hue) * pulse;
  const g = (0.35 + 0.4 * (1 - hue)) * pulse;
  const b = 1.0 * pulse;
  fx.orbMat.emissiveColor.set(r, g, b * 0.95 + 0.3);
  fx.orbMat.diffuseColor.set(r * 0.85, g * 0.9, b);

  if (fx.core && fx.coreMat) {
    const corePulse = 0.75 + 0.5 * Math.sin(t * 8);
    fx.coreMat.emissiveColor.set(corePulse, corePulse, corePulse);
    fx.core.scaling.setAll(0.9 + 0.25 * Math.sin(t * 7));
  }

  fx.orb.scaling.setAll(0.95 + 0.12 * Math.sin(t * 3.4));

  const speeds = [3.8, -2.9, 4.6];
  for (let i = 0; i < fx.halos.length; i++) {
    const h = fx.halos[i]!;
    h.rotation.y += dt * speeds[i % speeds.length]!;
    h.rotation.x += dt * (1.2 + i * 0.4) * (i % 2 === 0 ? 1 : -1);
    h.rotation.z = Math.sin(t * (1.5 + i * 0.3) + i) * 0.45;
    const s = 1 + 0.08 * Math.sin(t * 4 + i);
    h.scaling.set(s, s, s);
  }

  if (fx.aura && fx.auraMat) {
    const auraS = 1.05 + 0.18 * Math.sin(t * 2.6);
    fx.aura.scaling.setAll(auraS);
    fx.aura.rotation.y += dt * 0.8;
    const ap = 0.35 + 0.25 * Math.sin(t * 3);
    fx.auraMat.emissiveColor.set(0.5 * ap, 0.2 * ap, 0.95 * ap);
    fx.auraMat.alpha = 0.18 + 0.12 * Math.sin(t * 3);
  }

  if (fx.crown) fx.crown.rotation.y += dt * 2.2;

  orbitSparks(fx, t, 6, 5.5, 0.16, -3.2, 0.26, 0.04, 0.07);
}

function updateFlame(fx: StaffFx, t: number, dt: number): void {
  // 火球：红橙黄闪烁
  const pulse = 0.7 + 0.45 * (0.5 + 0.5 * Math.sin(t * 7));
  const flicker = 0.5 + 0.5 * Math.sin(t * 13.5);
  fx.orbMat.emissiveColor.set(pulse, 0.22 * pulse + 0.15 * flicker, 0.05 * pulse);
  fx.orbMat.diffuseColor.set(0.95 * pulse, 0.28 * pulse, 0.06);
  fx.orb.scaling.set(
    0.95 + 0.1 * Math.sin(t * 5),
    1 + 0.18 * Math.sin(t * 6.2),
    0.95 + 0.1 * Math.cos(t * 4.8),
  );

  if (fx.core && fx.coreMat) {
    const cp = 0.8 + 0.5 * Math.sin(t * 11);
    fx.coreMat.emissiveColor.set(cp, cp * 0.9, cp * 0.45);
    fx.core.scaling.setAll(0.85 + 0.3 * Math.sin(t * 9));
  }

  // 焰舌抖动
  if (fx.crown) {
    fx.crown.rotation.y += dt * 1.4;
    for (let i = 0; i < fx.extras.length; i++) {
      const tongue = fx.extras[i]!;
      const wiggle = 1 + 0.15 * Math.sin(t * (8 + i * 1.7) + i);
      tongue.scaling.y = wiggle;
      tongue.scaling.x = 1 / Math.sqrt(wiggle);
      tongue.scaling.z = 1 / Math.sqrt(wiggle);
    }
  }

  if (fx.aura && fx.auraMat) {
    const as = 1 + 0.2 * Math.sin(t * 4);
    fx.aura.scaling.set(as, as * 1.3, as);
    const ap = 0.4 + 0.3 * Math.sin(t * 5);
    fx.auraMat.emissiveColor.set(ap, 0.2 * ap, 0.02 * ap);
    fx.auraMat.alpha = 0.14 + 0.1 * Math.sin(t * 4.5);
  }

  // 火星上漂螺旋
  for (let i = 0; i < fx.sparks.length; i++) {
    const spark = fx.sparks[i]!;
    const speed = 2.2 + (i % 4) * 0.4;
    const phase = t * speed + (i / fx.sparks.length) * Math.PI * 2;
    const radius = 0.1 + (i % 3) * 0.04;
    const rise = ((t * 0.35 + i * 0.17) % 1) * 0.28 - 0.05;
    spark.position.set(Math.cos(phase) * radius, rise, Math.sin(phase) * radius);
    const ps = 0.5 + 0.6 * Math.sin(t * 10 + i) * (1 - Math.max(0, rise) / 0.28);
    spark.scaling.setAll(Math.max(0.2, ps));
  }
}

function updateFrost(fx: StaffFx, t: number, dt: number): void {
  const pulse = 0.75 + 0.35 * Math.sin(t * 3.2);
  fx.orbMat.emissiveColor.set(0.45 * pulse, 0.8 * pulse, pulse);
  fx.orbMat.diffuseColor.set(0.5, 0.85, 1);
  fx.orb.rotation.y += dt * 0.9;
  fx.orb.rotation.z = Math.sin(t * 1.4) * 0.12;
  fx.orb.scaling.setAll(0.96 + 0.08 * Math.sin(t * 2.4));

  if (fx.core && fx.coreMat) {
    const cp = 0.85 + 0.35 * Math.sin(t * 5);
    fx.coreMat.emissiveColor.set(cp, cp, cp);
    fx.core.scaling.setAll(0.9 + 0.2 * Math.sin(t * 4));
  }

  for (let i = 0; i < fx.halos.length; i++) {
    const h = fx.halos[i]!;
    h.rotation.z += dt * (i === 0 ? 1.6 : -1.1);
    h.rotation.y += dt * (i === 0 ? 0.4 : -0.55);
    const s = 1 + 0.06 * Math.sin(t * 2.5 + i);
    h.scaling.set(s, s, s);
  }

  if (fx.crown) {
    fx.crown.rotation.y += dt * 1.1;
    // 冰刺轻微呼吸
    for (let i = 0; i < fx.extras.length; i++) {
      const spike = fx.extras[i]!;
      const s = 1 + 0.08 * Math.sin(t * 2.8 + i * 0.7);
      spike.scaling.setAll(s);
    }
  }

  if (fx.aura && fx.auraMat) {
    const as = 1.02 + 0.12 * Math.sin(t * 1.8);
    fx.aura.scaling.setAll(as);
    const ap = 0.3 + 0.2 * Math.sin(t * 2.2);
    fx.auraMat.emissiveColor.set(0.35 * ap, 0.7 * ap, ap);
    fx.auraMat.alpha = 0.16 + 0.1 * Math.sin(t * 2);
  }

  // 雪尘缓缓环绕 + 轻飘
  for (let i = 0; i < fx.sparks.length; i++) {
    const spark = fx.sparks[i]!;
    const inner = i < 5;
    const n = inner ? 5 : fx.sparks.length - 5;
    const idx = inner ? i : i - 5;
    const speed = inner ? 1.8 : -1.2;
    const radius = inner ? 0.12 : 0.2;
    const a = t * speed + (idx / Math.max(n, 1)) * Math.PI * 2;
    const yOff = 0.06 * Math.sin(t * 2 + i) + (inner ? 0 : 0.03);
    spark.position.set(Math.cos(a) * radius, yOff, Math.sin(a) * radius);
    spark.scaling.setAll(0.6 + 0.45 * Math.sin(t * 3 + i));
  }
}

function updateNature(fx: StaffFx, t: number, dt: number): void {
  const pulse = 0.7 + 0.4 * (0.5 + 0.5 * Math.sin(t * 2.8));
  fx.orbMat.emissiveColor.set(0.15 * pulse, pulse, 0.4 * pulse);
  fx.orbMat.diffuseColor.set(0.2, 0.9 * pulse, 0.4);
  fx.orb.scaling.setAll(0.96 + 0.1 * Math.sin(t * 2));

  if (fx.core && fx.coreMat) {
    const cp = 0.8 + 0.35 * Math.sin(t * 3.5);
    fx.coreMat.emissiveColor.set(cp * 0.75, cp, cp * 0.8);
    fx.core.scaling.setAll(0.92 + 0.18 * Math.sin(t * 3));
  }

  if (fx.halos[0]) {
    const h = fx.halos[0];
    h.rotation.y += dt * 1.5;
    h.rotation.z = Math.sin(t * 1.2) * 0.25;
    const s = 1 + 0.07 * Math.sin(t * 2.2);
    h.scaling.set(s, s, s);
  }

  if (fx.crown) {
    fx.crown.rotation.y += dt * 0.85;
    for (let i = 0; i < fx.extras.length; i++) {
      const leaf = fx.extras[i]!;
      // 叶尖轻摆
      leaf.rotation.y = Math.sin(t * 2.5 + i) * 0.15;
      const s = 1 + 0.06 * Math.sin(t * 2 + i * 0.5);
      leaf.scaling.y = s;
    }
  }

  if (fx.aura && fx.auraMat) {
    const as = 1.03 + 0.14 * Math.sin(t * 1.6);
    fx.aura.scaling.setAll(as);
    const ap = 0.3 + 0.2 * Math.sin(t * 2);
    fx.auraMat.emissiveColor.set(0.15 * ap, 0.85 * ap, 0.35 * ap);
    fx.auraMat.alpha = 0.15 + 0.1 * Math.sin(t * 1.8);
  }

  // 孢子慢漂
  for (let i = 0; i < fx.sparks.length; i++) {
    const spark = fx.sparks[i]!;
    const a = t * 1.3 + (i / fx.sparks.length) * Math.PI * 2;
    const radius = 0.14 + 0.03 * Math.sin(t + i);
    const yOff = 0.08 * Math.sin(t * 1.5 + i * 0.9);
    spark.position.set(Math.cos(a) * radius, yOff, Math.sin(a) * radius);
    spark.scaling.setAll(0.65 + 0.4 * Math.sin(t * 2.5 + i));
  }
}

function updateVoid(fx: StaffFx, t: number, dt: number): void {
  // 紫雾脉动 + 内核吸光缩放
  const pulse = 0.55 + 0.5 * (0.5 + 0.5 * Math.sin(t * 3.6));
  fx.orbMat.emissiveColor.set(0.55 * pulse, 0.12 * pulse, pulse);
  fx.orbMat.diffuseColor.set(0.45, 0.12, 0.75);
  fx.orb.scaling.setAll(0.92 + 0.14 * Math.sin(t * 2.8));

  if (fx.core && fx.coreMat) {
    // 黑洞呼吸：缩小变暗
    const inhale = 0.5 + 0.5 * Math.sin(t * 2.2);
    const s = 0.75 + 0.35 * inhale;
    fx.core.scaling.setAll(s);
    fx.coreMat.emissiveColor.set(0.06 + 0.1 * inhale, 0.01, 0.12 + 0.15 * inhale);
  }

  const speeds = [2.8, -3.6];
  for (let i = 0; i < fx.halos.length; i++) {
    const h = fx.halos[i]!;
    h.rotation.y += dt * speeds[i % speeds.length]!;
    h.rotation.x += dt * (0.6 + i * 0.3) * (i % 2 === 0 ? 1 : -1);
    h.rotation.z = Math.sin(t * (1.2 + i * 0.4) + i) * 0.35;
    const s = 1 + 0.1 * Math.sin(t * 3 + i * 1.5);
    h.scaling.set(s, s, s);
  }

  if (fx.crown) {
    fx.crown.rotation.y += dt * 1.6;
    for (let i = 0; i < fx.extras.length; i++) {
      const shard = fx.extras[i]!;
      shard.rotation.x += dt * (1.2 + i * 0.3);
      shard.rotation.z += dt * 0.8;
      const bob = 0.02 * Math.sin(t * 3 + i);
      // 保持环位：用 local y 轻微浮动
      shard.position.y = 0.02 + bob;
    }
  }

  if (fx.aura && fx.auraMat) {
    const as = 1.05 + 0.2 * Math.sin(t * 2.4);
    fx.aura.scaling.setAll(as);
    const ap = 0.35 + 0.25 * Math.sin(t * 2.8);
    fx.auraMat.emissiveColor.set(0.45 * ap, 0.08 * ap, 0.8 * ap);
    fx.auraMat.alpha = 0.12 + 0.12 * Math.sin(t * 2.5);
  }

  orbitSparks(fx, t, 6, 4.2, 0.12, -2.6, 0.22, 0.03, 0.06);
}

function updateStorm(fx: StaffFx, t: number, dt: number): void {
  // 电球：黄白 / 青白快闪
  const pulse = 0.7 + 0.5 * (0.5 + 0.5 * Math.sin(t * 9));
  const zap = Math.sin(t * 28) > 0.7 ? 1.2 : 0.85;
  const cyan = 0.5 + 0.5 * Math.sin(t * 6.5);
  fx.orbMat.emissiveColor.set(pulse * zap, pulse * zap * (0.85 + 0.1 * cyan), 0.25 * pulse + 0.55 * cyan * zap);
  fx.orbMat.diffuseColor.set(0.95, 0.9, 0.35 + 0.4 * cyan);
  fx.orb.scaling.setAll((0.92 + 0.14 * Math.sin(t * 7)) * (zap > 1 ? 1.08 : 1));

  if (fx.core && fx.coreMat) {
    const cp = 0.75 + 0.55 * Math.sin(t * 14);
    fx.coreMat.emissiveColor.set(cp, cp, cp * 0.95);
    fx.core.scaling.setAll(0.8 + 0.35 * Math.sin(t * 12));
  }

  // 电弧环高速转
  for (let i = 0; i < fx.halos.length; i++) {
    const h = fx.halos[i]!;
    h.rotation.y += dt * 5.5;
    h.rotation.z = Math.sin(t * 4 + i) * 0.35;
    const s = 1 + 0.12 * Math.sin(t * 8 + i);
    h.scaling.set(s, s, s);
  }

  // 电弧锯齿：随机似的闪烁显隐 + 抖动
  if (fx.crown) {
    fx.crown.rotation.y += dt * 3.2;
    for (let i = 0; i < fx.extras.length; i++) {
      const bolt = fx.extras[i]!;
      // 伪随机闪：不同相位的高频门控
      const gate = Math.sin(t * (18 + i * 2.3) + i * 1.7);
      const on = gate > -0.15 ? 1 : 0.12;
      const stretch = 0.85 + 0.4 * Math.max(0, gate);
      bolt.scaling.set(on * (0.7 + 0.3 * (i % 2)), stretch * on + 0.15, on * (0.7 + 0.3 * (i % 3)));
      bolt.rotation.y += dt * (2 + i * 0.4) * (i % 2 === 0 ? 1 : -1);
    }
  }

  if (fx.aura && fx.auraMat) {
    const as = 1.02 + 0.22 * Math.sin(t * 5.5) * zap;
    fx.aura.scaling.setAll(as);
    const ap = 0.4 + 0.35 * Math.sin(t * 6);
    fx.auraMat.emissiveColor.set(ap, ap * 0.9, 0.25 * ap + 0.4 * cyan * ap);
    fx.auraMat.alpha = 0.12 + 0.14 * Math.sin(t * 5);
  }

  // 电火花：快轨 + 偶发径向弹出
  for (let i = 0; i < fx.sparks.length; i++) {
    const spark = fx.sparks[i]!;
    const inner = i < 6;
    const n = inner ? 6 : fx.sparks.length - 6;
    const idx = inner ? i : i - 6;
    const speed = inner ? 7.5 : -5.2;
    const baseR = inner ? 0.12 : 0.2;
    const pop = Math.sin(t * 15 + i * 2.1) > 0.85 ? 0.08 : 0;
    const a = t * speed + (idx / Math.max(n, 1)) * Math.PI * 2;
    const yOff = (inner ? 0.05 : 0.08) * Math.sin(t * 10 + i);
    spark.position.set(Math.cos(a) * (baseR + pop), yOff, Math.sin(a) * (baseR + pop));
    const ps = 0.5 + 0.7 * Math.sin(t * 16 + i) * (pop > 0 ? 1.4 : 1);
    spark.scaling.setAll(Math.max(0.25, ps));
  }
}

function updateHoly(fx: StaffFx, t: number, dt: number): void {
  // 圣光：暖白金柔脉
  const pulse = 0.75 + 0.35 * (0.5 + 0.5 * Math.sin(t * 2.6));
  fx.orbMat.emissiveColor.set(pulse, pulse * 0.95, pulse * 0.75);
  fx.orbMat.diffuseColor.set(1, 0.96, 0.8);
  fx.orb.scaling.setAll(0.96 + 0.1 * Math.sin(t * 2.2));

  if (fx.core && fx.coreMat) {
    const cp = 0.9 + 0.35 * Math.sin(t * 4);
    fx.coreMat.emissiveColor.set(cp, cp, cp * 0.95);
    fx.core.scaling.setAll(0.9 + 0.2 * Math.sin(t * 3.5));
  }

  // 光环缓慢旋转
  for (let i = 0; i < fx.halos.length; i++) {
    const h = fx.halos[i]!;
    h.rotation.y += dt * (i === 0 ? 1.2 : -0.85);
    h.rotation.z = Math.sin(t * 1.1 + i) * 0.12;
    const s = 1 + 0.06 * Math.sin(t * 2 + i);
    h.scaling.set(s, s, s);
  }

  // 十字冠：缓慢自转，光矛呼吸
  if (fx.crown) {
    fx.crown.rotation.y += dt * 0.9;
    for (let i = 0; i < fx.extras.length; i++) {
      const piece = fx.extras[i]!;
      if (i < 2) {
        // 十字本体轻微缩放
        const s = 1 + 0.04 * Math.sin(t * 2.4 + i);
        piece.scaling.setAll(s);
      } else {
        const s = 1 + 0.1 * Math.sin(t * 3 + i);
        piece.scaling.y = s;
        piece.scaling.x = 1 / Math.sqrt(s);
        piece.scaling.z = 1 / Math.sqrt(s);
      }
    }
  }

  if (fx.aura && fx.auraMat) {
    const as = 1.05 + 0.15 * Math.sin(t * 1.8);
    fx.aura.scaling.setAll(as);
    const ap = 0.4 + 0.25 * Math.sin(t * 2.2);
    fx.auraMat.emissiveColor.set(ap, ap * 0.92, ap * 0.55);
    fx.auraMat.alpha = 0.16 + 0.1 * Math.sin(t * 2);
  }

  // 金尘：缓升螺旋
  for (let i = 0; i < fx.sparks.length; i++) {
    const spark = fx.sparks[i]!;
    const speed = 1.6 + (i % 3) * 0.25;
    const phase = t * speed + (i / fx.sparks.length) * Math.PI * 2;
    const radius = 0.12 + (i % 3) * 0.035;
    const rise = ((t * 0.22 + i * 0.13) % 1) * 0.22 - 0.04;
    spark.position.set(Math.cos(phase) * radius, rise, Math.sin(phase) * radius);
    const fade = 1 - Math.max(0, rise) / 0.22;
    spark.scaling.setAll(Math.max(0.3, (0.6 + 0.45 * Math.sin(t * 3 + i)) * fade));
  }
}

function orbitSparks(
  fx: StaffFx,
  t: number,
  innerCount: number,
  innerSpeed: number,
  innerR: number,
  outerSpeed: number,
  outerR: number,
  innerY: number,
  outerY: number,
): void {
  for (let i = 0; i < fx.sparks.length; i++) {
    const spark = fx.sparks[i]!;
    const inner = i < innerCount;
    const n = inner ? innerCount : fx.sparks.length - innerCount;
    const idx = inner ? i : i - innerCount;
    const speed = inner ? innerSpeed : outerSpeed;
    const radius = inner ? innerR : outerR;
    const a = t * speed + (idx / Math.max(n, 1)) * Math.PI * 2;
    const yOff = (inner ? innerY : outerY) * Math.sin(t * 6 + i * 1.3);
    spark.position.set(Math.cos(a) * radius, yOff, Math.sin(a) * radius);
    const ps = 0.7 + 0.5 * Math.sin(t * 9 + i);
    spark.scaling.setAll(ps);
  }
}

