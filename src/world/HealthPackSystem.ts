import {
  Color3,
  Mesh,
  MeshBuilder,
  type Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import type { Minion } from './Minion';
import type { HealthBar } from './HealthBar';

interface HealthPackItem {
  node: TransformNode;
  modelNode: TransformNode;
  shadowDisc: Mesh;
  x: number;
  z: number;
  isActive: boolean;
  respawnTimer: number;
}

/** 拾取距离（米） */
const PICKUP_RADIUS = 0.85;
/** 恢复生命值（点） */
const HEAL_AMOUNT = 40;
/** 刷新冷却时间（秒） */
const RESPAWN_INTERVAL = 12.0;

/**
 * 3D 地图四个角固定刷新血包系统：
 * 1. 地图四个角 (±7.8, ±7.8) 悬浮旋转 3D 强立体感绿色十字架；
 * 2. 具备 3D 姿态倾斜、真实定向光照与高光镜面反射（高光/暗面明暗对比突出 3D 体积感）；
 * 3. 附带地面动态阴影（随沉浮上下缩放，强化空间悬浮立体感）；
 * 4. 主角靠近 0.85 米内恢复 +40 HP，拾取后 12 秒重新刷新。
 */
export class HealthPackSystem {
  private readonly scene: Scene;
  private readonly packs: HealthPackItem[] = [];
  private animTime = 0;

  constructor(scene: Scene) {
    this.scene = scene;
    this.initCornerPacks();
  }

  /**
   * 初始化地图四个角的固定血包刷新点
   */
  private initCornerPacks(): void {
    // 20×20 地图四个内角位置 (留 2.2m 边距防贴墙)
    const cornerCoords = [
      { x: -7.8, z: 7.8 },  // 左上
      { x: 7.8, z: 7.8 },   // 右上
      { x: -7.8, z: -7.8 }, // 左下
      { x: 7.8, z: -7.8 },  // 右下
    ];

    for (const pos of cornerCoords) {
      const pack = this.createHealthPackMesh(pos.x, pos.z);
      this.packs.push(pack);
    }
  }

  /**
   * 构建 3D 立体感强烈的绿色十字架血包模型
   * (开启光照与高光反射 + 3D 姿态倾斜 + 双层立体切边 + 地面悬浮阴影)
   */
  private createHealthPackMesh(x: number, z: number): HealthPackItem {
    const scene = this.scene;

    const root = new TransformNode(`healthPackRoot_${x}_${z}`, scene);
    root.position.set(x, 0, z);

    // 1. 地面动态悬浮阴影 (Ground Shadow Disc)
    const shadowDisc = MeshBuilder.CreateDisc(
      'shadowDisc',
      { radius: 0.35, tessellation: 20 },
      scene,
    );
    shadowDisc.rotation.x = Math.PI / 2;
    shadowDisc.position.y = 0.02;
    shadowDisc.parent = root;
    shadowDisc.isPickable = false;

    const shadowMat = new StandardMaterial('shadowMat', scene);
    shadowMat.diffuseColor = new Color3(0.05, 0.15, 0.08);
    shadowMat.emissiveColor = new Color3(0, 0, 0);
    shadowMat.disableLighting = true;
    shadowMat.backFaceCulling = false;
    shadowMat.alpha = 0.4;
    shadowDisc.material = shadowMat;

    // 2. 浮空 3D 旋转模型组 (Model Node at y=0.45)
    const modelNode = new TransformNode('healthPackModel', scene);
    modelNode.parent = root;
    modelNode.position.y = 0.45;

    // 3D 倾斜姿态：让摄像机能同时看到顶面、正面与侧面，大幅提升 3D 立体视觉
    modelNode.rotation.x = Math.PI * 0.16;
    modelNode.rotation.z = Math.PI * 0.10;

    // A. 绿色主材质（开启定向日光照射与高眩光镜面反射，产生清晰明暗交界线）
    const greenMat = new StandardMaterial('packGreenMat', scene);
    const greenColor = Color3.FromHexString('#00c853');
    greenMat.diffuseColor = greenColor;
    greenMat.emissiveColor = Color3.FromHexString('#004d1a'); // 内部柔和暗绿自发光
    greenMat.specularColor = Color3.FromHexString('#ffffff'); // 高亮白色高光
    greenMat.specularPower = 32;
    greenMat.disableLighting = false; // 启用光照！产生极强 3D 体积感
    greenMat.backFaceCulling = false;

    // B. 内部发光亮核材质 (Core Light)
    const coreMat = new StandardMaterial('packCoreMat', scene);
    const coreColor = Color3.FromHexString('#69f0ae');
    coreMat.diffuseColor = coreColor;
    coreMat.emissiveColor = coreColor.scale(1.4);
    coreMat.disableLighting = true;

    // 3D 绿色十字架主方体 (厚度 0.16m，高 0.44m)
    const crossV = MeshBuilder.CreateBox(
      'crossV',
      { width: 0.16, height: 0.44, depth: 0.16 },
      scene,
    );
    crossV.material = greenMat;
    crossV.parent = modelNode;
    crossV.isPickable = false;

    const crossH = MeshBuilder.CreateBox(
      'crossH',
      { width: 0.44, height: 0.16, depth: 0.16 },
      scene,
    );
    crossH.material = greenMat;
    crossH.parent = modelNode;
    crossH.isPickable = false;

    // 3D 十字架中心突出的亮绿核心块 (增加 3D 层次结构)
    const coreBox = MeshBuilder.CreateBox(
      'coreBox',
      { width: 0.18, height: 0.18, depth: 0.18 },
      scene,
    );
    coreBox.material = coreMat;
    coreBox.parent = modelNode;
    coreBox.isPickable = false;

    return {
      node: root,
      modelNode,
      shadowDisc,
      x,
      z,
      isActive: true,
      respawnTimer: 0,
    };
  }

  /**
   * 每帧更新血包旋转浮空动画 + 距离检测 + 治疗拾取与刷新倒计时
   */
  update(dt: number, player: Minion, playerHealthBar: HealthBar): void {
    this.animTime += dt;
    const playerPos = player.root.position;

    for (const pack of this.packs) {
      if (pack.isActive) {
        // 浮空上下沉浮与自转
        pack.modelNode.rotation.y += dt * 1.8;
        const bobOffset = Math.sin(this.animTime * 2.5) * 0.08;
        pack.modelNode.position.y = 0.42 + bobOffset;
        // 地面悬浮阴影随高低沉浮动态微缩放，强化立体真实感
        const shadowScale = 0.85 - bobOffset * 1.5;
        pack.shadowDisc.scaling.set(shadowScale, shadowScale, shadowScale);

        // 拾取距离检测
        const dist = Math.hypot(playerPos.x - pack.x, playerPos.z - pack.z);
        const currentHp = playerHealthBar.getHp();
        const maxHp = playerHealthBar.getMaxHp();

        // 玩家靠近且未满血时触发拾取 (即使已满血靠近也会优雅回复，保证良好手感)
        if (dist <= PICKUP_RADIUS && !player.isDead()) {
          const newHp = Math.min(maxHp, currentHp + HEAL_AMOUNT);
          playerHealthBar.setHp(newHp);

          // 触发拾取治疗特效
          this.triggerHealFx(playerPos);

          // 消耗血包，进入刷新倒计时
          pack.isActive = false;
          pack.respawnTimer = RESPAWN_INTERVAL;
          pack.node.setEnabled(false);
        }
      } else {
        // 倒计时刷新
        pack.respawnTimer -= dt;
        if (pack.respawnTimer <= 0) {
          pack.isActive = true;
          pack.node.setEnabled(true);
          // 重新出现时的刷新光亮特效
          this.triggerRespawnFx(new Vector3(pack.x, 0.05, pack.z));
        }
      }
    }
  }

  /**
   * 玩家拾取血包时的绿色/金光环形治疗气浪特效
   */
  private triggerHealFx(playerPos: Vector3): void {
    const scene = this.scene;
    const DURATION = 0.35;

    // 1. 脚下向上扩散升腾的绿光气浪盘
    const ring = MeshBuilder.CreateDisc(
      'healRing',
      { radius: 0.8, tessellation: 24 },
      scene,
    );
    ring.rotation.x = Math.PI / 2;
    ring.position = playerPos.clone();
    ring.position.y += 0.05;
    ring.isPickable = false;

    const mat = new StandardMaterial('healMat', scene);
    const healColor = new Color3(0.1, 0.95, 0.45);
    mat.diffuseColor = healColor;
    mat.emissiveColor = healColor;
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    mat.alpha = 0.85;
    ring.material = mat;

    let elapsed = 0;

    const observer = scene.onBeforeRenderObservable.add(() => {
      const dt = scene.getEngine().getDeltaTime() / 1000;
      elapsed += dt;
      const p = Math.min(1, elapsed / DURATION);

      ring.position.y = playerPos.y + 0.05 + p * 0.75;
      const s = 0.4 + p * 0.9;
      ring.scaling.set(s, s, s);
      mat.alpha = 0.85 * (1 - p);

      if (p >= 1) {
        scene.onBeforeRenderObservable.remove(observer);
        mat.dispose();
        ring.dispose();
      }
    });
  }

  /**
   * 血包重新刷新生成时的爆红光晕特效
   */
  private triggerRespawnFx(pos: Vector3): void {
    const scene = this.scene;
    const DURATION = 0.25;

    const disc = MeshBuilder.CreateDisc(
      'respawnFx',
      { radius: 0.7, tessellation: 20 },
      scene,
    );
    disc.rotation.x = Math.PI / 2;
    disc.position.copyFrom(pos);
    disc.isPickable = false;

    const mat = new StandardMaterial('respawnMat', scene);
    const col = Color3.FromHexString('#00e676');
    mat.diffuseColor = col;
    mat.emissiveColor = col;
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    mat.alpha = 0.9;
    disc.material = mat;

    let elapsed = 0;

    const observer = scene.onBeforeRenderObservable.add(() => {
      const dt = scene.getEngine().getDeltaTime() / 1000;
      elapsed += dt;
      const p = Math.min(1, elapsed / DURATION);

      const s = 0.2 + p * 1.1;
      disc.scaling.set(s, s, s);
      mat.alpha = 0.9 * (1 - p);

      if (p >= 1) {
        scene.onBeforeRenderObservable.remove(observer);
        mat.dispose();
        disc.dispose();
      }
    });
  }

  dispose(): void {
    for (const pack of this.packs) {
      if (!pack.node.isDisposed) {
        pack.node.dispose();
      }
    }
    this.packs.length = 0;
  }
}
