import {
  MeshBuilder,
  PhysicsAggregate,
  PhysicsShapeType,
  type Scene,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { Floor } from '../Floor';

/**
 * 与 Floor 几何对齐的静态碰撞体（不可见代理 mesh）。
 * 装饰/渲染仍由 Floor 负责；物理只认这些简化 shape。
 */
export function buildArenaColliders(scene: Scene): TransformNode {
  const root = new TransformNode('ArenaColliders', scene);
  const halfX = Floor.HALF_X;
  const halfZ = Floor.HALF_Z;
  const t = Floor.WALL_THICKNESS;
  const h = Floor.WALL_HEIGHT;
  const floorThick = Floor.FLOOR_THICKNESS;
  const sizeX = halfX * 2;
  const sizeZ = halfZ * 2;

  // 主场地地面：盒体顶面 Y=0
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
    wall.isPickable = false;
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
    wall.isPickable = false;
    wall.parent = root;
    new PhysicsAggregate(
      wall,
      PhysicsShapeType.BOX,
      { mass: 0, friction: 0.5, restitution: 0.25 },
      scene,
    );
  }

  return root;
}
