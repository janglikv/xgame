import { Application } from 'pixi.js';
import {
  getPlayableLevelById,
  loadMapDraftsFromStorage,
  LEVEL_1,
  setActiveMapDef,
  type LevelMapDef,
} from './data/maps';
import { LocalSaveStore } from './data/SaveStore';
import type { SavedScene } from './data/types';
import type { CharacterId } from './entities/types';
import { BodyEditScene } from './scenes/BodyEditScene';
import { LevelScene } from './scenes/LevelScene';
import { MainScene } from './scenes/MainScene';
import { SceneManager } from './scenes/SceneManager';
import { FpsHud } from './ui/FpsHud';
import { TimeScaleConfig } from './utils/TimeScaleConfig';

async function bootstrap(): Promise<void> {
  const host = document.getElementById('app');
  if (!host) {
    throw new Error('#app container not found');
  }

  loadMapDraftsFromStorage();

  const app = new Application();

  await app.init({
    resizeTo: host,
    background: 0x0b1524,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
  });

  host.appendChild(app.canvas);

  const saveStore = new LocalSaveStore();

  const setBackground = (color: number): void => {
    app.renderer.background.color = color;
    document.body.style.background = `#${color.toString(16).padStart(6, '0')}`;
  };

  const scenes = new SceneManager(app.stage, () => ({
    width: app.screen.width,
    height: app.screen.height,
  }));

  // 全局 HUD：左上角 FPS（挂在 stage 最上，跨场景常驻）
  const fpsHud = new FpsHud();
  app.stage.addChild(fpsHud);

  const persistScene = (scene: SavedScene): void => {
    saveStore.saveScene(scene);
  };

  const levelOptions = (mapDef: LevelMapDef) => ({
    mapDef,
    onBack: goMain,
    onBackground: setBackground,
    getLastCharacter: () => saveStore.getLastCharacter(),
    setLastCharacter: (id: CharacterId) => saveStore.saveLastCharacter(id),
  });

  const goMain = (): void => {
    persistScene({ kind: 'main' });
    void scenes.setScene(
      () =>
        new MainScene(app.screen.width, app.screen.height, {
          onSelectLevel: goLevel,
          onBodyEdit: () => goBodyEdit(),
          onBackground: setBackground,
        }),
    );
  };

  const goBodyEdit = (): void => {
    void scenes.setScene(
      () =>
        new BodyEditScene(app.screen.width, app.screen.height, {
          onBack: goMain,
          onBackground: setBackground,
        }),
    );
  };

  const goLevel = (mapDef: LevelMapDef): void => {
    const playable = getPlayableLevelById(mapDef.id) ?? mapDef;
    setActiveMapDef(playable);
    persistScene({ kind: 'level', levelId: playable.id });
    void scenes.setScene(
      () =>
        new LevelScene(
          app.screen.width,
          app.screen.height,
          levelOptions(playable),
        ),
    );
  };

  /** 按存档恢复上次场景；损坏 / 无档则进主菜单 */
  const bootScene = saveStore.load().progress.scene;
  if (bootScene.kind === 'level') {
    const map =
      getPlayableLevelById(bootScene.levelId) ??
      getPlayableLevelById(LEVEL_1.id) ??
      LEVEL_1;
    await scenes.setScene(
      () =>
        new LevelScene(
          app.screen.width,
          app.screen.height,
          levelOptions(map),
        ),
    );
  } else {
    await scenes.setScene(
      () =>
        new MainScene(app.screen.width, app.screen.height, {
          onSelectLevel: goLevel,
          onBodyEdit: () => goBodyEdit(),
          onBackground: setBackground,
        }),
    );
  }

  app.ticker.add((ticker) => {
    const scale = TimeScaleConfig.getScale();
    scenes.update(ticker.deltaMS * scale);
    // FPS 用真实帧时间，不受游戏倍速影响
    fpsHud.update(ticker.deltaMS, ticker.FPS);
    // 确保始终画在最上层（场景切换后可能被盖住）
    if (app.stage.children[app.stage.children.length - 1] !== fpsHud) {
      app.stage.setChildIndex(fpsHud, app.stage.children.length - 1);
    }
  });

  app.renderer.on('resize', () => {
    scenes.resize(app.screen.width, app.screen.height);
    fpsHud.layout(app.screen.width, app.screen.height);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start game:', err);
});
