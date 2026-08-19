import {
  Color3,
  Color4,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  type Scene,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { playSfx } from '../audio/Sfx';
import type { Minion } from './Minion';
import type { HealthBar } from './HealthBar';

interface HealthPackItem {
  node: TransformNode;
  modelNode: TransformNode;
  shadowDisc: Mesh;
  particleSystem: ParticleSystem;
  x: number;
  z: number;
  isActive: boolean;
}

/** 拾取距离（米） */
const PICKUP_RADIUS = 0.85;
/** 恢复生命值（点） */
const HEAL_AMOUNT = 40;

/**
 * 3D 地图血包系统：
 * 1. 关卡中心 (0, 0) 悬浮旋转 3D 纯深绿色十字架；
 * 2. 正立直观视角 + 环绕浮空小加号“+”粒子特效；
 * 3. 附带地面动态阴影（随沉浮上下缩放，强化空间悬浮立体感）；
 * 4. 主角靠近 0.85 米且未满血时恢复 +40 HP，只刷新一次，吃掉后彻底消失不再刷新。
 */
export class HealthPackSystem {
  private readonly scene: Scene;
  private readonly packs: HealthPackItem[] = [];
  private animTime = 0;
  private plusTexture: Texture | null = null;

  constructor(scene: Scene) {
    this.scene = scene;
    this.initCornerPacks();
  }

  /**
   * 延迟生成/复用高清小加号“+”粒子纹理
   */
  private getPlusTexture(): Texture {
    if (!this.plusTexture) {
      const dynTex = new DynamicTexture('plusParticleTex', 128, this.scene, false);
      const ctx = dynTex.getContext() as CanvasRenderingContext2D;
      ctx.clearRect(0, 0, 128, 128);
      ctx.fillStyle = '#ffffff';

      // 绘制纯正工整的十字加号
      const w = 22;
      const h = 74;
      // 水平条
      ctx.fillRect((128 - h) / 2, (128 - w) / 2, h, w);
      // 垂直条
      ctx.fillRect((128 - w) / 2, (128 - h) / 2, w, h);

      dynTex.update(false);
      dynTex.hasAlpha = true;
      this.plusTexture = dynTex;
    }
    return this.plusTexture;
  }

  /**
   * 初始化地图固定血包刷新点（仅保留关卡中心血包）
   */
  private initCornerPacks(): void {
    // 关卡最中心位置 (0, 0)
    const cornerCoords = [
      { x: 0, z: 0 },   // 关卡正中心
    ];

    for (const pos of cornerCoords) {
      const pack = this.createHealthPackMesh(pos.x, pos.z);
      this.packs.push(pack);
    }
  }

  /**
   * 构建 3D 深绿色一横一竖十字架血包模型与环绕小加号粒子
   */
  private createHealthPackMesh(x: number, z: number): HealthPackItem {
    const scene = this.scene;

    const root = new TransformNode(`healthPackRoot_${x}_${z}`, scene);
    root.position.set(x, 0, z);

    // 1. 地面动态悬浮阴影 (Ground Shadow Disc)
    const shadowDisc = MeshBuilder.CreateDisc(
      'shadowDisc',
      { radius: 0.26, tessellation: 20 },
      scene,
    );
    shadowDisc.rotation.x = Math.PI / 2;
    shadowDisc.position.y = 0.02;
    shadowDisc.parent = root;
    shadowDisc.isPickable = false;

    const shadowMat = new StandardMaterial('shadowMat', scene);
    shadowMat.diffuseColor = new Color3(0.02, 0.1, 0.04);
    shadowMat.emissiveColor = new Color3(0, 0, 0);
    shadowMat.disableLighting = true;
    shadowMat.backFaceCulling = false;
    shadowMat.alpha = 0.4;
    shadowDisc.material = shadowMat;

    // 2. 浮空 3D 旋转模型组 (Model Node at y=0.45)
    const modelNode = new TransformNode('healthPackModel', scene);
    modelNode.parent = root;
    modelNode.position.y = 0.45;

    // 姿态放正 (无 X/Z 轴倾斜，保持垂直正立自转)
    modelNode.rotation.x = 0;
    modelNode.rotation.z = 0;

    // 深绿色纯色材质 (Solid Dark Green)
    const darkGreenMat = new StandardMaterial('packDarkGreenMat', scene);
    const darkGreenColor = Color3.FromHexString('#1b5e20'); // 纯正典雅深绿
    darkGreenMat.diffuseColor = darkGreenColor;
    darkGreenMat.emissiveColor = Color3.FromHexString('#0a3611'); // 暗部纯色深绿保底自发光
    darkGreenMat.specularColor = Color3.Black(); // 无杂色高光，呈现纯色质感
    darkGreenMat.disableLighting = false;
    darkGreenMat.backFaceCulling = false;

    // 简易 3D 深绿十字架：一竖 (crossV) + 一横 (crossH) (精致缩小版)
    const crossV = MeshBuilder.CreateBox(
      'crossV',
      { width: 0.11, height: 0.30, depth: 0.11 },
      scene,
    );
    crossV.material = darkGreenMat;
    crossV.parent = modelNode;
    crossV.isPickable = false;

    const crossH = MeshBuilder.CreateBox(
      'crossH',
      { width: 0.30, height: 0.11, depth: 0.11 },
      scene,
    );
    crossH.material = darkGreenMat;
    crossH.parent = modelNode;
    crossH.isPickable = false;

    // 3. 环绕飘浮小“+”号粒子系统 (Floating "+" Particle System)
    const ps = new ParticleSystem(`plusPS_${x}_${z}`, 30, scene);
    ps.particleTexture = this.getPlusTexture();
    ps.emitter = new Vector3(x, 0.45, z);
    ps.minEmitBox = new Vector3(-0.30, -0.20, -0.30);
    ps.maxEmitBox = new Vector3(0.30, 0.20, 0.30);

    ps.color1 = new Color4(0.35, 1.0, 0.55, 0.95);
    ps.color2 = new Color4(0.15, 0.9, 0.4, 0.85);
    ps.colorDead = new Color4(0.05, 0.55, 0.2, 0.0);

    ps.minSize = 0.12;
    ps.maxSize = 0.20;

    ps.minLifeTime = 1.0;
    ps.maxLifeTime = 1.8;

    ps.emitRate = 8;

    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;

    ps.gravity = new Vector3(0, 0.25, 0);
    ps.direction1 = new Vector3(-0.12, 0.25, -0.12);
    ps.direction2 = new Vector3(0.12, 0.55, 0.12);

    ps.minAngularSpeed = -0.6;
    ps.maxAngularSpeed = 0.6;

    ps.targetStopDuration = 0;

    ps.start();

    return {
      node: root,
      modelNode,
      shadowDisc,
      particleSystem: ps,
      x,
      z,
      isActive: true,
    };
  }

  /**
   * 每帧更新血包旋转浮空动画 + 距离检测 + 治疗拾取（单次拾取，吃掉即消失）
   */
  update(dt: number, player: Minion, playerHealthBar: HealthBar): void {
    this.animTime += dt;
    const playerPos = player.root.position;

    for (const pack of this.packs) {
      if (!pack.isActive) continue;

      // 浮空上下沉浮与自转
      pack.modelNode.rotation.y += dt * 1.8;
      const bobOffset = Math.sin(this.animTime * 2.5) * 0.08;
      pack.modelNode.position.y = 0.42 + bobOffset;
      // 地面悬浮阴影随高低沉浮动态微缩放，强化立体真实感
      const shadowScale = 0.85 - bobOffset * 1.5;
      pack.shadowDisc.scaling.set(shadowScale, shadowScale, shadowScale);

      // 拾取距离与生命值检测
      const dist = Math.hypot(playerPos.x - pack.x, playerPos.z - pack.z);
      const currentHp = playerHealthBar.getHp();
      const maxHp = playerHealthBar.getMaxHp();

      // 玩家靠近且未满血时触发拾取（未满血避免路过误消耗）
      if (dist <= PICKUP_RADIUS && !player.isDead() && currentHp < maxHp) {
        const newHp = Math.min(maxHp, currentHp + HEAL_AMOUNT);
        const actualHealed = newHp - currentHp;
        playerHealthBar.setHp(newHp);

        // 拾取时播放音效反馈
        playSfx('/audio/heal.mp3', 0.55);

        // 视觉特效
        if (actualHealed > 0) {
          this.triggerHealFx(playerPos, actualHealed);
        }

        // 消耗血包：仅刷新一次，吃掉后彻底消失不再刷新
        pack.isActive = false;
        pack.node.setEnabled(false);
        pack.particleSystem.stop();
      }
    }
  }

  /**
   * 玩家拾取血包时的小加号“+”粒子喷涌升腾特效
   * @param healAmount 实际恢复的生命值点数
   */
  private triggerHealFx(playerPos: Vector3, healAmount: number): void {
    if (healAmount <= 0) return;

    const scene = this.scene;

    // 加号粒子数量由恢复量决定 (最大 40 点对应 12 个，恢复量较小时至少 2 个)
    const plusCount = Math.max(2, Math.min(12, Math.round((healAmount / HEAL_AMOUNT) * 12)));

    // 喷涌升腾的小加号“+”粒子特效 (数量由恢复量动态决定)
    const ps = new ParticleSystem('healBurstPlusFx', plusCount + 2, scene);
    ps.particleTexture = this.getPlusTexture();
    ps.emitter = playerPos.clone().add(new Vector3(0, 0.2, 0));
    ps.minEmitBox = new Vector3(-0.25, -0.1, -0.25);
    ps.maxEmitBox = new Vector3(0.25, 0.25, 0.25);

    // 鲜艳明亮的治疗翡翠绿与亮白绿渐变
    ps.color1 = new Color4(0.35, 1.0, 0.55, 0.95);
    ps.color2 = new Color4(0.15, 0.9, 0.4, 0.85);
    ps.colorDead = new Color4(0.05, 0.55, 0.2, 0.0);

    ps.minSize = 0.10;
    ps.maxSize = 0.18;

    ps.minLifeTime = 0.55;
    ps.maxLifeTime = 0.95;

    // 单次爆发发射对应数量的小加号
    ps.manualEmitCount = plusCount;
    ps.minEmitPower = 0.8;
    ps.maxEmitPower = 1.8;

    // 向上升腾加速度与随机向外微散
    ps.gravity = new Vector3(0, 1.4, 0);
    ps.direction1 = new Vector3(-0.35, 1.2, -0.35);
    ps.direction2 = new Vector3(0.35, 2.0, 0.35);

    ps.minAngularSpeed = -1.0;
    ps.maxAngularSpeed = 1.0;

    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;

    ps.targetStopDuration = 0.15;
    ps.disposeOnStop = true;
    ps.start();
  }


  dispose(): void {
    for (const pack of this.packs) {
      if (pack.particleSystem) {
        pack.particleSystem.dispose();
      }
      if (!pack.node.isDisposed) {
        pack.node.dispose();
      }
    }
    this.packs.length = 0;
    if (this.plusTexture) {
      this.plusTexture.dispose();
      this.plusTexture = null;
    }
  }
}
