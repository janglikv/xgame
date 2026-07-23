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
import {
  applyKnockImpulse,
  applyRecoilHop,
  type KnockArcState,
} from '../entities/knockArc';
import type { Spider } from '../entities/Spider';

/** 受击体：武器命中用（可与 solid 独立调参） */
export const PLAYER_HURT_R = 22;
export const SPIDER_HURT_R = 24;
/** 蜘蛛对击飞的接收倍率（目标抗性，非炸弹属性） */
export const SPIDER_KNOCK_SCALE = 0.85;
/** 点太近不扔（屏幕像素） */
const THROW_MIN_DIST = 12;

/** 镜头参数：屏幕点击 → 世界瞄准 */
export type CombatCameraView = {
  x: number;
  y: number;
  zoom: number;
  width: number;
  height: number;
};

/** 操作中的玩家（武器可打到自己爆炸） */
export type CombatPlayerTarget = {
  entity: PlayerCharacterBase;
  worldX: number;
  worldY: number;
  knock: KnockArcState;
};

/** 停场角色：可被武器击飞，不扣血 */
export type CombatParkedTarget = {
  worldX: number;
  worldY: number;
  knock: KnockArcState;
  entity: {
    playBlastKnock: (
      strength: number,
      dirX?: number,
      airSpinTurns?: number,
    ) => void;
  };
};

/** 一帧武器结算所需世界 */
export type CombatWorld = {
  player: CombatPlayerTarget | null;
  parked: CombatParkedTarget[];
  /** 可变数组：死亡蜘蛛会从中 splice */
  spiders: Spider[];
};

export type CombatSystemHooks = {
  sortDepth: () => void;
  syncWorldActors: () => void;
  /** 飞剑弹药 HUD（投矛后同步） */
  onSpearAmmoChanged?: (snap: SpearAmmoSnapshot) => void;
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

  constructor(sortLayer: Container, hooks: CombatSystemHooks) {
    this.sortLayer = sortLayer;
    this.hooks = hooks;
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
   * `getPlayerWorld` 在出手瞬间再读，避免投矛前摇期间位移错位。
   * 非对应角色或瞄准过近则 no-op。
   */
  tryRangedAtScreen(
    player: PlayerCharacterBase,
    getPlayerWorld: () => { x: number; y: number },
    playerKnock: KnockArcState,
    screenX: number,
    screenY: number,
    camera: CombatCameraView,
  ): void {
    const pos = getPlayerWorld();
    if (player instanceof BombGirl) {
      this.throwBombAtScreen(
        player,
        pos.x,
        pos.y,
        screenX,
        screenY,
        camera,
      );
      return;
    }
    if (player instanceof IceRanger) {
      this.throwSpearAtScreen(
        player,
        getPlayerWorld,
        playerKnock,
        screenX,
        screenY,
        camera,
      );
    }
  }

  /** 推进所有投射物；结算爆炸 / 矛命中；清理 done */
  update(deltaMS: number, world: CombatWorld): void {
    this.updateBombs(deltaMS, world);
    this.updateSpears(deltaMS, world);
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
  }

  private throwSpearAtScreen(
    player: IceRanger,
    getPlayerWorld: () => { x: number; y: number },
    playerKnock: KnockArcState,
    screenX: number,
    screenY: number,
    camera: CombatCameraView,
  ): void {
    const pos = getPlayerWorld();
    const aim = this.screenAimWorldDelta(
      pos.x,
      pos.y,
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
        playerKnock,
        -dirX,
        -dirY,
        SPEAR_THROW_RECOIL_SPEED,
      );

      // 脱手瞬间再取脚底，与前摇期间位移一致
      const release = getPlayerWorld();
      const origin = player.getThrowOrigin(release.x, release.y);
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
        this.applyBombBlast(bomb, world);
      }

      if (phase === 'done') {
        this.sortLayer.removeChild(bomb);
        bomb.destroy({ children: true });
        this.bombs.splice(i, 1);
      }
    }
  }

  /**
   * 直线长矛：飞行中检测蜘蛛 / 停场角色；撞墙由投射物内部处理。
   * 停场角色：击飞 + 姿态，不扣血。
   */
  private updateSpears(deltaMS: number, world: CombatWorld): void {
    let needSync = false;

    for (let i = this.spears.length - 1; i >= 0; i--) {
      const spear = this.spears[i]!;
      let phase = spear.update(deltaMS);

      if (phase === 'flying') {
        let stuck = false;

        for (let s = world.spiders.length - 1; s >= 0; s--) {
          const spider = world.spiders[s]!;
          if (!spider.isAlive) continue;
          if (!spear.hitsTarget(spider.worldX, spider.worldY, SPIDER_HURT_R)) {
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
          stuck = true;
          break;
        }

        if (!stuck) {
          for (const parked of world.parked) {
            if (
              !spear.hitsTarget(
                parked.worldX,
                parked.worldY,
                PLAYER_HURT_R,
              )
            ) {
              continue;
            }
            const hit = spear.buildHit();
            this.applyParkedHitFx(parked, hit, 1);
            spear.stick();
            phase = spear.getPhase();
            needSync = true;
            break;
          }
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
   * 玩家 / 停场：击飞 / 姿态，不扣血；蜘蛛可死亡。
   */
  private applyBombBlast(bomb: BombProjectile, world: CombatWorld): void {
    const player = world.player;
    if (player) {
      const face = player.entity.facingDir;
      const playerHit = bomb.evaluateHit(
        player.worldX,
        player.worldY,
        face,
        PLAYER_HURT_R,
      );
      if (playerHit) {
        applyKnockImpulse(
          player.knock,
          playerHit.knockVelX,
          playerHit.knockVelY,
        );
        player.entity.playBlastKnock(
          playerHit.poseStrength,
          playerHit.dirX,
          playerHit.airSpinTurns,
        );
      }
    }

    let anyFx = false;
    for (const parked of world.parked) {
      const hit = bomb.evaluateHit(
        parked.worldX,
        parked.worldY,
        parked.worldX >= bomb.groundX ? 1 : -1,
        PLAYER_HURT_R,
      );
      if (!hit) continue;
      this.applyParkedHitFx(parked, hit, 1);
      anyFx = true;
    }

    for (let i = world.spiders.length - 1; i >= 0; i--) {
      const spider = world.spiders[i]!;
      if (!spider.isAlive) continue;

      const hit = bomb.evaluateHit(
        spider.worldX,
        spider.worldY,
        spider.worldX >= bomb.groundX ? 1 : -1,
        SPIDER_HURT_R,
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

  private applyParkedHitFx(
    parked: CombatParkedTarget,
    hit: {
      knockVelX: number;
      knockVelY: number;
      dirX: number;
      poseStrength: number;
      airSpinTurns?: number;
    },
    knockScale = 1,
  ): void {
    applyKnockImpulse(
      parked.knock,
      hit.knockVelX,
      hit.knockVelY,
      knockScale,
    );
    parked.entity.playBlastKnock(
      hit.poseStrength,
      hit.dirX,
      hit.airSpinTurns ?? 0,
    );
  }

  private removeSpider(world: CombatWorld, index: number): void {
    const spider = world.spiders[index];
    if (!spider) return;
    this.sortLayer.removeChild(spider);
    spider.destroy({ children: true });
    world.spiders.splice(index, 1);
  }
}
