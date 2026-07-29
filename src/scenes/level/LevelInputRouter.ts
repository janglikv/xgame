import type { EntranceContext } from '../../entities/CharacterEntrance';
import type { PlayerCharacterBase } from '../../entities/PlayerCharacterBase';
import type { InputManager } from '../../input/InputManager';
import type { CombatSystem } from '../../systems/CombatSystem';
import type { GodModeController } from '../../systems/GodModeController';
import type { HarvestWorld } from '../../systems/HarvestWorld';
import type { LevelCamera } from '../LevelCamera';

export type LevelPointerState = {
  screenX: number;
  screenY: number;
  seen: boolean;
};

export type LevelInputRouterDeps = {
  input: InputManager;
  camera: LevelCamera;
  combat: CombatSystem;
  harvest: HarvestWorld;
  god: GodModeController;
  getPlayer: () => PlayerCharacterBase | null;
  isPaused: () => boolean;
  setPaused: (value: boolean) => void;
  setGodMode: (on: boolean) => void;
  entranceContext: () => EntranceContext;
  syncWorldActors: () => void;
  applyPlayerSolid: (fromX: number, fromY: number) => void;
};

/**
 * 关卡输入路由：模式键、技能键、缩放、指针与滚轮。
 * 发出意图并调用已有系统，不承载帧模拟。
 */
export class LevelInputRouter {
  private readonly deps: LevelInputRouterDeps;

  private pointerScreenX = 0;
  private pointerScreenY = 0;
  private pointerSeen = false;

  constructor(deps: LevelInputRouterDeps) {
    this.deps = deps;
  }

  get pointer(): LevelPointerState {
    return {
      screenX: this.pointerScreenX,
      screenY: this.pointerScreenY,
      seen: this.pointerSeen,
    };
  }

  /** Esc / G / 技能 / 缩放 */
  poll(dt: number): void {
    this.pollModeKeys();
    this.pollAbilityKeys();
    this.handleZoomKeys(dt);
  }

  readonly onWheel = (e: WheelEvent): void => {
    if (this.deps.isPaused()) return;
    e.preventDefault();
    this.deps.camera.applyWheel(e.deltaY);
  };

  readonly onPointerMove = (e: {
    global: { x: number; y: number };
  }): void => {
    this.pointerScreenX = e.global.x;
    this.pointerScreenY = e.global.y;
    this.pointerSeen = true;
  };

  readonly onPointerTap = (e: {
    global: { x: number; y: number };
  }): void => {
    this.pointerScreenX = e.global.x;
    this.pointerScreenY = e.global.y;
    this.pointerSeen = true;
    if (this.deps.isPaused()) return;

    const { god, combat, camera, getPlayer } = this.deps;
    if (god.enabled) {
      god.handleClick(e.global.x, e.global.y);
      return;
    }

    const player = getPlayer();
    if (!player) return;
    if (player.entranceLocks.attack) return;
    combat.tryRangedAtScreen(player, e.global.x, e.global.y, {
      x: camera.x,
      y: camera.y,
      zoom: camera.currentZoom,
      width: camera.width,
      height: camera.height,
    });
  };

  /** Esc / G */
  private pollModeKeys(): void {
    const { input, isPaused, setPaused, setGodMode, god } = this.deps;
    if (input.pressed('Escape', input.isDown('Escape'))) {
      setPaused(!isPaused());
    }
    if (input.pressed('KeyG', input.isDown('KeyG'))) {
      setGodMode(!god.enabled);
    }
  }

  /** Q 特技 / E 闪现 / R 砍树 */
  private pollAbilityKeys(): void {
    const {
      input,
      isPaused,
      god,
      getPlayer,
      combat,
      harvest,
      entranceContext,
      syncWorldActors,
      applyPlayerSolid,
    } = this.deps;

    if (isPaused() || god.enabled) {
      // 仍推进边沿状态，避免退出暂停/上帝后连发
      input.pressed('KeyQ', input.isDown('KeyQ'));
      input.pressed('KeyE', input.isDown('KeyE'));
      input.pressed('KeyR', input.isDown('KeyR'));
      return;
    }

    const p = getPlayer();
    if (
      input.pressed('KeyQ', input.isDown('KeyQ')) &&
      p &&
      !p.entranceLocks.attack
    ) {
      const aim = this.aimFromPointer(p);
      if (
        p.trySpecialAbility(
          combat.rangedServices(),
          entranceContext(),
          aim ?? undefined,
        )
      ) {
        syncWorldActors();
      }
    }

    if (
      input.pressed('KeyE', input.isDown('KeyE')) &&
      p &&
      !p.entranceLocks.move
    ) {
      const fromX = p.worldX;
      const fromY = p.worldY;
      const aim = this.aimFromPointer(p);
      if (p.tryMobilityAbility(entranceContext(), aim ?? undefined)) {
        applyPlayerSolid(fromX, fromY);
        syncWorldActors();
      }
    }

    if (input.pressed('KeyR', input.isDown('KeyR')) && p) {
      harvest.tryMelee(p);
    }
  }

  private aimFromPointer(player: PlayerCharacterBase) {
    if (!this.pointerSeen) return null;
    const { combat, camera } = this.deps;
    return combat.aimFromScreen(
      player.worldX,
      player.worldY,
      this.pointerScreenX,
      this.pointerScreenY,
      {
        x: camera.x,
        y: camera.y,
        zoom: camera.currentZoom,
        width: camera.width,
        height: camera.height,
      },
    );
  }

  private handleZoomKeys(dt: number): void {
    const { input, camera } = this.deps;
    // 合成键名：多物理键映射同一动作时只计一次边沿
    const fitDown = input.isDown('KeyF') || input.isDown('KeyM');
    if (input.pressed('__fitOverview', fitDown)) {
      camera.fitOverview();
    }

    const resetDown =
      input.isDown('Digit0') || input.isDown('Numpad0');
    if (input.pressed('__resetZoom', resetDown)) {
      camera.resetZoom();
    }

    const zoomIn =
      input.isDown('Equal') || input.isDown('NumpadAdd');
    const zoomOut =
      input.isDown('Minus') || input.isDown('NumpadSubtract');
    camera.applyZoomKeyHold(zoomIn, zoomOut, dt);
  }
}
