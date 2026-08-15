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

const BASE_BULLET_DAMAGE = 25;
const BASE_TRAIL_WIDTH = 0.24;
const BASE_TRAIL_LEN = 0.45;
const BASE_EXPLOSION_R = 0.32;
/** 弹道飞行高度上限：须低于视觉围墙（0.5m），避免大体型杖尖从墙顶穿过 */
const MAX_SHOT_Y = 0.38;

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
  private readonly bullets: Bullet[] = [];
  private bounds = { minX: -19.8, maxX: 19.8, minZ: -19.8, maxZ: 19.8 };

  constructor(scene: Scene) {
    this.scene = scene;
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

    const width = 256;
    const height = 64;
    const dynTex = new DynamicTexture(
      `bulletTex_${style}`,
      { width, height },
      scene,
      false,
    );
    const ctx = dynTex.getContext();

    ctx.clearRect(0, 0, width, height);

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

  /**
   * 构建可实时更新顶点的拖尾带 Quad Mesh (4 Vertices, 2 Triangles)
   */
  private createTrailMesh(name: string): Mesh {
    const customMesh = new Mesh(name, this.scene);
    customMesh.alwaysSelectAsActiveMesh = true;

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

    const mesh = this.createTrailMesh(`bullet_${style}`);
    mesh.material = this.getMaterial(style);
    mesh.isPickable = false;
    mesh.renderingGroupId = 1;

    const posBuffer = new Float32Array(12);

    const bullet: Bullet = {
      mesh,
      position: finalSpawnPos.clone(),
      lastPos: finalSpawnPos.clone(),
      direction: dir,
      speed,
      shooter,
      style,
      posBuffer,
      powerScale,
      damage: Math.round(BASE_BULLET_DAMAGE * powerScale),
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
    const trailLen = Math.max(
      BASE_TRAIL_LEN * bullet.powerScale,
      stepDist * 1.3,
    );

    const T = H.subtract(bullet.direction.scale(trailLen));

    const fwd = bullet.direction;
    const cam = this.scene.activeCamera;
    const camPos = cam ? cam.globalPosition : new Vector3(0, 10, -10);
    let toCam = camPos.subtract(H);
    if (toCam.lengthSquared() < 1e-4) {
      toCam = new Vector3(0, 1, 0);
    } else {
      toCam.normalize();
    }

    let side = Vector3.Cross(fwd, toCam);
    if (side.lengthSquared() < 1e-4) {
      side = Vector3.Cross(fwd, Vector3.Up());
      if (side.lengthSquared() < 1e-4) {
        side = new Vector3(1, 0, 0);
      }
    }
    side.normalize();

    const width = BASE_TRAIL_WIDTH * bullet.powerScale;
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

      const moveStep = b.direction.scale(b.speed * dt);
      const nextPos = b.position.add(moveStep);

      const raySegment = nextPos.subtract(b.lastPos);
      const moveDist = raySegment.length();

      let wallHitDist = Infinity;

      // 墙体/障碍物遮挡射线检测
      if (moveDist > 1e-4) {
        const rayDir = raySegment.scale(1 / moveDist);
        const sweepRay = new Ray(b.lastPos, rayDir, moveDist + 0.05);
        const wallRes = this.tryHitWallRay(sweepRay);
        if (wallRes.hit) {
          wallHitDist = wallRes.distance;
        }
      }

      // 小兵圆柱体扫掠求交检测
      const minionHit = this.checkMinionCylinderHit(
        b.lastPos,
        nextPos,
        b.shooter,
        targetMinions,
      );

      const { minX, maxX, minZ, maxZ } = this.bounds;
      const outOfBounds =
        nextPos.x <= minX ||
        nextPos.x >= maxX ||
        nextPos.z <= minZ ||
        nextPos.z >= maxZ;

      const hitMinion =
        minionHit &&
        (wallHitDist === Infinity || Math.sqrt(minionHit.distSq) <= wallHitDist);

      if (hitMinion && minionHit) {
        if (minionHit.hitMinion.physicsProxy) {
          minionHit.hitMinion.physicsProxy.applyHitKnockback(b.direction, 2.0);
        }
        minionHit.hitMinion.takeDamage(b.damage, b.direction);
        if (!(player && minionHit.hitMinion === player)) {
          playSfx('/audio/bullet_hit.mp3', 0.55);
        }
        this.triggerExplosionFx(nextPos, b.style, b.powerScale);
        b.mesh.dispose();
        this.bullets.splice(i, 1);
        continue;
      }

      if (wallHitDist !== Infinity || outOfBounds) {
        b.mesh.dispose();
        this.bullets.splice(i, 1);
        continue;
      }

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

    const expMesh = MeshBuilder.CreateDisc(
      'expSprite',
      { radius: BASE_EXPLOSION_R * powerScale, tessellation: 12 },
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
        return;
      }

      const s = 0.4 + progress * 1.2;
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
}


