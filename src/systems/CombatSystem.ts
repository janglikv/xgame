import type { Container } from 'pixi.js';
import type { EntranceAimTarget } from '../entities/CharacterEntrance';
import type { RangedCombatServices } from '../entities/CharacterRanged';
import {
  BombProjectile,
  type BombProjectileOptions,
} from '../entities/BombProjectile';
import { BombGirl } from '../entities/BombGirl';
import { IceRanger } from '../entities/IceRanger';
import type { PlayerCharacterBase } from '../entities/PlayerCharacterBase';
import { SpearProjectile } from '../entities/SpearProjectile';
import type { SpearAmmoSnapshot } from '../entities/SpearAmmo';
import type { BombAmmoSnapshot } from '../entities/BombAmmo';
import type { Spider } from '../entities/Spider';
import {
  PLAYER_HURT_R,
  SPIDER_HURT_R,
} from '../entities/WorldActor';

/** 再导出，方便场景引用 */
export { PLAYER_HURT_R, SPIDER_HURT_R };

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

export type CombatSystemHooks = {
  sortDepth: () => void;
  syncWorldActors: () => void;
  /** 飞剑弹药 HUD（投矛后同步） */
  onSpearAmmoChanged?: (snap: SpearAmmoSnapshot) => void;
  /** 炸药弹药 HUD（投弹后同步） */
  onBombAmmoChanged?: (snap: BombAmmoSnapshot) => void;
};

/**
 * 远程战斗：扔炸弹 / 投矛、弹体更新、爆炸与矛命中。
 * 拥有 bombs / spears 列表；场景只负责传入世界快照与镜头。
 */
export class CombatSystem {
  private readonly bombs: BombProjectile[] = [];
  private readonly spears: SpearProjectile[] = [];
  private readonly sortLayer: Container;
  private readonly hooks: CombatSystemHooks;
  /** 脚本化免费自动瞄准连射（出场等调用，非普攻） */
  private autoAimVolley: {
    player: IceRanger;
    targets: readonly EntranceAimTarget[];
    remaining: number;
    targetIndex: number;
    elapsed: number;
  } | null = null;
  /** 炸弹首次爆炸回调（如出场显现）；与「出场」语义无关的通用钩子 */
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
      notifyAmmoHud: (p) => {
        this.notifyAmmoHud(p);
      },
    };
  }

  private spawnBomb(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    options: BombProjectileOptions = {},
  ): void {
    const bomb = new BombProjectile(startX, startY, endX, endY, options);
    this.sortLayer.addChild(bomb);
    this.bombs.push(bomb);
    bomb.syncToWorld();
    this.hooks.sortDepth();
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

  private notifyAmmoHud(player: PlayerCharacterBase): void {
    const model = player.getAmmoHud();
    if (model.kind === 'spear') {
      this.hooks.onSpearAmmoChanged?.(model.snap);
    } else if (model.kind === 'bomb') {
      this.hooks.onBombAmmoChanged?.(model.snap);
    }
  }

  /**
   * 免费自动瞄准连射：不走手持飞剑与弹药。
   * 供角色出场等脚本调用；战斗系统不感知「出场」语义。
   */
  fireFreeAutoAimSpearVolley(
    player: IceRanger,
    targets: readonly EntranceAimTarget[],
    count = 3,
  ): void {
    if (count <= 0) return;
    this.autoAimVolley = {
      player,
      targets,
      remaining: count,
      targetIndex: 0,
      elapsed: 0,
    };
    this.fireNextAutoAimSpear();
  }

  /**
   * 从角色位置同时抛向多个落点（不扣弹药）。
   * `onFirstBlast` 在本组任一枚首次爆炸时调用一次。
   */
  throwBombBurst(
    player: BombGirl,
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
      const bomb = new BombProjectile(
        player.worldX,
        player.worldY,
        land.endX,
        land.endY,
        options,
      );
      this.sortLayer.addChild(bomb);
      this.bombs.push(bomb);
      if (firstBlastOnce) {
        this.bombFirstBlastHooks.set(bomb, firstBlastOnce);
      }
      bomb.syncToWorld();
    }
    this.hooks.sortDepth();
  }

  /** 取消该角色相关的脚本化攻击（切换角色时调用） */
  cancelScriptedAttacks(player: PlayerCharacterBase): void {
    if (this.autoAimVolley?.player === player) {
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

    const targets = volley.targets
      .filter((t) => {
        if (!t.isAlive) return false;
        const dx = t.worldX - volley.player.worldX;
        const dy = t.worldY - volley.player.worldY;
        return dx * dx + dy * dy <= AUTO_AIM_RANGE ** 2;
      })
      .sort((a, b) => {
        const adx = a.worldX - volley.player.worldX;
        const ady = a.worldY - volley.player.worldY;
        const bdx = b.worldX - volley.player.worldX;
        const bdy = b.worldY - volley.player.worldY;
        return adx * adx + ady * ady - (bdx * bdx + bdy * bdy);
      });
    if (targets.length === 0) {
      this.autoAimVolley = null;
      return;
    }

    const target = targets[volley.targetIndex % targets.length]!;
    volley.player.setFacingFromMoveX(target.worldX - volley.player.worldX);
    const origin = volley.player.getThrowOrigin(
      volley.player.worldX,
      volley.player.worldY,
    );
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
          if (!spear.hitsTarget(spider.worldX, spider.worldY, spider.hurtR)) {
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

      const hit = bomb.evaluateHit(
        spider.worldX,
        spider.worldY,
        spider.worldX >= bomb.groundX ? 1 : -1,
        spider.hurtR,
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
