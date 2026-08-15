import {
  Color3,
  Mesh,
  MeshBuilder,
  type Scene,
  ShadowGenerator,
  StandardMaterial,
} from '@babylonjs/core';

export function ball(
  scene: Scene,
  name: string,
  diameter: number,
  material: StandardMaterial,
  segments = 16,
  flat = false,
): Mesh {
  const m = MeshBuilder.CreateSphere(name, { diameter, segments }, scene);
  m.material = material;
  if (flat) applyFlatShading(m);
  return m;
}

/** 平面着色：拆分平滑法线，露出棱角（对应 Three flat: true） */
export function applyFlatShading(mesh: Mesh): void {
  mesh.convertToFlatShadedMesh();
}

export function cast(mesh: Mesh, shadowGen?: ShadowGenerator): void {
  if (shadowGen) {
    mesh.receiveShadows = true;
    shadowGen.addShadowCaster(mesh);
  } else {
    mesh.receiveShadows = false;
  }
}

export function mat(scene: Scene, name: string, hex: number): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  const c = colorFromHex(hex);
  m.diffuseColor = c;
  m.ambientColor = new Color3(
    Math.max(0.25, c.r * 0.6),
    Math.max(0.25, c.g * 0.6),
    Math.max(0.28, c.b * 0.6),
  );
  m.specularColor = Color3.Black();
  return m;
}

export function emissiveMat(
  scene: Scene,
  name: string,
  hex: number,
  intensity: number,
): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  const c = colorFromHex(hex);
  m.diffuseColor = c;
  m.emissiveColor = new Color3(
    Math.min(1, c.r * intensity),
    Math.min(1, c.g * intensity),
    Math.min(1, c.b * intensity),
  );
  m.specularColor = Color3.Black();
  m.disableLighting = intensity >= 0.75;
  return m;
}

export function colorFromHex(hex: number): Color3 {
  return new Color3(
    ((hex >> 16) & 0xff) / 255,
    ((hex >> 8) & 0xff) / 255,
    (hex & 0xff) / 255,
  );
}
