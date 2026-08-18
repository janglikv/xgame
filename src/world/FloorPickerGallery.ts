import {
  ActionManager,
  Color3,
  DynamicTexture,
  ExecuteCodeAction,
  Mesh,
  MeshBuilder,
  PointerEventTypes,
  type Scene,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { saveFloorSurfaceState } from '../storage/floorState';
import { Floor, type FloorSurface } from './Floor';

export type LevelFloorId = 'hub' | 'level1' | 'level2';

export interface LevelFloorPreset {
  id: LevelFloorId;
  name: string;
  englishName: string;
  description: string;
  surface: FloorSurface;
}

export const LEVEL_FLOOR_PRESETS: LevelFloorPreset[] = [
  {
    id: 'hub',
    name: '大厅',
    englishName: 'Main Hub',
    description: '温润拼接胡桃木与静谧暖金微光',
    surface: 'hubGrid',
  },
  {
    id: 'level1',
    name: '第一关',
    englishName: 'Level 1',
    description: '焦黑玄武岩与炽热熔岩裂隙',
    surface: 'flameGrid',
  },
  {
    id: 'level2',
    name: '第二关',
    englishName: 'Level 2',
    description: '进阶对决赛博网格',
    surface: 'cyberGrid',
  },
];

export interface FloorPickerGalleryOptions {
  /** 展台中心 Z 坐标（默认 -14） */
  centerZ?: number;
  onSurfaceChanged?: (surface: FloorSurface) => void;
}

/**
 * 展台数据接口
 */
interface PodiumData {
  preset: LevelFloorPreset;
  rootNode: TransformNode;
  cubeMesh: Mesh;
  podiumMesh: Mesh;
  ringMesh: Mesh;
  labelMesh: Mesh;
  labelTexture: DynamicTexture;
  initialY: number;
}

export class FloorPickerGallery {
  readonly scene: Scene;
  readonly floor: Floor;
  readonly root: TransformNode;
  private podiums: PodiumData[] = [];
  private activePresetId: LevelFloorId = 'hub';
  private animTime = 0;
  private isEKeyPressed = false;
  private eKeyHandler?: (e: KeyboardEvent) => void;
  private readonly onSurfaceChanged?: (surface: FloorSurface) => void;

  constructor(
    scene: Scene,
    floor: Floor,
    options: FloorPickerGalleryOptions = {},
  ) {
    this.scene = scene;
    this.floor = floor;
    this.root = new TransformNode('FloorPickerGallery', scene);
    this.onSurfaceChanged = options.onSurfaceChanged;

    const presets = LEVEL_FLOOR_PRESETS;
    const centerZ = options.centerZ ?? -14;
    const count = presets.length;
    const spacing = 2.4;
    const startX = -((count - 1) * spacing) / 2;

    presets.forEach((preset, index) => {
      const posX = startX + index * spacing;
      const posZ = centerZ;
      const podium = this.createPodium(preset, posX, posZ, index);
      this.podiums.push(podium);
    });

    // 点击拾取监听
    this.scene.onPointerObservable.add((pointerInfo) => {
      if (pointerInfo.type === PointerEventTypes.POINTERDOWN) {
        const pickResult = pointerInfo.pickInfo;
        if (pickResult?.hit && pickResult.pickedMesh) {
          const pickedName = pickResult.pickedMesh.name;
          const found = this.podiums.find(
            (p) =>
              p.cubeMesh.name === pickedName ||
              p.podiumMesh.name === pickedName,
          );
          if (found) {
            this.selectPreset(found.preset.id);
          }
        }
      }
    });

    // 键盘 E 键监听
    this.eKeyHandler = (e: KeyboardEvent) => {
      if (e.key === 'e' || e.key === 'E') {
        this.isEKeyPressed = true;
      }
    };
    window.addEventListener('keydown', this.eKeyHandler);

    this.updateActiveVisuals();
  }

  /**
   * 创建单座展台
   */
  private createPodium(
    preset: LevelFloorPreset,
    posX: number,
    posZ: number,
    index: number,
  ): PodiumData {
    const rootNode = new TransformNode(`PodiumRoot_${preset.id}`, this.scene);
    rootNode.position = new Vector3(posX, 0, posZ);
    rootNode.parent = this.root;

    // 1. 基座台（同步缩小一倍）
    const podiumMesh = MeshBuilder.CreateCylinder(
      `PodiumBase_${preset.id}`,
      { height: 0.1, diameter: 0.9, tessellation: 24 },
      this.scene,
    );
    podiumMesh.position.y = 0.05;
    podiumMesh.parent = rootNode;

    const baseMat = new StandardMaterial(`PodiumMat_${preset.id}`, this.scene);
    baseMat.diffuseColor = new Color3(0.12, 0.14, 0.18);
    baseMat.specularColor = new Color3(0.5, 0.5, 0.6);
    podiumMesh.material = baseMat;

    // 2. 发光圈（选中高亮环，同步缩小一倍）
    const ringMesh = MeshBuilder.CreateTorus(
      `PodiumRing_${preset.id}`,
      { diameter: 0.95, thickness: 0.025, tessellation: 32 },
      this.scene,
    );
    ringMesh.position.y = 0.105;
    ringMesh.parent = rootNode;

    const ringMat = new StandardMaterial(`RingMat_${preset.id}`, this.scene);
    ringMat.diffuseColor = Color3.Black();
    ringMat.emissiveColor = new Color3(0.1, 0.85, 1.0);
    ringMat.specularColor = Color3.Black();
    ringMesh.material = ringMat;

    // 3. 悬浮展示方块（尺寸 0.5）
    const cubeMesh = MeshBuilder.CreateBox(
      `PodiumCube_${preset.id}`,
      { size: 0.5 },
      this.scene,
    );
    const initialY = 0.55;
    cubeMesh.position.y = initialY;
    cubeMesh.rotation.y = (index * Math.PI) / 4;
    cubeMesh.parent = rootNode;

    // 立方体材质：采用赛博网格材质
    const cubeMat = this.createCyberCubeMaterial(preset.id);
    cubeMesh.material = cubeMat;

    // 指针 ActionManager
    cubeMesh.actionManager = new ActionManager(this.scene);
    cubeMesh.actionManager.registerAction(
      new ExecuteCodeAction(ActionManager.OnPickTrigger, () => {
        this.selectPreset(preset.id);
      }),
    );

    // 4. 浮空 Billboard 3D UI 标签（尺寸同步缩小一倍：宽 1.4，高 0.5）
    const labelMesh = MeshBuilder.CreatePlane(
      `PodiumLabel_${preset.id}`,
      { width: 1.4, height: 0.5 },
      this.scene,
    );
    labelMesh.position.y = 1.15;
    labelMesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
    labelMesh.parent = rootNode;

    const labelTex = new DynamicTexture(
      `PodiumLabelTex_${preset.id}`,
      { width: 512, height: 184 },
      this.scene,
      true,
    );
    labelTex.hasAlpha = true;

    const labelMat = new StandardMaterial(
      `PodiumLabelMat_${preset.id}`,
      this.scene,
    );
    labelMat.diffuseTexture = labelTex;
    labelMat.emissiveTexture = labelTex;
    labelMat.useAlphaFromDiffuseTexture = true;
    labelMat.specularColor = Color3.Black();
    labelMat.backFaceCulling = false;
    labelMesh.material = labelMat;

    const podiumData: PodiumData = {
      preset,
      rootNode,
      cubeMesh,
      podiumMesh,
      ringMesh,
      labelMesh,
      labelTexture: labelTex,
      initialY,
    };

    this.renderLabelText(podiumData, false, false);
    return podiumData;
  }

  /**
   * 绘制 3D Billboard 悬浮标签文字
   */
  private renderLabelText(
    podium: PodiumData,
    isActive: boolean,
    isNear: boolean,
  ): void {
    const tex = podium.labelTexture;
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 512, 184);

    // 背景半透明圆角矩形框
    ctx.fillStyle = isActive
      ? 'rgba(0, 160, 230, 0.85)'
      : isNear
      ? 'rgba(0, 200, 180, 0.85)'
      : 'rgba(15, 20, 30, 0.75)';
    ctx.strokeStyle = isActive
      ? '#00e5ff'
      : isNear
      ? '#38bdf8'
      : 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 4;

    ctx.beginPath();
    drawRoundedRect(ctx, 10, 10, 492, 164, 18);
    ctx.fill();
    ctx.stroke();

    // 标题（中文名：第一关 / 第二关 / 第三关）
    ctx.fillStyle = isActive || isNear ? '#ffffff' : '#e2e8f0';
    ctx.font = 'bold 34px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(podium.preset.name, 256, 54);

    // 英文名（Level 1 / Level 2 / Level 3）
    ctx.fillStyle = isActive ? '#d4f4ff' : isNear ? '#e0f2fe' : '#94a3b8';
    ctx.font = '20px sans-serif';
    ctx.fillText(podium.preset.englishName, 256, 92);

    // 状态 / 按键提示
    if (isActive) {
      ctx.fillStyle = '#061325';
      ctx.font = 'bold 24px sans-serif';
      ctx.fillText('✓ 当前关卡地面', 256, 136);
    } else if (isNear) {
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 24px sans-serif';
      ctx.fillText('👉 按 [ E ] 或点击选用', 256, 136);
    } else {
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '20px sans-serif';
      ctx.fillText('点击或靠近按 E', 256, 136);
    }

    tex.update(true);
  }

  /**
   * 为悬浮预览方块创建赛博网格材质
   */
  private createCyberCubeMaterial(id: string): StandardMaterial {
    const mat = new StandardMaterial(
      `CubePreviewMat_${id}`,
      this.scene,
    );
    mat.diffuseColor = new Color3(0.8, 0.9, 1.0);
    mat.emissiveColor = new Color3(0.08, 0.14, 0.22);
    mat.specularColor = new Color3(0.3, 0.4, 0.5);

    const tex = new DynamicTexture(
      `CyberGridPreviewTex_${id}`,
      { width: 256, height: 256 },
      this.scene,
      false,
    );
    tex.wrapU = Texture.WRAP_ADDRESSMODE;
    tex.wrapV = Texture.WRAP_ADDRESSMODE;
    tex.uScale = 1;
    tex.vScale = 1;

    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;

    if (id === 'hub') {
      // 大厅专属温馨静谧暖木与金边方块贴图
      ctx.fillStyle = '#221913';
      ctx.fillRect(0, 0, 256, 256);

      // 交错拼木方格纹理
      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < 2; c++) {
          const bx = c * 128;
          const by = r * 128;
          const isH = (r + c) % 2 === 0;

          ctx.fillStyle = (r + c) % 2 === 0 ? '#2c2018' : '#261b14';
          ctx.fillRect(bx, by, 128, 128);

          // 木纹内细线
          ctx.strokeStyle = 'rgba(255, 225, 185, 0.05)';
          ctx.lineWidth = 1;
          for (let k = 1; k <= 3; k++) {
            if (isH) {
              ctx.beginPath();
              ctx.moveTo(bx + 4, by + k * 32);
              ctx.lineTo(bx + 124, by + k * 32);
              ctx.stroke();
            } else {
              ctx.beginPath();
              ctx.moveTo(bx + k * 32, by + 4);
              ctx.lineTo(bx + k * 32, by + 124);
              ctx.stroke();
            }
          }

          ctx.strokeStyle = '#120d09';
          ctx.lineWidth = 2;
          ctx.strokeRect(bx, by, 128, 128);
        }
      }

      // 暖金微光外框
      ctx.strokeStyle = 'rgba(230, 180, 100, 0.5)';
      ctx.lineWidth = 2;
      ctx.strokeRect(4, 4, 248, 248);

      // 节点中心暖金微光晶核
      ctx.fillStyle = 'rgba(255, 210, 110, 0.95)';
      ctx.beginPath();
      ctx.arc(128, 128, 5, 0, Math.PI * 2);
      ctx.fill();
    } else if (id === 'level1') {
      // 第一关专属暗黑火系余烬方块贴图（极致暗黑）
      ctx.fillStyle = '#060202';
      ctx.fillRect(0, 0, 256, 256);

      // 玄武岩焦黑石板块
      ctx.fillStyle = '#0c0403';
      ctx.fillRect(8, 8, 116, 116);
      ctx.fillRect(132, 8, 116, 116);
      ctx.fillRect(8, 132, 116, 116);
      ctx.fillRect(132, 132, 116, 116);

      // 深红暗火裂隙微晕
      ctx.strokeStyle = 'rgba(120, 15, 8, 0.20)';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(128, 0);
      ctx.lineTo(128, 256);
      ctx.moveTo(0, 128);
      ctx.lineTo(256, 128);
      ctx.stroke();

      // 幽暗深血红流线
      ctx.strokeStyle = 'rgba(160, 25, 10, 0.45)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(128, 0);
      ctx.lineTo(128, 256);
      ctx.moveTo(0, 128);
      ctx.lineTo(256, 128);
      ctx.stroke();

      // 极细暗赤橙火芯
      ctx.strokeStyle = 'rgba(195, 60, 20, 0.65)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(128, 0);
      ctx.lineTo(128, 256);
      ctx.moveTo(0, 128);
      ctx.lineTo(256, 128);
      ctx.stroke();

      // 熔岩中心微小暗火晶体
      ctx.fillStyle = 'rgba(210, 70, 20, 0.85)';
      ctx.beginPath();
      ctx.arc(128, 128, 3.5, 0, Math.PI * 2);
      ctx.fill();

      // 散落极微弱余烬火星
      const embers = [
        [40, 50],
        [200, 40],
        [60, 210],
        [210, 190],
      ];
      ctx.fillStyle = 'rgba(175, 45, 15, 0.55)';
      for (const [ex, ey] of embers) {
        ctx.beginPath();
        ctx.arc(ex, ey, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // 竞技场网格方块贴图
      ctx.fillStyle = '#070814';
      ctx.fillRect(0, 0, 256, 256);

      ctx.strokeStyle = 'rgba(0, 190, 240, 0.45)';
      ctx.lineWidth = 2;
      for (let i = 0; i <= 256; i += 32) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, 256);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(256, i);
        ctx.stroke();
      }

      // 交叉点发光微点
      ctx.fillStyle = 'rgba(0, 230, 255, 0.8)';
      for (let x = 0; x <= 256; x += 32) {
        for (let y = 0; y <= 256; y += 32) {
          ctx.beginPath();
          ctx.arc(x, y, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    tex.update(false);
    mat.diffuseTexture = tex;
    return mat;
  }

  /**
   * 选择并应用关卡地面
   */
  public selectPreset(presetId: LevelFloorId): void {
    const targetPreset = LEVEL_FLOOR_PRESETS.find((p) => p.id === presetId);
    if (!targetPreset) return;

    this.activePresetId = presetId;
    this.floor.setSurface(targetPreset.surface);
    saveFloorSurfaceState(targetPreset.surface);
    this.onSurfaceChanged?.(targetPreset.surface);
    this.updateActiveVisuals();
  }

  public getActivePresetId(): LevelFloorId {
    return this.activePresetId;
  }

  private updateActiveVisuals(): void {
    this.podiums.forEach((podium) => {
      const isActive = podium.preset.id === this.activePresetId;
      podium.ringMesh.isVisible = isActive;
      this.renderLabelText(podium, isActive, false);
    });
  }

  /**
   * 帧更新：自转 + 悬浮 + 靠近提示 + E 键判定
   */
  public update(minionPosition?: Vector3): void {
    this.animTime += 0.02;

    this.podiums.forEach((podium) => {
      const isActive = podium.preset.id === this.activePresetId;

      // 旋转
      podium.cubeMesh.rotation.y += 0.012;

      // 上下轻微浮动 (Sine 波)
      const floatOffset =
        Math.sin(this.animTime * 2.5 + podium.cubeMesh.position.x) * 0.04;
      const targetY = podium.initialY + (isActive ? 0.15 : 0) + floatOffset;
      podium.cubeMesh.position.y = targetY;

      // 距离判定
      let isNear = false;
      if (minionPosition) {
        const podWorldPos = podium.rootNode.position;
        const dist = Vector3.Distance(
          new Vector3(minionPosition.x, 0, minionPosition.z),
          new Vector3(podWorldPos.x, 0, podWorldPos.z),
        );
        if (dist <= 1.6) {
          isNear = true;

          // 若按下 E 键，触发选用
          if (this.isEKeyPressed && !isActive) {
            this.selectPreset(podium.preset.id);
          }
        }
      }

      // 重新绘出 label 变化 (当近距离状态变更时)
      this.renderLabelText(podium, isActive, isNear);
    });

    this.isEKeyPressed = false;
  }

  public dispose(): void {
    if (this.eKeyHandler) {
      window.removeEventListener('keydown', this.eKeyHandler);
    }
    this.root.dispose();
  }
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.arcTo(x + width, y, x + width, y + radius, radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.arcTo(x + width, y + height, x + width - radius, y + height, radius);
  ctx.lineTo(x + radius, y + height);
  ctx.arcTo(x, y + height, x, y + height - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
}
