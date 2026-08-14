import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  HemisphericLight,
  Scene,
  ShadowGenerator,
  Vector3,
  type Engine,
} from '@babylonjs/core';
import {
  FIXED_CAMERA,
  FREE_CAMERA_FOV,
  type CameraMode,
} from '../../storage/settingsState';
import { Minion } from '../Minion';

export interface FogOptions {
  start: number;
  end: number;
}

export interface ShadowOrthoOptions {
  half: number;
  mapSize?: number;
}

export interface SceneBasics {
  scene: Scene;
  hemi: HemisphericLight;
  dir: DirectionalLight;
  shadowGen: ShadowGenerator;
}

/**
 * 创建统一风格的 Scene：黑底、线性雾、右手系。
 */
export function createDarkScene(engine: Engine, fog: FogOptions): Scene {
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  const skyColor = Color3.Black();
  scene.clearColor = Color4.FromColor3(skyColor, 1);
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogColor = skyColor;
  scene.fogStart = fog.start;
  scene.fogEnd = fog.end;
  return scene;
}

/**
 * 枢纽 / 关卡共用的半球光 + 方向光 + PCF 阴影。
 */
export function addStandardLighting(
  scene: Scene,
  shadow: ShadowOrthoOptions,
): Omit<SceneBasics, 'scene'> {
  const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.55;
  hemi.groundColor = new Color3(0.15, 0.16, 0.18);

  const dir = new DirectionalLight(
    'dir',
    new Vector3(-12, -22, -14).normalize(),
    scene,
  );
  dir.position = new Vector3(12, 22, 14);
  dir.intensity = 1.25;

  const shadowGen = new ShadowGenerator(shadow.mapSize ?? 1024, dir);
  shadowGen.usePercentageCloserFiltering = true;
  shadowGen.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
  shadowGen.bias = 0.0005;
  shadowGen.normalBias = 0.01;

  dir.autoUpdateExtends = false;
  const h = shadow.half;
  dir.orthoLeft = -h;
  dir.orthoRight = h;
  dir.orthoTop = h;
  dir.orthoBottom = -h;
  dir.shadowMinZ = 1;
  dir.shadowMaxZ = 70;

  return { hemi, dir, shadowGen };
}

export interface FollowCameraOptions {
  name: string;
  mode: CameraMode;
  target: Vector3;
  /** 自由模式初始角度；固定模式忽略 */
  free?: { alpha: number; beta: number; radius: number };
}

/**
 * 创建跟随用 ArcRotateCamera，并按模式应用固定/自由参数。
 */
export function createFollowCamera(
  scene: Scene,
  opts: FollowCameraOptions,
): ArcRotateCamera {
  const free = opts.free ?? {
    alpha: 4.695,
    beta: 0.568,
    radius: 12.39,
  };
  const alpha = opts.mode === 'fixed' ? FIXED_CAMERA.alpha : free.alpha;
  const beta = opts.mode === 'fixed' ? FIXED_CAMERA.beta : free.beta;
  const radius = opts.mode === 'fixed' ? FIXED_CAMERA.radius : free.radius;

  const camera = new ArcRotateCamera(
    opts.name,
    alpha,
    beta,
    radius,
    opts.target.clone(),
    scene,
  );
  camera.lowerRadiusLimit = 2;
  camera.upperRadiusLimit = 120;
  camera.wheelPrecision = 40;
  camera.panningSensibility = 80;
  // 小兵用 WASD；关掉轨道相机方向键，避免抢键
  camera.keysUp = [];
  camera.keysDown = [];
  camera.keysLeft = [];
  camera.keysRight = [];
  camera.minZ = 0.1;
  camera.maxZ = 1000;

  if (opts.mode === 'fixed') {
    lockFixedOrbit(camera);
  } else {
    camera.fov = FREE_CAMERA_FOV;
  }

  return camera;
}

/** 固定俯视：锁 α/β/半径与窄 FOV */
export function lockFixedOrbit(camera: ArcRotateCamera): void {
  camera.alpha = FIXED_CAMERA.alpha;
  camera.beta = FIXED_CAMERA.beta;
  camera.radius = FIXED_CAMERA.radius;
  camera.fov = FIXED_CAMERA.fov;
}

/** 按模式挂/卸相机控制 */
export function applyCameraMode(
  camera: ArcRotateCamera,
  mode: CameraMode,
  canvas: HTMLCanvasElement,
  attachIfFree: boolean,
): void {
  if (mode === 'fixed') {
    camera.detachControl();
    lockFixedOrbit(camera);
  } else {
    camera.fov = FREE_CAMERA_FOV;
    if (attachIfFree) {
      camera.attachControl(canvas, true);
    }
  }
}

/** 角色缩放对应的默认注视高度 */
export function defaultFocusY(scaleMultiplier = 1): number {
  return Minion.BODY_LOCAL_Y * Minion.SCALE * scaleMultiplier;
}
