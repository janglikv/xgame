import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { CameraController } from './controls/CameraController';
import { MainScene } from './scenes/MainScene';
import {
  loadGameSettings,
  saveGameSettings,
  type GameSettingsSnapshot,
} from './storage/gameSettings';
import { EscMenu } from './ui/EscMenu';
import { preloadGameCursors, setGameCursor } from './ui/GameCursor';
import { ScreenBrightness } from './ui/ScreenBrightness';
import { SkillBar } from './ui/SkillBar';

/** 防御塔悬停：屏幕空间整体外轮廓（深红） */
const TOWER_OUTLINE_COLOR = 0x8b0000;

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
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height);
  renderer.setClearColor(0x0b0f14, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  host.appendChild(renderer.domElement);
  void preloadGameCursors().then(() => {
    setGameCursor(renderer.domElement, 'default');
    setGameCursor(document.body, 'default');
  });
  setGameCursor(renderer.domElement, 'default');
  setGameCursor(document.body, 'default');

  const camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 1000);
  camera.position.set(8, 10, 12);
  camera.lookAt(0, 0, 0);

  const scene = new MainScene();

  // 方案 1：后处理屏幕空间 silhouette 描边（整塔外轮廓，非零件级）
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(width, height);
  composer.addPass(new RenderPass(scene, camera));

  const outlinePass = new OutlinePass(
    new THREE.Vector2(width * pixelRatio, height * pixelRatio),
    scene,
    camera,
  );
  outlinePass.edgeStrength = 5;
  outlinePass.edgeGlow = 0;
  outlinePass.edgeThickness = 2;
  outlinePass.pulsePeriod = 0;
  outlinePass.visibleEdgeColor.set(TOWER_OUTLINE_COLOR);
  outlinePass.hiddenEdgeColor.set(TOWER_OUTLINE_COLOR);
  outlinePass.enabled = false;
  composer.addPass(outlinePass);
  composer.addPass(new OutputPass());

  let lastOutlineRoot: THREE.Object3D | null = null;
  const syncTowerOutline = (): void => {
    const root = scene.getHoverOutlineRoot();
    if (root === lastOutlineRoot) return;
    lastOutlineRoot = root;
    if (root) {
      outlinePass.selectedObjects = [root];
      outlinePass.enabled = true;
    } else {
      outlinePass.selectedObjects = [];
      outlinePass.enabled = false;
    }
  };

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
  escMenu.setSize(width, height);

  // 底部技能栏 QWER（E = 枪林弹雨）
  const skillBar = new SkillBar({
    isInputBlocked: () => escMenu.isOpen,
    onSkillPress: (slot) => {
      if (slot === 'E') {
        scene.beginHeroSkillE();
        skillBar.setTargeting(scene.skillTargetingSlot);
        refreshGameplayCursor();
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
        refreshGameplayCursor(e.clientX, e.clientY);
        return;
      }
      if (e.button === 0) {
        e.preventDefault();
        if (!pickGround(e.clientX, e.clientY)) return;
        scene.confirmSkillTarget(hitPoint.x, hitPoint.z);
        skillBar.setTargeting(null);
        refreshGameplayCursor(e.clientX, e.clientY);
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

  const updatePointerNdc = (clientX: number, clientY: number): boolean => {
    const rect = renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    pointerNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    );
    raycaster.setFromCamera(pointerNdc, camera);
    return true;
  };

  /** 两态指针：可攻击悬停（塔=红描边同源）→ 短剑，其余 → 小手 */
  const refreshGameplayCursor = (clientX?: number, clientY?: number): void => {
    if (escMenu.isOpen) {
      setGameCursor(renderer.domElement, 'default');
      return;
    }

    if (clientX === undefined || clientY === undefined) {
      setGameCursor(renderer.domElement, 'default');
      return;
    }

    if (!updatePointerNdc(clientX, clientY)) {
      setGameCursor(renderer.domElement, 'default');
      return;
    }
    const hasGround =
      raycaster.ray.intersectPlane(groundPlane, hitPoint) != null;
    // 须在 setTowerHover 之后调用：塔的攻击指针与红描边共用 hoveredTower
    const target = scene.pickAttackHover(
      raycaster,
      hasGround ? hitPoint.x : undefined,
      hasGround ? hitPoint.z : undefined,
    );

    setGameCursor(renderer.domElement, target ? 'attack' : 'default');
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (escMenu.isOpen) {
      scene.setTowerHover(null);
      syncTowerOutline();
      setGameCursor(renderer.domElement, 'default');
      return;
    }

    if (!updatePointerNdc(e.clientX, e.clientY)) return;

    // 敌方完整塔 fullModel 命中 → 红描边；攻击指针与此同源
    scene.setTowerHover(scene.pickTowerAtRay(raycaster));
    syncTowerOutline();

    // 技能选点：同步地面瞄准点
    if (scene.isSkillTargeting) {
      if (raycaster.ray.intersectPlane(groundPlane, hitPoint) != null) {
        scene.updateSkillTargeting(hitPoint.x, hitPoint.z);
      }
    }

    refreshGameplayCursor(e.clientX, e.clientY);
  };

  const onPointerLeave = (): void => {
    scene.setTowerHover(null);
    syncTowerOutline();
    setGameCursor(renderer.domElement, 'default');
  };

  renderer.domElement.addEventListener('pointerdown', onPointerDownCommand);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerleave', onPointerLeave);
  renderer.domElement.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });

  const onResize = (): void => {
    const { width: w, height: h } = getSize();
    const pr = Math.min(window.devicePixelRatio || 1, 2);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h);
    composer.setPixelRatio(pr);
    composer.setSize(w, h);
    outlinePass.resolution.set(w * pr, h * pr);
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
    // 塔被摧毁等逻辑可能清掉悬停，与 OutlinePass 同步
    syncTowerOutline();

    skillBar.setCooldown(
      'E',
      scene.hero.eCooldownRemaining,
      scene.hero.eCooldownTotal,
    );
    skillBar.setTargeting(scene.skillTargetingSlot);
    skillBar.setHp(scene.hero.hp, scene.hero.maxHp);

    composer.render();
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
