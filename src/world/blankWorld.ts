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
import { SpatialAxesGrid } from './SpatialAxesGrid';
import { createTerrainGround } from './TerrainGround';
import { TeleportPad } from './TeleportPad';

export interface BlankWorld {
  scene: Scene;
  camera: ArcRotateCamera;
  minion: Minion;
  minionPhys: MinionPhysicsProxy;
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
 * 空白场景：仅地板 + 光照 + 可操控主角（暂无其它内容）。
 * 独立 Scene / 物理世界，与枢纽互不干扰。
 */
export async function createBlankWorld(
  engine: Engine,
  appearance: MinionAppearance,
  cameraMode: CameraMode,
  initialX = TeleportPad.DEFAULT_X,
  initialZ = TeleportPad.DEFAULT_Z,
): Promise<BlankWorld> {
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  const skyColor = Color3.Black();
  scene.clearColor = Color4.FromColor3(skyColor, 1);
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogColor = skyColor;
  scene.fogStart = 22;
  scene.fogEnd = 45;

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
  shadowGen.bias = 0.001;
  shadowGen.normalBias = 0.02;
  dir.autoUpdateExtends = false;
  dir.orthoLeft = -32;
  dir.orthoRight = 32;
  dir.orthoTop = 32;
  dir.orthoBottom = -32;
  dir.shadowMinZ = 1;
  dir.shadowMaxZ = 70;

  // 完全平坦草地（TerrainMaterial 贴图混合，无 heightMap 高低差）
  // 物理：标准平面地板 + 围墙（与枢纽一致）
  createTerrainGround(scene, shadowGen, { textureScale: 36 });
  buildArenaColliders(scene, { includeFloor: true });
  new SpatialAxesGrid(scene);

  // 回程传送阵：与枢纽同坐标风格，站在阵中按 E 返回
  const teleportPad = new TeleportPad(
    scene,
    TeleportPad.DEFAULT_X,
    TeleportPad.DEFAULT_Z,
  );

  // 出生点
  const minion = new Minion(scene, initialX, initialZ, {
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

  const lockFixed = (): void => {
    camera.alpha = FIXED_CAMERA.alpha;
    camera.beta = FIXED_CAMERA.beta;
    camera.radius = FIXED_CAMERA.radius;
  };
  if (cameraMode === 'fixed') {
    lockFixed();
  }

  return {
    scene,
    camera,
    minion,
    minionPhys,
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
