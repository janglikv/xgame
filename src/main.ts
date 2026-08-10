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
import { FpsOverlay } from './ui/FpsOverlay';
import { Floor } from './world/Floor';
import { Minion } from './world/Minion';
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

  // 3. 相机（轨道，等价 OrbitControls；参数可 localStorage 恢复）
  const savedCam = loadCameraState();
  const camera = new ArcRotateCamera(
    'camera',
    savedCam?.alpha ?? -Math.PI / 4,
    savedCam?.beta ?? Math.PI / 3,
    savedCam?.radius ?? 17,
    savedCam
      ? new Vector3(savedCam.targetX, savedCam.targetY, savedCam.targetZ)
      : Vector3.Zero(),
    scene,
  );
  camera.attachControl(canvas, true);
  camera.lowerRadiusLimit = 2;
  camera.upperRadiusLimit = 120;
  camera.wheelPrecision = 40;
  camera.panningSensibility = 80;
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
  window.addEventListener('beforeunload', () => {
    if (camSaveTimer !== null) clearTimeout(camSaveTimer);
    saveCameraState(snapshotCamera());
  });

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
  // 手写正交阴影体，只覆盖矩形场地（X±20、Z±5），略留边
  dir.autoUpdateExtends = false;
  dir.orthoLeft = -28;
  dir.orthoRight = 28;
  dir.orthoTop = 18;
  dir.orthoBottom = -18;
  dir.shadowMinZ = 1;
  dir.shadowMaxZ = 70;

  // 5. 地板 + 坐标系
  new Floor(scene, shadowGen);
  new SpatialAxesGrid(scene);

  // 6. 小兵模型（无帽子、无法杖）
  new Minion(scene, 1, 0, {
    facePositiveX: true,
    shadowGenerator: shadowGen,
  });

  // 7. 左上角 FPS
  const fpsOverlay = new FpsOverlay();

  // 8. 窗口尺寸
  window.addEventListener('resize', () => {
    engine.resize();
  });

  // 9. 渲染循环
  engine.runRenderLoop(() => {
    fpsOverlay.update();
    scene.render();
  });
}

try {
  initScene();
} catch (err) {
  console.error('Failed to start scene:', err);
}
