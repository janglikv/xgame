import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  Matrix,
  Scene,
  ShadowGenerator,
  Vector3,
} from '@babylonjs/core';
import {
  loadCameraState,
  saveCameraState,
  type CameraStateSnapshot,
} from './storage/cameraState';
import {
  loadMinionState,
  saveMinionState,
  type MinionStateSnapshot,
} from './storage/minionState';
import {
  loadMinionAppearanceState,
  saveMinionAppearanceState,
} from './storage/minionAppearanceState';
import {
  FIXED_CAMERA,
  loadSettingsState,
  saveSettingsState,
  type CameraMode,
} from './storage/settingsState';
import {
  loadWorldState,
  saveWorldState,
  type WorldMode,
} from './storage/worldState';
import { computeCameraRelativeWish } from './input/cameraRelativeMove';
import { FpsOverlay } from './ui/FpsOverlay';
import { SettingsPanel } from './ui/SettingsPanel';
import { createBlankWorld, type BlankWorld } from './world/blankWorld';
import { loadFloorSurfaceState } from './storage/floorState';
import { Floor } from './world/Floor';
import { FloorPickerGallery } from './world/FloorPickerGallery';
import { HoverOutline } from './world/HoverOutline';
import { Minion } from './world/Minion';
import { spawnMinionDemoLineup } from './world/MinionDemoLineup';
import {
  buildArenaColliders,
  initPhysics,
  MinionPhysicsProxy,
} from './world/physics';
import { RangeRing } from './world/RangeRing';
import { SpatialAxesGrid } from './world/SpatialAxesGrid';
import { TeleportPad } from './world/TeleportPad';

async function initScene(): Promise<void> {
  const container = document.getElementById('app');
  if (!container) {
    throw new Error('#app element not found');
  }

  // 1. Canvas + Engine
  const canvas = document.createElement('canvas');
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  container.appendChild(canvas);

  const engine = new Engine(canvas, true, {
    preserveDrawingBuffer: true,
    stencil: true,
    adaptToDeviceRatio: true,
  });
  engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 2));

  // 2. Scene（右手系，与原 Three 场景一致）
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  // 天空 / 清屏 / 雾：纯黑（非地板）
  const skyColor = Color3.Black();
  scene.clearColor = Color4.FromColor3(skyColor, 1);
  // 线性雾：近处清晰，远处融入天空
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogColor = skyColor;
  scene.fogStart = 22;
  scene.fogEnd = 45;

  // 2b. Havok 物理（须在创建任何 PhysicsAggregate 之前）
  await initPhysics(scene);

  // 3. 相机：注视点始终跟角色；固定模式只锁 α/β/半径且禁止拖拽
  const settingsBoot = loadSettingsState();
  let cameraMode: CameraMode = settingsBoot.cameraMode;
  let showFps = settingsBoot.showFps;
  let showGrid = settingsBoot.showGrid;

  const savedWorldMode = loadWorldState();
  const savedMinion = loadMinionState();
  const hubMinionX = savedMinion?.hubX ?? savedMinion?.x ?? 1;
  const hubMinionZ = savedMinion?.hubZ ?? savedMinion?.z ?? 0;
  const blankMinionX = savedMinion?.blankX ?? TeleportPad.DEFAULT_X;
  const blankMinionZ = savedMinion?.blankZ ?? TeleportPad.DEFAULT_Z;

  const minionX = hubMinionX;
  const minionZ = hubMinionZ;
  const activeMinionX = savedWorldMode === 'blank' ? blankMinionX : hubMinionX;
  const activeMinionZ = savedWorldMode === 'blank' ? blankMinionZ : hubMinionZ;

  const minionTarget = new Vector3(
    activeMinionX,
    Minion.BODY_LOCAL_Y * Minion.SCALE,
    activeMinionZ,
  );
  const savedCam = loadCameraState();

  // 固定：预设角度距离 + 角色中心；自由：恢复上次角度（注视点仍跟角色）
  const bootAlpha =
    cameraMode === 'fixed'
      ? FIXED_CAMERA.alpha
      : (savedCam?.alpha ?? -Math.PI / 4);
  const bootBeta =
    cameraMode === 'fixed'
      ? FIXED_CAMERA.beta
      : (savedCam?.beta ?? Math.PI / 3);
  const bootRadius =
    cameraMode === 'fixed'
      ? FIXED_CAMERA.radius
      : (savedCam?.radius ?? 17);

  const camera = new ArcRotateCamera(
    'camera',
    bootAlpha,
    bootBeta,
    bootRadius,
    minionTarget.clone(),
    scene,
  );
  camera.lowerRadiusLimit = 2;
  camera.upperRadiusLimit = 120;
  camera.wheelPrecision = 40;
  // 小兵用 WASD 移动；关掉轨道相机自带的方向键平移，避免抢键
  camera.panningSensibility = 80;
  camera.keysUp = [];
  camera.keysDown = [];
  camera.keysLeft = [];
  camera.keysRight = [];
  camera.minZ = 0.1;
  camera.maxZ = 1000;

  const snapshotCamera = (): CameraStateSnapshot => {
    const activeCam =
      worldMode === 'blank' && blankWorld ? blankWorld.camera : camera;
    return {
      alpha: activeCam.alpha,
      beta: activeCam.beta,
      radius: activeCam.radius,
      targetX: activeCam.target.x,
      targetY: activeCam.target.y,
      targetZ: activeCam.target.z,
    };
  };

  /** 固定模式：锁角度/距离（注视点由跟随逻辑写） */
  const lockFixedOrbit = (): void => {
    camera.alpha = FIXED_CAMERA.alpha;
    camera.beta = FIXED_CAMERA.beta;
    camera.radius = FIXED_CAMERA.radius;
  };

  const applyCameraMode = (mode: CameraMode, attachIfFree: boolean): void => {
    cameraMode = mode;
    if (mode === 'fixed') {
      camera.detachControl();
      lockFixedOrbit();
    } else if (attachIfFree) {
      camera.attachControl(canvas, true);
    }
  };

  /** 拖拽/滚轮后节流写入（仅自由模式；只存角度距离，注视点随角色） */
  let camSaveTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleSaveCamera = (): void => {
    if (cameraMode !== 'free') return;
    if (camSaveTimer !== null) clearTimeout(camSaveTimer);
    camSaveTimer = setTimeout(() => {
      camSaveTimer = null;
      if (cameraMode === 'free') saveCameraState(snapshotCamera());
    }, 200);
  };

  camera.onViewMatrixChangedObservable.add(scheduleSaveCamera);

  // 初始：固定不挂控制；自由才 attach
  if (cameraMode === 'free') {
    camera.attachControl(canvas, true);
  }

  // 4. 光照 + 阴影
  const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.55;
  hemi.groundColor = new Color3(0.15, 0.16, 0.18);

  // 方向光：direction 为光线传播方向；position 用于阴影投影体
  const dir = new DirectionalLight(
    'dir',
    new Vector3(-12, -22, -14).normalize(),
    scene,
  );
  dir.position = new Vector3(12, 22, 14);
  dir.intensity = 1.25;

  const shadowGen = new ShadowGenerator(2048, dir);
  // PCF 软阴影；避免 blur ESM 在场地尺度下糊成脏带
  shadowGen.usePercentageCloserFiltering = true;
  shadowGen.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
  shadowGen.bias = 0.001;
  shadowGen.normalBias = 0.02;
  // 手写正交阴影体，只覆盖矩形场地（X±20、Z±20），略留边
  dir.autoUpdateExtends = false;
  dir.orthoLeft = -32;
  dir.orthoRight = 32;
  dir.orthoTop = 32;
  dir.orthoBottom = -32;
  dir.shadowMinZ = 1;
  dir.shadowMaxZ = 70;

  // 5. 地板（贴图选择与预设烘焙）+ 展台选择器 + 物理静态场地 + 坐标系
  const initialFloorSurface = loadFloorSurfaceState();
  const floor = new Floor(scene, shadowGen, { surface: initialFloorSurface });
  const floorPickerGallery = new FloorPickerGallery(scene, floor);
  buildArenaColliders(scene);
  const spatialAxesGrid = new SpatialAxesGrid(scene);
  spatialAxesGrid.setVisible(showGrid);

  // 5b. 传送阵（X=15）：站上蓄力 3s 自动切换场景（阵法加速旋转）
  const teleportPad = new TeleportPad(
    scene,
    TeleportPad.DEFAULT_X,
    TeleportPad.DEFAULT_Z,
  );
  /** hub | blank：当前渲染与输入作用的世界 */
  let worldMode: WorldMode = 'hub';
  let blankWorld: BlankWorld | null = null;
  let blankEnterBusy = false;

  // 6. 小兵模型（位置与换装造型可 localStorage 恢复）
  const savedAppearance = loadMinionAppearanceState();
  const minion = new Minion(scene, minionX, minionZ, {
    facePositiveX: true,
    shadowGenerator: shadowGen,
    allBlack: true,
    face: 'fierce',
    redHat: true,
    magicStaff: true,
    scaleMultiplier: 0.5,
    formation: 'crimson',
  });
  if (savedAppearance) {
    minion.applyPatch(savedAppearance);
  }
  minion.onAppearanceChanged = (appearance) => {
    saveMinionAppearanceState(appearance);
  };
  // 主控物理：DYNAMIC 速度驱动，与阵列/球真实互推
  const minionPhys = new MinionPhysicsProxy(scene, minion.root, {
    mode: 'player',
    radius: 0.13,
    height: 0.38,
    mass: 2.6,
  });
  minionPhys.teleportToTarget();

  // 展示副本多排阵列：右对齐固定间距 + 每人物理胶囊（配置见 MinionDemoLineup）
  const demoLineup = spawnMinionDemoLineup(scene, shadowGen, {
    x0: 1,
    rowGap: 1.6,
    zEnd: 5,
    colGap: 1.1,
    physics: true,
  });

  // 鼠标悬停：深红整体外轮廓；仅展示阵列可作 E/R 替换源（不描主角也可悬停）
  const hoverOutline = new HoverOutline(scene);
  hoverOutline.registerMinions([minion, ...demoLineup.minions]);
  /** 外观替换最大距离；不够近时在主角脚下画红圈提示 */
  const SWAP_RANGE = RangeRing.DEFAULT_RADIUS;
  const swapRangeRing = new RangeRing(scene, SWAP_RANGE);

  const distXZ = (ax: number, az: number, bx: number, bz: number): number =>
    Math.hypot(ax - bx, az - bz);

  /** 悬停目标是否在替换距离内（XZ） */
  const isInSwapRange = (target: Minion): boolean => {
    const a = minion.root.position;
    const b = target.root.position;
    return distXZ(a.x, a.z, b.x, b.z) <= SWAP_RANGE;
  };

  /** 指针是否在画布上（leave 后勿用残留 pointerX/Y 重拾取） */
  let pointerOverCanvas = false;
  let isPointerDown = false;

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button === 0 || e.button === 2) {
      isPointerDown = true;
    }
  });

  window.addEventListener('pointerup', () => {
    isPointerDown = false;
  });

  window.addEventListener('pointercancel', () => {
    isPointerDown = false;
  });

  canvas.addEventListener('pointerenter', () => {
    pointerOverCanvas = true;
  });
  canvas.addEventListener('pointermove', () => {
    pointerOverCanvas = true;
    if (settingsPanel?.isOpen()) return;
    hoverOutline.updateFromScenePick(scene);
  });
  canvas.addEventListener('pointerleave', () => {
    pointerOverCanvas = false;
    isPointerDown = false;
    hoverOutline.clear();
  });

  const snapshotMinion = (): MinionStateSnapshot => {
    const activeMinion =
      worldMode === 'blank' && blankWorld ? blankWorld.minion : minion;
    const isBlank = worldMode === 'blank' && blankWorld !== null;
    const posX = activeMinion.root.position.x;
    const posZ = activeMinion.root.position.z;

    const prev = loadMinionState();
    return {
      x: posX,
      z: posZ,
      hubX: isBlank ? (prev?.hubX ?? hubMinionX) : posX,
      hubZ: isBlank ? (prev?.hubZ ?? hubMinionZ) : posZ,
      blankX: isBlank ? posX : (prev?.blankX ?? blankMinionX),
      blankZ: isBlank ? posZ : (prev?.blankZ ?? blankMinionZ),
    };
  };

  /** 移动后节流写入，避免每帧刷 localStorage */
  let minionSaveTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleSaveMinion = (): void => {
    if (minionSaveTimer !== null) clearTimeout(minionSaveTimer);
    minionSaveTimer = setTimeout(() => {
      minionSaveTimer = null;
      saveMinionState(snapshotMinion());
    }, 200);
  };

  // 7. WASD：相对镜头水平方向移动小兵（镜头平滑跟随）
  const moveKeys = { w: false, a: false, s: false, d: false };
  const MOVE_SPEED = 2; // 世界单位 / 秒
  /** 镜头跟随平滑强度（越大越跟手；指数衰减，与帧率无关） */
  const CAM_FOLLOW = 6;
  const focusPoint = new Vector3();
  // 平滑注视点从当前相机目标起步，避免开局跳变
  const camFollowTarget = camera.target.clone();
  const moveForward = new Vector3();
  const moveRight = new Vector3();
  const moveDelta = new Vector3();
  /** HUD（先声明供场景切换闭包读取，稍后构造） */
  let settingsPanel: SettingsPanel | null = null;
  let fpsOverlay: FpsOverlay | null = null;

  const persistSettings = (): void => {
    saveSettingsState({ showFps, showGrid, cameraMode });
  };

  const isMoveKey = (key: string): key is keyof typeof moveKeys =>
    key === 'w' || key === 'a' || key === 's' || key === 'd';

  const isTypingTarget = (t: EventTarget | null): boolean => {
    if (!(t instanceof HTMLElement)) return false;
    return (
      t.tagName === 'INPUT' ||
      t.tagName === 'TEXTAREA' ||
      t.isContentEditable
    );
  };

  /**
   * 悬停展示目标后（须进入 SWAP_RANGE）：
   * - E：部分替换（只拷该行展示槽，如表情行只换脸、帽子行只换帽）
   * - R：全量替换（整体外观对齐目标）
   * 距离不足：不替换，目标脚下细线红圈短暂提示范围
   * @returns 是否消费了按键（含距离不足提示）
   */
  const tryApplyHoverAppearance = (mode: 'partial' | 'full'): boolean => {
    if (worldMode !== 'hub') return false;
    const target = hoverOutline.getHovered();
    if (!target || target === minion) return false;
    if (!isInSwapRange(target)) {
      // 仅按键时提示：目标脚下细线红圈（hover 不显示）
      swapRangeRing.show(target.root.position);
      return true;
    }
    minion.applyFrom(target, mode);
    // 主角 mesh 变更后若仍悬停自己，刷新描边 mesh 列表
    hoverOutline.refreshSelection();
    return true;
  };

  let warpLanding: {
    minion: Minion;
    phys: MinionPhysicsProxy;
    startY: number;
    targetX: number;
    targetZ: number;
    progress: number;
  } | null = null;

  const triggerLandingWarp = (
    targetMinion: Minion,
    targetPhys: MinionPhysicsProxy,
    tx = TeleportPad.DEFAULT_X,
    tz = TeleportPad.DEFAULT_Z,
  ): void => {
    targetMinion.root.position.set(tx, 0.75, tz);
    targetPhys.teleportToTarget();
    warpLanding = {
      minion: targetMinion,
      phys: targetPhys,
      startY: 0.75,
      targetX: tx,
      targetZ: tz,
      progress: 0,
    };
  };

  /** 枢纽 → 空白场景（懒创建，带入当前外观）
   * @param isInitialLoad 是否页面首次加载恢复场景（此时保留小兵在 blank 场景保存的位置）
   */
  const enterBlankWorld = async (isInitialLoad = false): Promise<void> => {
    if (worldMode === 'blank' || blankEnterBusy) return;
    blankEnterBusy = true;
    try {
      const appearance = minion.getAppearance();
      const spawnX = isInitialLoad ? blankMinionX : TeleportPad.DEFAULT_X;
      const spawnZ = isInitialLoad ? blankMinionZ : TeleportPad.DEFAULT_Z;

      if (!blankWorld) {
        blankWorld = await createBlankWorld(
          engine,
          appearance,
          cameraMode,
          spawnX,
          spawnZ,
        );
        blankWorld.camera.onViewMatrixChangedObservable.add(scheduleSaveCamera);
        blankWorld.spatialAxesGrid.setVisible(showGrid);
      } else {
        blankWorld.applyAppearance(appearance);
        blankWorld.minion.root.position.set(spawnX, 0, spawnZ);
        blankWorld.minionPhys.teleportToTarget();
      }

      if (!isInitialLoad) {
        triggerLandingWarp(blankWorld.minion, blankWorld.minionPhys, spawnX, spawnZ);
      }

      // 卸枢纽控制；空白场景相机仅在菜单关闭且自由模式时挂上
      camera.detachControl();
      hoverOutline.clear();
      hoverOutline.setEnabled(false);
      moveKeys.w = moveKeys.a = moveKeys.s = moveKeys.d = false;

      const menuOpen = settingsPanel?.isOpen() ?? false;
      if (cameraMode === 'fixed') {
        blankWorld.detachCamera();
        blankWorld.setCameraMode('fixed', canvas);
      } else if (menuOpen) {
        blankWorld.detachCamera();
      } else {
        blankWorld.attachCamera(canvas);
      }
      if (cameraMode === 'free' && isInitialLoad && savedCam) {
        blankWorld.camera.alpha = savedCam.alpha;
        blankWorld.camera.beta = savedCam.beta;
        blankWorld.camera.radius = savedCam.radius;
      }

      // 重置空白场景镜头跟随，避免跳变
      blankWorld.minion.getFocusPoint(focusPoint);
      blankWorld.camera.setTarget(focusPoint.clone());
      camFollowTarget.copyFrom(focusPoint);

      // 出生在阵上：须先离开再站上才重新蓄力
      blankWorld.teleportPad.disarmUntilLeave();
      teleportPad.resetCharge();

      worldMode = 'blank';
      // GUI 挂在当前渲染 Scene 上，否则空白场景看不到 ESC / FPS
      settingsPanel?.rebind(blankWorld.scene);
      fpsOverlay?.rebind(blankWorld.scene);
      saveWorldState('blank');
      saveMinionState(snapshotMinion());
    } finally {
      blankEnterBusy = false;
    }
  };

  /** 空白场景 → 枢纽（带回外观，落在枢纽传送阵） */
  const returnToHubWorld = (): void => {
    if (worldMode !== 'blank' || !blankWorld || blankEnterBusy) return;

    // 空白场景外观写回枢纽主角
    minion.applyPatch(blankWorld.minion.getAppearance());
    triggerLandingWarp(minion, minionPhys, TeleportPad.DEFAULT_X, TeleportPad.DEFAULT_Z);

    blankWorld.detachCamera();
    blankWorld.teleportPad.resetCharge();
    moveKeys.w = moveKeys.a = moveKeys.s = moveKeys.d = false;

    if (!settingsPanel?.isOpen()) {
      if (cameraMode === 'free') {
        camera.attachControl(canvas, true);
      } else {
        camera.detachControl();
        lockFixedOrbit();
      }
      hoverOutline.setEnabled(true);
    }

    minion.getFocusPoint(focusPoint);
    camera.setTarget(focusPoint.clone());
    camFollowTarget.copyFrom(focusPoint);

    // 出生在阵上：须先离开再站上才重新蓄力
    teleportPad.disarmUntilLeave();

    worldMode = 'hub';
    // 回到枢纽 Scene 的 GUI
    settingsPanel?.rebind(scene);
    fpsOverlay?.rebind(scene);
    saveWorldState('hub');
    saveMinionState(snapshotMinion());
  };

  window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if (e.repeat) return;
    if (settingsPanel?.isOpen()) return;
    if (isTypingTarget(e.target)) return;

    if (key === 'e') {
      if (tryApplyHoverAppearance('partial')) e.preventDefault();
      return;
    }
    if (key === 'r') {
      if (tryApplyHoverAppearance('full')) e.preventDefault();
      return;
    }

    if (!isMoveKey(key)) return;
    moveKeys[key] = true;
    e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    if (!isMoveKey(key)) return;
    moveKeys[key] = false;
  });
  window.addEventListener('blur', () => {
    moveKeys.w = moveKeys.a = moveKeys.s = moveKeys.d = false;
  });

  window.addEventListener('beforeunload', () => {
    if (camSaveTimer !== null) clearTimeout(camSaveTimer);
    if (minionSaveTimer !== null) clearTimeout(minionSaveTimer);
    if (cameraMode === 'free') saveCameraState(snapshotCamera());
    saveMinionState(snapshotMinion());
    saveWorldState(worldMode);
    persistSettings();
  });

  // 8. 左上角 FPS + ESC 设置面板（Babylon GUI，挂在当前渲染 Scene）
  fpsOverlay = new FpsOverlay(scene);
  fpsOverlay.setVisible(showFps);

  settingsPanel = new SettingsPanel(scene, {
    getShowFps: () => showFps,
    setShowFps: (show) => {
      showFps = show;
      fpsOverlay?.setVisible(show);
      persistSettings();
    },
    getShowGrid: () => showGrid,
    setShowGrid: (show) => {
      showGrid = show;
      spatialAxesGrid.setVisible(show);
      if (blankWorld) {
        blankWorld.spatialAxesGrid.setVisible(show);
      }
      persistSettings();
    },
    getCameraMode: () => cameraMode,
    setCameraMode: (mode) => {
      if (mode === cameraMode) return;
      // 切到固定前，保存当前自由角度/距离
      if (cameraMode === 'free' && mode === 'fixed') {
        if (worldMode === 'hub') saveCameraState(snapshotCamera());
      }
      cameraMode = mode;
      if (worldMode === 'hub') {
        applyCameraMode(mode, !settingsPanel?.isOpen());
        if (mode === 'free') {
          const free = loadCameraState();
          if (free) {
            camera.alpha = free.alpha;
            camera.beta = free.beta;
            camera.radius = free.radius;
          }
        }
      } else if (blankWorld) {
        blankWorld.setCameraMode(mode, canvas);
        if (settingsPanel?.isOpen()) blankWorld.detachCamera();
      }
      persistSettings();
    },
    getCameraInfo: () => {
      const cam =
        worldMode === 'blank' && blankWorld ? blankWorld.camera : camera;
      return {
        alpha: cam.alpha,
        beta: cam.beta,
        radius: cam.radius,
        targetX: cam.target.x,
        targetY: cam.target.y,
        targetZ: cam.target.z,
      };
    },
    onOpenChange: (open) => {
      // 打开时松手、停 WASD、卸掉轨道拖拽，避免穿透 UI
      moveKeys.w = moveKeys.a = moveKeys.s = moveKeys.d = false;
      if (worldMode === 'hub') {
        hoverOutline.setEnabled(!open);
        if (open) {
          camera.detachControl();
        } else if (cameraMode === 'free') {
          camera.attachControl(canvas, true);
        }
      } else if (blankWorld) {
        if (open) {
          blankWorld.detachCamera();
        } else if (cameraMode === 'free') {
          blankWorld.attachCamera(canvas);
        }
      }
    },
  });

  // 若上次保存在空白场景，启动时自动恢复（须在 HUD 创建之后，以便 rebind）
  if (savedWorldMode === 'blank') {
    await enterBlankWorld(true);
  }

  // 9. 窗口尺寸
  window.addEventListener('resize', () => {
    engine.resize();
  });

  // 10. 渲染循环
  // 时序：读上一帧物理位姿 → 写玩家速度 → 表现动画 → render（内含物理步进）
  let wasMovingBlank = false;
  let wasMovingHub = false;

  /** 读 WASD → 相对镜头水平速度；菜单打开时停 */
  const readMoveWish = (
    cam: { position: Vector3; target: Vector3; alpha: number },
    menuOpen: boolean,
  ) => {
    if (menuOpen) {
      return { moving: false, wishX: 0, wishZ: 0, dirX: 0, dirZ: 0 };
    }
    const ix = (moveKeys.a ? 1 : 0) - (moveKeys.d ? 1 : 0);
    const iz = (moveKeys.w ? 1 : 0) - (moveKeys.s ? 1 : 0);
    return computeCameraRelativeWish(
      ix,
      iz,
      MOVE_SPEED,
      cam,
      moveForward,
      moveRight,
      moveDelta,
    );
  };

  /** 注视点平滑跟随角色 */
  const followFocus = (
    activeCam: { setTarget: (t: Vector3) => void; target: Vector3 },
    getFocus: (out: Vector3) => void,
    dt: number,
  ): void => {
    getFocus(focusPoint);
    const followT = 1 - Math.exp(-CAM_FOLLOW * dt);
    camFollowTarget.x += (focusPoint.x - camFollowTarget.x) * followT;
    camFollowTarget.y += (focusPoint.y - camFollowTarget.y) * followT;
    camFollowTarget.z += (focusPoint.z - camFollowTarget.z) * followT;
    if (!activeCam.target.equalsWithEpsilon(camFollowTarget, 1e-4)) {
      activeCam.setTarget(camFollowTarget);
    }
  };

  engine.runRenderLoop(() => {
    const dt = Math.min(engine.getDeltaTime() / 1000, 0.05);
    const menuOpen = settingsPanel?.isOpen() ?? false;

    // 手持法杖按下鼠标：实时拾取 3D 地面坐标并让法杖指向鼠标
    const activeScene =
      worldMode === 'blank' && blankWorld ? blankWorld.scene : scene;
    const activeCam =
      worldMode === 'blank' && blankWorld ? blankWorld.camera : camera;
    const activeMinion =
      worldMode === 'blank' && blankWorld ? blankWorld.minion : minion;

    if (
      isPointerDown &&
      pointerOverCanvas &&
      !menuOpen &&
      activeMinion.hasStaff()
    ) {
      const ray = activeScene.createPickingRay(
        activeScene.pointerX,
        activeScene.pointerY,
        Matrix.Identity(),
        activeCam,
      );
      const planeY = activeMinion.root.position.y;
      if (Math.abs(ray.direction.y) > 1e-5) {
        const t = (planeY - ray.origin.y) / ray.direction.y;
        if (t > 0) {
          const aimPoint = ray.origin.add(ray.direction.scale(t));
          activeMinion.setAimTarget(aimPoint);
        }
      }
    } else {
      activeMinion.setAimTarget(null);
    }

    if (warpLanding) {
      warpLanding.progress += dt / 0.22;
      if (warpLanding.progress >= 1) {
        warpLanding.minion.root.position.set(
          warpLanding.targetX,
          0,
          warpLanding.targetZ,
        );
        warpLanding.phys.teleportToTarget();
        warpLanding = null;
      } else {
        const t = warpLanding.progress;
        const easeY = (1 - t) * (1 - t);
        warpLanding.minion.root.position.x = warpLanding.targetX;
        warpLanding.minion.root.position.z = warpLanding.targetZ;
        warpLanding.minion.root.position.y = warpLanding.startY * easeY;
        warpLanding.phys.teleportToTarget();
      }
    }

    // ── 空白场景：仅地板 + 主角 ──────────────────────────
    if (worldMode === 'blank' && blankWorld) {
      const bw = blankWorld;
      bw.minionPhys.syncToTarget();

      const wish = readMoveWish(bw.camera, menuOpen);
      if (wish.moving) {
        bw.minion.faceToward(wish.dirX, wish.dirZ);
        scheduleSaveMinion();
      }
      bw.minionPhys.setHorizontalVelocity(wish.wishX, wish.wishZ);
      bw.minion.update(dt, wish.moving);

      if (!wish.moving && wasMovingBlank) {
        saveMinionState(snapshotMinion());
      }
      wasMovingBlank = wish.moving;

      // 传送阵：站上蓄力加速，满 3s 回枢纽
      {
        const p = bw.minion.root.position;
        const onPad = bw.teleportPad.contains(p.x, p.z);
        if (bw.teleportPad.update(dt, onPad && !menuOpen)) {
          returnToHubWorld();
        }
      }

      followFocus(bw.camera, (out) => bw.minion.getFocusPoint(out), dt);
      if (cameraMode === 'fixed') {
        bw.camera.alpha = FIXED_CAMERA.alpha;
        bw.camera.beta = FIXED_CAMERA.beta;
        bw.camera.radius = FIXED_CAMERA.radius;
      }

      if (showFps) fpsOverlay?.update();
      settingsPanel?.update();
      bw.scene.render();
      return;
    }

    // ── 枢纽场景 ────────────────────────────────────────
    minionPhys.syncToTarget();

    const wish = readMoveWish(camera, menuOpen);
    if (wish.moving) {
      minion.faceToward(wish.dirX, wish.dirZ);
      scheduleSaveMinion();
    }
    // 速度驱动物理体：有输入则冲，无输入则水平刹停（保留 Y）
    minionPhys.setHorizontalVelocity(wish.wishX, wish.wishZ);

    minion.update(dt, wish.moving);
    demoLineup.update(dt);
    floorPickerGallery.update(minion.root.position);

    if (!wish.moving && wasMovingHub) {
      saveMinionState(snapshotMinion());
    }
    wasMovingHub = wish.moving;

    // 传送阵：站上蓄力加速，满 3s 进空白场景
    {
      const p = minion.root.position;
      const onPad = teleportPad.contains(p.x, p.z);
      if (teleportPad.update(dt, onPad && !menuOpen)) {
        void enterBlankWorld();
      }
    }

    // 悬停目标可能被推动离指针：每帧按指针位置重拾取，保持轮廓同步
    if (!menuOpen && pointerOverCanvas) {
      hoverOutline.updateFromScenePick(scene);
    }

    // 黄圈仅在距离不足按 E/R 时短暂显示（update 负责淡出）
    swapRangeRing.update(dt);

    followFocus(camera, (out) => minion.getFocusPoint(out), dt);
    if (cameraMode === 'fixed') {
      lockFixedOrbit();
    }

    if (showFps) fpsOverlay?.update();
    settingsPanel?.update();
    scene.render();
  });
}

initScene().catch((err) => {
  console.error('Failed to start scene:', err);
});
