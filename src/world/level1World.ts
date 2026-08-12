import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  type Engine,
  HemisphericLight,
  Scene,
  ShadowGenerator,
  Vector3,
} from '@babylonjs/core';
import {
  FIXED_CAMERA,
  FREE_CAMERA_FOV,
  type CameraMode,
} from '../storage/settingsState';
import {
  Minion,
  type MinionAppearance,
} from './Minion';
import {
  buildArenaColliders,
  initPhysics,
  MinionPhysicsProxy,
} from './physics';
import { Floor } from './Floor';
import { SpatialAxesGrid } from './SpatialAxesGrid';
import { TeleportPad } from './TeleportPad';

/** 第一关（Level 1）可玩地图边长（米）：20×20 */
export const BLANK_MAP_SIZE = 20;
/** 半边长（X/Z ∈ [−half, +half]，即 [−10, +10]） */
export const BLANK_MAP_HALF = BLANK_MAP_SIZE / 2;
/** 可视地板相对围墙四边外延格数（1 格 = 1 米） */
export const BLANK_FLOOR_EXTEND = 10;
/**
 * 回程传送阵位置（须在 20×20 地图内）。
 * 距 +X 边约 3m，与枢纽「边侧放置」风格一致。
 */
export const BLANK_PAD_X = 7;
export const BLANK_PAD_Z = 0;

/** 将坐标钳到空白场景可站立区域（留半米边距） */
export function clampBlankMapPosition(
  x: number,
  z: number,
  margin = 0.5,
): { x: number; z: number } {
  const lim = BLANK_MAP_HALF - margin;
  return {
    x: Math.max(-lim, Math.min(lim, x)),
    z: Math.max(-lim, Math.min(lim, z)),
  };
}

export interface BlankWorld {
  scene: Scene;
  camera: ArcRotateCamera;
  minion: Minion;
  minionPhys: MinionPhysicsProxy;
  floor: Floor;
  spatialAxesGrid: SpatialAxesGrid;
  /** 回枢纽传送阵（站上蓄力自动返回） */
  teleportPad: TeleportPad;
  /** 将相机控制挂到 canvas（自由模式） */
  attachCamera(canvas: HTMLCanvasElement): void;
  detachCamera(): void;
  setCameraMode(mode: CameraMode, canvas: HTMLCanvasElement): void;
  /** 同步玩家外观（从枢纽场景带入） */
  applyAppearance(appearance: MinionAppearance): void;
  dispose(): void;
}

/**
 * 第一关（Level 1）：仅地板 + 光照 + 可操控主角。
 * 独立 Scene / 物理世界，与枢纽互不干扰。
 * 可玩区 20×20（X/Z ∈ [−10, +10]）；可视地板四边各外延 10 格。
 */
export async function createBlankWorld(
  engine: Engine,
  appearance: MinionAppearance,
  cameraMode: CameraMode,
  initialX = BLANK_PAD_X,
  initialZ = BLANK_PAD_Z,
): Promise<BlankWorld> {
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  const skyColor = Color3.Black();
  scene.clearColor = Color4.FromColor3(skyColor, 1);
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogColor = skyColor;
  // 雾推远：墙外 10 格延展地板仍清晰可见
  scene.fogStart = 28;
  scene.fogEnd = 48;

  await initPhysics(scene);

  const hemi = new HemisphericLight('blankHemi', new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.55;
  hemi.groundColor = new Color3(0.15, 0.16, 0.18);

  const dir = new DirectionalLight(
    'blankDir',
    new Vector3(-12, -22, -14).normalize(),
    scene,
  );
  dir.position = new Vector3(12, 22, 14);
  dir.intensity = 1.25;

  const shadowGen = new ShadowGenerator(1024, dir);
  shadowGen.usePercentageCloserFiltering = true;
  shadowGen.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
  shadowGen.bias = 0.0005;
  shadowGen.normalBias = 0.01;
  dir.autoUpdateExtends = false;
  // 阴影覆盖可玩区 + 外延地板
  const shadowHalf = BLANK_MAP_HALF + BLANK_FLOOR_EXTEND + 4;
  dir.orthoLeft = -shadowHalf;
  dir.orthoRight = shadowHalf;
  dir.orthoTop = shadowHalf;
  dir.orthoBottom = -shadowHalf;
  dir.shadowMinZ = 1;
  dir.shadowMaxZ = 70;

  // 可玩 20×20 + 围墙；中心 3x3 围墙 + 右下角 L 型围墙
  const half = BLANK_MAP_HALF;
  const floor = new Floor(scene, shadowGen, {
    surface: 'cyberGrid',
    halfX: half,
    halfZ: half,
    extend: BLANK_FLOOR_EXTEND,
    centerWallSize: 3,
    addLWall: true,
  });
  buildArenaColliders(scene, {
    includeFloor: true,
    halfX: half,
    halfZ: half,
    centerWallSize: 3,
    addLWall: true,
  });
  const spatialAxesGrid = new SpatialAxesGrid(scene, {
    extentX: half,
    extentZ: half,
  });

  // 回程传送阵（地图内侧）
  const teleportPad = new TeleportPad(scene, BLANK_PAD_X, BLANK_PAD_Z);

  // 出生点（钳制在地图内，避免出生在中心 3x3 围墙重叠区）
  let spawn = clampBlankMapPosition(initialX, initialZ);
  if (Math.abs(spawn.x) < 2.2 && Math.abs(spawn.z) < 2.2) {
    spawn = { x: BLANK_PAD_X, z: BLANK_PAD_Z };
  }
  const minion = new Minion(scene, spawn.x, spawn.z, {
    facePositiveX: true,
    shadowGenerator: shadowGen,
    face: appearance.face,
    mosaicFace: appearance.mosaicFace,
    bodyColor: appearance.bodyColor,
    hat: appearance.hat ?? undefined,
    staff: appearance.staff ?? undefined,
    scaleMultiplier: appearance.scaleMultiplier,
    lowPolyFlat: appearance.lowPolyFlat,
    formation: appearance.formation,
  });
  const minionPhys = new MinionPhysicsProxy(scene, minion.root, {
    mode: 'player',
    radius: 0.13,
    height: 0.38,
    mass: 2.6,
  });
  minionPhys.teleportToTarget();

  // 固定 = 略倾俯视（与枢纽 FIXED_CAMERA 一致）；自由 = 调试轨道
  const focusY = Minion.BODY_LOCAL_Y * Minion.SCALE * appearance.scaleMultiplier;
  const camera = new ArcRotateCamera(
    'blankCam',
    cameraMode === 'fixed' ? FIXED_CAMERA.alpha : -Math.PI / 4,
    cameraMode === 'fixed' ? FIXED_CAMERA.beta : Math.PI / 3,
    cameraMode === 'fixed' ? FIXED_CAMERA.radius : 17,
    new Vector3(0, focusY, 0),
    scene,
  );
  camera.lowerRadiusLimit = 2;
  camera.upperRadiusLimit = 120;
  camera.wheelPrecision = 40;
  camera.panningSensibility = 80;
  camera.keysUp = [];
  camera.keysDown = [];
  camera.keysLeft = [];
  camera.keysRight = [];
  camera.minZ = 0.1;
  camera.maxZ = 1000;

  /** 固定俯视锁定：角色居中、略倾 + 窄 FOV 弱透视 */
  const lockFixed = (): void => {
    camera.alpha = FIXED_CAMERA.alpha;
    camera.beta = FIXED_CAMERA.beta;
    camera.radius = FIXED_CAMERA.radius;
    camera.fov = FIXED_CAMERA.fov;
  };
  if (cameraMode === 'fixed') {
    lockFixed();
  } else {
    camera.fov = FREE_CAMERA_FOV;
  }

  return {
    scene,
    camera,
    minion,
    minionPhys,
    floor,
    spatialAxesGrid,
    teleportPad,
    attachCamera(canvas) {
      camera.attachControl(canvas, true);
    },
    detachCamera() {
      camera.detachControl();
    },
    setCameraMode(mode, canvas) {
      if (mode === 'fixed') {
        camera.detachControl();
        lockFixed();
      } else {
        camera.fov = FREE_CAMERA_FOV;
        camera.attachControl(canvas, true);
      }
    },
    applyAppearance(next) {
      minion.applyPatch(next);
    },
    dispose() {
      teleportPad.dispose();
      minionPhys.dispose();
      scene.dispose();
    },
  };
}
