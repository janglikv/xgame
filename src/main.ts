import * as THREE from 'three';
import { CameraController } from './controls/CameraController';
import { MainScene } from './scenes/MainScene';
import { PropertyPanel } from './ui/PropertyPanel';

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

  const camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 1000);
  camera.position.set(8, 10, 12);
  camera.lookAt(0, 0, 0);

  const scene = new MainScene();
  const propertyPanel = new PropertyPanel();
  propertyPanel.resize(width, height);

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
    propertyPanel.resize(w, h);
  };

  window.addEventListener('resize', onResize);

  const clock = new THREE.Clock();
  const lookDir = new THREE.Vector3();
  let fps = 0;
  let fpsFrames = 0;
  let fpsTimer = 0;

  const tick = (): void => {
    requestAnimationFrame(tick);
    const delta = clock.getDelta();

    fpsFrames += 1;
    fpsTimer += delta;
    if (fpsTimer >= 0.5) {
      fps = fpsFrames / fpsTimer;
      fpsFrames = 0;
      fpsTimer = 0;
    }

    controls.update(delta);
    scene.update(delta);

    if (propertyPanel.isVisible) {
      camera.getWorldDirection(lookDir);
      const yawDeg = THREE.MathUtils.radToDeg(
        Math.atan2(-lookDir.x, -lookDir.z),
      );
      const pitchDeg = THREE.MathUtils.radToDeg(
        Math.asin(THREE.MathUtils.clamp(lookDir.y, -1, 1)),
      );

      propertyPanel.update({
        pos: camera.position,
        yawDeg,
        pitchDeg,
        pointerLocked: controls.isPointerLocked,
        fps,
      });
    }

    renderer.render(scene, camera);
    propertyPanel.render(renderer);
  };

  tick();
}

try {
  bootstrap();
} catch (err) {
  console.error('Failed to start game:', err);
}
