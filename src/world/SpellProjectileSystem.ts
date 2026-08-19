import {
  type AbstractMesh,
  Color3,
  DynamicTexture,
  Engine,
  Mesh,
  MeshBuilder,
  Ray,
  type Scene,
  StandardMaterial,
  Vector3,
  VertexBuffer,
  VertexData,
} from '@babylonjs/core';
import { playSfx } from '../audio/Sfx';
import type { Minion } from './Minion';
import { isGunStyle, type StaffStyle } from './minion/staff';

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
  pistol: Color3.FromHexString('#ff8800'), // 战术高能橙
  shotgun: Color3.FromHexString('#ffcc55'), // 黄铜霰弹
};

const BASE_BULLET_DAMAGE = 25;
const BASE_TRAIL_WIDTH = 0.24;
const BASE_TRAIL_LEN = 0.45;
const BASE_EXPLOSION_R = 0.32;
/** 弹道飞行高度上限：须低于视觉围墙（0.5m），避免大体型杖尖从墙顶穿过 */
const MAX_SHOT_Y = 0.38;
/** 同时存活子弹上限，超出回收最旧的一条 */
const MAX_LIVE_BULLETS = 56;
const MAX_LIVE_EXPLOSIONS = 6;

interface Bullet {
  mesh: Mesh;
  position: Vector3;
  lastPos: Vector3;
  direction: Vector3;
  speed: number;
  shooter?: Minion;
  style: StaffStyle;
  posBuffer: Float32Array;
  powerScale: number;
  damage: number;
  remainingBounces: number;
}

/**
 * AAA 级彗星魔法子弹特效系统：
 * 1. 彗星水滴型自然拖尾贴图 (Teardrop Comet Texture)：二次贝塞尔曲线外廓 + 白热核心 + 软光晕；
 * 2. 动态面向摄像机 Trail Mesh (0.24m 紧凑高能光束)；
 * 3. 0 判定漏洞的圆柱体扫掠与防穿墙遮挡扫掠。
 */
export class SpellProjectileSystem {
  private readonly scene: Scene;
  private readonly matMap = new Map<StaffStyle, StandardMaterial>();
  private readonly textureMap = new Map<StaffStyle, DynamicTexture>();
  private readonly explosionMatMap = new Map<StaffStyle, StandardMaterial>();
  private readonly sparkMatMap = new Map<StaffStyle, StandardMaterial>();
  private readonly bullets: Bullet[] = [];
  private readonly meshPool: Mesh[] = [];
  private liveExplosions = 0;
  private maxBounces = 0;
  private bounds = { minX: -19.8, maxX: 19.8, minZ: -19.8, maxZ: 19.8 };
  private readonly tmpNext = new Vector3();
  private readonly tmpSeg = new Vector3();
  private readonly tmpDir = new Vector3();
  private readonly tmpSide = new Vector3();
  private readonly tmpToCam = new Vector3();
  private readonly tmpTail = new Vector3();
  private readonly sweepRay = new Ray(Vector3.Zero(), Vector3.Forward(), 1);

  constructor(scene: Scene) {
    this.scene = scene;
  }

  setBounceCount(count: number): void {
    this.maxBounces = Math.max(0, Math.floor(count));
  }

  getBounceCount(): number {
    return this.maxBounces;
  }

  setBounds(bounds: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  }): void {
    const m = 0.2;
    this.bounds = {
      minX: bounds.minX + m,
      maxX: bounds.maxX - m,
      minZ: bounds.minZ + m,
      maxZ: bounds.maxZ - m,
    };
  }

  /**
   * 使用 HTML5 Canvas 程序化预生成【彗星水滴型高亮拖尾贴图】
   * 采用二次贝塞尔曲线 (quadraticCurveTo) 消除直边梯形感，形成优美平滑的彗星彗尾
   */
  private getBulletTexture(style: StaffStyle): DynamicTexture {
    let tex = this.textureMap.get(style);
    if (tex) return tex;

    const scene = this.scene;
    const baseColor = STYLE_COLORS[style] ?? STYLE_COLORS.arcane;
    const r = Math.round(baseColor.r * 255);
    const g = Math.round(baseColor.g * 255);
    const b = Math.round(baseColor.b * 255);
    const rgba = (a: number) => `rgba(${r}, ${g}, ${b}, ${a})`;
    const pistol = isGunStyle(style);

    const width = 256;
    const height = 64;
    const dynTex = new DynamicTexture(
      `bulletTex_${style}`,
      { width, height },
      scene,
      false,
    );
    const ctx = dynTex.getContext() as CanvasRenderingContext2D;

    ctx.clearRect(0, 0, width, height);

    if (pistol) {
      // 手枪：细长热曳光，头白尾橙，没有法杖那种胖彗星
      const auraGrad = ctx.createLinearGradient(0, 0, 240, 0);
      auraGrad.addColorStop(0, rgba(0));
      auraGrad.addColorStop(0.45, rgba(0.22));
      auraGrad.addColorStop(0.85, rgba(0.7));
      auraGrad.addColorStop(1.0, rgba(0));
      ctx.fillStyle = auraGrad;
      ctx.beginPath();
      ctx.moveTo(8, 32);
      ctx.quadraticCurveTo(130, 20, 220, 24);
      ctx.arc(220, 32, 10, -Math.PI / 2, Math.PI / 2);
      ctx.quadraticCurveTo(130, 44, 8, 32);
      ctx.closePath();
      ctx.fill();

      const coreGrad = ctx.createLinearGradient(40, 0, 224, 0);
      coreGrad.addColorStop(0, rgba(0));
      coreGrad.addColorStop(0.4, 'rgba(255, 220, 160, 0.75)');
      coreGrad.addColorStop(1.0, '#ffffff');
      ctx.strokeStyle = coreGrad;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(48, 32);
      ctx.lineTo(220, 32);
      ctx.stroke();

      const headGrad = ctx.createRadialGradient(222, 32, 0, 222, 32, 12);
      headGrad.addColorStop(0, '#ffffff');
      headGrad.addColorStop(0.45, '#ffe0a0');
      headGrad.addColorStop(1.0, rgba(0));
      ctx.fillStyle = headGrad;
      ctx.beginPath();
      ctx.arc(222, 32, 12, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // 1. 柔和外晕 (Soft Outer Teardrop Aura)
      const auraGrad = ctx.createLinearGradient(0, 0, 230, 0);
      auraGrad.addColorStop(0, rgba(0));
      auraGrad.addColorStop(0.3, rgba(0.25));
      auraGrad.addColorStop(0.7, rgba(0.6));
      auraGrad.addColorStop(1.0, rgba(0));

      ctx.fillStyle = auraGrad;
      ctx.beginPath();
      ctx.moveTo(0, 32);
      ctx.quadraticCurveTo(110, 0, 206, 8);
      ctx.arc(206, 32, 24, -Math.PI / 2, Math.PI / 2);
      ctx.quadraticCurveTo(110, 64, 0, 32);
      ctx.closePath();
      ctx.fill();

      // 2. 彗星能量主体 (Comet Body)
      const bodyGrad = ctx.createLinearGradient(0, 0, 206, 0);
      bodyGrad.addColorStop(0, rgba(0));
      bodyGrad.addColorStop(0.25, rgba(0.45));
      bodyGrad.addColorStop(0.75, rgba(0.95));
      bodyGrad.addColorStop(1.0, '#ffffff');

      ctx.fillStyle = bodyGrad;
      ctx.beginPath();
      ctx.moveTo(8, 32);
      ctx.quadraticCurveTo(115, 10, 204, 18);
      ctx.arc(204, 32, 14, -Math.PI / 2, Math.PI / 2);
      ctx.quadraticCurveTo(115, 54, 8, 32);
      ctx.closePath();
      ctx.fill();

      // 3. 核心白热能量光束 (White Hot Inner Ray)
      const coreGrad = ctx.createLinearGradient(30, 0, 204, 0);
      coreGrad.addColorStop(0, rgba(0));
      coreGrad.addColorStop(0.35, 'rgba(255, 255, 255, 0.85)');
      coreGrad.addColorStop(1.0, '#ffffff');

      ctx.strokeStyle = coreGrad;
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(30, 32);
      ctx.lineTo(204, 32);
      ctx.stroke();

      // 4. 子弹头部发光圆核 (Glowing Bullet Head Orb) at X=204, Y=32
      const headGrad = ctx.createRadialGradient(204, 32, 0, 204, 32, 20);
      headGrad.addColorStop(0, '#ffffff');
      headGrad.addColorStop(0.45, '#ffffff');
      headGrad.addColorStop(0.75, rgba(1));
      headGrad.addColorStop(1.0, rgba(0));

      ctx.fillStyle = headGrad;
      ctx.beginPath();
      ctx.arc(204, 32, 20, 0, Math.PI * 2);
      ctx.fill();
    }

    dynTex.update(false);
    dynTex.hasAlpha = true;

    this.textureMap.set(style, dynTex);
    return dynTex;
  }

  private getMaterial(style: StaffStyle): StandardMaterial {
    let m = this.matMap.get(style);
    if (m) return m;

    const tex = this.getBulletTexture(style);
    const col = STYLE_COLORS[style] ?? STYLE_COLORS.arcane;

    m = new StandardMaterial(`bullet_trail_mat_${style}`, this.scene);
    m.diffuseTexture = tex;
    m.emissiveTexture = tex;
    m.emissiveColor = col.scale(2.2);
    m.disableLighting = true;
    m.backFaceCulling = false;
    m.useAlphaFromDiffuseTexture = true;
    m.alphaMode = Engine.ALPHA_ADD;

    this.matMap.set(style, m);
    return m;
  }

  private acquireTrailMesh(name: string): Mesh {
    const pooled = this.meshPool.pop();
    if (pooled) {
      pooled.setEnabled(true);
      pooled.name = name;
      return pooled;
    }
    return this.createTrailMesh(name);
  }

  private retireBullet(index: number): void {
    const b = this.bullets[index];
    if (!b) return;
    b.mesh.setEnabled(false);
    this.meshPool.push(b.mesh);
    this.bullets.splice(index, 1);
  }

  /**
   * 构建可实时更新顶点的拖尾带 Quad Mesh (4 Vertices, 2 Triangles)
   */
  private createTrailMesh(name: string): Mesh {
    const customMesh = new Mesh(name, this.scene);

    const vertexData = new VertexData();

    vertexData.positions = [
      0, 0, 0, // 0: Tail Left
      0, 0, 0, // 1: Tail Right
      0, 0, 0, // 2: Head Left
      0, 0, 0, // 3: Head Right
    ];

    vertexData.uvs = [
      0, 0, // 0: Tail Left
      0, 1, // 1: Tail Right
      1, 0, // 2: Head Left
      1, 1, // 3: Head Right
    ];

    vertexData.indices = [0, 1, 2, 1, 3, 2];
    vertexData.normals = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];

    vertexData.applyToMesh(customMesh, true);
    return customMesh;
  }

  /**
   * 发射一枚带彗星拖尾与散逸星火的魔法子弹
   */
  spawnOrb(
    spawnPos: Vector3,
    direction: Vector3,
    style: StaffStyle = 'arcane',
    shooter?: Minion,
    speed = 9.0,
  ): void {
    const dirRaw =
      direction.lengthSquared() > 1e-6
        ? direction.clone()
        : new Vector3(0, 0, 1);
    dirRaw.y = 0;
    const dir =
      dirRaw.lengthSquared() > 1e-6
        ? dirRaw.normalizeToNew()
        : new Vector3(0, 0, 1);

    let finalSpawnPos = spawnPos.clone();
    finalSpawnPos.y = Math.min(finalSpawnPos.y, MAX_SHOT_Y);

    // 防卡墙穿墙校验：若开火者法杖顶端插进墙内，将子弹出生点自动收回至墙面外侧
    if (shooter && shooter.root) {
      const originPos = shooter.root.position.clone();
      originPos.y = Math.min(originPos.y + 0.35, MAX_SHOT_Y);
      const toTip = spawnPos.subtract(originPos);
      const tipDist = toTip.length();
      if (tipDist > 1e-4) {
        const rayDir = toTip.scale(1 / tipDist);
        const checkRay = new Ray(originPos, rayDir, tipDist);
        const wallRes = this.tryHitWallRay(checkRay);
        if (wallRes.hit && wallRes.distance < tipDist) {
          const safeDist = Math.max(0.05, wallRes.distance - 0.05);
          finalSpawnPos = originPos.add(rayDir.scale(safeDist));
        }
      }
    }

    const powerScale = Math.max(0.2, shooter?.getStaffPowerScale() ?? 1);
    const pistol = isGunStyle(style);
    const shotgun = style === 'shotgun';
    const speedMul = shotgun ? 1.2 : pistol ? 1.55 : 1;
    const damageMul = shotgun ? 0.36 : pistol ? 0.6 : 1;
    const fireSpeed = (speed * speedMul) / Math.max(0.4, powerScale);

    if (this.bullets.length >= MAX_LIVE_BULLETS) {
      this.retireBullet(0);
    }

    const mesh = this.acquireTrailMesh(`bullet_${style}`);
    mesh.material = this.getMaterial(style);
    mesh.isPickable = false;
    mesh.renderingGroupId = 1;

    const isPlayerShooter =
      shooter?.isPlayer === true ||
      (shooter !== undefined && shooter.combatTeam !== 'enemy');
    const bulletBounces = isPlayerShooter ? this.maxBounces : 0;
    const posBuffer = new Float32Array(12);

    const bullet: Bullet = {
      mesh,
      position: finalSpawnPos.clone(),
      lastPos: finalSpawnPos.clone(),
      direction: dir,
      speed: fireSpeed,
      shooter,
      style,
      posBuffer,
      powerScale,
      damage: Math.round(BASE_BULLET_DAMAGE * powerScale * damageMul),
      remainingBounces: bulletBounces,
    };

    this.updateTrailMeshVertices(bullet);
    this.bullets.push(bullet);
  }

  /**
   * 根据当前摄像机视线方向与飞行方向计算面向摄像机的 Strip Vertices
   */
  private updateTrailMeshVertices(bullet: Bullet): void {
    const H = bullet.position;
    const stepDist = Vector3.Distance(bullet.position, bullet.lastPos);
    const pistol = isGunStyle(bullet.style);
    const shotgun = bullet.style === 'shotgun';
    const trailMul = shotgun ? 0.7 : pistol ? 1.2 : 1;
    const trailLen = Math.max(
      BASE_TRAIL_LEN * bullet.powerScale * trailMul,
      stepDist * (shotgun ? 1.15 : pistol ? 1.55 : 1.3),
    );

    const T = this.tmpTail;
    T.copyFrom(H);
    T.addInPlaceFromFloats(
      -bullet.direction.x * trailLen,
      -bullet.direction.y * trailLen,
      -bullet.direction.z * trailLen,
    );

    const fwd = bullet.direction;
    const cam = this.scene.activeCamera;
    const toCam = this.tmpToCam;
    if (cam) {
      cam.globalPosition.subtractToRef(H, toCam);
    } else {
      toCam.set(0, 10, -10);
    }
    if (toCam.lengthSquared() < 1e-4) {
      toCam.set(0, 1, 0);
    } else {
      toCam.normalize();
    }

    const side = this.tmpSide;
    Vector3.CrossToRef(fwd, toCam, side);
    if (side.lengthSquared() < 1e-4) {
      Vector3.CrossToRef(fwd, Vector3.Up(), side);
      if (side.lengthSquared() < 1e-4) {
        side.set(1, 0, 0);
      }
    }
    side.normalize();

    const widthMul = shotgun ? 0.28 : pistol ? 0.4 : 1;
    const width = BASE_TRAIL_WIDTH * bullet.powerScale * widthMul;
    const halfW = width * 0.5;

    const sideX = side.x * halfW;
    const sideY = side.y * halfW;
    const sideZ = side.z * halfW;

    const buf = bullet.posBuffer;

    buf[0] = T.x + sideX;  buf[1] = T.y + sideY;  buf[2] = T.z + sideZ;
    buf[3] = T.x - sideX;  buf[4] = T.y - sideY;  buf[5] = T.z - sideZ;
    buf[6] = H.x + sideX;  buf[7] = H.y + sideY;  buf[8] = H.z + sideZ;
    buf[9] = H.x - sideX;  buf[10] = H.y - sideY; buf[11] = H.z - sideZ;

    bullet.mesh.updateVerticesData(VertexBuffer.PositionKind, buf, true);
  }

  update(dt: number, targetMinions?: Minion[], player?: Minion): void {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i]!;

      const step = b.speed * dt;
      const nextPos = this.tmpNext;
      nextPos.copyFrom(b.position);
      nextPos.addInPlaceFromFloats(
        b.direction.x * step,
        b.direction.y * step,
        b.direction.z * step,
      );

      const raySegment = this.tmpSeg;
      nextPos.subtractToRef(b.position, raySegment);
      const moveDist = raySegment.length();

      let wallHitDist = Infinity;
      let wallHitNormal: Vector3 | undefined;

      // 墙体/障碍物扫掠检测
      if (moveDist > 1e-4) {
        const rayDir = this.tmpDir;
        raySegment.scaleToRef(1 / moveDist, rayDir);
        this.sweepRay.origin.copyFrom(b.position);
        this.sweepRay.direction.copyFrom(rayDir);
        this.sweepRay.length = moveDist + 0.05;
        const wallRes = this.tryHitWallRay(this.sweepRay);
        if (wallRes.hit && wallRes.distance <= moveDist + 0.05) {
          wallHitDist = wallRes.distance;
          wallHitNormal = wallRes.normal;
        }
      }

      // 外边界碰撞检测
      let boundHitDist = Infinity;
      let boundHitNormal: Vector3 | undefined;
      const { minX, maxX, minZ, maxZ } = this.bounds;
      const curX = b.position.x;
      const curZ = b.position.z;
      const dirX = b.direction.x;
      const dirZ = b.direction.z;

      if (dirX > 1e-5 && nextPos.x >= maxX) {
        const d = (maxX - curX) / dirX;
        if (d >= 0 && d < boundHitDist) {
          boundHitDist = d;
          boundHitNormal = new Vector3(-1, 0, 0);
        }
      } else if (dirX < -1e-5 && nextPos.x <= minX) {
        const d = (minX - curX) / dirX;
        if (d >= 0 && d < boundHitDist) {
          boundHitDist = d;
          boundHitNormal = new Vector3(1, 0, 0);
        }
      }

      if (dirZ > 1e-5 && nextPos.z >= maxZ) {
        const d = (maxZ - curZ) / dirZ;
        if (d >= 0 && d < boundHitDist) {
          boundHitDist = d;
          boundHitNormal = new Vector3(0, 0, -1);
        }
      } else if (dirZ < -1e-5 && nextPos.z <= minZ) {
        const d = (minZ - curZ) / dirZ;
        if (d >= 0 && d < boundHitDist) {
          boundHitDist = d;
          boundHitNormal = new Vector3(0, 0, 1);
        }
      }

      // 汇总最先发生的障碍物撞击
      let obstacleHitDist = Infinity;
      let obstacleNormal: Vector3 | undefined;
      if (wallHitDist < boundHitDist) {
        obstacleHitDist = wallHitDist;
        obstacleNormal = wallHitNormal;
      } else if (boundHitDist < Infinity) {
        obstacleHitDist = boundHitDist;
        obstacleNormal = boundHitNormal;
      }

      // 小兵圆柱体扫掠求交检测
      const minionHit = this.checkMinionCylinderHit(
        b.position,
        nextPos,
        b.shooter,
        targetMinions,
      );

      const minionDist = minionHit ? Math.sqrt(minionHit.distSq) : Infinity;

      // 击中小兵：在障碍物之前命中
      if (minionHit && minionDist <= obstacleHitDist && minionDist <= moveDist + 0.05) {
        if (minionHit.hitMinion.physicsProxy) {
          minionHit.hitMinion.physicsProxy.applyHitKnockback(b.direction, 2.0);
        }
        minionHit.hitMinion.takeDamage(b.damage, b.direction);
        if (!(player && minionHit.hitMinion === player)) {
          playSfx('/audio/bullet_hit.mp3', 0.55);
        }
        this.triggerExplosionFx(nextPos, b.style, b.powerScale);
        this.retireBullet(i);
        continue;
      }

      // 撞击障碍物（墙体 / 边界）
      if (obstacleHitDist !== Infinity && obstacleHitDist <= moveDist + 0.05) {
        const actualHitDist = Math.min(obstacleHitDist, moveDist);
        const impactPos = b.position.add(b.direction.scale(actualHitDist));
        impactPos.y = b.position.y;

        // 如果还可以反弹
        if (b.remainingBounces > 0) {
          b.remainingBounces -= 1;

          let normal = obstacleNormal;
          if (!normal || normal.lengthSquared() < 1e-4) {
            if (impactPos.x <= minX + 0.1) normal = new Vector3(1, 0, 0);
            else if (impactPos.x >= maxX - 0.1) normal = new Vector3(-1, 0, 0);
            else if (impactPos.z <= minZ + 0.1) normal = new Vector3(0, 0, 1);
            else if (impactPos.z >= maxZ - 0.1) normal = new Vector3(0, 0, -1);
            else normal = b.direction.scale(-1);
          }
          normal = new Vector3(normal.x, 0, normal.z).normalize();

          // 确保法线逆着入射方向：D · N < 0
          const dot = Vector3.Dot(b.direction, normal);
          if (dot > 0) {
            normal.scaleInPlace(-1);
          }

          // 计算反射向量 R = D - 2 * (D · N) * N
          const newDot = Vector3.Dot(b.direction, normal);
          const reflectDir = b.direction.subtract(normal.scale(2 * newDot));
          reflectDir.y = 0;
          if (reflectDir.lengthSquared() < 1e-4) {
            reflectDir.copyFrom(b.direction).scaleInPlace(-1);
          }
          reflectDir.normalize();

          // 反弹时的火花撞击特效
          this.triggerWallImpactFx(impactPos, b.style, b.powerScale);

          // 沿反射方向推进剩余位移并确保处于安全边界内
          const remainingStep = Math.max(0.04, moveDist - actualHitDist);
          const newPos = impactPos.add(reflectDir.scale(remainingStep));
          newPos.x = Math.max(minX + 0.02, Math.min(maxX - 0.02, newPos.x));
          newPos.z = Math.max(minZ + 0.02, Math.min(maxZ - 0.02, newPos.z));

          b.lastPos.copyFrom(impactPos);
          b.position.copyFrom(newPos);
          b.direction.copyFrom(reflectDir);
          this.updateTrailMeshVertices(b);
          continue;
        }

        // 无反弹次数：常规撞墙爆裂销毁
        this.triggerExplosionFx(impactPos, b.style, b.powerScale);
        this.triggerWallImpactFx(impactPos, b.style, b.powerScale);
        this.retireBullet(i);
        continue;
      }

      // 未发生任何碰撞：平滑飞行
      b.lastPos.copyFrom(b.position);
      b.position.copyFrom(nextPos);

      this.updateTrailMeshVertices(b);
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
   * 圆柱体受击精确求交检测：把小兵抽象为半径 0.32m、高 0.85m 的垂直受击圆柱体
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
      const targetScale = target.getStaffPowerScale();
      const targetHeight = 0.85 * targetScale;
      const targetRadius = 0.32 * targetScale;

      if (maxY < -0.1 || minY > targetHeight) continue;

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
  private tryHitWallRay(
    ray: Ray,
  ): { hit: boolean; distance: number; normal?: Vector3 } {
    const pick = this.scene.pickWithRay(ray, (mesh) => this.isWallTarget(mesh));
    if (pick?.hit && pick.pickedMesh) {
      const rawNormal = pick.getNormal(true);
      let normal: Vector3 | undefined;
      if (rawNormal) {
        const hNormal = new Vector3(rawNormal.x, 0, rawNormal.z);
        if (hNormal.lengthSquared() > 1e-4) {
          normal = hNormal.normalize();
        }
      }
      return { hit: true, distance: pick.distance, normal };
    }
    return { hit: false, distance: Infinity };
  }

  private isWallTarget(mesh: AbstractMesh): boolean {
    if (!mesh.isEnabled() || !mesh.isPickable) return false;
    const name = mesh.name.toLowerCase();

    if (name.includes('bullet') || name.includes('spell') || mesh.metadata?.minion) {
      return false;
    }

    if (
      (name.includes('floor') && !name.includes('wall')) ||
      name.includes('ground') ||
      name.includes('grid') ||
      name.includes('axes') ||
      name.includes('pad')
    ) {
      return false;
    }

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
    for (const m of this.meshPool) {
      if (!m.isDisposed) m.dispose();
    }
    this.meshPool.length = 0;
  }

  dispose(): void {
    this.clear();
    for (const m of this.matMap.values()) m.dispose();
    this.matMap.clear();
    for (const t of this.textureMap.values()) t.dispose();
    this.textureMap.clear();
    for (const m of this.explosionMatMap.values()) {
      if (m.diffuseTexture) m.diffuseTexture.dispose();
      m.dispose();
    }
    this.explosionMatMap.clear();
    for (const m of this.sparkMatMap.values()) m.dispose();
    this.sparkMatMap.clear();
  }

  /**
   * 法术元素爆裂特效
   */
  private triggerExplosionFx(
    pos: Vector3,
    style: StaffStyle,
    powerScale = 1,
  ): void {
    const scene = this.scene;
    const mat = this.getExplosionMaterial(style);

    if (this.liveExplosions >= MAX_LIVE_EXPLOSIONS) return;
    this.liveExplosions += 1;

    const pistol = isGunStyle(style);
    const expMesh = MeshBuilder.CreateDisc(
      'expSprite',
      {
        radius: BASE_EXPLOSION_R * powerScale * (pistol ? 0.38 : 1),
        tessellation: 12,
      },
      scene,
    );
    expMesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
    expMesh.material = mat;
    expMesh.position.copyFrom(pos);
    expMesh.isPickable = false;
    expMesh.renderingGroupId = 2;

    expMesh.rotation.z = Math.random() * Math.PI * 2;

    let animTimer = 0;
    const maxTime = 0.14;

    const observer = scene.onBeforeRenderObservable.add(() => {
      const dt = scene.getEngine().getDeltaTime() / 1000;
      animTimer += dt;

      const progress = animTimer / maxTime;
      if (progress >= 1) {
        scene.onBeforeRenderObservable.remove(observer);
        expMesh.dispose();
        this.liveExplosions = Math.max(0, this.liveExplosions - 1);
        return;
      }

      const s = pistol ? 0.5 + progress * 0.65 : 0.4 + progress * 1.2;
      expMesh.scaling.set(s, s, s);
      expMesh.visibility = 1 - progress * progress;
    });
  }

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

    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 60);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.2, hex);
    grad.addColorStop(0.55, hex + '88');
    grad.addColorStop(1, 'rgba(0,0,0,0)');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(64, 64, 60, 0, Math.PI * 2);
    ctx.fill();

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

  /**
   * 子弹命中墙体时的碎花火花散逸视觉特效 (纯视觉，无音效)
   */
  private triggerWallImpactFx(
    pos: Vector3,
    style: StaffStyle,
    powerScale = 1,
  ): void {
    const scene = this.scene;
    const mat = this.getSparkMaterial(style);
    const pistol = isGunStyle(style);

    const sparkCount = 4;
    const duration = pistol ? 0.14 : 0.16;
    const radius = (pistol ? 0.026 : 0.06) * powerScale;

    for (let k = 0; k < sparkCount; k++) {
      const spark = MeshBuilder.CreateDisc(
        'wallSpark',
        { radius, tessellation: 8 },
        scene,
      );
      spark.billboardMode = Mesh.BILLBOARDMODE_ALL;
      spark.position.copyFrom(pos);
      spark.isPickable = false;
      spark.renderingGroupId = 2;
      spark.material = mat;

      const angle = (k / sparkCount) * Math.PI * 2 + Math.random() * 0.55;
      const speed = (pistol ? 0.85 : 1.2) + Math.random() * (pistol ? 0.7 : 1.5);
      const vx = Math.cos(angle) * speed;
      let vy = (Math.random() - 0.15) * speed * 0.85;
      const vz = Math.sin(angle) * speed;

      let timer = 0;

      const obs = scene.onBeforeRenderObservable.add(() => {
        const dt = scene.getEngine().getDeltaTime() / 1000;
        timer += dt;
        const p = Math.min(1, timer / duration);

        vy -= 8 * dt;
        spark.position.x += vx * dt;
        spark.position.y += vy * dt;
        spark.position.z += vz * dt;

        const s = (1 - p) * (pistol ? 0.9 : 1.2);
        spark.scaling.set(s, s, s);
        spark.visibility = 1 - p;

        if (p >= 1) {
          scene.onBeforeRenderObservable.remove(obs);
          spark.dispose();
        }
      });
    }
  }

  private getSparkMaterial(style: StaffStyle): StandardMaterial {
    let mat = this.sparkMatMap.get(style);
    if (mat) return mat;

    const baseColor = STYLE_COLORS[style] ?? STYLE_COLORS.arcane;
    mat = new StandardMaterial(`wallSparkMat_${style}`, this.scene);
    mat.diffuseColor = baseColor;
    mat.emissiveColor = baseColor.scale(2.1);
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    mat.transparencyMode = StandardMaterial.MATERIAL_ALPHABLEND;
    mat.disableDepthWrite = true;
    this.sparkMatMap.set(style, mat);
    return mat;
  }
}


