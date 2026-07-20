import { Application } from 'pixi.js';
import { EmptyScene } from './scenes/EmptyScene';

async function bootstrap(): Promise<void> {
  const host = document.getElementById('app');
  if (!host) {
    throw new Error('#app container not found');
  }

  const app = new Application();

  await app.init({
    resizeTo: host,
    background: 0x0b0f14,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
  });

  host.appendChild(app.canvas);

  const scene = new EmptyScene(app.screen.width, app.screen.height);
  app.stage.addChild(scene);
  await scene.init();

  app.renderer.on('resize', () => {
    scene.resize(app.screen.width, app.screen.height);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start game:', err);
});
