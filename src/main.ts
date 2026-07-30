import * as THREE from 'three';
import { CameraController } from './controls/CameraController';
import { MainScene } from './scenes/MainScene';
import {
  loadGameSettings,
  saveGameSettings,
  type GameSettingsSnapshot,
} from './storage/gameSettings';
import { EscMenu } from './ui/EscMenu';
import { ScreenBrightness } from './ui/ScreenBrightness';

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
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  host.appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 1000);
  camera.position.set(8, 10, 12);
  camera.lookAt(0, 0, 0);

  const scene = new MainScene();

  const controls = new CameraController(camera, renderer.domElement, {
    moveSpeed: 1.8,
    lookSpeed: 0.002,
  });
  controls.setFollowTarget(scene.hero);

  // 从本地恢复设置
  const settings: GameSettingsSnapshot = loadGameSettings();
  scene.setAxesVisible(settings.showAxes);
  scene.setColliderMarkersVisible(settings.showColliderMarkers);
  controls.setViewMode(settings.cameraLocked ? 'locked' : 'free');

  // 全局亮度压暗层（主场景后、设置面板前）
  const screenBrightness = new ScreenBrightness();
  screenBrightness.setSize(width, height);
  applyBrightnessUi(screenBrightness, settings.brightnessUi);

  const persistSettings = (patch: Partial<GameSettingsSnapshot>): void => {
    if (patch.showAxes !== undefined) settings.showAxes = patch.showAxes;
    if (patch.showColliderMarkers !== undefined) {
      settings.showColliderMarkers = patch.showColliderMarkers;
    }
    if (patch.brightnessUi !== undefined) {
      settings.brightnessUi = patch.brightnessUi;
    }
    if (patch.cameraLocked !== undefined) {
      settings.cameraLocked = patch.cameraLocked;
    }
    saveGameSettings(settings);
  };

  // ESC 设置面板：游戏内 HUD（正交场景 + Canvas 纹理）
  const escMenu = new EscMenu(renderer.domElement, {
    initialAxesVisible: settings.showAxes,
    initialColliderMarkersVisible: settings.showColliderMarkers,
    initialBrightness: settings.brightnessUi,
    initialCameraLocked: settings.cameraLocked,
    onAxesChange: (visible) => {
      scene.setAxesVisible(visible);
      persistSettings({ showAxes: visible });
    },
    onColliderMarkersChange: (visible) => {
      scene.setColliderMarkersVisible(visible);
      persistSettings({ showColliderMarkers: visible });
    },
    onSkipTime: (gameSeconds, realSeconds) =>
      scene.skipTime(gameSeconds, realSeconds),
    onBrightnessChange: (ui01) => {
      applyBrightnessUi(screenBrightness, ui01);
      persistSettings({ brightnessUi: ui01 });
    },
    onCameraLockChange: (locked) => {
      controls.setViewMode(locked ? 'locked' : 'free');
      persistSettings({ cameraLocked: locked });
    },
    onOpenChange: (open) => controls.setEnabled(!open),
  });
  escMenu.setSize(width, height);

  // 锁定视角：右键点地板 → 英雄移动
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const hitPoint = new THREE.Vector3();

  const onPointerDownMove = (e: PointerEvent): void => {
    if (e.button !== 2) return;
    if (escMenu.isOpen || !controls.isLocked) return;
    e.preventDefault();

    const rect = renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    pointerNdc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -(((e.clientY - rect.top) / rect.height) * 2 - 1),
    );
    raycaster.setFromCamera(pointerNdc, camera);
    if (!raycaster.ray.intersectPlane(groundPlane, hitPoint)) return;
    scene.commandHeroMoveTo(hitPoint.x, hitPoint.z);
  };

  renderer.domElement.addEventListener('pointerdown', onPointerDownMove);

  const onResize = (): void => {
    const { width: w, height: h } = getSize();
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    scene.resize(w, h);
    screenBrightness.setSize(w, h);
    escMenu.setSize(w, h);
  };

  window.addEventListener('resize', onResize);

  const clock = new THREE.Clock();

  const tick = (): void => {
    requestAnimationFrame(tick);
    const delta = clock.getDelta();

    // 先推进场景（英雄位移），再跟随镜头
    scene.update(delta);
    controls.update(delta);

    renderer.render(scene, camera);
    // 压暗世界画面，设置面板保持清晰可读
    screenBrightness.render(renderer);
    escMenu.render(renderer);
  };

  tick();
}

/** 滑条 0~1 → 实际亮度区间 */
function applyBrightnessUi(
  screenBrightness: ScreenBrightness,
  ui01: number,
): void {
  const { MIN, MAX } = ScreenBrightness;
  const t = Number.isFinite(ui01) ? Math.min(1, Math.max(0, ui01)) : 1;
  screenBrightness.setBrightness(MIN + t * (MAX - MIN));
}

try {
  bootstrap();
} catch (err) {
  console.error('Failed to start game:', err);
}
