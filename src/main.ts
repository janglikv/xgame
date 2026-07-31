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
import { SkillBar } from './ui/SkillBar';

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
  if (settings.fixedCamera) {
    controls.setFixedCamera(true);
  }
  scene.setHeroInvincible(settings.godMode);
  scene.setMinionSpawnEnabled(settings.minionSpawn);
  scene.setTowerInvincible(settings.towerInvincible);

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
    if (patch.fixedCamera !== undefined) {
      settings.fixedCamera = patch.fixedCamera;
    }
    if (patch.godMode !== undefined) {
      settings.godMode = patch.godMode;
    }
    if (patch.minionSpawn !== undefined) {
      settings.minionSpawn = patch.minionSpawn;
    }
    if (patch.towerInvincible !== undefined) {
      settings.towerInvincible = patch.towerInvincible;
    }
    saveGameSettings(settings);
  };

  // ESC 设置面板：游戏内 HUD（正交场景 + Canvas 纹理）
  const escMenu = new EscMenu(renderer.domElement, {
    getCameraParams: () => controls.getParams(),
    initialAxesVisible: settings.showAxes,
    initialColliderMarkersVisible: settings.showColliderMarkers,
    initialBrightness: settings.brightnessUi,
    initialCameraLocked: settings.cameraLocked,
    initialFixedCamera: settings.fixedCamera,
    initialGodMode: settings.godMode,
    initialMinionSpawn: settings.minionSpawn,
    initialTowerInvincible: settings.towerInvincible,
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
      if (!locked) {
        controls.setFixedCamera(false);
        persistSettings({ cameraLocked: false, fixedCamera: false });
      } else {
        persistSettings({ cameraLocked: true });
      }
    },
    onFixedCameraChange: (fixed) => {
      controls.setFixedCamera(fixed);
      if (fixed) {
        persistSettings({ fixedCamera: true, cameraLocked: true });
      } else {
        persistSettings({ fixedCamera: false });
      }
    },
    onGodModeChange: (god) => {
      scene.setHeroInvincible(god);
      persistSettings({ godMode: god });
    },
    onMinionSpawnChange: (spawn) => {
      scene.setMinionSpawnEnabled(spawn);
      persistSettings({ minionSpawn: spawn });
    },
    onTowerInvincibleChange: (invincible) => {
      scene.setTowerInvincible(invincible);
      persistSettings({ towerInvincible: invincible });
    },
    onOpenChange: (open) => {
      controls.setEnabled(!open);
      if (open) {
        scene.cancelSkillTargeting();
        skillBar.setTargeting(null);
      }
    },
  });

  // 底部技能栏 QWER（E = 枪林弹雨）
  const skillBar = new SkillBar({
    isInputBlocked: () => escMenu.isOpen,
    onSkillPress: (slot) => {
      if (slot === 'E') {
        scene.beginHeroSkillE();
        skillBar.setTargeting(scene.skillTargetingSlot);
      }
    },
  });
  skillBar.setSize(width, height);

  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const hitPoint = new THREE.Vector3();
  const wasdWish = new THREE.Vector3();

  const pickGround = (clientX: number, clientY: number): boolean => {
    const rect = renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    pointerNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    );
    raycaster.setFromCamera(pointerNdc, camera);
    return raycaster.ray.intersectPlane(groundPlane, hitPoint) != null;
  };

  const onPointerDownCommand = (e: PointerEvent): void => {
    if (escMenu.isOpen) return;

    if (scene.isSkillTargeting) {
      if (e.button === 2) {
        e.preventDefault();
        scene.cancelSkillTargeting();
        skillBar.setTargeting(null);
        return;
      }
      if (e.button === 0) {
        e.preventDefault();
        if (!pickGround(e.clientX, e.clientY)) return;
        scene.confirmSkillTarget(hitPoint.x, hitPoint.z);
        skillBar.setTargeting(null);
        return;
      }
      return;
    }

    if (e.button === 2) {
      e.preventDefault();
      if (!pickGround(e.clientX, e.clientY)) return;
      scene.commandHeroMoveTo(hitPoint.x, hitPoint.z);
      return;
    }

    if (e.button === 0) {
      if (!pickGround(e.clientX, e.clientY)) return;

      let enemy = scene.pickEnemyNear(hitPoint.x, hitPoint.z, 0.6);
      if (!enemy) {
        enemy = scene.pickEnemyNear(hitPoint.x, hitPoint.z, 2.5);
      }
      if (!enemy) {
        enemy = scene.findClosestEnemy(hitPoint.x, hitPoint.z);
      }

      if (enemy) {
        scene.commandHeroAttack(enemy);
      }
      return;
    }
  };

  const onPointerMoveTargeting = (e: PointerEvent): void => {
    if (escMenu.isOpen || !scene.isSkillTargeting) return;
    if (!pickGround(e.clientX, e.clientY)) return;
    scene.updateSkillTargeting(hitPoint.x, hitPoint.z);
  };

  renderer.domElement.addEventListener('pointerdown', onPointerDownCommand);
  renderer.domElement.addEventListener('pointermove', onPointerMoveTargeting);
  renderer.domElement.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });

  const onResize = (): void => {
    const { width: w, height: h } = getSize();
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    scene.resize(w, h);
    screenBrightness.setSize(w, h);
    escMenu.setSize(w, h);
    skillBar.setSize(w, h);
  };

  window.addEventListener('resize', onResize);

  const clock = new THREE.Clock();

  const tick = (): void => {
    requestAnimationFrame(tick);
    const delta = Math.min(clock.getDelta(), 1 / 20);

    if (controls.isLocked) {
      controls.getWasdWishXZ(wasdWish);
      scene.commandHeroMoveInput(wasdWish.x, wasdWish.z);
    } else {
      scene.commandHeroMoveInput(0, 0);
    }

    scene.update(delta);
    controls.update(delta);

    skillBar.setCooldown(
      'E',
      scene.hero.eCooldownRemaining,
      scene.hero.eCooldownTotal,
    );
    skillBar.setTargeting(scene.skillTargetingSlot);
    skillBar.setHp(scene.hero.hp, scene.hero.maxHp);

    renderer.render(scene, camera);
    // 压暗世界画面，设置面板保持清晰可读
    screenBrightness.render(renderer);
    skillBar.render(renderer);
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
