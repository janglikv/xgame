import type { EntranceContext } from '../../entities/CharacterEntrance';
import {
  applyKnockImpulse,
  stepKnockArc,
} from '../../entities/knockArc';
import type { PlayerCharacterBase } from '../../entities/PlayerCharacterBase';
import type {
  CreatureEcologyContext,
  WorldCreature,
} from '../../entities/WorldCreature';
import type { LevelMapDef } from '../../data/maps';
import {
  GRASS_FAR_LOD_ZOOM_MUL,
  GRASS_VIEW_CULL_MARGIN,
} from '../../data/grassProfiles';
import { TREE_VIEW_CULL_MARGIN } from '../../data/treeProfiles';
import type { InputManager } from '../../input/InputManager';
import type { CombatSystem, CombatWorld } from '../../systems/CombatSystem';
import type { GodModeController } from '../../systems/GodModeController';
import type { HarvestWorld } from '../../systems/HarvestWorld';
import {
  SolidResolver,
  type SolidContext,
} from '../../systems/SolidResolver';
import type { HealthBar } from '../../ui/HealthBar';
import type { WorldMap } from '../../world/WorldMap';
import type { LevelCamera } from '../LevelCamera';
import type { LevelPointerState } from './LevelInputRouter';
import type { LevelLandRedraw } from './LevelLandRedraw';
import type { LevelWorldLayers } from './LevelWorldLayers';

const MOVE_SPEED = 220;
/** 击退很强时削弱 WASD 控制（水平速度） */
const KNOCK_CONTROL_SOFTEN = 220;

export type LevelSimulationDeps = {
  input: InputManager;
  getPlayer: () => PlayerCharacterBase | null;
  creatures: WorldCreature[];
  mapDef: LevelMapDef;
  solid: SolidResolver;
  combat: CombatSystem;
  harvest: HarvestWorld;
  god: GodModeController;
  camera: LevelCamera;
  healthBar: HealthBar;
  worldMap: WorldMap;
  layers: LevelWorldLayers;
  landRedraw: LevelLandRedraw;
  getPointer: () => LevelPointerState;
  entranceContext: () => EntranceContext;
  syncWorldActors: () => void;
  stepCamera: (dt: number, snap?: boolean) => boolean;
  syncAmmoHud: (player: PlayerCharacterBase) => void;
};

/**
 * 关卡帧模拟：移动 / 击退 / 出场 / 生物生态 / 碰撞 / 战斗 / 收割。
 * LevelScene 只负责编排调用。
 */
export class LevelSimulation {
  private readonly deps: LevelSimulationDeps;

  /** 生态树列表缓存：避免每帧 map 分配 */
  private ecoTreesCache: Array<{
    worldX: number;
    worldY: number;
    kind: 'pine' | 'apple';
    isAlive: boolean;
  }> = [];
  private ecoTreesCacheLen = -1;

  constructor(deps: LevelSimulationDeps) {
    this.deps = deps;
  }

  /** 玩家位移后的固体解析（闪现等输入路径也会调用） */
  applyPlayerSolid(fromX: number, fromY: number): void {
    const player = this.deps.getPlayer();
    if (!player) return;
    this.deps.solid.resolvePlayer(
      player,
      fromX,
      fromY,
      this.solidContext(),
    );
  }

  /**
   * 移动 / 击退 / 出场 / 战斗 / 收割帧步进。
   */
  step(
    deltaMS: number,
    dt: number,
    player: PlayerCharacterBase,
  ): void {
    const {
      input,
      god,
      camera,
      healthBar,
      worldMap,
      combat,
      harvest,
      creatures,
      layers,
      landRedraw,
    } = this.deps;
    const pointer = this.deps.getPointer();

    const { x, y } = input.getMoveAxis();
    const fromX = player.worldX;
    const fromY = player.worldY;
    const godOn = god.enabled;

    const knockStep = godOn
      ? { moved: false, dx: 0, dy: 0, airborne: false, justLanded: false }
      : stepKnockArc(player.knock, dt);
    if (knockStep.moved) {
      player.worldX += knockStep.dx;
      player.worldY += knockStep.dy;
    }
    const knockSpeed = godOn
      ? 0
      : Math.hypot(player.knock.velX, player.knock.velY);
    const airborne = knockStep.airborne;
    const locks = player.entranceLocks;

    const moving = x !== 0 || y !== 0;
    if (moving && (godOn || !locks.move)) {
      let control = 1;
      if (godOn) {
        control = 1.6;
      } else if (airborne) {
        control = 0.08;
      } else if (knockSpeed > KNOCK_CONTROL_SOFTEN) {
        control = Math.max(0.2, 1 - knockSpeed / (KNOCK_CONTROL_SOFTEN * 3));
      }
      player.worldX += x * MOVE_SPEED * control * dt;
      player.worldY += y * MOVE_SPEED * control * dt;
    }

    if (!godOn) {
      this.applyPlayerSolid(fromX, fromY);
    }

    if (pointer.seen) {
      const z = Math.max(camera.currentZoom, 1e-4);
      const playerSx =
        camera.width / 2 + (player.worldX - camera.x) * z;
      const screenDx = pointer.screenX - playerSx;
      player.setFacingFromMoveX(screenDx);
    }
    player.updateEntrance(
      dt,
      this.deps.entranceContext(),
      knockStep.justLanded,
    );

    this.deps.stepCamera(dt);

    this.deps.syncWorldActors();
    player.update(
      deltaMS,
      moving && !locks.move && !airborne && knockSpeed < 80,
    );
    healthBar.update(deltaMS);
    player.tickResources(deltaMS);
    this.deps.syncAmmoHud(player);
    worldMap.update(deltaMS);

    if (!godOn) {
      const ecology = this.buildEcologyContext();
      // 快照：生态可能中途 removeCreature（吃鸡 / 饿死），避免下标错位
      const tickList = creatures.slice();
      for (const spider of tickList) {
        if (!creatures.includes(spider)) continue;
        if (!spider.isAlive && !spider.isCorpse) {
          spider.turnIntoCorpse(6.0);
        }
        const sFromX = spider.worldX;
        const sFromY = spider.worldY;
        const result = spider.update(
          deltaMS,
          player.worldX,
          player.worldY,
          player.bodyProfileId,
          ecology,
        );
        const si = creatures.indexOf(spider);
        if (si < 0 || !spider.isAlive) continue;
        this.applySpiderSolid(spider, sFromX, sFromY, si);
        if (result.attackHit) {
          this.applySpiderAttack(result.attackHit);
        }
      }
      for (const spider of creatures) {
        spider.syncToWorld();
      }
      combat.update(deltaMS, this.combatWorld());
    } else {
      for (const spider of creatures) {
        spider.syncToWorld();
      }
    }

    this.updateGrassLod();
    harvest.tickTrees(deltaMS, creatures, this.grassViewBounds());
    harvest.update(deltaMS, player.worldX, player.worldY);
    layers.sortDepth();
    layers.sortTreeBands();
    landRedraw.flush(dt);
  }

  private solidContext(): SolidContext {
    return {
      player: this.deps.getPlayer(),
      creatures: this.deps.creatures,
    };
  }

  private applySpiderSolid(
    spider: WorldCreature,
    fromX: number,
    fromY: number,
    spiderIndex: number,
  ): void {
    if (spider.immovable) return;
    this.deps.solid.resolveSpider(
      spider,
      fromX,
      fromY,
      spiderIndex,
      this.solidContext(),
    );
  }

  private combatWorld(): CombatWorld {
    return {
      player: this.deps.getPlayer(),
      creatures: this.deps.creatures,
      harvestTrees: this.deps.harvest.trees,
    };
  }

  private refreshEcoTreesCache(): void {
    const trees = this.deps.harvest.trees;
    if (this.ecoTreesCacheLen !== trees.length) {
      this.ecoTreesCache = new Array(trees.length);
      this.ecoTreesCacheLen = trees.length;
    }
    for (let i = 0; i < trees.length; i++) {
      const t = trees[i]!;
      const slot = this.ecoTreesCache[i];
      if (slot) {
        slot.worldX = t.worldX;
        slot.worldY = t.worldY;
        slot.kind = t.treeKind;
        slot.isAlive = t.isAlive;
      } else {
        this.ecoTreesCache[i] = {
          worldX: t.worldX,
          worldY: t.worldY,
          kind: t.treeKind,
          isAlive: t.isAlive,
        };
      }
    }
  }

  /** 猪 / 牛 / 马等生物的觅食上下文（每帧重建轻量引用） */
  private buildEcologyContext(): CreatureEcologyContext {
    this.refreshEcoTreesCache();
    const { harvest, creatures, mapDef } = this.deps;
    return {
      pickups: harvest.pickups,
      grasses: harvest.grasses,
      trees: this.ecoTreesCache,
      creatures,
      mapDef,
      consumePickup: (p) => {
        const found = harvest.pickups.find((item) => item === p);
        if (found) harvest.consumePickup(found);
      },
      consumeGrass: (g) => harvest.consumeGrass(g),
      findNearestLargeGrass: (x, y) => {
        const hit = harvest.findNearestLargeGrass(x, y);
        if (!hit) return null;
        return { grass: hit.grass, dist: hit.dist };
      },
      removeCreature: (creature) => {
        this.removeCreatureEntity(creature);
      },
    };
  }

  /** 生态捕食 / 死亡移除（不写回地图草稿） */
  private removeCreatureEntity(creature: WorldCreature): void {
    const idx = this.deps.creatures.indexOf(creature);
    if (idx < 0) return;
    creature.parent?.removeChild(creature);
    creature.destroy({ children: true });
    this.deps.creatures.splice(idx, 1);
  }

  /** 全景 zoom → 草退出角色深度排序 */
  private updateGrassLod(): void {
    const { camera, harvest } = this.deps;
    const minZ = camera.getMinZoom();
    const far = camera.currentZoom <= minZ * GRASS_FAR_LOD_ZOOM_MUL;
    harvest.setGrassLodFar(far);
  }

  /** 镜头世界可视区（含边距），供草/树屏外剔除 */
  private grassViewBounds(): {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  } {
    const { camera } = this.deps;
    const z = Math.max(0.05, camera.currentZoom);
    const margin = Math.max(GRASS_VIEW_CULL_MARGIN, TREE_VIEW_CULL_MARGIN);
    const halfW = camera.width / (2 * z) + margin;
    const halfH = camera.height / (2 * z) + margin;
    return {
      minX: camera.x - halfW,
      maxX: camera.x + halfW,
      minY: camera.y - halfH,
      maxY: camera.y + halfH,
    };
  }

  private applySpiderAttack(hit: {
    damage: number;
    dirX: number;
    dirY: number;
    knockImpulse: number;
  }): void {
    const player = this.deps.getPlayer();
    if (!player) return;
    this.deps.healthBar.applyDelta(-Math.abs(hit.damage));
    applyKnockImpulse(
      player.knock,
      hit.dirX * hit.knockImpulse,
      hit.dirY * hit.knockImpulse,
    );
    player.playBlastKnock(0.45, hit.dirX, 0);
    this.deps.stepCamera(0, false);
    this.deps.syncWorldActors();
    this.deps.layers.sortDepth();
  }
}
