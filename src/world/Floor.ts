import {
  Color3,
  MeshBuilder,
  type Scene,
  ShadowGenerator,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core';

/**
 * 简单矩形场地：Y=0 平面地板 + 四周矮墙 + 外围兜底大地板。
 * 与坐标系范围对齐：X ±20、Z ±5。
 */
export class Floor {
  /** X 方向半宽（米）→ 总长 40 */
  static readonly HALF_X = 20;
  /** Z 方向半宽（米）→ 总宽 10 */
  static readonly HALF_Z = 5;
  /** 围墙厚度（米） */
  static readonly WALL_THICKNESS = 0.25;
  /** 围墙高度（米）；底边贴齐 Y=0 */
  static readonly WALL_HEIGHT = 0.5;
  /**
   * 兜底大地板边长（米）。
   * 超大平面近似无限；必须在矩形地板厚度之下，否则会 z-fighting 闪烁。
   */
  static readonly GROUND_SIZE = 4000;
  /** 矩形地板厚度（米）；顶面贴齐 Y=0 */
  static readonly FLOOR_THICKNESS = 0.05;
  /**
   * 兜底地面 Y（米）。
   * 须 < -FLOOR_THICKNESS，避免与矩形盒体相交。
   */
  static readonly GROUND_Y = -0.08;

  readonly root: TransformNode;

  constructor(scene: Scene, shadowGenerator?: ShadowGenerator) {
    this.root = new TransformNode('Floor', scene);

    const sizeX = Floor.HALF_X * 2;
    const sizeZ = Floor.HALF_Z * 2;
    const t = Floor.WALL_THICKNESS;
    const h = Floor.WALL_HEIGHT;
    const floorThick = Floor.FLOOR_THICKNESS;

    // 主场地与兜底大地板同色、共用材质
    const floorMat = mat(scene, 'floorMat', 0x1e2022);
    const wallMat = mat(scene, 'wallMat', 0x2a2e32);

    // 兜底大地板：放在矩形地板盒体下方，不重叠
    const ground = MeshBuilder.CreateGround(
      'FallbackGround',
      { width: Floor.GROUND_SIZE, height: Floor.GROUND_SIZE },
      scene,
    );
    ground.position.y = Floor.GROUND_Y;
    ground.material = floorMat;
    // 不接收阴影：4000m 平面若参与阴影体会把 shadow map 分辨率拉崩
    ground.receiveShadows = false;
    ground.parent = this.root;

    // 矩形主场地：盒体顶面 = Y=0，底面 = -FLOOR_THICKNESS
    const floor = MeshBuilder.CreateBox(
      'FloorSurface',
      { width: sizeX, height: floorThick, depth: sizeZ },
      scene,
    );
    floor.position.y = -floorThick / 2;
    floor.material = floorMat;
    floor.receiveShadows = true;
    floor.parent = this.root;

    const wallY = h / 2;
    const halfX = Floor.HALF_X;
    const halfZ = Floor.HALF_Z;

    // ±Z 长边（沿 X）
    for (const [i, z] of [-halfZ - t / 2, halfZ + t / 2].entries()) {
      const wall = MeshBuilder.CreateBox(
        `WallLong_${i}`,
        { width: sizeX + t * 2, height: h, depth: t },
        scene,
      );
      wall.position = new Vector3(0, wallY, z);
      wall.material = wallMat;
      wall.receiveShadows = true;
      wall.parent = this.root;
      shadowGenerator?.addShadowCaster(wall);
    }

    // ±X 短边（沿 Z）
    for (const [i, x] of [-halfX - t / 2, halfX + t / 2].entries()) {
      const wall = MeshBuilder.CreateBox(
        `WallShort_${i}`,
        { width: t, height: h, depth: sizeZ },
        scene,
      );
      wall.position = new Vector3(x, wallY, 0);
      wall.material = wallMat;
      wall.receiveShadows = true;
      wall.parent = this.root;
      shadowGenerator?.addShadowCaster(wall);
    }
  }
}

function mat(scene: Scene, name: string, hex: number): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  const c = colorFromHex(hex);
  m.diffuseColor = c;
  m.specularColor = Color3.Black();
  return m;
}

function colorFromHex(hex: number): Color3 {
  return new Color3(
    ((hex >> 16) & 0xff) / 255,
    ((hex >> 8) & 0xff) / 255,
    (hex & 0xff) / 255,
  );
}
