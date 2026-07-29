import * as THREE from 'three';
import { createSceneLights } from '../world/createSceneLights';
import { DefenseTower } from '../world/DefenseTower';
import { DirtFloor } from '../world/DirtFloor';
import { Minion } from '../world/Minion';
import { SpatialAxesGrid } from '../world/SpatialAxesGrid';

/**
 * 主场景：灯光 + 泥土地板 + 空间坐标辅助线 + 防御塔 + 小兵。
 * 后续关卡 / 实体可在此挂载。
 */
export class MainScene extends THREE.Scene {
  private readonly floor: DirtFloor;
  private readonly axesGrid: SpatialAxesGrid;
  private readonly defenseTowers: DefenseTower[];
  private readonly minions: Minion[];

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

    // 小兵：蓝方 x=-0.5（蓝帽），红方 x=+0.5（红帽），沿 Z 各一排
    this.minions = [];
    const zStart = -1.5;
    const zEnd = 1.5;
    const zStep = 0.35;
    for (let z = zStart; z <= zEnd + 1e-6; z += zStep) {
      const blue = new Minion(-0.5, z, 'blue');
      const red = new Minion(0.5, z, 'red');
      this.minions.push(blue, red);
      this.add(blue);
      this.add(red);
    }
  }

  /** 每帧更新 */
  update(delta: number): void {
    for (const tower of this.defenseTowers) {
      tower.update(delta);
    }
    for (const minion of this.minions) {
      minion.update(delta);
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
    for (const minion of this.minions) {
      minion.dispose();
    }
  }
}
