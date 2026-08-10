import {
  Color3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  type Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core';

const AXIS_X = 0xff3355;
const AXIS_Z = 0x3399ff;
const GRID_COLOR = 0x4b5563;
const TICK_COLOR = 0xd1d5db;
const ORIGIN_COLOR = 0xffffff;

/** 各轴从原点到正/负端的米数（范围 = ±extent） */
interface AxisExtents {
  x: number;
  z: number;
}

/**
 * 空间坐标网格：XZ 轴 + 每米刻度点 + 地面（XZ）参考网格。
 * 约定：1 世界单位 = 1 米。配置内聚在类内，不对外传参。
 *
 * 范围：X ∈ [-20, 20]，Z ∈ [-20, 20]（无 Y 轴）
 * 网格仅画地板面，不画 XY / YZ 竖直面。
 */
export class SpatialAxesGrid {
  /** X：-20 ~ 20 */
  private static readonly EXTENT_X = 20;
  /** Z：-20 ~ 20 */
  private static readonly EXTENT_Z = 20;
  /** 刻度间隔（米） */
  private static readonly STEP = 1;
  /** 米数标签间隔 */
  private static readonly MAJOR_EVERY = 5;

  readonly root: TransformNode;

  constructor(scene: Scene) {
    this.root = new TransformNode('SpatialAxesGrid', scene);

    const extents: AxisExtents = {
      x: SpatialAxesGrid.EXTENT_X,
      z: SpatialAxesGrid.EXTENT_Z,
    };
    const step = SpatialAxesGrid.STEP;
    const majorEvery = SpatialAxesGrid.MAJOR_EVERY;

    // 仅地板 XZ 网格；坐标轴 / 刻度 / 标签另建
    createFloorGrid(scene, this.root, extents, step);

    createAxisLines(scene, this.root, extents);
    createTickMarks(scene, this.root, extents, step);
    createTickPoints(scene, this.root, extents, step);
    createAxisLabels(scene, this.root, extents);
    createMeterLabels(scene, this.root, extents, step, majorEvery);

    const origin = MeshBuilder.CreateSphere(
      'Origin',
      { diameter: 0.12, segments: 16 },
      scene,
    );
    origin.material = unlitMat(scene, 'originMat', ORIGIN_COLOR);
    origin.parent = this.root;
  }
}

/** 仅地面 XZ 网格（不画 XY / YZ 竖直面） */
function createFloorGrid(
  scene: Scene,
  parent: TransformNode,
  extents: AxisExtents,
  step: number,
): void {
  const halfX = extents.x;
  const halfZ = extents.z;
  const lines: Vector3[][] = [];

  for (let x = -halfX; x <= halfX + 1e-9; x += step) {
    lines.push([new Vector3(x, 0, -halfZ), new Vector3(x, 0, halfZ)]);
  }
  for (let z = -halfZ; z <= halfZ + 1e-9; z += step) {
    lines.push([new Vector3(-halfX, 0, z), new Vector3(halfX, 0, z)]);
  }

  const mesh = MeshBuilder.CreateLineSystem('GridXZ', { lines }, scene);
  mesh.color = colorFromHex(GRID_COLOR);
  mesh.alpha = 0.35;
  // 略抬高避免与地板 z-fighting
  mesh.position = new Vector3(0, 0.001, 0);
  mesh.parent = parent;
}

function createAxisLines(
  scene: Scene,
  parent: TransformNode,
  extents: AxisExtents,
): void {
  const axes: Array<{
    name: string;
    color: number;
    from: Vector3;
    to: Vector3;
  }> = [
    {
      name: 'AxisX',
      color: AXIS_X,
      from: new Vector3(-extents.x, 0, 0),
      to: new Vector3(extents.x, 0, 0),
    },
    {
      name: 'AxisZ',
      color: AXIS_Z,
      from: new Vector3(0, 0, -extents.z),
      to: new Vector3(0, 0, extents.z),
    },
  ];

  for (const axis of axes) {
    const line = MeshBuilder.CreateLines(
      axis.name,
      { points: [axis.from, axis.to] },
      scene,
    );
    line.color = colorFromHex(axis.color);
    line.alpha = 0.95;
    line.parent = parent;

    // 正方向箭头（圆锥，尖端朝正方向）
    const dir = axis.to.subtract(axis.from).normalize();
    const cone = MeshBuilder.CreateCylinder(
      `${axis.name}Arrow`,
      {
        diameterTop: 0,
        diameterBottom: 0.12,
        height: 0.22,
        tessellation: 12,
      },
      scene,
    );
    cone.material = unlitMat(scene, `${axis.name}ArrowMat`, axis.color);
    // 默认圆柱沿 +Y，转到 dir
    const up = Vector3.Up();
    if (1 - Math.abs(Vector3.Dot(up, dir)) > 1e-4) {
      const axisRot = Vector3.Cross(up, dir).normalize();
      const angle = Math.acos(Math.min(1, Math.max(-1, Vector3.Dot(up, dir))));
      cone.rotate(axisRot, angle);
    } else if (Vector3.Dot(up, dir) < 0) {
      cone.rotate(Vector3.Right(), Math.PI);
    }
    cone.position = axis.to.add(dir.scale(-0.11));
    cone.parent = parent;
  }
}

function createTickMarks(
  scene: Scene,
  parent: TransformNode,
  extents: AxisExtents,
  step: number,
): void {
  const half = 0.1;
  const lines: Vector3[][] = [];

  for (let t = -extents.x; t <= extents.x + 1e-9; t += step) {
    if (Math.abs(t) < 1e-9) continue;
    lines.push([new Vector3(t, -half, 0), new Vector3(t, half, 0)]);
    lines.push([new Vector3(t, 0, -half), new Vector3(t, 0, half)]);
  }
  for (let t = -extents.z; t <= extents.z + 1e-9; t += step) {
    if (Math.abs(t) < 1e-9) continue;
    lines.push([new Vector3(-half, 0, t), new Vector3(half, 0, t)]);
    lines.push([new Vector3(0, -half, t), new Vector3(0, half, t)]);
  }

  const mesh = MeshBuilder.CreateLineSystem('TickMarks', { lines }, scene);
  mesh.color = colorFromHex(TICK_COLOR);
  mesh.alpha = 0.75;
  mesh.parent = parent;
}

function createTickPoints(
  scene: Scene,
  parent: TransformNode,
  extents: AxisExtents,
  step: number,
): void {
  const diameter = 0.0175;
  const matX = unlitMat(scene, 'tickMatX', AXIS_X);
  const matZ = unlitMat(scene, 'tickMatZ', AXIS_Z);

  for (let t = -extents.x; t <= extents.x + 1e-9; t += step) {
    if (Math.abs(t) < 1e-9) continue;
    const p = MeshBuilder.CreateSphere(
      `tickX_${t}`,
      { diameter, segments: 8 },
      scene,
    );
    p.position = new Vector3(t, 0, 0);
    p.material = matX;
    p.parent = parent;
  }
  for (let t = -extents.z; t <= extents.z + 1e-9; t += step) {
    if (Math.abs(t) < 1e-9) continue;
    const p = MeshBuilder.CreateSphere(
      `tickZ_${t}`,
      { diameter, segments: 8 },
      scene,
    );
    p.position = new Vector3(0, 0, t);
    p.material = matZ;
    p.parent = parent;
  }
}

function createAxisLabels(
  scene: Scene,
  parent: TransformNode,
  extents: AxisExtents,
): void {
  makeTextSprite(
    scene,
    parent,
    'X',
    AXIS_X,
    new Vector3(extents.x + 0.45, 0.15, 0),
    0.55,
  );
  makeTextSprite(
    scene,
    parent,
    'Z',
    AXIS_Z,
    new Vector3(0, 0.15, extents.z + 0.45),
    0.55,
  );
}

function createMeterLabels(
  scene: Scene,
  parent: TransformNode,
  extents: AxisExtents,
  step: number,
  majorEvery: number,
): void {
  const shouldLabel = (t: number, extent: number): boolean => {
    if (Math.abs(t) < 1e-9) return false;
    if (Math.abs(Math.abs(t) - extent) < 1e-9) return true;
    return Math.abs(t % majorEvery) < 1e-6;
  };

  for (let t = -extents.x; t <= extents.x + 1e-9; t += step) {
    if (!shouldLabel(t, extents.x)) continue;
    makeTextSprite(
      scene,
      parent,
      `${t}m`,
      AXIS_X,
      new Vector3(t, 0.22, 0.22),
      0.35,
    );
  }
  for (let t = -extents.z; t <= extents.z + 1e-9; t += step) {
    if (!shouldLabel(t, extents.z)) continue;
    makeTextSprite(
      scene,
      parent,
      `${t}m`,
      AXIS_Z,
      new Vector3(0.22, 0.22, t),
      0.35,
    );
  }
}

function makeTextSprite(
  scene: Scene,
  parent: TransformNode,
  text: string,
  color: number,
  position: Vector3,
  scale: number,
): void {
  const plane = MeshBuilder.CreatePlane(
    `label_${text}`,
    { width: scale * 2, height: scale },
    scene,
  );
  plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
  plane.position = position;
  plane.parent = parent;

  const tex = new DynamicTexture(
    `labelTex_${text}`,
    { width: 128, height: 64 },
    scene,
    false,
  );
  tex.hasAlpha = true;
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 128, 64);
  ctx.font = 'bold 36px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(0,0,0,0.65)';
  ctx.strokeText(text, 64, 32);
  ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  ctx.fillText(text, 64, 32);
  tex.update();

  const mat = new StandardMaterial(`labelMat_${text}`, scene);
  mat.diffuseTexture = tex;
  mat.emissiveTexture = tex;
  mat.opacityTexture = tex;
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  mat.useAlphaFromDiffuseTexture = true;
  plane.material = mat;
}

function unlitMat(scene: Scene, name: string, hex: number): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  const c = colorFromHex(hex);
  m.diffuseColor = c;
  m.emissiveColor = c;
  m.specularColor = Color3.Black();
  m.disableLighting = true;
  return m;
}

function colorFromHex(hex: number): Color3 {
  return new Color3(
    ((hex >> 16) & 0xff) / 255,
    ((hex >> 8) & 0xff) / 255,
    (hex & 0xff) / 255,
  );
}
