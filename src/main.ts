import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
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
import { FpsOverlay } from './ui/FpsOverlay';
import { Floor } from './world/Floor';
import { FootRingBuff } from './world/FootRingBuff';
import { Minion } from './world/Minion';
import { spawnMinionDemoLineup } from './world/MinionDemoLineup';
import { SpatialAxesGrid } from './world/SpatialAxesGrid';

function initScene(): void {
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

  // 3. 相机（轨道，等价 OrbitControls；默认以小兵为中心，参数可 localStorage 恢复）
  const savedMinion = loadMinionState();
  const minionX = savedMinion?.x ?? 1;
  const minionZ = savedMinion?.z ?? 0;
  const minionTarget = new Vector3(
    minionX,
    Minion.BODY_LOCAL_Y * Minion.SCALE,
    minionZ,
  );
  const savedCam = loadCameraState();
  const camera = new ArcRotateCamera(
    'camera',
    savedCam?.alpha ?? -Math.PI / 4,
    savedCam?.beta ?? Math.PI / 3,
    savedCam?.radius ?? 17,
    savedCam
      ? new Vector3(savedCam.targetX, savedCam.targetY, savedCam.targetZ)
      : minionTarget,
    scene,
  );
  camera.attachControl(canvas, true);
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

  const snapshotCamera = (): CameraStateSnapshot => ({
    alpha: camera.alpha,
    beta: camera.beta,
    radius: camera.radius,
    targetX: camera.target.x,
    targetY: camera.target.y,
    targetZ: camera.target.z,
  });

  /** 拖拽/滚轮后节流写入，避免每帧刷 localStorage */
  let camSaveTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleSaveCamera = (): void => {
    if (camSaveTimer !== null) clearTimeout(camSaveTimer);
    camSaveTimer = setTimeout(() => {
      camSaveTimer = null;
      saveCameraState(snapshotCamera());
    }, 200);
  };

  // 轨道交互结束 / 观察点变化时缓存
  camera.onViewMatrixChangedObservable.add(scheduleSaveCamera);

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

  // 5. 地板 + 坐标系
  new Floor(scene, shadowGen);
  new SpatialAxesGrid(scene);

  // 6. 小兵模型（灰黑肤色 + 凶狠表情 + 红帽 + 法杖，体积缩小一半；位置可 localStorage 恢复）
  const minion = new Minion(scene, minionX, minionZ, {
    facePositiveX: true,
    shadowGenerator: shadowGen,
    allBlack: true,
    face: 'fierce',
    redHat: true,
    magicStaff: true,
    scaleMultiplier: 0.5,
  });
  // 脚底红色阵法（赤环）
  const minionFormation = new FootRingBuff(scene, minion.root, 'crimson');

  // 展示副本多排阵列：每排同类（表情/阵法/肤色/武器…，配置见 MinionDemoLineup）
  const demoLineup = spawnMinionDemoLineup(scene, shadowGen, {
    x0: 1,
    rowGap: 1.6,
    zMin: -5,
    zMax: 5,
  });

  const snapshotMinion = (): MinionStateSnapshot => ({
    x: minion.root.position.x,
    z: minion.root.position.z,
  });

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

  const isMoveKey = (key: string): key is keyof typeof moveKeys =>
    key === 'w' || key === 'a' || key === 's' || key === 'd';

  window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if (!isMoveKey(key) || e.repeat) return;
    // 输入框内不拦截
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
      return;
    }
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
    saveCameraState(snapshotCamera());
    saveMinionState(snapshotMinion());
  });

  // 8. 左上角 FPS
  const fpsOverlay = new FpsOverlay();

  // 9. 窗口尺寸
  window.addEventListener('resize', () => {
    engine.resize();
  });

  // 10. 渲染循环
  engine.runRenderLoop(() => {
    const dt = Math.min(engine.getDeltaTime() / 1000, 0.05);

    // 相对镜头：W/S 前后，A/D 左右（符号已按右手系校正）
    const ix = (moveKeys.a ? 1 : 0) - (moveKeys.d ? 1 : 0);
    const iz = (moveKeys.w ? 1 : 0) - (moveKeys.s ? 1 : 0);
    let moving = false;
    if (ix !== 0 || iz !== 0) {
      // 相机 → 目标 在 XZ 上的前方向；俯视时用 alpha 兜底
      moveForward.copyFrom(camera.target).subtractInPlace(camera.position);
      moveForward.y = 0;
      if (moveForward.lengthSquared() < 1e-8) {
        moveForward.set(Math.sin(camera.alpha), 0, Math.cos(camera.alpha));
      } else {
        moveForward.normalize();
      }
      // 右手系 Y-up：Up × Forward
      Vector3.CrossToRef(Vector3.UpReadOnly, moveForward, moveRight);
      if (moveRight.lengthSquared() < 1e-8) {
        moveRight.set(1, 0, 0);
      } else {
        moveRight.normalize();
      }

      moveDelta.set(0, 0, 0);
      moveDelta.addInPlace(moveForward.scale(iz));
      moveDelta.addInPlace(moveRight.scale(ix));
      if (moveDelta.lengthSquared() > 1e-8) {
        moveDelta.normalize().scaleInPlace(MOVE_SPEED * dt);
        minion.moveBy(moveDelta.x, moveDelta.z);
        minion.faceToward(moveDelta.x, moveDelta.z);
        scheduleSaveMinion();
        moving = true;
      }
    }

    minion.update(dt, moving);
    minionFormation.update(dt);
    demoLineup.update(dt);

    // 镜头指数平滑跟随小兵（滤掉逐步硬切带来的抖动）
    minion.getFocusPoint(focusPoint);
    const followT = 1 - Math.exp(-CAM_FOLLOW * dt);
    camFollowTarget.x += (focusPoint.x - camFollowTarget.x) * followT;
    camFollowTarget.y += (focusPoint.y - camFollowTarget.y) * followT;
    camFollowTarget.z += (focusPoint.z - camFollowTarget.z) * followT;
    if (!camera.target.equalsWithEpsilon(camFollowTarget, 1e-4)) {
      camera.setTarget(camFollowTarget);
    }

    fpsOverlay.update();
    scene.render();
  });
}

try {
  initScene();
} catch (err) {
  console.error('Failed to start scene:', err);
}
