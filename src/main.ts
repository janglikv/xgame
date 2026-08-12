import { GameApp } from './app/GameApp';

async function main(): Promise<void> {
  const container = document.getElementById('app');
  if (!container) {
    throw new Error('#app element not found');
  }
  const app = new GameApp();
  await app.start(container);
}

main().catch((err) => {
  console.error('Failed to start game:', err);
});
