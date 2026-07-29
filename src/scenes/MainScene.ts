import * as THREE from 'three';
import { createSceneLights } from '../world/createSceneLights';
import { DirtFloor } from '../world/DirtFloor';
import { SpatialAxesGrid } from '../world/SpatialAxesGrid';

/**
 * 主场景：灯光 + 泥土地板 + 空间坐标辅助线。
 * 后续关卡 / 实体可在此挂载。
 */
export class MainScene extends THREE.Scene {
  private readonly floor: DirtFloor;
  private readonly axesGrid: SpatialAxesGrid;

  constructor() {
    super();
    this.name = 'MainScene';
    this.background = new THREE.Color(0x0b0f14);

    this.add(createSceneLights());

    this.floor = new DirtFloor();
    this.add(this.floor);

    this.axesGrid = new SpatialAxesGrid();
    this.add(this.axesGrid);
  }

  /** 每帧更新（占位，后续可挂动画 / 逻辑） */
  update(_delta: number): void {
    // no-op
  }

  /** 窗口尺寸变化时由外部调用 */
  resize(_width: number, _height: number): void {
    // no-op
  }

  dispose(): void {
    this.floor.dispose();
  }
}
