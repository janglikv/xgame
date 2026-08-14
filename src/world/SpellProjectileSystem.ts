import {
  type AbstractMesh,
  Color3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  Ray,
  type Scene,
  StandardMaterial,
  Vector3,
} from '@babylonjs/core';
import type { Minion } from './Minion';
import type { StaffStyle } from './minion/staff';

/**
 * 各法杖类型对应的纯鲜艳颜色
 */
const STYLE_COLORS: Record<StaffStyle, Color3> = {
  arcane: Color3.FromHexString('#b545ff'), // 奥术紫
  flame: Color3.FromHexString('#ff5500'),  // 烈焰橙
  frost: Color3.FromHexString('#00c8ff'),  // 冰霜蓝
  nature: Color3.FromHexString('#20e040'), // 自然绿
  void: Color3.FromHexString('#8811ee'),   // 虚空紫
  storm: Color3.FromHexString('#00e5ff'),  // 风暴青
  holy: Color3.FromHexString('#ffcc00'),   // 圣光黄
};

interface Bullet {
  mesh: Mesh;
  position: Vector3;
  lastPos: Vector3;
  direction: Vector3;
  speed: number;
  shooter?: Minion;
  style: StaffStyle;
}

/**
 * 极简纯色圆形子弹系统：
 * 采用圆柱体/胶囊体物理扫描 (Ray-to-Cylinder Swept Check) 精准检测 Minion 受击，
 * 配合 3D Ray 墙体遮挡判定，彻底解决子弹穿透、擦过假漏判和高低差判定失真问题。
 */
export class SpellProjectileSystem {
  private readonly scene: Scene;
  private readonly matMap = new Map<StaffStyle, StandardMaterial>();
  private readonly explosionMatMap = new Map<StaffStyle, StandardMaterial>();
  private readonly bullets: Bullet[] = [];

  constructor(scene: Scene) {
    this.scene = scene;
  }

  private getMaterial(style: StaffStyle): StandardMaterial {
    let m = this.matMap.get(style);
    if (m) return m;

    const col = STYLE_COLORS[style] ?? STYLE_COLORS.arcane;
    m = new StandardMaterial(`bullet_solid_mat_${style}`, this.scene);
    m.diffuseColor = col;
    m.emissiveColor = col;
    m.disableLighting = true;
    m.backFaceCulling = false;

    this.matMap.set(style, m);
    return m;
  }

  /**
   * 发射一枚极简纯色圆形子弹
   */
  spawnOrb(
    spawnPos: Vector3,
    direction: Vector3,
    style: StaffStyle = 'arcane',
    shooter?: Minion,
    speed = 9.0,
  ): void {
    const dir =
      direction.lengthSquared() > 1e-6
        ? direction.normalizeToNew()
        : new Vector3(0, 0, 1);

    let finalSpawnPos = spawnPos.clone();

    // 防卡墙穿墙校验：若开火者法杖顶端插进墙内，将子弹出生点自动收回至墙面外侧
    if (shooter && shooter.root) {
      const originPos = shooter.root.position.clone();
      originPos.y += 0.45; // 射手胸口中心
      const toTip = spawnPos.subtract(originPos);
      const tipDist = toTip.length();
      if (tipDist > 1e-4) {
        const rayDir = toTip.scale(1 / tipDist);
        const checkRay = new Ray(originPos, rayDir, tipDist);
        const wallRes = this.tryHitWallRay(checkRay);
        if (wallRes.hit && wallRes.distance < tipDist) {
          // 法杖插进了墙内！将子弹出生点安全收回至墙面外侧
          const safeDist = Math.max(0.05, wallRes.distance - 0.05);
          finalSpawnPos = originPos.add(rayDir.scale(safeDist));
        }
      }
    }

    // 面向摄像机的纯色圆形 Disc Mesh (半径 0.04)
    const disc = MeshBuilder.CreateDisc(
      'bullet',
      { radius: 0.04, tessellation: 32 },
      this.scene,
    );
    disc.material = this.getMaterial(style);
    disc.billboardMode = Mesh.BILLBOARDMODE_ALL;
    disc.isPickable = false;
    disc.position.copyFrom(finalSpawnPos);

    this.bullets.push({
      mesh: disc,
      position: finalSpawnPos.clone(),
      lastPos: finalSpawnPos.clone(),
      direction: dir,
      speed,
      shooter,
      style,
    });
  }

  update(dt: number, targetMinions?: Minion[]): void {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i]!;

      const moveStep = b.direction.scale(b.speed * dt);
      const nextPos = b.position.add(moveStep);

      const raySegment = nextPos.subtract(b.lastPos);
      const moveDist = raySegment.length();

      let wallHitDist = Infinity;

      // 1. 墙体/障碍物遮挡射线检测
      if (moveDist > 1e-4) {
        const rayDir = raySegment.scale(1 / moveDist);
        const sweepRay = new Ray(b.lastPos, rayDir, moveDist + 0.05);
        const wallRes = this.tryHitWallRay(sweepRay);
        if (wallRes.hit) {
          wallHitDist = wallRes.distance;
        }
      }

      // 2. 小兵圆柱体扫掠求交检测 (Ray-to-Cylinder Check)
      const minionHit = this.checkMinionCylinderHit(
        b.lastPos,
        nextPos,
        b.shooter,
        targetMinions,
      );

      const outOfBounds =
        Math.abs(nextPos.x) >= 19.8 || Math.abs(nextPos.z) >= 19.8;

      let hitOccurred = false;
      let isWallHit = false;

      // 若在墙体生效前命中了小兵，触发小兵受击与击退；否则若撞墙/越界则吸收销毁
      if (
        minionHit &&
        (wallHitDist === Infinity || Math.sqrt(minionHit.distSq) <= wallHitDist)
      ) {
        hitOccurred = true;
        if (minionHit.hitMinion.physicsProxy) {
          minionHit.hitMinion.physicsProxy.applyHitKnockback(b.direction, 2.0);
        }
        minionHit.hitMinion.takeDamage(25, b.direction);
      } else if (wallHitDist !== Infinity || outOfBounds) {
        hitOccurred = true;
        if (wallHitDist !== Infinity) isWallHit = true;
      }

      if (hitOccurred) {
        // 在精准的求交命中点触发法术元素爆炸特效
        const impactPos = isWallHit
          ? b.lastPos.add(b.direction.scale(Math.max(0, wallHitDist - 0.08)))
          : nextPos;
        this.triggerExplosionFx(impactPos, b.style);

        b.mesh.dispose();
        this.bullets.splice(i, 1);
        continue;
      }

      b.lastPos.copyFrom(b.position);
      b.position.copyFrom(nextPos);
      b.mesh.position.copyFrom(b.position);
    }
  }

  /**
   * 计算 2D 平面点 (px, pz) 到线段 (ax,az)->(bx,bz) 的最短距离平方与投影比例 t
   */
  private distSqToSegment2D(
    px: number,
    pz: number,
    ax: number,
    az: number,
    bx: number,
    bz: number,
  ): { distSq: number; t: number } {
    const dx = bx - ax;
    const dz = bz - az;
    const lenSq = dx * dx + dz * dz;
    if (lenSq < 1e-8) {
      const dX = px - ax;
      const dZ = pz - az;
      return { distSq: dX * dX + dZ * dZ, t: 0 };
    }
    let t = ((px - ax) * dx + (pz - az) * dz) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const projX = ax + t * dx;
    const projZ = az + t * dz;
    const dX = px - projX;
    const dZ = pz - projZ;
    return { distSq: dX * dX + dZ * dZ, t };
  }

  /**
   * 圆柱体受击精确求交检测：把小兵抽象为半径 0.32m、高 0.85m 的垂直受击圆柱体，
   * 与子弹一帧内的移动轨迹线段进行精确求交。
   */
  private checkMinionCylinderHit(
    p0: Vector3,
    p1: Vector3,
    shooter?: Minion,
    candidates?: Minion[],
  ): { hitMinion: Minion; t: number; distSq: number } | null {
    if (!candidates || candidates.length === 0) return null;

    const minY = Math.min(p0.y, p1.y);
    const maxY = Math.max(p0.y, p1.y);

    let closestHit: { hitMinion: Minion; t: number; distSq: number } | null = null;
    let closestDistSq = Infinity;

    for (const target of candidates) {
      if (!target || target === shooter || target.isDead()) continue;
      if (
        shooter?.combatTeam &&
        target.combatTeam &&
        shooter.combatTeam === target.combatTeam
      ) {
        continue;
      }
      if (target.root && !target.root.isEnabled()) continue;

      const pos = target.root.position;
      const targetHeight = 0.85; // 小兵高度 (含帽子与角)
      const targetRadius = 0.32; // 受击判定半径 (小兵 0.28m + 子弹 0.04m)

      // 1. 高度 Y 轴覆盖判断
      if (maxY < -0.1 || minY > targetHeight) continue;

      // 2. 2D 水平坐标系线段到圆柱中心的距离判断
      const res = this.distSqToSegment2D(pos.x, pos.z, p0.x, p0.z, p1.x, p1.z);
      if (res.distSq <= targetRadius * targetRadius) {
        const hitX = p0.x + res.t * (p1.x - p0.x);
        const hitZ = p0.z + res.t * (p1.z - p0.z);
        const dX = hitX - p0.x;
        const dZ = hitZ - p0.z;
        const distFromP0Sq = dX * dX + dZ * dZ;

        if (distFromP0Sq < closestDistSq) {
          closestDistSq = distFromP0Sq;
          closestHit = { hitMinion: target, t: res.t, distSq: distFromP0Sq };
        }
      }
    }

    return closestHit;
  }

  /**
   * 检测子弹轨迹线段是否击中墙体/遮挡物体
   */
  private tryHitWallRay(ray: Ray): { hit: boolean; distance: number } {
    const picks = this.scene.multiPickWithRay(ray, (mesh) =>
      this.isWallTarget(mesh),
    );
    if (!picks || picks.length === 0) return { hit: false, distance: Infinity };

    picks.sort((a, b) => a.distance - b.distance);

    for (const pick of picks) {
      if (pick.hit && pick.pickedMesh) {
        return { hit: true, distance: pick.distance };
      }
    }

    return { hit: false, distance: Infinity };
  }

  private isWallTarget(mesh: AbstractMesh): boolean {
    if (!mesh.isEnabled() || !mesh.isPickable) return false;
    const name = mesh.name.toLowerCase();

    // 过滤子弹自身与小兵节点
    if (name.includes('bullet') || name.includes('spell') || mesh.metadata?.minion) {
      return false;
    }

    // 过滤纯地面、地形与网格
    if (
      (name.includes('floor') && !name.includes('wall')) ||
      name.includes('ground') ||
      name.includes('grid') ||
      name.includes('axes') ||
      name.includes('pad')
    ) {
      return false;
    }

    // 过滤隐形物理代理盒，优先让子弹扎在 RenderWall 真实视觉模型多边形表面上
    if (name.startsWith('phys') || mesh.metadata?.isColliderMesh === true) {
      return false;
    }

    return (
      name.includes('renderwall') ||
      name.includes('wall') ||
      name.includes('obstacle') ||
      name.includes('pillar') ||
      name.includes('podium') ||
      name.includes('barrier')
    );
  }

  clear(): void {
    for (const b of this.bullets) {
      if (!b.mesh.isDisposed) b.mesh.dispose();
    }
    this.bullets.length = 0;
  }

  dispose(): void {
    this.clear();
    for (const m of this.matMap.values()) m.dispose();
    this.matMap.clear();
    for (const m of this.explosionMatMap.values()) {
      if (m.diffuseTexture) m.diffuseTexture.dispose();
      m.dispose();
    }
    this.explosionMatMap.clear();
  }

  /**
   * 采用程序预渲染发光贴图 (Procedural Pre-rendered Texture) + 最高渲染层级 (renderingGroupId = 2) 置顶快闪。
   * 永远面向摄像机 Billboard 渲染，彻底消除 3D 几何体遮挡与嵌入问题，实现最佳性能与最饱满视觉体验！
   */
  private triggerExplosionFx(pos: Vector3, style: StaffStyle): void {
    const scene = this.scene;
    const mat = this.getExplosionMaterial(style);

    // 单一 Billboard 贴图面片 (0 GC, 1 Draw Call, 永远面向摄像机)
    const expMesh = MeshBuilder.CreateDisc(
      'expSprite',
      { radius: 0.32, tessellation: 12 },
      scene,
    );
    expMesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
    expMesh.material = mat;
    expMesh.position.copyFrom(pos);
    expMesh.isPickable = false;

    // 设置最高渲染图层 (2)，确保永远在场景所有墙体与地形最上方置顶无损绘制！
    expMesh.renderingGroupId = 2;

    // 随机 Z 轴角度增添爆裂随机性
    expMesh.rotation.z = Math.random() * Math.PI * 2;

    let animTimer = 0;
    const maxTime = 0.14; // 140ms 极致高频爆裂快闪

    const observer = scene.onBeforeRenderObservable.add(() => {
      const dt = scene.getEngine().getDeltaTime() / 1000;
      animTimer += dt;

      const progress = animTimer / maxTime;
      if (progress >= 1) {
        scene.onBeforeRenderObservable.remove(observer);
        expMesh.dispose();
        return;
      }

      // 0.14 秒内由 0.4 快速膨胀至 1.6 倍，配合透明度二次方渐隐
      const s = 0.4 + progress * 1.2;
      expMesh.scaling.set(s, s, s);
      expMesh.visibility = 1 - progress * progress;
    });
  }

  /**
   * 使用 HTML5 Canvas 动态程序预生成高品质发光爆裂星光贴图（首次一次性生成，后续 100% 材质缓存复用）
   */
  private getExplosionMaterial(style: StaffStyle): StandardMaterial {
    let mat = this.explosionMatMap.get(style);
    if (mat) return mat;

    const scene = this.scene;
    const baseColor = STYLE_COLORS[style] ?? STYLE_COLORS.arcane;
    const hex = baseColor.toHexString();

    const size = 128;
    const dynTex = new DynamicTexture(
      `expTex_${style}`,
      { width: size, height: size },
      scene,
      false,
    );
    const ctx = dynTex.getContext();

    ctx.clearRect(0, 0, size, size);

    // 1. 核心径向高亮光晕
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 60);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.2, hex);
    grad.addColorStop(0.55, hex + '88');
    grad.addColorStop(1, 'rgba(0,0,0,0)');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(64, 64, 60, 0, Math.PI * 2);
    ctx.fill();

    // 2. 8 方向爆裂放射状星光线条
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    for (let i = 0; i < 8; i++) {
      const angle = (i * Math.PI) / 4 + 0.15;
      ctx.beginPath();
      ctx.moveTo(64, 64);
      ctx.lineTo(64 + Math.cos(angle) * 58, 64 + Math.sin(angle) * 58);
      ctx.stroke();
    }

    dynTex.update(false);
    dynTex.hasAlpha = true;

    mat = new StandardMaterial(`expMat_${style}`, scene);
    mat.diffuseTexture = dynTex;
    mat.opacityTexture = dynTex;
    mat.emissiveColor = baseColor.scale(1.8);
    mat.disableLighting = true;
    mat.backFaceCulling = false;

    this.explosionMatMap.set(style, mat);
    return mat;
  }
}
