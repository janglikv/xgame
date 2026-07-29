import * as THREE from 'three';
import { CameraController } from './controls/CameraController';
import { MainScene } from './scenes/MainScene';

function bootstrap(): void {
  const host = document.getElementById('app');
  if (!host) {
    throw new Error('#app container not found');
  }

  const getSize = (): { width: number; height: number } => ({
    width: Math.max(host.clientWidth || window.innerWidth, 1),
    height: Math.max(host.clientHeight || window.innerHeight, 1),
  });

  const { width, height } = getSize();

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height);
  renderer.setClearColor(0x0b0f14, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  host.appendChild(renderer.domElement);

  // 俯视一点，保证能看到整块底板
  const camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 1000);
  camera.position.set(8, 10, 12);
  camera.lookAt(0, 0, 0);

  const scene = new MainScene();
  const controls = new CameraController(camera, renderer.domElement, {
    moveSpeed: 12,
    lookSpeed: 0.002,
  });

  const onResize = (): void => {
    const { width: w, height: h } = getSize();
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    scene.resize(w, h);
  };

  window.addEventListener('resize', onResize);

  const clock = new THREE.Clock();

  const tick = (): void => {
    requestAnimationFrame(tick);
    const delta = clock.getDelta();
    controls.update(delta);
    scene.update(delta);
    renderer.render(scene, camera);
  };

  tick();
}

try {
  bootstrap();
} catch (err) {
  console.error('Failed to start game:', err);
}
