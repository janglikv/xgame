import * as THREE from 'three';

const AXIS_X = 0xff3355;
const AXIS_Y = 0x33dd66;
const AXIS_Z = 0x3399ff;
const GRID_COLOR = 0x4b5563;
const TICK_COLOR = 0xd1d5db;
const ORIGIN_COLOR = 0xffffff;

/**
 * 空间坐标网格：XYZ 轴 + 每米刻度点 + 三向参考网格。
 * 约定：1 世界单位 = 1 米。配置内聚在类内，不对外传参。
 */
export class SpatialAxesGrid extends THREE.Group {
  /** 从原点沿各轴正负方向延伸的米数（总跨度 20m） */
  private static readonly EXTENT = 10;
  /** 刻度间隔（米） */
  private static readonly STEP = 1;
  /** 是否绘制三向网格面（XY / XZ / YZ） */
  private static readonly SHOW_PLANES = true;
  /** 米数标签间隔 */
  private static readonly MAJOR_EVERY = 5;

  constructor() {
    super();
    this.name = 'SpatialAxesGrid';

    const extent = SpatialAxesGrid.EXTENT;
    const step = SpatialAxesGrid.STEP;
    const majorEvery = SpatialAxesGrid.MAJOR_EVERY;

    if (SpatialAxesGrid.SHOW_PLANES) {
      this.add(createPlaneGrids(extent, step));
    }

    this.add(createAxisLines(extent));
    this.add(createTickMarks(extent, step));
    this.add(createTickPoints(extent, step));
    this.add(createAxisLabels(extent));
    this.add(createMeterLabels(extent, step, majorEvery));

    // 原点高亮
    const origin = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 16, 16),
      new THREE.MeshBasicMaterial({ color: ORIGIN_COLOR }),
    );
    origin.name = 'Origin';
    this.add(origin);
  }
}

/** 三向半透明网格面 */
function createPlaneGrids(extent: number, step: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'PlaneGrids';

  const divisions = (extent * 2) / step;
  const size = extent * 2;

  // XZ 水平面（地面）
  const xz = new THREE.GridHelper(size, divisions, GRID_COLOR, GRID_COLOR);
  fadeGrid(xz, 0.35);
  xz.position.y = 0.001;
  group.add(xz);

  // XY 竖直面（法线沿 Z）
  const xy = new THREE.GridHelper(size, divisions, GRID_COLOR, GRID_COLOR);
  xy.rotation.x = Math.PI / 2;
  fadeGrid(xy, 0.18);
  group.add(xy);

  // YZ 竖直面（法线沿 X）
  const yz = new THREE.GridHelper(size, divisions, GRID_COLOR, GRID_COLOR);
  yz.rotation.z = Math.PI / 2;
  fadeGrid(yz, 0.18);
  group.add(yz);

  return group;
}

function fadeGrid(grid: THREE.GridHelper, opacity: number): void {
  const materials = Array.isArray(grid.material)
    ? grid.material
    : [grid.material];

  for (const material of materials) {
    material.transparent = true;
    material.opacity = opacity;
    material.depthWrite = false;
  }
}

/** RGB 坐标轴线段（正负双向） */
function createAxisLines(extent: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'AxisLines';

  const axes: Array<{
    color: number;
    from: THREE.Vector3;
    to: THREE.Vector3;
  }> = [
    {
      color: AXIS_X,
      from: new THREE.Vector3(-extent, 0, 0),
      to: new THREE.Vector3(extent, 0, 0),
    },
    {
      color: AXIS_Y,
      from: new THREE.Vector3(0, -extent, 0),
      to: new THREE.Vector3(0, extent, 0),
    },
    {
      color: AXIS_Z,
      from: new THREE.Vector3(0, 0, -extent),
      to: new THREE.Vector3(0, 0, extent),
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
function createTickMarks(extent: number, step: number): THREE.Group {
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

  for (let t = -extent; t <= extent; t += step) {
    if (t === 0) continue;

    // X 轴刻度（沿 Y/Z 各画一小段）
    pushSeg(t, -half, 0, t, half, 0);
    pushSeg(t, 0, -half, t, 0, half);

    // Y 轴刻度
    pushSeg(-half, t, 0, half, t, 0);
    pushSeg(0, t, -half, 0, t, half);

    // Z 轴刻度
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
function createTickPoints(extent: number, step: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'TickPoints';

  const sphereGeom = new THREE.SphereGeometry(0.035, 10, 10);
  const materials = {
    x: new THREE.MeshBasicMaterial({ color: AXIS_X }),
    y: new THREE.MeshBasicMaterial({ color: AXIS_Y }),
    z: new THREE.MeshBasicMaterial({ color: AXIS_Z }),
  };

  for (let t = -extent; t <= extent; t += step) {
    if (t === 0) continue;

    const px = new THREE.Mesh(sphereGeom, materials.x);
    px.position.set(t, 0, 0);
    group.add(px);

    const py = new THREE.Mesh(sphereGeom, materials.y);
    py.position.set(0, t, 0);
    group.add(py);

    const pz = new THREE.Mesh(sphereGeom, materials.z);
    pz.position.set(0, 0, t);
    group.add(pz);
  }

  return group;
}

/** 轴端点 XYZ 标签 */
function createAxisLabels(extent: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'AxisLabels';

  const offset = extent + 0.45;
  group.add(makeTextSprite('X', AXIS_X, new THREE.Vector3(offset, 0.15, 0), 0.55));
  group.add(makeTextSprite('Y', AXIS_Y, new THREE.Vector3(0.15, offset, 0), 0.55));
  group.add(makeTextSprite('Z', AXIS_Z, new THREE.Vector3(0, 0.15, offset), 0.55));

  return group;
}

/** 主要米数标签（默认每 5m） */
function createMeterLabels(
  extent: number,
  step: number,
  majorEvery: number,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'MeterLabels';

  for (let t = -extent; t <= extent; t += step) {
    if (t === 0) continue;
    if (Math.abs(t % majorEvery) > 1e-6) continue;

    const label = `${t}m`;
    // 贴在各轴外侧一点，避免压住刻度点
    group.add(
      makeTextSprite(label, AXIS_X, new THREE.Vector3(t, 0.22, 0.22), 0.35),
    );
    group.add(
      makeTextSprite(label, AXIS_Y, new THREE.Vector3(0.22, t, 0.22), 0.35),
    );
    group.add(
      makeTextSprite(label, AXIS_Z, new THREE.Vector3(0.22, 0.22, t), 0.35),
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
