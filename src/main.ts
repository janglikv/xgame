import { Application } from 'pixi.js';
import { LocalSaveStore } from './data/SaveStore';
import type { SavedScene } from './data/types';
import { LevelScene } from './scenes/LevelScene';
import { MainScene } from './scenes/MainScene';
import { SceneManager } from './scenes/SceneManager';
import type { LevelTheme } from './scenes/types';

async function bootstrap(): Promise<void> {
  const host = document.getElementById('app');
  if (!host) {
    throw new Error('#app container not found');
  }

  const app = new Application();

  await app.init({
    resizeTo: host,
    background: 0x5a8f3c,
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

  const goMain = (): void => {
    persistScene({ kind: 'main' });
    void scenes.setScene(
      () =>
        new MainScene(app.screen.width, app.screen.height, {
          onSelectLevel: goLevel,
          onBackground: setBackground,
        }),
    );
  };

  const goLevel = (theme: LevelTheme): void => {
    persistScene({ kind: 'level', theme });
    void scenes.setScene(
      () =>
        new LevelScene(app.screen.width, app.screen.height, {
          theme,
          onBack: goMain,
          onBackground: setBackground,
        }),
    );
  };

  /** 按存档恢复上次场景；损坏 / 无档则进主菜单 */
  const bootScene = saveStore.load().progress.scene;
  if (bootScene.kind === 'level') {
    await scenes.setScene(
      () =>
        new LevelScene(app.screen.width, app.screen.height, {
          theme: bootScene.theme,
          onBack: goMain,
          onBackground: setBackground,
        }),
    );
  } else {
    await scenes.setScene(
      () =>
        new MainScene(app.screen.width, app.screen.height, {
          onSelectLevel: goLevel,
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
