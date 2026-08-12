import {
  MeshBuilder,
  PhysicsAggregate,
  PhysicsShapeType,
  type Scene,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { Floor } from '../Floor';

export interface ArenaColliderOptions {
  /** 是否生成主场地平面地面碰撞（默认 true；高度图地形场景应 false） */
  includeFloor?: boolean;
  /** 围墙高度覆盖（米）；地形起伏时可加高 */
  wallHeight?: number;
  /** 场地半宽（X）；默认 Floor.HALF_X */
  halfX?: number;
  /** 场地半深（Z）；默认 Floor.HALF_Z */
  halfZ?: number;
  /** 是否生成中心围墙物理碰撞（指定边长米数，如 3 表示 3×3 米围墙） */
  centerWallSize?: number;
  /** 是否生成右下角 L 型围墙物理碰撞 */
  addLWall?: boolean;
}

/**
 * 与 Floor 几何对齐的静态碰撞体（不可见代理 mesh）。
 * 装饰/渲染仍由 Floor / TerrainGround 负责；物理只认这些简化 shape。
 */
export function buildArenaColliders(
  scene: Scene,
  options: ArenaColliderOptions = {},
): TransformNode {
  const includeFloor = options.includeFloor !== false;
  const root = new TransformNode('ArenaColliders', scene);
  const halfX = options.halfX ?? Floor.HALF_X;
  const halfZ = options.halfZ ?? Floor.HALF_Z;
  const t = Floor.WALL_THICKNESS;
  const h = options.wallHeight ?? Floor.WALL_HEIGHT;
  const floorThick = Floor.FLOOR_THICKNESS;
  const sizeX = halfX * 2;
  const sizeZ = halfZ * 2;

  // 主场地地面：盒体顶面 Y=0
  if (includeFloor) {
    const floor = MeshBuilder.CreateBox(
      'PhysFloor',
      { width: sizeX, height: floorThick, depth: sizeZ },
      scene,
    );
    floor.position.y = -floorThick / 2;
    floor.isVisible = false;
    floor.isPickable = false;
    floor.parent = root;
    new PhysicsAggregate(
      floor,
      PhysicsShapeType.BOX,
      { mass: 0, friction: 0.6, restitution: 0.15 },
      scene,
    );
  }

  // 围墙（与 Floor 同布局）
  const wallY = h / 2;
  for (const [i, z] of [-halfZ - t / 2, halfZ + t / 2].entries()) {
    const wall = MeshBuilder.CreateBox(
      `PhysWallLong_${i}`,
      { width: sizeX + t * 2, height: h, depth: t },
      scene,
    );
    wall.position = new Vector3(0, wallY, z);
    wall.isVisible = false;
    wall.isPickable = true;
    wall.parent = root;
    new PhysicsAggregate(
      wall,
      PhysicsShapeType.BOX,
      { mass: 0, friction: 0.5, restitution: 0.25 },
      scene,
    );
  }
  for (const [i, x] of [-halfX - t / 2, halfX + t / 2].entries()) {
    const wall = MeshBuilder.CreateBox(
      `PhysWallShort_${i}`,
      { width: t, height: h, depth: sizeZ },
      scene,
    );
    wall.position = new Vector3(x, wallY, 0);
    wall.isVisible = false;
    wall.isPickable = true;
    wall.parent = root;
    new PhysicsAggregate(
      wall,
      PhysicsShapeType.BOX,
      { mass: 0, friction: 0.5, restitution: 0.25 },
      scene,
    );
  }

  // 中心围墙物理碰撞盒（如 3×3 米围墙，完全匹配 90° 标准正方形）
  if (options.centerWallSize && options.centerWallSize > 0) {
    const cSize = options.centerWallSize;
    const cThickness = 0.8;
    const halfS = cSize / 2;

    // 北墙和南墙 (平行于 X，全宽 cSize，深 cThickness)
    for (const [i, zSign] of [-1, 1].entries()) {
      const wall = MeshBuilder.CreateBox(
        `PhysCenterWallNS_${i}`,
        { width: cSize, height: h, depth: cThickness },
        scene,
      );
      wall.position = new Vector3(0, wallY, zSign * (halfS - cThickness / 2));
      wall.isVisible = false;
      wall.isPickable = true;
      wall.parent = root;
      new PhysicsAggregate(
        wall,
        PhysicsShapeType.BOX,
        { mass: 0, friction: 0.5, restitution: 0.25 },
        scene,
      );
    }

    // 东墙和西墙 (平行于 Z，宽 cThickness，深 cSize - 2*cThickness)
    for (const [i, xSign] of [-1, 1].entries()) {
      const wall = MeshBuilder.CreateBox(
        `PhysCenterWallEW_${i}`,
        { width: cThickness, height: h, depth: cSize - 2 * cThickness },
        scene,
      );
      wall.position = new Vector3(xSign * (halfS - cThickness / 2), wallY, 0);
      wall.isVisible = false;
      wall.isPickable = true;
      wall.parent = root;
      new PhysicsAggregate(
        wall,
        PhysicsShapeType.BOX,
        { mass: 0, friction: 0.5, restitution: 0.25 },
        scene,
      );
    }
  }

  // 四角 L 型围墙物理碰撞盒 (四个象限)
  if (options.addLWall) {
    const wallY = h / 2;
    const t = 0.8; // 墙厚 0.8m

    const corners = [
      { name: 'BR', cx: 6.5, cz: -5.0, zx: 5.0, zz: -6.5 },
      { name: 'TR', cx: 6.5, cz: 5.0, zx: 5.0, zz: 6.5 },
      { name: 'TL', cx: -6.5, cz: 5.0, zx: -5.0, zz: 6.5 },
      { name: 'BL', cx: -6.5, cz: -5.0, zx: -5.0, zz: -6.5 },
    ];

    for (const c of corners) {
      // X 臂物理盒
      const wallX = MeshBuilder.CreateBox(
        `PhysLWall_ArmX_${c.name}`,
        { width: 3.8, height: h, depth: t },
        scene,
      );
      wallX.position = new Vector3(c.cx, wallY, c.cz);
      wallX.isVisible = false;
      wallX.isPickable = true;
      wallX.parent = root;
      new PhysicsAggregate(
        wallX,
        PhysicsShapeType.BOX,
        { mass: 0, friction: 0.5, restitution: 0.25 },
        scene,
      );

      // Z 臂物理盒
      const wallZ = MeshBuilder.CreateBox(
        `PhysLWall_ArmZ_${c.name}`,
        { width: t, height: h, depth: 3.8 },
        scene,
      );
      wallZ.position = new Vector3(c.zx, wallY, c.zz);
      wallZ.isVisible = false;
      wallZ.isPickable = true;
      wallZ.parent = root;
      new PhysicsAggregate(
        wallZ,
        PhysicsShapeType.BOX,
        { mass: 0, friction: 0.5, restitution: 0.25 },
        scene,
      );
    }
  }

  return root;
}
