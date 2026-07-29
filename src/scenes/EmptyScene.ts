import * as THREE from 'three';
import { SpatialAxesGrid } from '../helpers/SpatialAxesGrid';

/**
 * 空场景：Three.js 占位场景，后续可替换为正式关卡 / 菜单场景。
 */
export class EmptyScene extends THREE.Scene {
  private readonly floor: THREE.Mesh;
  private readonly axesGrid: SpatialAxesGrid;

  constructor() {
    super();
    this.name = 'EmptyScene';
    this.background = new THREE.Color(0x0b0f14);

    // 偏亮的灯光，避免 MeshStandard 材质看起来全黑
    const ambient = new THREE.AmbientLight(0xffffff, 0.85);
    this.add(ambient);

    const dir = new THREE.DirectionalLight(0xffffff, 1.4);
    dir.position.set(6, 12, 8);
    this.add(dir);

    // 实体底板：X ±10m，Z 仅 -2 ~ 2m（共 4m）
    const floorSizeX = 20;
    const floorSizeZ = 4;
    this.floor = new THREE.Mesh(
      new THREE.PlaneGeometry(floorSizeX, floorSizeZ),
      new THREE.MeshStandardMaterial({
        color: 0x3a4658,
        roughness: 0.85,
        metalness: 0.05,
      }),
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = 0;
    this.floor.receiveShadow = true;
    this.floor.name = 'Floor';
    this.add(this.floor);

    // XYZ 空间坐标网格：每 1 米一个刻度点
    this.axesGrid = new SpatialAxesGrid({
      extent: 10,
      step: 1,
      showPlanes: true,
      majorEvery: 5,
    });
    this.add(this.axesGrid);
  }

  /** 每帧更新（占位，后续可挂动画 / 逻辑） */
  update(_delta: number): void {
    // no-op for empty scene
  }

  /** 窗口尺寸变化时由外部调用 */
  resize(_width: number, _height: number): void {
    // 当前为空场景，无需按分辨率调整内容
  }
}
