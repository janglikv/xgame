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

export interface StaffFx {
  root: TransformNode;
  orb: Mesh;
  orbMat: StandardMaterial;
  core: Mesh;
  coreMat: StandardMaterial;
  halos: Mesh[];
  aura: Mesh;
  auraMat: StandardMaterial;
  crown: TransformNode;
  sparks: Mesh[];
  t: number;
}

/**
 * 浮夸魔法杖：巨型炫彩水晶 + 三层原子光环 + 双层星轨 + 外光晕 + 尖刺冠。
 */
export function attachMagicStaff(
  scene: Scene,
  rightHand: Mesh,
  shadowGen?: ShadowGenerator,
): StaffFx {
  const root = new TransformNode('magicStaff', scene);
  root.parent = rightHand;
  root.position = new Vector3(0, -0.06, 0);
  root.rotation.x = -0.32;
  root.rotation.z = 0.1;
  // 整体放大一截，更压迫感
  root.scaling = new Vector3(1.15, 1.15, 1.15);

  const woodMat = mat(scene, 'staffWood', 0x1a1210);
  const metalMat = emissiveMat(scene, 'staffMetal', 0xa8b8d0, 0.4);
  const goldMat = emissiveMat(scene, 'staffGold', 0xffd24a, 0.55);
  const orbMat = emissiveMat(scene, 'staffOrb', 0xb44dff, 1.0);
  const coreMat = emissiveMat(scene, 'staffOrbCore', 0xffffff, 1.4);
  const sparkMat = emissiveMat(scene, 'staffSpark', 0xff66ee, 1.2);
  const sparkMat2 = emissiveMat(scene, 'staffSpark2', 0x66f0ff, 1.2);
  const auraMat = emissiveMat(scene, 'staffAura', 0x8844ff, 0.6);
  auraMat.alpha = 0.22;
  auraMat.transparencyMode = StandardMaterial.MATERIAL_ALPHABLEND;
  auraMat.backFaceCulling = false;
  auraMat.disableDepthWrite = true;

  // —— 超长杖身 ——
  const shaft = MeshBuilder.CreateCylinder(
    'staffShaft',
    {
      height: 1.25,
      diameterTop: 0.03,
      diameterBottom: 0.06,
      tessellation: 14,
    },
    scene,
  );
  shaft.position.y = 0.32;
  shaft.material = woodMat;
  shaft.parent = root;
  cast(shaft, shadowGen);

  // 满身螺旋金箍
  for (let i = 0; i < 7; i++) {
    const wrap = MeshBuilder.CreateTorus(
      `staffWrap_${i}`,
      { diameter: 0.055 + i * 0.004, thickness: 0.014, tessellation: 16 },
      scene,
    );
    wrap.position.y = -0.12 + i * 0.12;
    wrap.rotation.x = 0.35;
    wrap.material = i % 2 === 0 ? goldMat : metalMat;
    wrap.parent = root;
    cast(wrap, shadowGen);
  }

  // 底端巨型宝珠
  const pommel = MeshBuilder.CreateSphere(
    'staffPommel',
    { diameter: 0.12, segments: 14 },
    scene,
  );
  pommel.position.y = -0.32;
  pommel.material = goldMat;
  pommel.parent = root;
  cast(pommel, shadowGen);

  const pommelGem = MeshBuilder.CreatePolyhedron(
    'staffPommelGem',
    { type: 2, size: 0.035 },
    scene,
  );
  pommelGem.position.y = -0.32;
  pommelGem.material = emissiveMat(scene, 'staffPommelGem', 0xff44aa, 0.9);
  pommelGem.parent = root;

  // 中段大水晶簇
  for (const [i, y, size, hex] of [
    [0, 0.28, 0.04, 0x66f0ff],
    [1, 0.42, 0.05, 0xff66ee],
    [2, 0.56, 0.038, 0xffd24a],
  ] as const) {
    const gem = MeshBuilder.CreatePolyhedron(
      `staffMidGem_${i}`,
      { type: 1, size },
      scene,
    );
    gem.position.y = y;
    gem.rotation.y = i * 0.7;
    gem.material = emissiveMat(scene, `staffMidGemMat_${i}`, hex, 0.85);
    gem.parent = root;
    cast(gem, shadowGen);
  }

  // 顶端宽箍
  const collar = MeshBuilder.CreateCylinder(
    'staffCollar',
    { height: 0.06, diameter: 0.12, tessellation: 16 },
    scene,
  );
  collar.position.y = 0.88;
  collar.material = goldMat;
  collar.parent = root;
  cast(collar, shadowGen);

  // 六爪夸张托座
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const claw = MeshBuilder.CreateCylinder(
      `staffClaw_${i}`,
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

  // —— 巨型主水晶 ——
  const headY = 1.15;
  const orb = MeshBuilder.CreateSphere(
    'staffOrb',
    { diameter: 0.28, segments: 24 },
    scene,
  );
  orb.position.y = headY;
  orb.material = orbMat;
  orb.parent = root;
  cast(orb, shadowGen);

  // 交叉钻石
  const crystal = MeshBuilder.CreatePolyhedron(
    'staffCrystal',
    { type: 2, size: 0.09 },
    scene,
  );
  crystal.position.y = headY;
  crystal.rotation.z = Math.PI / 5;
  crystal.material = emissiveMat(scene, 'staffCrystal', 0x66f0ff, 1.0);
  crystal.parent = root;
  cast(crystal, shadowGen);

  const core = MeshBuilder.CreateSphere(
    'staffOrbCore',
    { diameter: 0.1, segments: 14 },
    scene,
  );
  core.position.y = headY;
  core.material = coreMat;
  core.parent = root;

  // 三层原子光环（青 / 粉 / 金）
  const haloSpecs: Array<{ d: number; th: number; hex: number; rx: number }> = [
    { d: 0.38, th: 0.022, hex: 0x66f0ff, rx: Math.PI / 2.2 },
    { d: 0.48, th: 0.02, hex: 0xff44cc, rx: Math.PI / 3.1 },
    { d: 0.58, th: 0.018, hex: 0xffd24a, rx: Math.PI / 4.5 },
  ];
  const halos: Mesh[] = [];
  for (const [i, spec] of haloSpecs.entries()) {
    const halo = MeshBuilder.CreateTorus(
      `staffHalo_${i}`,
      { diameter: spec.d, thickness: spec.th, tessellation: 36 },
      scene,
    );
    halo.position.y = headY;
    halo.rotation.x = spec.rx;
    halo.rotation.y = i * 1.1;
    halo.material = emissiveMat(scene, `staffHaloMat_${i}`, spec.hex, 1.0);
    halo.parent = root;
    cast(halo, shadowGen);
    halos.push(halo);
  }

  // 外层大光晕球
  const aura = MeshBuilder.CreateSphere(
    'staffAura',
    { diameter: 0.55, segments: 20 },
    scene,
  );
  aura.position.y = headY;
  aura.material = auraMat;
  aura.parent = root;

  // 尖刺冠（上方一圈刺）
  const crown = new TransformNode('staffCrown', scene);
  crown.parent = root;
  crown.position.y = headY;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const spike = MeshBuilder.CreateCylinder(
      `staffSpike_${i}`,
      {
        height: 0.18,
        diameterTop: 0,
        diameterBottom: 0.035,
        tessellation: 6,
      },
      scene,
    );
    spike.position.set(Math.cos(a) * 0.12, 0.14, Math.sin(a) * 0.12);
    // 尖刺朝外上
    spike.rotation.z = Math.cos(a) * 0.9;
    spike.rotation.x = -Math.sin(a) * 0.9;
    spike.material = goldMat;
    spike.parent = crown;
    cast(spike, shadowGen);
  }

  // 双层星轨：6 内粉 + 6 外青
  const sparks: Mesh[] = [];
  for (let i = 0; i < 12; i++) {
    const s = MeshBuilder.CreateSphere(
      `staffSpark_${i}`,
      { diameter: i < 6 ? 0.04 : 0.032, segments: 8 },
      scene,
    );
    s.material = i < 6 ? sparkMat : sparkMat2;
    s.parent = orb;
    sparks.push(s);
  }

  return {
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
    t: 0,
  };
}

/** 杖顶动效：脉动、光环、星轨、光晕、尖冠 */
export function updateStaffFx(fx: StaffFx, dt: number): void {
  fx.t += dt;
  const t = fx.t;

  const pulse = 0.65 + 0.55 * (0.5 + 0.5 * Math.sin(t * 5.5));
  const hue = 0.5 + 0.5 * Math.sin(t * 2.2);
  const r = (0.45 + 0.55 * hue) * pulse;
  const g = (0.35 + 0.4 * (1 - hue)) * pulse;
  const b = 1.0 * pulse;
  fx.orbMat.emissiveColor.set(r, g, b * 0.95 + 0.3);
  fx.orbMat.diffuseColor.set(r * 0.85, g * 0.9, b);

  const corePulse = 0.75 + 0.5 * Math.sin(t * 8);
  fx.coreMat.emissiveColor.set(corePulse, corePulse, corePulse);
  fx.core.scaling.setAll(0.9 + 0.25 * Math.sin(t * 7));

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

  const auraS = 1.05 + 0.18 * Math.sin(t * 2.6);
  fx.aura.scaling.setAll(auraS);
  fx.aura.rotation.y += dt * 0.8;
  const ap = 0.35 + 0.25 * Math.sin(t * 3);
  fx.auraMat.emissiveColor.set(0.5 * ap, 0.2 * ap, 0.95 * ap);
  fx.auraMat.alpha = 0.18 + 0.12 * Math.sin(t * 3);

  fx.crown.rotation.y += dt * 2.2;

  for (let i = 0; i < fx.sparks.length; i++) {
    const spark = fx.sparks[i]!;
    const inner = i < 6;
    const n = inner ? 6 : fx.sparks.length - 6;
    const idx = inner ? i : i - 6;
    const speed = inner ? 5.5 : -3.2;
    const radius = inner ? 0.16 : 0.26;
    const a = t * speed + (idx / Math.max(n, 1)) * Math.PI * 2;
    const yOff = (inner ? 0.04 : 0.07) * Math.sin(t * 6 + i * 1.3);
    spark.position.set(Math.cos(a) * radius, yOff, Math.sin(a) * radius);
    const ps = 0.7 + 0.5 * Math.sin(t * 9 + i);
    spark.scaling.setAll(ps);
  }
}
