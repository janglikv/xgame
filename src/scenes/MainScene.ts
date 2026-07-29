import * as THREE from 'three';
import { createSceneLights } from '../world/createSceneLights';
import { DefenseTower } from '../world/DefenseTower';
import { DirtFloor } from '../world/DirtFloor';
import { SpatialAxesGrid } from '../world/SpatialAxesGrid';

/**
 * 主场景：灯光 + 泥土地板 + 空间坐标辅助线 + 防御塔。
 * 后续关卡 / 实体可在此挂载。
 */
export class MainScene extends THREE.Scene {
  private readonly floor: DirtFloor;
  private readonly axesGrid: SpatialAxesGrid;
  private readonly defenseTowers: DefenseTower[];

  constructor() {
    super();
    this.name = 'MainScene';
    this.background = new THREE.Color(0x0b0f14);

    this.add(createSceneLights());

    this.floor = new DirtFloor();
    this.add(this.floor);

    this.axesGrid = new SpatialAxesGrid();
    this.add(this.axesGrid);

    // 防御塔：±3m、±7m 对称布置
    this.defenseTowers = [
      new DefenseTower(3),
      new DefenseTower(7),
      new DefenseTower(-3),
      new DefenseTower(-7),
    ];
    for (const tower of this.defenseTowers) {
      this.add(tower);
    }
  }

  /** 每帧更新 */
  update(delta: number): void {
    for (const tower of this.defenseTowers) {
      tower.update(delta);
    }
  }

  /** 窗口尺寸变化时由外部调用 */
  resize(_width: number, _height: number): void {
    // no-op
  }

  dispose(): void {
    this.floor.dispose();
    for (const tower of this.defenseTowers) {
      tower.dispose();
    }
  }
}
