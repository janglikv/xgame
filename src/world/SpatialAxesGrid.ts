import * as THREE from 'three';

const AXIS_X = 0xff3355;
const AXIS_Y = 0x33dd66;
const AXIS_Z = 0x3399ff;
const GRID_COLOR = 0x4b5563;
const TICK_COLOR = 0xd1d5db;
const ORIGIN_COLOR = 0xffffff;

/** 各轴从原点到正/负端的米数（范围 = ±extent） */
interface AxisExtents {
  x: number;
  y: number;
  z: number;
}

/**
 * 空间坐标网格：XYZ 轴 + 每米刻度点 + 三向参考网格。
 * 约定：1 世界单位 = 1 米。配置内聚在类内，不对外传参。
 *
 * 范围：X ∈ [-20, 20]，Y ∈ [-3, 3]，Z ∈ [-5, 5]
 */
export class SpatialAxesGrid extends THREE.Group {
  /** X：-20 ~ 20 */
  private static readonly EXTENT_X = 20;
  /** Y：-3 ~ 3 */
  private static readonly EXTENT_Y = 3;
  /** Z：-5 ~ 5 */
  private static readonly EXTENT_Z = 5;
  /** 刻度间隔（米） */
  private static readonly STEP = 1;
  /** 是否绘制三向网格面（XY / XZ / YZ） */
  private static readonly SHOW_PLANES = true;
  /** 米数标签间隔 */
  private static readonly MAJOR_EVERY = 5;

  constructor() {
    super();
    this.name = 'SpatialAxesGrid';

    const extents: AxisExtents = {
      x: SpatialAxesGrid.EXTENT_X,
      y: SpatialAxesGrid.EXTENT_Y,
      z: SpatialAxesGrid.EXTENT_Z,
    };
    const step = SpatialAxesGrid.STEP;
    const majorEvery = SpatialAxesGrid.MAJOR_EVERY;

    if (SpatialAxesGrid.SHOW_PLANES) {
      this.add(createPlaneGrids(extents, step));
    }

    this.add(createAxisLines(extents));
    this.add(createTickMarks(extents, step));
    this.add(createTickPoints(extents, step));
    this.add(createAxisLabels(extents));
    this.add(createMeterLabels(extents, step, majorEvery));

    // 原点高亮
    const origin = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 16, 16),
      new THREE.MeshBasicMaterial({ color: ORIGIN_COLOR }),
    );
    origin.name = 'Origin';
    this.add(origin);
  }
}

/**
 * 三向半透明网格面。
 * GridHelper 默认是正方形，按平面两轴跨度缩放/裁切到矩形范围。
 */
function createPlaneGrids(extents: AxisExtents, step: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'PlaneGrids';

  // XZ 水平面（地面）：X×Z
  group.add(
    createRectGrid({
      sizeA: extents.x * 2,
      sizeB: extents.z * 2,
      step,
      opacity: 0.35,
      // 默认在 XZ，Y 微抬避免 z-fighting
      position: new THREE.Vector3(0, 0.001, 0),
      rotation: new THREE.Euler(0, 0, 0),
      /** GridHelper 在 XZ：本地 X→世界 X，本地 Z→世界 Z；先建在 XY 再转到 XZ 不方便，直接用 */
      plane: 'xz',
    }),
  );

  // XY 竖直面：X×Y
  group.add(
    createRectGrid({
      sizeA: extents.x * 2,
      sizeB: extents.y * 2,
      step,
      opacity: 0.18,
      position: new THREE.Vector3(0, 0, 0),
      rotation: new THREE.Euler(0, 0, 0),
      plane: 'xy',
    }),
  );

  // YZ 竖直面：Y×Z
  group.add(
    createRectGrid({
      sizeA: extents.y * 2,
      sizeB: extents.z * 2,
      step,
      opacity: 0.18,
      position: new THREE.Vector3(0, 0, 0),
      rotation: new THREE.Euler(0, 0, 0),
      plane: 'yz',
    }),
  );

  return group;
}

function createRectGrid(options: {
  sizeA: number;
  sizeB: number;
  step: number;
  opacity: number;
  position: THREE.Vector3;
  rotation: THREE.Euler;
  plane: 'xz' | 'xy' | 'yz';
}): THREE.Group {
  const { sizeA, sizeB, step, opacity, position, plane } = options;
  const group = new THREE.Group();

  // 用线段手动画矩形网格，避免 GridHelper 强制正方形
  const positions: number[] = [];
  const halfA = sizeA / 2;
  const halfB = sizeB / 2;

  const push = (x: number, y: number, z: number): void => {
    positions.push(x, y, z);
  };

  if (plane === 'xz') {
    // 平行于 Z 的线（沿 X 步进）
    for (let x = -halfA; x <= halfA + 1e-9; x += step) {
      push(x, 0, -halfB);
      push(x, 0, halfB);
    }
    // 平行于 X 的线（沿 Z 步进）
    for (let z = -halfB; z <= halfB + 1e-9; z += step) {
      push(-halfA, 0, z);
      push(halfA, 0, z);
    }
  } else if (plane === 'xy') {
    for (let x = -halfA; x <= halfA + 1e-9; x += step) {
      push(x, -halfB, 0);
      push(x, halfB, 0);
    }
    for (let y = -halfB; y <= halfB + 1e-9; y += step) {
      push(-halfA, y, 0);
      push(halfA, y, 0);
    }
  } else {
    // yz：sizeA → Y，sizeB → Z
    for (let y = -halfA; y <= halfA + 1e-9; y += step) {
      push(0, y, -halfB);
      push(0, y, halfB);
    }
    for (let z = -halfB; z <= halfB + 1e-9; z += step) {
      push(0, -halfA, z);
      push(0, halfA, z);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({
    color: GRID_COLOR,
    transparent: true,
    opacity,
    depthWrite: false,
  });
  const lines = new THREE.LineSegments(geom, mat);
  lines.position.copy(position);
  group.add(lines);
  return group;
}

/** RGB 坐标轴线段（正负双向，各轴独立长度） */
function createAxisLines(extents: AxisExtents): THREE.Group {
  const group = new THREE.Group();
  group.name = 'AxisLines';

  const axes: Array<{
    color: number;
    from: THREE.Vector3;
    to: THREE.Vector3;
  }> = [
    {
      color: AXIS_X,
      from: new THREE.Vector3(-extents.x, 0, 0),
      to: new THREE.Vector3(extents.x, 0, 0),
    },
    {
      color: AXIS_Y,
      from: new THREE.Vector3(0, -extents.y, 0),
      to: new THREE.Vector3(0, extents.y, 0),
    },
    {
      color: AXIS_Z,
      from: new THREE.Vector3(0, 0, -extents.z),
      to: new THREE.Vector3(0, 0, extents.z),
    },
  ];

  for (const axis of axes) {
    const geom = new THREE.BufferGeometry().setFromPoints([axis.from, axis.to]);
    const mat = new THREE.LineBasicMaterial({
      color: axis.color,
      linewidth: 2,
      transparent: true,
      opacity: 0.95,
    });
    group.add(new THREE.Line(geom, mat));

    // 正方向箭头（圆锥）
    const dir = axis.to.clone().sub(axis.from).normalize();
    const arrow = new THREE.ArrowHelper(
      dir,
      axis.to.clone().addScaledVector(dir, -0.35),
      0.45,
      axis.color,
      0.22,
      0.12,
    );
    group.add(arrow);
  }

  return group;
}

/**
 * 每米刻度短线：垂直于对应轴的小十字。
 */
function createTickMarks(extents: AxisExtents, step: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'TickMarks';

  const half = 0.1;
  const positions: number[] = [];

  const pushSeg = (
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
  ): void => {
    positions.push(ax, ay, az, bx, by, bz);
  };

  for (let t = -extents.x; t <= extents.x + 1e-9; t += step) {
    if (Math.abs(t) < 1e-9) continue;
    pushSeg(t, -half, 0, t, half, 0);
    pushSeg(t, 0, -half, t, 0, half);
  }

  for (let t = -extents.y; t <= extents.y + 1e-9; t += step) {
    if (Math.abs(t) < 1e-9) continue;
    pushSeg(-half, t, 0, half, t, 0);
    pushSeg(0, t, -half, 0, t, half);
  }

  for (let t = -extents.z; t <= extents.z + 1e-9; t += step) {
    if (Math.abs(t) < 1e-9) continue;
    pushSeg(-half, 0, t, half, 0, t);
    pushSeg(0, -half, t, 0, half, t);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({
    color: TICK_COLOR,
    transparent: true,
    opacity: 0.75,
  });
  group.add(new THREE.LineSegments(geom, mat));
  return group;
}

/**
 * 每米刻度点：三轴上的小球。
 */
function createTickPoints(extents: AxisExtents, step: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'TickPoints';

  const sphereGeom = new THREE.SphereGeometry(0.00875, 10, 10);
  const materials = {
    x: new THREE.MeshBasicMaterial({ color: AXIS_X }),
    y: new THREE.MeshBasicMaterial({ color: AXIS_Y }),
    z: new THREE.MeshBasicMaterial({ color: AXIS_Z }),
  };

  for (let t = -extents.x; t <= extents.x + 1e-9; t += step) {
    if (Math.abs(t) < 1e-9) continue;
    const px = new THREE.Mesh(sphereGeom, materials.x);
    px.position.set(t, 0, 0);
    group.add(px);
  }

  for (let t = -extents.y; t <= extents.y + 1e-9; t += step) {
    if (Math.abs(t) < 1e-9) continue;
    const py = new THREE.Mesh(sphereGeom, materials.y);
    py.position.set(0, t, 0);
    group.add(py);
  }

  for (let t = -extents.z; t <= extents.z + 1e-9; t += step) {
    if (Math.abs(t) < 1e-9) continue;
    const pz = new THREE.Mesh(sphereGeom, materials.z);
    pz.position.set(0, 0, t);
    group.add(pz);
  }

  return group;
}

/** 轴端点 XYZ 标签 */
function createAxisLabels(extents: AxisExtents): THREE.Group {
  const group = new THREE.Group();
  group.name = 'AxisLabels';

  group.add(
    makeTextSprite(
      'X',
      AXIS_X,
      new THREE.Vector3(extents.x + 0.45, 0.15, 0),
      0.55,
    ),
  );
  group.add(
    makeTextSprite(
      'Y',
      AXIS_Y,
      new THREE.Vector3(0.15, extents.y + 0.45, 0),
      0.55,
    ),
  );
  group.add(
    makeTextSprite(
      'Z',
      AXIS_Z,
      new THREE.Vector3(0, 0.15, extents.z + 0.45),
      0.55,
    ),
  );

  return group;
}

/** 主要米数标签（默认每 5m；短轴在端点也标） */
function createMeterLabels(
  extents: AxisExtents,
  step: number,
  majorEvery: number,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'MeterLabels';

  const shouldLabel = (t: number, extent: number): boolean => {
    if (Math.abs(t) < 1e-9) return false;
    // 主刻度，或轴端点（短轴端点不一定落在 majorEvery 上）
    if (Math.abs(Math.abs(t) - extent) < 1e-9) return true;
    return Math.abs(t % majorEvery) < 1e-6;
  };

  for (let t = -extents.x; t <= extents.x + 1e-9; t += step) {
    if (!shouldLabel(t, extents.x)) continue;
    group.add(
      makeTextSprite(`${t}m`, AXIS_X, new THREE.Vector3(t, 0.22, 0.22), 0.35),
    );
  }

  for (let t = -extents.y; t <= extents.y + 1e-9; t += step) {
    if (!shouldLabel(t, extents.y)) continue;
    group.add(
      makeTextSprite(`${t}m`, AXIS_Y, new THREE.Vector3(0.22, t, 0.22), 0.35),
    );
  }

  for (let t = -extents.z; t <= extents.z + 1e-9; t += step) {
    if (!shouldLabel(t, extents.z)) continue;
    group.add(
      makeTextSprite(`${t}m`, AXIS_Z, new THREE.Vector3(0.22, 0.22, t), 0.35),
    );
  }

  return group;
}

function makeTextSprite(
  text: string,
  color: number,
  position: THREE.Vector3,
  scale: number,
): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('2D canvas context unavailable');
  }

  const hex = `#${color.toString(16).padStart(6, '0')}`;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = 'bold 36px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(0,0,0,0.65)';
  ctx.strokeText(text, canvas.width / 2, canvas.height / 2);
  ctx.fillStyle = hex;
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: true,
    sizeAttenuation: true,
  });

  const sprite = new THREE.Sprite(material);
  sprite.position.copy(position);
  sprite.scale.set(scale * 2, scale, 1);
  return sprite;
}
