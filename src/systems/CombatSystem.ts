import type { Container } from 'pixi.js';
import type {
  AutoAimSpearCaster,
  EntranceAimTarget,
  WorldFeetOrigin,
} from '../entities/CharacterEntrance';
import type { RangedCombatServices } from '../entities/CharacterRanged';
import type { AmmoHudModel } from '../entities/CharacterResources';
import {
  BombProjectile,
  type BombProjectileOptions,
} from '../entities/BombProjectile';
import type { PlayerCharacterBase } from '../entities/PlayerCharacterBase';
import { SPEAR_HIT_R, SpearProjectile } from '../entities/SpearProjectile';
import type { Spider } from '../entities/Spider';
import {
  circleHitsHurt,
  distancePastHurt,
} from '../data/bodyProfiles';

/** 蜘蛛对击飞的接收倍率（目标抗性，非炸弹属性） */
export const SPIDER_KNOCK_SCALE = 0.85;
/** 点太近不扔（屏幕像素） */
const THROW_MIN_DIST = 12;
/** 脚本化自动瞄准连射：单发间隔（秒） */
const AUTO_AIM_SPEAR_INTERVAL = 0.12;
/** 脚本化自动瞄准连射：索敌半径（世界像素） */
const AUTO_AIM_RANGE = 520;

/** 镜头参数：屏幕点击 → 世界瞄准 */
export type CombatCameraView = {
  x: number;
  y: number;
  zoom: number;
  width: number;
  height: number;
};

/**
 * 一帧武器结算所需世界。
 * 玩家为 WorldActor（实体自持 worldX/Y + knock）；场上仅一名玩家角色。
 */
export type CombatWorld = {
  player: PlayerCharacterBase | null;
  /** 可变数组：死亡蜘蛛会从中 splice */
  spiders: Spider[];
};

/**
 * 场景注入的世界/UI 能力。
 * 弹药只经统一 AmmoHudModel 回传，不点名飞剑/炸药。
 */
export type CombatSystemHooks = {
  sortDepth: () => void;
  syncWorldActors: () => void;
  /** 弹药显示变更（模型由角色 getAmmoHud 产生） */
  onAmmoHudChanged?: (model: AmmoHudModel) => void;
};

/**
 * 远程投射物运行时：生成、更新、命中结算、销毁。
 * 不识别具体角色类；玩法意图在角色，弹体事实在本系统。
 */
export class CombatSystem {
  private readonly bombs: BombProjectile[] = [];
  private readonly spears: SpearProjectile[] = [];
  private readonly sortLayer: Container;
  private readonly hooks: CombatSystemHooks;
  /** 脚本化免费自动瞄准连射（出场等调用，非普攻） */
  private autoAimVolley: {
    caster: AutoAimSpearCaster;
    targets: readonly EntranceAimTarget[];
    remaining: number;
    targetIndex: number;
    elapsed: number;
  } | null = null;
  /** 炸弹首次爆炸回调（通用钩子，不绑定出场语义） */
  private readonly bombFirstBlastHooks = new Map<
    BombProjectile,
    () => void
  >();

  constructor(sortLayer: Container, hooks: CombatSystemHooks) {
    this.sortLayer = sortLayer;
    this.hooks = hooks;
  }

  /** 获取当前运行中的炸弹列表（Debug 用） */
  getBombs(): ReadonlyArray<BombProjectile> {
    return this.bombs;
  }

  /** 获取当前运行中的矛列表（Debug 用） */
  getSpears(): ReadonlyArray<SpearProjectile> {
    return this.spears;
  }

  /** 同步投射物世界坐标（由场景 syncWorldActors 调用） */
  syncProjectiles(): void {
    for (const bomb of this.bombs) {
      bomb.syncToWorld();
    }
    for (const spear of this.spears) {
      spear.syncToWorld();
    }
  }

  /**
   * 屏幕点击远程攻击。
   * 换算世界瞄准向量后交给角色 `tryRangedAttack`；不识别具体角色类。
   * 瞄准过近则 no-op。
   */
  tryRangedAtScreen(
    player: PlayerCharacterBase,
    screenX: number,
    screenY: number,
    camera: CombatCameraView,
  ): void {
    const aim = this.screenAimWorldDelta(
      player.worldX,
      player.worldY,
      screenX,
      screenY,
      camera,
    );
    if (!aim) return;
    player.tryRangedAttack(aim, this.rangedServices());
  }

  /** 供角色远程出手的生成 / HUD 服务 */
  private rangedServices(): RangedCombatServices {
    return {
      spawnBomb: (startX, startY, endX, endY, options) => {
        this.spawnBomb(startX, startY, endX, endY, options);
      },
      spawnSpear: (originX, originY, dirX, dirY, options) => {
        this.spawnSpear(originX, originY, dirX, dirY, options);
      },
      notifyAmmoHud: (model) => {
        this.hooks.onAmmoHudChanged?.(model);
      },
    };
  }

  private spawnBomb(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    options: BombProjectileOptions = {},
  ): BombProjectile {
    const bomb = new BombProjectile(startX, startY, endX, endY, options);
    this.sortLayer.addChild(bomb);
    this.bombs.push(bomb);
    bomb.syncToWorld();
    this.hooks.sortDepth();
    return bomb;
  }

  private spawnSpear(
    originX: number,
    originY: number,
    dirX: number,
    dirY: number,
    options: { originHeight?: number } = {},
  ): void {
    const spear = new SpearProjectile(originX, originY, dirX, dirY, {
      originHeight: options.originHeight,
    });
    this.sortLayer.addChild(spear);
    this.spears.push(spear);
    spear.syncToWorld();
    this.hooks.sortDepth();
  }

  /**
   * 免费自动瞄准连射：不走手持飞剑与弹药。
   * 供角色出场等脚本调用；战斗系统不感知「出场」语义。
   */
  fireFreeAutoAimSpearVolley(
    caster: AutoAimSpearCaster,
    targets: readonly EntranceAimTarget[],
    count = 3,
  ): void {
    if (count <= 0) return;
    this.autoAimVolley = {
      caster,
      targets,
      remaining: count,
      targetIndex: 0,
      elapsed: 0,
    };
    this.fireNextAutoAimSpear();
  }

  /**
   * 从原点同时抛向多个落点（不扣弹药）。
   * `onFirstBlast` 在本组任一枚首次爆炸时调用一次。
   */
  throwBombBurst(
    origin: WorldFeetOrigin,
    landings: ReadonlyArray<{ endX: number; endY: number }>,
    options: BombProjectileOptions = {},
    onFirstBlast?: () => void,
  ): void {
    let blasted = false;
    const firstBlastOnce = onFirstBlast
      ? (): void => {
          if (blasted) return;
          blasted = true;
          onFirstBlast();
        }
      : null;

    for (const land of landings) {
      const bomb = this.spawnBomb(
        origin.worldX,
        origin.worldY,
        land.endX,
        land.endY,
        options,
      );
      if (firstBlastOnce) {
        this.bombFirstBlastHooks.set(bomb, firstBlastOnce);
      }
    }
  }

  /** 取消该实体相关的脚本化攻击（切换角色时调用） */
  cancelScriptedAttacks(owner: object): void {
    if (this.autoAimVolley?.caster === owner) {
      this.autoAimVolley = null;
    }
  }

  /** 推进所有投射物；结算爆炸 / 矛命中；清理 done */
  update(deltaMS: number, world: CombatWorld): void {
    this.updateAutoAimVolley(deltaMS / 1000);
    this.updateBombs(deltaMS, world);
    this.updateSpears(deltaMS, world);
  }

  private updateAutoAimVolley(dt: number): void {
    const volley = this.autoAimVolley;
    if (!volley) return;

    volley.elapsed += dt;
    if (volley.elapsed < AUTO_AIM_SPEAR_INTERVAL) return;
    volley.elapsed -= AUTO_AIM_SPEAR_INTERVAL;
    this.fireNextAutoAimSpear();
  }

  private fireNextAutoAimSpear(): void {
    const volley = this.autoAimVolley;
    if (!volley || volley.remaining <= 0) {
      this.autoAimVolley = null;
      return;
    }

    const { caster } = volley;
    const targets = volley.targets
      .filter((t) => {
        if (!t.isAlive) return false;
        const dx = t.worldX - caster.worldX;
        const dy = t.worldY - caster.worldY;
        return dx * dx + dy * dy <= AUTO_AIM_RANGE ** 2;
      })
      .sort((a, b) => {
        const adx = a.worldX - caster.worldX;
        const ady = a.worldY - caster.worldY;
        const bdx = b.worldX - caster.worldX;
        const bdy = b.worldY - caster.worldY;
        return adx * adx + ady * ady - (bdx * bdx + bdy * bdy);
      });
    if (targets.length === 0) {
      this.autoAimVolley = null;
      return;
    }

    const target = targets[volley.targetIndex % targets.length]!;
    caster.setFacingFromMoveX(target.worldX - caster.worldX);
    const origin = caster.getThrowOrigin(caster.worldX, caster.worldY);
    this.spawnSpear(
      origin.x,
      origin.y,
      target.worldX - origin.x,
      target.worldY - origin.y,
      { originHeight: origin.height },
    );

    volley.remaining -= 1;
    volley.targetIndex += 1;
    if (volley.remaining <= 0) {
      this.autoAimVolley = null;
    }
  }

  private screenAimWorldDelta(
    playerWorldX: number,
    playerWorldY: number,
    screenX: number,
    screenY: number,
    camera: CombatCameraView,
  ): { dx: number; dy: number } | null {
    const z = camera.zoom;
    const playerSx =
      camera.width / 2 + (playerWorldX - camera.x) * z;
    const playerSy =
      camera.height / 2 + (playerWorldY - camera.y) * z;
    const screenDx = screenX - playerSx;
    const screenDy = screenY - playerSy;
    if (Math.hypot(screenDx, screenDy) < THROW_MIN_DIST) return null;
    return { dx: screenDx / z, dy: screenDy / z };
  }

  private updateBombs(deltaMS: number, world: CombatWorld): void {
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const bomb = this.bombs[i]!;
      const phase = bomb.update(deltaMS);
      bomb.syncToWorld();

      if (bomb.consumeBlastResolve()) {
        this.bombFirstBlastHooks.get(bomb)?.();
        this.applyBombBlast(bomb, world);
      }

      if (phase === 'done') {
        this.bombFirstBlastHooks.delete(bomb);
        this.sortLayer.removeChild(bomb);
        bomb.destroy({ children: true });
        this.bombs.splice(i, 1);
      }
    }
  }

  /**
   * 直线长矛：飞行中检测蜘蛛；撞墙由投射物内部处理。
   */
  private updateSpears(deltaMS: number, world: CombatWorld): void {
    let needSync = false;

    for (let i = this.spears.length - 1; i >= 0; i--) {
      const spear = this.spears[i]!;
      let phase = spear.update(deltaMS);

      if (phase === 'flying') {
        for (let s = world.spiders.length - 1; s >= 0; s--) {
          const spider = world.spiders[s]!;
          if (!spider.isAlive) continue;
          if (
            !circleHitsHurt(
              spear.groundX,
              spear.groundY,
              SPEAR_HIT_R,
              spider.worldX,
              spider.worldY,
              spider.bodyProfileId,
            )
          ) {
            continue;
          }

          const hit = spear.buildHit();
          const alive = spider.applyBlastHit(hit, SPIDER_KNOCK_SCALE);
          if (!alive) {
            this.removeSpider(world, s);
          }
          spear.stick();
          phase = spear.getPhase();
          needSync = true;
          break;
        }
      }

      spear.syncToWorld();

      if (phase === 'done') {
        this.sortLayer.removeChild(spear);
        spear.destroy({ children: true });
        this.spears.splice(i, 1);
      }
    }

    if (needSync) {
      this.hooks.syncWorldActors();
    }
  }

  /**
   * 把炸弹算出的命中接到目标上。
   * 炸弹无击飞：玩家不受影响；蜘蛛只结算伤害（可死亡）。
   */
  private applyBombBlast(bomb: BombProjectile, world: CombatWorld): void {
    let anyFx = false;
    for (let i = world.spiders.length - 1; i >= 0; i--) {
      const spider = world.spiders[i]!;
      if (!spider.isAlive) continue;

      const inner = distancePastHurt(
        bomb.groundX,
        bomb.groundY,
        spider.worldX,
        spider.worldY,
        spider.bodyProfileId,
      );
      const hit = bomb.evaluateHit(
        spider.worldX,
        spider.worldY,
        spider.worldX >= bomb.groundX ? 1 : -1,
        0,
        inner,
      );
      if (!hit) continue;

      anyFx = true;
      const alive = spider.applyBlastHit(hit, SPIDER_KNOCK_SCALE);
      if (!alive) {
        this.removeSpider(world, i);
      }
    }

    if (anyFx) {
      this.hooks.syncWorldActors();
      this.hooks.sortDepth();
    }
  }

  private removeSpider(world: CombatWorld, index: number): void {
    const spider = world.spiders[index];
    if (!spider) return;
    this.sortLayer.removeChild(spider);
    spider.destroy({ children: true });
    world.spiders.splice(index, 1);
  }
}
