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
    scenes.update(ticker.deltaMS);
  });

  app.renderer.on('resize', () => {
    scenes.resize(app.screen.width, app.screen.height);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start game:', err);
});
