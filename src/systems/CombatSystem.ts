import type { Container } from 'pixi.js';
import {
  BombProjectile,
  BOMB_MAX_RANGE,
  type BombProjectileOptions,
} from '../entities/BombProjectile';
import { BombGirl } from '../entities/BombGirl';
import { IceRanger, SPEAR_THROW_RECOIL_SPEED } from '../entities/IceRanger';
import type { PlayerCharacterBase } from '../entities/PlayerCharacterBase';
import { SpearProjectile } from '../entities/SpearProjectile';
import type { SpearAmmoSnapshot } from '../entities/SpearAmmo';
import type { BombAmmoSnapshot } from '../entities/BombAmmo';
import { applyRecoilHop } from '../entities/knockArc';
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
/** 冰冰登场三连发的单发间隔（秒） */
const ENTRANCE_SPEAR_INTERVAL = 0.12;
/** 冰冰登场自动攻击的索敌半径（世界像素） */
const ENTRANCE_AUTO_AIM_RANGE = 520;
/** 炸炸出场时三枚炸弹围绕角色的落点半径 */
const BOMB_ENTRANCE_RADIUS = 34;

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
  private entranceVolley: {
    player: IceRanger;
    spiders: readonly Spider[];
    remaining: number;
    targetIndex: number;
    elapsed: number;
  } | null = null;
  private readonly entranceBombBlasts = new Map<
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
   * 屏幕点击远程攻击（炸弹妹 / 冰霜游侠）。
   * 脚底从 `player.worldX/Y` 读取；投矛脱手瞬间再读，避免前摇位移错位。
   * 非对应角色或瞄准过近则 no-op。
   */
  tryRangedAtScreen(
    player: PlayerCharacterBase,
    screenX: number,
    screenY: number,
    camera: CombatCameraView,
  ): void {
    if (player instanceof BombGirl) {
      this.throwBombAtScreen(
        player,
        player.worldX,
        player.worldY,
        screenX,
        screenY,
        camera,
      );
      return;
    }
    if (player instanceof IceRanger) {
      this.throwSpearAtScreen(player, screenX, screenY, camera);
    }
  }

  /** 冰冰落地时开始自动瞄准三连发，不走手持飞剑与弹药流程。 */
  fireFreeAutoAimSpearVolley(
    player: IceRanger,
    spiders: readonly Spider[],
    count = 3,
  ): void {
    if (count <= 0) return;
    this.entranceVolley = {
      player,
      spiders,
      remaining: count,
      targetIndex: 0,
      elapsed: 0,
    };
    this.fireNextEntranceSpear();
  }

  /**
   * 炸炸出场时从原地同时抛出三枚小炸弹。
   * 三枚炸弹共用一次回调，首次爆炸时让角色显现。
   */
  throwBombEntranceBurst(player: BombGirl, onFirstBlast: () => void): void {
    let revealed = false;
    const revealOnce = (): void => {
      if (revealed) return;
      revealed = true;
      onFirstBlast();
    };

    for (let i = 0; i < 3; i++) {
      const angle = -Math.PI / 2 + (i * Math.PI * 2) / 3;
      const endX =
        player.worldX + Math.cos(angle) * BOMB_ENTRANCE_RADIUS;
      const endY =
        player.worldY + Math.sin(angle) * BOMB_ENTRANCE_RADIUS;
      const bomb = new BombProjectile(
        player.worldX,
        player.worldY,
        endX,
        endY,
        {
          originHeight: 24,
          sizeScale: 0.7,
          blast: {
            maxDamage: 12,
            minDamage: 4,
          },
        },
      );
      this.sortLayer.addChild(bomb);
      this.bombs.push(bomb);
      this.entranceBombBlasts.set(bomb, revealOnce);
      bomb.syncToWorld();
    }
    this.hooks.sortDepth();
  }

  /** 推进所有投射物；结算爆炸 / 矛命中；清理 done */
  update(deltaMS: number, world: CombatWorld): void {
    this.updateEntranceVolley(deltaMS / 1000);
    this.updateBombs(deltaMS, world);
    this.updateSpears(deltaMS, world);
  }

  private updateEntranceVolley(dt: number): void {
    const volley = this.entranceVolley;
    if (!volley) return;

    volley.elapsed += dt;
    if (volley.elapsed < ENTRANCE_SPEAR_INTERVAL) return;
    volley.elapsed -= ENTRANCE_SPEAR_INTERVAL;
    this.fireNextEntranceSpear();
  }

  private fireNextEntranceSpear(): void {
    const volley = this.entranceVolley;
    if (!volley || volley.remaining <= 0) {
      this.entranceVolley = null;
      return;
    }

    const targets = volley.spiders
      .filter((spider) => {
        if (!spider.isAlive) return false;
        const dx = spider.worldX - volley.player.worldX;
        const dy = spider.worldY - volley.player.worldY;
        return dx * dx + dy * dy <= ENTRANCE_AUTO_AIM_RANGE ** 2;
      })
      .sort((a, b) => {
        const adx = a.worldX - volley.player.worldX;
        const ady = a.worldY - volley.player.worldY;
        const bdx = b.worldX - volley.player.worldX;
        const bdy = b.worldY - volley.player.worldY;
        return adx * adx + ady * ady - (bdx * bdx + bdy * bdy);
      });
    if (targets.length === 0) {
      this.entranceVolley = null;
      return;
    }

    const target = targets[volley.targetIndex % targets.length]!;
    volley.player.setFacingFromMoveX(target.worldX - volley.player.worldX);
    const origin = volley.player.getThrowOrigin(
      volley.player.worldX,
      volley.player.worldY,
    );
    const spear = new SpearProjectile(
      origin.x,
      origin.y,
      target.worldX - origin.x,
      target.worldY - origin.y,
      { originHeight: origin.height },
    );
    this.sortLayer.addChild(spear);
    this.spears.push(spear);
    spear.syncToWorld();
    this.hooks.sortDepth();

    volley.remaining -= 1;
    volley.targetIndex += 1;
    if (volley.remaining <= 0) {
      this.entranceVolley = null;
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

  private throwBombAtScreen(
    player: BombGirl,
    worldX: number,
    worldY: number,
    screenX: number,
    screenY: number,
    camera: CombatCameraView,
  ): void {
    const aim = this.screenAimWorldDelta(
      worldX,
      worldY,
      screenX,
      screenY,
      camera,
    );
    if (!aim) return;

    let landDx = aim.dx;
    let landDy = aim.dy;
    const worldDist = Math.hypot(landDx, landDy);
    if (worldDist > BOMB_MAX_RANGE) {
      const s = BOMB_MAX_RANGE / worldDist;
      landDx *= s;
      landDy *= s;
    }

    // 有效瞄准后再扣弹，避免点太近空耗
    if (!player.tryConsumeBomb()) return;

    const endX = worldX + landDx;
    const endY = worldY + landDy;

    player.setFacingFromMoveX(endX - worldX);
    player.playThrowRecoil();

    const origin = player.getThrowOrigin(worldX, worldY);
    const bombOptions: BombProjectileOptions = {
      originHeight: origin.height,
    };
    const bomb = new BombProjectile(
      origin.x,
      origin.y,
      endX,
      endY,
      bombOptions,
    );
    this.sortLayer.addChild(bomb);
    this.bombs.push(bomb);
    bomb.syncToWorld();
    this.hooks.sortDepth();
    this.hooks.onBombAmmoChanged?.(player.bombAmmo);
  }

  private throwSpearAtScreen(
    player: IceRanger,
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

    const aimLen = Math.hypot(aim.dx, aim.dy);
    if (aimLen < 1e-4) return;
    const inv = 1 / aimLen;
    const dirX = aim.dx * inv;
    const dirY = aim.dy * inv;

    player.setFacingFromMoveX(aim.dx);

    const launched = player.launchSpear(dirX, dirY, () => {
      applyRecoilHop(
        player.knock,
        -dirX,
        -dirY,
        SPEAR_THROW_RECOIL_SPEED,
      );

      // 脱手瞬间再取脚底，与前摇期间位移一致
      const origin = player.getThrowOrigin(player.worldX, player.worldY);
      const spear = new SpearProjectile(origin.x, origin.y, dirX, dirY, {
        originHeight: origin.height,
      });
      this.sortLayer.addChild(spear);
      this.spears.push(spear);
      spear.syncToWorld();
      this.hooks.sortDepth();
      this.hooks.onSpearAmmoChanged?.(player.spearAmmo);
    });

    if (!launched) return;
  }

  private updateBombs(deltaMS: number, world: CombatWorld): void {
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const bomb = this.bombs[i]!;
      const phase = bomb.update(deltaMS);
      bomb.syncToWorld();

      if (bomb.consumeBlastResolve()) {
        this.entranceBombBlasts.get(bomb)?.();
        this.applyBombBlast(bomb, world);
      }

      if (phase === 'done') {
        this.entranceBombBlasts.delete(bomb);
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
