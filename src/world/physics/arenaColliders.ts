import {
  Mesh,
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
 * 算法核心：根据 Extrude 视觉墙体的中心路径 (path) 和底宽 (bottomWidth)，
 * 动态纯算法解析每段线段，自动生成 100% 几何端点平齐、转角无缝拼接的实心物理 Box 碰撞阵列。
 */
export function createCollidersFromExtrudePath(
  namePrefix: string,
  path: Vector3[],
  bottomWidth: number,
  height: number,
  isClosedLoop: boolean,
  scene: Scene,
  parent: TransformNode,
): Mesh[] {
  const colliders: Mesh[] = [];
  const count = isClosedLoop ? path.length - 1 : path.length - 1;
  const halfW = bottomWidth / 2;
  const wallY = height / 2;

  for (let i = 0; i < count; i++) {
    const pStart = path[i];
    const pEnd = path[i + 1];
    if (!pStart || !pEnd) continue;

    const dir = pEnd.subtract(pStart);
    const len = dir.length();
    if (len < 0.001) continue;

    dir.scaleInPlace(1 / len); // 单位方向向量

    // 计算起点与终点的缩进/外延约束
    // 如果是开放路径（如 L 墙）：
    //   - 起点 i === 0: 刚好停在 pStart 端面，端点坐标绝对不多一厘米！
    //   - 终点 i === count - 1: 刚好停在 pEnd 端面，端点坐标绝对不多一厘米！
    //   - 中间拐角: 延伸 halfW 覆盖转角重叠区
    let startOffset = 0;
    let endOffset = 0;

    if (!isClosedLoop) {
      if (i > 0) startOffset = -halfW; // 拐角覆盖
      if (i < count - 1) endOffset = halfW; // 拐角覆盖
    } else {
      // 闭合 Loop (如 4x4 外墙或 3x3 中心墙)
      startOffset = -halfW;
      endOffset = halfW;
    }

    const effectiveLen = len + endOffset - startOffset;
    const center = pStart.add(pEnd).scale(0.5);

    // 微调中心点位置
    const offsetVector = dir.scale((startOffset + endOffset) / 2);
    const finalCenter = center.add(offsetVector);

    const collider = MeshBuilder.CreateBox(
      `${namePrefix}_seg_${i}`,
      { width: bottomWidth, height, depth: effectiveLen },
      scene,
    );

    collider.position = new Vector3(finalCenter.x, wallY, finalCenter.z);

    // 自动计算三维旋转朝向（旋转 Y 轴对齐线段 dir 向量）
    const angle = Math.atan2(dir.x, dir.z);
    collider.rotation.y = angle;

    collider.isVisible = false;
    collider.isPickable = true;
    collider.metadata = { isColliderMesh: true };
    collider.parent = parent;

    new PhysicsAggregate(
      collider,
      PhysicsShapeType.BOX,
      { mass: 0, friction: 0.8, restitution: 0 },
      scene,
    );

    colliders.push(collider);
  }

  return colliders;
}

/**
 * 与 Floor 视觉模型完全基于纯算法（Algorithmically Generated）对齐的碰撞组装器。
 */
export function buildArenaColliders(
  scene: Scene,
  options: ArenaColliderOptions = {},
): TransformNode {
  const includeFloor = options.includeFloor !== false;
  const root = new TransformNode('ArenaColliders', scene);
  const halfX = options.halfX ?? Floor.HALF_X;
  const halfZ = options.halfZ ?? Floor.HALF_Z;

  const outerThickness = Floor.WALL_THICKNESS; // 1.0m
  const innerThickness = 0.8;                  // 0.8m
  const h = options.wallHeight ?? Floor.WALL_HEIGHT;
  const floorThick = Floor.FLOOR_THICKNESS;
  const sizeX = halfX * 2;
  const sizeZ = halfZ * 2;

  // 主场地地面
  if (includeFloor) {
    const floor = MeshBuilder.CreateBox(
      'PhysFloor',
      { width: sizeX, height: floorThick, depth: sizeZ },
      scene,
    );
    floor.position.y = -floorThick / 2;
    floor.isVisible = false;
    floor.isPickable = false;
    floor.metadata = { isColliderMesh: true };
    floor.parent = root;
    new PhysicsAggregate(
      floor,
      PhysicsShapeType.BOX,
      { mass: 0, friction: 0.6, restitution: 0.15 },
      scene,
    );
  }

  // 1. 四周外围墙：算法自动根据四周围线路径解析生成
  const loopPath = [
    new Vector3(-halfX - outerThickness / 2, 0, -halfZ - outerThickness / 2),
    new Vector3(halfX + outerThickness / 2, 0, -halfZ - outerThickness / 2),
    new Vector3(halfX + outerThickness / 2, 0, halfZ + outerThickness / 2),
    new Vector3(-halfX - outerThickness / 2, 0, halfZ + outerThickness / 2),
    new Vector3(-halfX - outerThickness / 2, 0, -halfZ - outerThickness / 2),
  ];
  createCollidersFromExtrudePath(
    'PhysWall_Outer',
    loopPath,
    outerThickness,
    h,
    true,
    scene,
    root,
  );

  // 2. 中心“口”字墙：算法自动根据中心 3x3 米路径解析生成
  if (options.centerWallSize && options.centerWallSize > 0) {
    const cHalf = options.centerWallSize / 2;
    const centerLoopPath = [
      new Vector3(-cHalf, 0, -cHalf),
      new Vector3(cHalf, 0, -cHalf),
      new Vector3(cHalf, 0, cHalf),
      new Vector3(-cHalf, 0, cHalf),
      new Vector3(-cHalf, 0, -cHalf),
    ];
    createCollidersFromExtrudePath(
      'PhysWall_Center',
      centerLoopPath,
      innerThickness,
      h,
      true,
      scene,
      root,
    );
  }

  // 3. 四角 L 型围墙：算法自动根据 Floor 中的 4 个 L 管道路径点解析生成
  if (options.addLWall) {
    const cornerConfigs = [
      { name: 'BR', path: [new Vector3(8, 0, -5), new Vector3(5, 0, -5), new Vector3(5, 0, -8)] },
      { name: 'TR', path: [new Vector3(8, 0, 5), new Vector3(5, 0, 5), new Vector3(5, 0, 8)] },
      { name: 'TL', path: [new Vector3(-8, 0, 5), new Vector3(-5, 0, 5), new Vector3(-5, 0, 8)] },
      { name: 'BL', path: [new Vector3(-8, 0, -5), new Vector3(-5, 0, -5), new Vector3(-5, 0, -8)] },
    ];

    for (const config of cornerConfigs) {
      createCollidersFromExtrudePath(
        `PhysWall_L_${config.name}`,
        config.path,
        innerThickness,
        h,
        false,
        scene,
        root,
      );
    }
  }

  return root;
}
