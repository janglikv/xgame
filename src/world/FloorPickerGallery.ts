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
import {
  Floor,
  FLOOR_SURFACE_PRESETS,
  type FloorSurface,
  type FloorSurfacePreset,
} from './Floor';

export interface FloorPickerGalleryOptions {
  /** 展台中心 Z 坐标（默认 13） */
  centerZ?: number;
  onSurfaceChanged?: (surface: FloorSurface) => void;
}

/**
 * 展台数据接口
 */
interface PodiumData {
  preset: FloorSurfacePreset;
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
  private activeSurface: FloorSurface;
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
    this.activeSurface = floor.getSurface();
    this.onSurfaceChanged = options.onSurfaceChanged;

    const presets = FLOOR_SURFACE_PRESETS;
    const centerZ = options.centerZ ?? 13;
    const count = presets.length;
    const spacing = 3.5;
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
            this.selectSurface(found.preset.id);
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
    preset: FloorSurfacePreset,
    posX: number,
    posZ: number,
    index: number,
  ): PodiumData {
    const rootNode = new TransformNode(`PodiumRoot_${preset.id}`, this.scene);
    rootNode.position = new Vector3(posX, 0, posZ);
    rootNode.parent = this.root;

    // 1. 基座台
    const podiumMesh = MeshBuilder.CreateCylinder(
      `PodiumBase_${preset.id}`,
      { height: 0.2, diameter: 1.8, tessellation: 24 },
      this.scene,
    );
    podiumMesh.position.y = 0.1;
    podiumMesh.parent = rootNode;

    const baseMat = new StandardMaterial(`PodiumMat_${preset.id}`, this.scene);
    baseMat.diffuseColor = new Color3(0.12, 0.14, 0.18);
    baseMat.specularColor = new Color3(0.5, 0.5, 0.6);
    podiumMesh.material = baseMat;

    // 2. 发光圈（选中高亮环）
    const ringMesh = MeshBuilder.CreateTorus(
      `PodiumRing_${preset.id}`,
      { diameter: 1.9, thickness: 0.05, tessellation: 32 },
      this.scene,
    );
    ringMesh.position.y = 0.21;
    ringMesh.parent = rootNode;

    const ringMat = new StandardMaterial(`RingMat_${preset.id}`, this.scene);
    ringMat.diffuseColor = Color3.Black();
    ringMat.emissiveColor = new Color3(1.0, 0.75, 0.1);
    ringMat.specularColor = Color3.Black();
    ringMesh.material = ringMat;

    // 3. 悬浮展示方块
    const cubeMesh = MeshBuilder.CreateBox(
      `PodiumCube_${preset.id}`,
      { size: 1.0 },
      this.scene,
    );
    const initialY = 1.0;
    cubeMesh.position.y = initialY;
    cubeMesh.rotation.y = (index * Math.PI) / 4;
    cubeMesh.parent = rootNode;

    // 立方体材质：赋予该预设对应材质
    const cubeMat = this.createCubeMaterial(preset);
    cubeMesh.material = cubeMat;

    // 指针 ActionManager
    cubeMesh.actionManager = new ActionManager(this.scene);
    cubeMesh.actionManager.registerAction(
      new ExecuteCodeAction(ActionManager.OnPickTrigger, () => {
        this.selectSurface(preset.id);
      }),
    );

    // 4. 浮空 Billboard 3D UI 标签
    const labelMesh = MeshBuilder.CreatePlane(
      `PodiumLabel_${preset.id}`,
      { width: 2.8, height: 1.0 },
      this.scene,
    );
    labelMesh.position.y = 2.2;
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

    // 背景半透明圆框
    ctx.fillStyle = isActive
      ? 'rgba(255, 170, 0, 0.85)'
      : isNear
      ? 'rgba(0, 180, 255, 0.85)'
      : 'rgba(15, 20, 30, 0.75)';
    ctx.strokeStyle = isActive
      ? '#ffcc00'
      : isNear
      ? '#66d9ff'
      : 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 4;

    ctx.beginPath();
    drawRoundedRect(ctx, 10, 10, 492, 164, 18);
    ctx.fill();
    ctx.stroke();

    // 标题（中文名）
    ctx.fillStyle = isActive || isNear ? '#ffffff' : '#e2e8f0';
    ctx.font = 'bold 34px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(podium.preset.name, 256, 54);

    // 英文名
    ctx.fillStyle = isActive ? '#fff3cc' : isNear ? '#d4f4ff' : '#94a3b8';
    ctx.font = '20px sans-serif';
    ctx.fillText(podium.preset.englishName, 256, 92);

    // 状态 / 按键提示
    if (isActive) {
      ctx.fillStyle = '#111827';
      ctx.font = 'bold 24px sans-serif';
      ctx.fillText('✓ 当前地板模式', 256, 136);
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
   * 为悬浮预览方块创建缩略材质
   */
  private createCubeMaterial(preset: FloorSurfacePreset): StandardMaterial {
    const mat = new StandardMaterial(
      `CubePreviewMat_${preset.id}`,
      this.scene,
    );
    mat.diffuseColor = Color3.White();
    mat.specularColor = new Color3(0.3, 0.3, 0.3);

    if (preset.id === 'tiles') {
      const tex = new Texture(
        'https://www.babylonjs-playground.com/textures/albedo.png',
        this.scene,
        false,
        true,
      );
      tex.uScale = 2;
      tex.vScale = 2;
      mat.diffuseTexture = tex;
    } else {
      // 通过辅助生成独立纹理
      const tex = this.createPreviewTexture(preset.id);
      tex.uScale = 2;
      tex.vScale = 2;
      mat.diffuseTexture = tex;
      if (preset.id === 'cyberGrid') {
        mat.emissiveColor = new Color3(0.1, 0.15, 0.2);
      }
    }

    return mat;
  }

  private createPreviewTexture(id: FloorSurface): Texture {
    // 快速生成贴图
    const tex = new DynamicTexture(
      `PreviewTex_${id}`,
      { width: 256, height: 256 },
      this.scene,
      false,
    );
    tex.wrapU = Texture.WRAP_ADDRESSMODE;
    tex.wrapV = Texture.WRAP_ADDRESSMODE;

    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;

    if (id === 'cyberGrid') {
      ctx.fillStyle = '#06040c';
      ctx.fillRect(0, 0, 256, 256);
      ctx.strokeStyle = 'rgba(0, 160, 200, 0.4)';
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
    } else if (id === 'checker') {
      const step = 64;
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          ctx.fillStyle = (r + c) % 2 === 0 ? '#f0f4f8' : '#22262a';
          ctx.fillRect(c * step, r * step, step, step);
        }
      }
    } else if (id === 'sand') {
      ctx.fillStyle = '#e6c280';
      ctx.fillRect(0, 0, 256, 256);
      ctx.strokeStyle = '#c29b53';
      ctx.lineWidth = 6;
      for (let y = 20; y < 256; y += 40) {
        ctx.beginPath();
        ctx.arc(128, y, 100, 0, Math.PI);
        ctx.stroke();
      }
    } else if (id === 'marble') {
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 0, 256, 256);
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(0, 40);
      ctx.bezierCurveTo(80, 120, 160, 20, 256, 200);
      ctx.stroke();
    } else if (id === 'woodPlanks') {
      for (let p = 0; p < 4; p++) {
        ctx.fillStyle = p % 2 === 0 ? '#b47b48' : '#8c592e';
        ctx.fillRect(0, p * 64, 256, 64);
        ctx.strokeStyle = '#4a2e1b';
        ctx.lineWidth = 4;
        ctx.strokeRect(0, p * 64, 256, 64);
      }
    } else if (id === 'cobblestone') {
      ctx.fillStyle = '#332f2c';
      ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = '#78716c';
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          ctx.beginPath();
          ctx.arc(c * 80 + 48, r * 80 + 48, 30, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (id === 'dirtGrass') {
      ctx.fillStyle = '#4d7c0f';
      ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = '#78350f';
      ctx.beginPath();
      ctx.arc(80, 80, 50, 0, Math.PI * 2);
      ctx.arc(180, 180, 60, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // dark
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, 0, 256, 256);
    }

    tex.update(false);
    return tex;
  }

  /**
   * 选择并应用地板贴图
   */
  public selectSurface(surface: FloorSurface): void {
    this.activeSurface = surface;
    this.floor.setSurface(surface);
    saveFloorSurfaceState(surface);
    this.onSurfaceChanged?.(surface);
    this.updateActiveVisuals();
  }

  private updateActiveVisuals(): void {
    this.podiums.forEach((podium) => {
      const isActive = podium.preset.id === this.activeSurface;
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
      const isActive = podium.preset.id === this.activeSurface;

      // 旋转
      podium.cubeMesh.rotation.y += 0.012;

      // 上下轻微浮动 (Sine 波)
      const floatOffset = Math.sin(this.animTime * 2.5 + podium.cubeMesh.position.x) * 0.12;
      const targetY = podium.initialY + (isActive ? 0.3 : 0) + floatOffset;
      podium.cubeMesh.position.y = targetY;

      // 距离判定
      let isNear = false;
      if (minionPosition) {
        const podWorldPos = podium.rootNode.position;
        const dist = Vector3.Distance(
          new Vector3(minionPosition.x, 0, minionPosition.z),
          new Vector3(podWorldPos.x, 0, podWorldPos.z),
        );
        if (dist <= 2.2) {
          isNear = true;

          // 若按下 E 键，触发选用
          if (this.isEKeyPressed && !isActive) {
            this.selectSurface(podium.preset.id);
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

