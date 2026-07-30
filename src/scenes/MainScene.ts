import * as THREE from 'three';
import { ProjectileManager } from '../effects/ProjectileManager';
import type { CircleBody } from '../world/collision/CircleBody';
import { clampBodiesToFloor } from '../world/collision/clampBodiesToFloor';
import { resolveCircleCollisions } from '../world/collision/resolveCircleCollisions';
import { createSceneLights } from '../world/createSceneLights';
import { DefenseTower } from '../world/DefenseTower';
import { DirtFloor } from '../world/DirtFloor';
import { MinionWaveSpawner } from '../world/MinionWaveSpawner';
import { SpatialAxesGrid } from '../world/SpatialAxesGrid';

/**
 * 主场景：灯光 + 地板 + 坐标辅助 + 防御塔 + AI 发兵 + 弹道战斗 + 地面圆碰撞。
 */
export class MainScene extends THREE.Scene {
  private readonly floor: DirtFloor;
  private readonly axesGrid: SpatialAxesGrid;
  private readonly defenseTowers: DefenseTower[];
  private readonly minionSpawner: MinionWaveSpawner;
  private readonly projectiles: ProjectileManager;

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

    // AI 发兵 + 锁定弹道
    this.minionSpawner = new MinionWaveSpawner(this);
    this.projectiles = new ProjectileManager(this);
  }

  /** 每帧更新 */
  update(delta: number): void {
    // 本帧开战前的存活单位（塔 + 小兵），供双方索敌
    const combatUnits = [
      ...this.defenseTowers.filter((t) => t.isAlive),
      ...this.minionSpawner.activeMinions.filter((m) => m.isAlive),
    ];

    // 防御塔 AI：范围内锁定敌方，水晶发射追踪弹
    for (const tower of this.defenseTowers) {
      tower.update(delta, combatUnits, this.projectiles);
    }

    // 小兵 AI：前摇结束只发射弹道，不直接扣血
    this.minionSpawner.update(delta, this.defenseTowers, this.projectiles);

    // 弹道追踪与命中结算（命中才 takeDamage）
    this.projectiles.update(delta);
    this.minionSpawner.pruneDead();

    // 移动后再做地面圆碰撞（死兵已 prune；死塔仍挡路）
    const bodies: CircleBody[] = [
      ...this.defenseTowers.map((t) => t.collider),
      ...this.minionSpawner.activeMinions.map((m) => m.collider),
    ];
    resolveCircleCollisions(bodies);
    // 兵线两侧夹紧：圆心+半径不得超出地板 Z 范围
    clampBodiesToFloor(bodies, { halfZ: DirtFloor.HALF_Z });
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
    this.minionSpawner.dispose();
    this.projectiles.dispose();
  }
}

