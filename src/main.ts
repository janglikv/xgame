import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { getGameAudio } from './audio/GameAudio';
import { CameraController } from './controls/CameraController';
import { MainScene } from './scenes/MainScene';
import { clearCameraState } from './storage/cameraState';
import {
  clearGameSettings,
  loadGameSettings,
  saveGameSettings,
  type GameSettingsSnapshot,
} from './storage/gameSettings';
import { EscMenu } from './ui/EscMenu';
import { FpsOverlay } from './ui/FpsOverlay';
import { preloadGameCursors, setGameCursor } from './ui/GameCursor';
import { ScreenBrightness } from './ui/ScreenBrightness';
import { SkillBar } from './ui/SkillBar';
import { StartOverlay } from './ui/StartOverlay';
import { VictoryOverlay } from './ui/VictoryOverlay';

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
  // 预编译残骸模型材质，避免首座防御塔摧毁时 GPU hitch
  scene.warmUpGpu(renderer, camera);

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
  /** 同步 OutlinePass：敌方塔 / 小兵悬停红描边 */
  const syncHoverOutline = (): void => {
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
  /** 开局暂停：点击播放后才推进逻辑与接受操作 */
  let gameStarted = false;
  controls.setEnabled(false);

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

  // 音频：程序化 SFX；须用户手势后 unlock（浏览器策略）
  const audio = getGameAudio();
  audio.setSfxVolume(settings.sfxVolume);
  const unlockAudio = (): void => {
    void audio.unlock().then(() => {
      if (!audio.isUnlocked) return;
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    });
  };
  window.addEventListener('pointerdown', unlockAudio);
  window.addEventListener('keydown', unlockAudio);

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
    if (patch.mouseControl !== undefined) {
      settings.mouseControl = patch.mouseControl;
    }
    if (patch.sfxVolume !== undefined) {
      settings.sfxVolume = patch.sfxVolume;
      audio.setSfxVolume(patch.sfxVolume);
    }
    if (patch.bgmVolume !== undefined) {
      settings.bgmVolume = patch.bgmVolume;
      audio.setBgmVolume(patch.bgmVolume);
    }
    saveGameSettings(settings);
  };

  // 初始同步音量与 BGM
  audio.setSfxVolume(settings.sfxVolume);
  audio.setBgmVolume(settings.bgmVolume);

  // 胜负结算 HUD（须在 EscMenu / SkillBar 之前创建，供闭包引用）
  const victoryOverlay = new VictoryOverlay();
  victoryOverlay.setSize(width, height);

  // 开局暂停 HUD：点击播放后才开始对局
  const startOverlay = new StartOverlay(renderer.domElement, {
    onStart: () => {
      if (gameStarted) return;
      gameStarted = true;
      // 丢掉暂停期间积累的 delta，避免首帧跳变
      clock.getDelta();
      controls.setEnabled(!escMenu.isOpen && !victoryOverlay.isVisible);
      void audio.unlock();
      scene.clearAttackHover();
      syncHoverOutline();
      setGameCursor(renderer.domElement, 'default');
    },
  });
  startOverlay.setSize(width, height);

  // ESC 设置面板：游戏内 HUD（正交场景 + Canvas 纹理）
  const escMenu = new EscMenu(renderer.domElement, {
    getCameraParams: () => controls.getParams(),
    initialAxesVisible: settings.showAxes,
    initialColliderMarkersVisible: settings.showColliderMarkers,
    initialBrightness: settings.brightnessUi,
    initialBgmVolume: settings.bgmVolume,
    initialSfxVolume: settings.sfxVolume,
    initialCameraLocked: settings.cameraLocked,
    initialFixedCamera: settings.fixedCamera,
    initialGodMode: settings.godMode,
    initialMinionSpawn: settings.minionSpawn,
    initialTowerInvincible: settings.towerInvincible,
    initialMouseControl: settings.mouseControl,
    onAxesChange: (visible) => {
      scene.setAxesVisible(visible);
      persistSettings({ showAxes: visible });
    },
    onColliderMarkersChange: (visible) => {
      scene.setColliderMarkersVisible(visible);
      persistSettings({ showColliderMarkers: visible });
    },
    onSkipTime: (gameSeconds, realSeconds) => {
      if (!gameStarted) return;
      scene.skipTime(gameSeconds, realSeconds);
    },
    onBrightnessChange: (ui01) => {
      applyBrightnessUi(screenBrightness, ui01);
      persistSettings({ brightnessUi: ui01 });
    },
    onBgmVolumeChange: (vol) => {
      audio.setBgmVolume(vol);
      persistSettings({ bgmVolume: vol });
    },
    onSfxVolumeChange: (vol) => {
      audio.setSfxVolume(vol);
      persistSettings({ sfxVolume: vol });
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
    initialFlashSkill: settings.flashSkillEnabled,
    onMouseControlChange: (mode) => {
      persistSettings({ mouseControl: mode });
    },
    onFlashSkillChange: (enabled) => {
      scene.setFlashSkillEnabled(enabled);
      persistSettings({ flashSkillEnabled: enabled });
    },
    onResetGame: () => {
      // 清空设置 / 相机等本地缓存，刷新页面以默认状态重新初始化
      clearGameSettings();
      clearCameraState();
      window.location.reload();
    },
    onOpenChange: (open) => {
      // 未开局 / 结算后始终保持相机禁用，避免关 ESC 又把操作加回来
      controls.setEnabled(
        gameStarted && !open && !victoryOverlay.isVisible,
      );
      audio.setBgmInMenu(open);
      if (open) {
        scene.cancelSkillTargeting();
        skillBar.setTargeting(null);
      }
    },
  });
  escMenu.setSize(width, height);

  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const hitPoint = new THREE.Vector3();
  const wasdWish = new THREE.Vector3();
  /** 最近一次指针对应的地面坐标（供 Q 选敌） */
  let lastPointerGroundX = 0;
  let lastPointerGroundZ = 0;
  let hasPointerGround = false;

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

  const rememberPointerGroundFromHit = (): void => {
    lastPointerGroundX = hitPoint.x;
    lastPointerGroundZ = hitPoint.z;
    hasPointerGround = true;
  };

  // 底部技能栏 QWER（Q/W/E/R）
  const skillBar = new SkillBar({
    isInputBlocked: () =>
      !gameStarted || escMenu.isOpen || victoryOverlay.isVisible,
    onSkillPress: (slot) => {
      if (slot === 'Q') {
        scene.beginHeroSkillQ(
          hasPointerGround
            ? { x: lastPointerGroundX, z: lastPointerGroundZ }
            : null,
        );
      } else if (slot === 'W') {
        scene.beginHeroSkillW();
      } else if (slot === 'E') {
        scene.beginHeroSkillE();
        skillBar.setTargeting(scene.skillTargetingSlot);
        refreshGameplayCursor();
      } else if (slot === 'R') {
        scene.beginHeroSkillR(
          hasPointerGround
            ? { x: lastPointerGroundX, z: lastPointerGroundZ }
            : null,
        );
      }
    },
  });
  skillBar.setSize(width, height);

  const onPointerDownCommand = (e: PointerEvent): void => {
    if (!gameStarted || escMenu.isOpen || victoryOverlay.isVisible) return;

    const mainBtn = settings.mouseControl === 'left' ? 0 : 2;
    const cancelBtn = settings.mouseControl === 'left' ? 2 : 0;

    if (scene.isSkillTargeting) {
      if (e.button === cancelBtn) {
        e.preventDefault();
        scene.cancelSkillTargeting();
        skillBar.setTargeting(null);
        refreshGameplayCursor(e.clientX, e.clientY);
        return;
      }
      if (e.button === mainBtn) {
        e.preventDefault();
        if (!pickGround(e.clientX, e.clientY)) return;
        scene.confirmSkillTarget(hitPoint.x, hitPoint.z);
        skillBar.setTargeting(null);
        refreshGameplayCursor(e.clientX, e.clientY);
        return;
      }
      return;
    }

    if (e.button === mainBtn) {
      e.preventDefault();
      if (!pickGround(e.clientX, e.clientY)) return;

      // 与攻击指针同源：先刷新悬停描边，仅当短剑态才攻击，否则点地移动
      // （不再用 pickEnemyNear 宽松兜底，避免点地板却被当成点附近小兵）
      scene.updateAttackHover(raycaster);
      syncHoverOutline();
      const enemy = scene.pickAttackHover(
        raycaster,
        hitPoint.x,
        hitPoint.z,
      );

      if (enemy) {
        scene.commandHeroAttack(enemy);
      } else {
        scene.commandHeroMoveTo(hitPoint.x, hitPoint.z);
      }
      refreshGameplayCursor(e.clientX, e.clientY);
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
    if (!gameStarted || escMenu.isOpen || victoryOverlay.isVisible) {
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
    // 须在 updateAttackHover 之后：塔/兵攻击指针与红描边同源
    const target = scene.pickAttackHover(
      raycaster,
      hasGround ? hitPoint.x : undefined,
      hasGround ? hitPoint.z : undefined,
    );

    setGameCursor(renderer.domElement, target ? 'attack' : 'default');
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (!gameStarted || escMenu.isOpen || victoryOverlay.isVisible) {
      scene.clearAttackHover();
      syncHoverOutline();
      setGameCursor(renderer.domElement, 'default');
      return;
    }

    if (!updatePointerNdc(e.clientX, e.clientY)) return;

    // 记录地面指针，供 Q 按「指针最近敌人」锁定
    if (raycaster.ray.intersectPlane(groundPlane, hitPoint) != null) {
      rememberPointerGroundFromHit();
    }

    // 敌方塔 fullModel / 小兵 bodyRoot → 红描边；攻击指针同源
    scene.updateAttackHover(raycaster);
    syncHoverOutline();

    // 技能选点：同步地面瞄准点
    if (scene.isSkillTargeting) {
      if (raycaster.ray.intersectPlane(groundPlane, hitPoint) != null) {
        scene.updateSkillTargeting(hitPoint.x, hitPoint.z);
      }
    }

    refreshGameplayCursor(e.clientX, e.clientY);
  };

  const onPointerLeave = (): void => {
    scene.clearAttackHover();
    syncHoverOutline();
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
    startOverlay.setSize(w, h);
    escMenu.setSize(w, h);
    skillBar.setSize(w, h);
    victoryOverlay.setSize(w, h);
  };

  window.addEventListener('resize', onResize);

  let currentClientX = window.innerWidth / 2;
  let currentClientY = window.innerHeight / 2;

  window.addEventListener('pointermove', (e: PointerEvent) => {
    currentClientX = e.clientX;
    currentClientY = e.clientY;
  }, { passive: true });

  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.repeat) return;
    if (!gameStarted || escMenu.isOpen || victoryOverlay.isVisible) return;
    const targetEl = e.target as HTMLElement | null;
    const tag = targetEl?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if (e.code === 'KeyS') {
      scene.commandHeroStop();
      scene.cancelSkillTargeting();
      skillBar.setTargeting(null);
    } else if (e.code === 'KeyD') {
      scene.castHeroGhost();
    } else if (e.code === 'KeyF') {
      if (pickGround(currentClientX, currentClientY)) {
        scene.castHeroFlash(hitPoint.x, hitPoint.z);
      } else if (hasPointerGround) {
        scene.castHeroFlash(lastPointerGroundX, lastPointerGroundZ);
      }
    }
  });

  const fpsOverlay = new FpsOverlay();
  const clock = new THREE.Clock();
  /** 结算后只锁一次相机 / 技能输入 */
  let controlsEnabledLockedByMatch = false;

  const enterMatchOverUi = (): void => {
    const outcome = scene.matchOutcome;
    if (!outcome) return;
    victoryOverlay.show(outcome);
    if (controlsEnabledLockedByMatch) return;
    controlsEnabledLockedByMatch = true;
    controls.setEnabled(false);
    scene.cancelSkillTargeting();
    skillBar.setTargeting(null);
    scene.clearAttackHover();
    syncHoverOutline();
    setGameCursor(renderer.domElement, 'default');
  };

  const tick = (): void => {
    requestAnimationFrame(tick);
    fpsOverlay.update();
    const delta = Math.min(clock.getDelta(), 1 / 20);

    // 开局未点播放：冻结对局逻辑，仅渲染场景 + 开始界面
    if (!gameStarted) {
      scene.commandHeroMoveInput(0, 0);
      startOverlay.update(delta);
      // 相机仍可微跟，但 controls 已禁用，不会飞镜头
      controls.update(0);
      scene.updateStructureHealthBars(camera);
      syncHoverOutline();
      skillBar.setHp(scene.hero.hp, scene.hero.maxHp);

      composer.render();
      screenBrightness.render(renderer);
      skillBar.render(renderer);
      startOverlay.render(renderer);
      escMenu.render(renderer);
      return;
    }

    if (scene.isMatchOver) {
      enterMatchOverUi();
      scene.commandHeroMoveInput(0, 0);
    } else {
      if (controls.isLocked) {
        controls.getWasdWishXZ(wasdWish);
        scene.commandHeroMoveInput(wasdWish.x, wasdWish.z);
      } else {
        scene.commandHeroMoveInput(0, 0);
      }

      scene.update(delta);
      // 死亡动画结束后英雄已传送回水晶：锁定镜头从死亡点平滑拉回
      if (scene.hero.consumeRespawnCameraPan()) {
        controls.smoothPanToFollow(1.35);
      }
      // 本帧可能刚分出胜负
      if (scene.isMatchOver) enterMatchOverUi();
    }

    controls.update(delta);
    // 须在相机更新后：塔/水晶血条视口贴合
    scene.updateStructureHealthBars(camera);
    // 目标死亡等逻辑可能清掉悬停，与 OutlinePass 同步
    syncHoverOutline();

    if (!scene.isMatchOver) {
      skillBar.setCooldown(
        'Q',
        scene.hero.qCooldownRemaining,
        scene.hero.qCooldownTotal,
      );
      skillBar.setCooldown(
        'W',
        scene.hero.wCooldownRemaining,
        scene.hero.wCooldownTotal,
      );
      skillBar.setActive('W', scene.hero.isWBuffActive);
      skillBar.setCooldown(
        'E',
        scene.hero.eCooldownRemaining,
        scene.hero.eCooldownTotal,
      );
      skillBar.setCooldown(
        'R',
        scene.hero.rCooldownRemaining,
        scene.hero.rCooldownTotal,
      );
      skillBar.setActive('R', scene.hero.isRChanneling);
      // 选点中优先；否则高亮排队走位施法的技能
      skillBar.setTargeting(
        scene.skillTargetingSlot ?? scene.heroQueuedSkill,
      );
      skillBar.setHp(scene.hero.hp, scene.hero.maxHp);
    }

    victoryOverlay.update(delta);

    composer.render();
    // 压暗世界画面，设置面板保持清晰可读
    screenBrightness.render(renderer);
    skillBar.render(renderer);
    escMenu.render(renderer);
    victoryOverlay.render(renderer);
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
