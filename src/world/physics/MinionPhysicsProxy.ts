import {
  HavokPlugin,
  MeshBuilder,
  PhysicsAggregate,
  PhysicsMotionType,
  PhysicsShapeType,
  type Scene,
  type TransformNode,
  Vector3,
} from '@babylonjs/core';

/** 代理控制模式 */
export type MinionPhysicsMode =
  /** 玩家：速度驱动，可推人也可被挤 */
  | 'player'
  /** 可被推动的展示/NPC：物理积分位置 */
  | 'pushable';

export interface MinionPhysicsProxyOptions {
  /** 胶囊半径（世界单位） */
  radius?: number;
  /** 胶囊总高（世界单位，含两端半球） */
  height?: number;
  /** player = 主控；pushable = 可被推走（默认） */
  mode?: MinionPhysicsMode;
  /** 质量：player 宜重一点，pushable 轻一点好推 */
  mass?: number;
  /** 弹性 */
  restitution?: number;
  /** 摩擦 */
  friction?: number;
  /** 是否显示调试胶囊（默认 false） */
  debugVisible?: boolean;
}

let proxySeq = 0;

/**
 * 小兵物理代理：竖直胶囊。
 *
 * - `player`：DYNAMIC + 每帧写水平速度（WASD），与他体真实互撞
 * - `pushable`：DYNAMIC + 阻尼，可被主角/球推走，表现层跟胶囊走
 *
 * 装饰 mesh 不进物理。
 */
export class MinionPhysicsProxy {
  readonly mesh;
  readonly aggregate: PhysicsAggregate;
  readonly mode: MinionPhysicsMode;
  private readonly radius: number;
  private readonly halfHeight: number;
  private readonly tmpVel = new Vector3();
  private readonly tmpPos = new Vector3();
  private disposed = false;

  constructor(
    scene: Scene,
    private readonly target: TransformNode,
    options: MinionPhysicsProxyOptions = {},
  ) {
    this.mode = options.mode ?? 'pushable';
    this.radius = options.radius ?? 0.14;
    const height = options.height ?? 0.42;
    this.halfHeight = Math.max(0.02, height * 0.5 - this.radius);

    const isPlayer = this.mode === 'player';
    const mass = options.mass ?? (isPlayer ? 2.4 : 0.55);
    const restitution = options.restitution ?? (isPlayer ? 0.05 : 0.2);
    const friction = options.friction ?? (isPlayer ? 0.9 : 0.45);

    const id = proxySeq++;
    const mesh = MeshBuilder.CreateCapsule(
      `MinionPhysProxy_${id}`,
      {
        radius: this.radius,
        height,
        tessellation: 8,
        subdivisions: 2,
      },
      scene,
    );
    mesh.isVisible = options.debugVisible ?? false;
    mesh.isPickable = false;
    mesh.position.copyFrom(this.centerFromTarget());
    this.mesh = mesh;

    const pointA = new Vector3(0, -this.halfHeight, 0);
    const pointB = new Vector3(0, this.halfHeight, 0);
    this.aggregate = new PhysicsAggregate(
      mesh,
      PhysicsShapeType.CAPSULE,
      {
        mass,
        friction,
        restitution,
        radius: this.radius,
        pointA,
        pointB,
      },
      scene,
    );

    // 一律 DYNAMIC，才能互推；靠速度控制区分玩家
    this.aggregate.body.setMotionType(PhysicsMotionType.DYNAMIC);
    this.aggregate.body.setMassProperties({ mass });
    // 玩家略滑一点便于贴着人走；展示位阻尼大，推完会停
    this.aggregate.body.setLinearDamping(isPlayer ? 0.15 : 1.8);
    this.aggregate.body.setAngularDamping(8);
    // 物理驱动 mesh（disablePreStep 默认 true）
    this.aggregate.body.disablePreStep = true;

    // 若 target 的 body 上记录了 minion，自动进行物理代理反向引用绑定
    const minionObj = (target as unknown as { metadata?: { minion?: unknown } }).metadata?.minion;
    if (minionObj && typeof minionObj === 'object') {
      (minionObj as { physicsProxy?: unknown }).physicsProxy = this;
    }
  }

  /** 受击击退：平滑叠加物理线性速度 */
  applyHitKnockback(dir: Vector3, force = 2.0): void {
    if (this.disposed) return;
    this.aggregate.body.getLinearVelocityToRef(this.tmpVel);
    this.tmpVel.x += dir.x * force;
    this.tmpVel.z += dir.z * force;
    this.aggregate.body.setLinearVelocity(this.tmpVel);
  }

  /** 脚底 → 胶囊中心 */
  private centerFromTarget(): Vector3 {
    this.target.computeWorldMatrix(true);
    const p = this.target.getAbsolutePosition();
    return new Vector3(p.x, p.y + this.radius + this.halfHeight, p.z);
  }

  /** 胶囊中心高度（贴地站立时） */
  get standingCenterY(): number {
    return this.radius + this.halfHeight;
  }

  /**
   * 玩家：写入水平速度（世界 XZ，单位/秒）。
   * Y 保留物理结果（贴地/轻跳）。
   */
  setHorizontalVelocity(vx: number, vz: number): void {
    if (this.disposed) return;
    this.aggregate.body.getLinearVelocityToRef(this.tmpVel);
    this.tmpVel.x = vx;
    this.tmpVel.z = vz;
    this.aggregate.body.setLinearVelocity(this.tmpVel);
  }

  /** 读水平速度（用于朝向 / 步态） */
  getHorizontalVelocityToRef(out: Vector3): Vector3 {
    if (this.disposed) {
      out.set(0, 0, 0);
      return out;
    }
    this.aggregate.body.getLinearVelocityToRef(this.tmpVel);
    out.set(this.tmpVel.x, 0, this.tmpVel.z);
    return out;
  }

  getHorizontalSpeed(): number {
    if (this.disposed) return 0;
    this.aggregate.body.getLinearVelocityToRef(this.tmpVel);
    return Math.hypot(this.tmpVel.x, this.tmpVel.z);
  }

  /**
   * 每帧：锁直立 + 把胶囊位姿写回表现 root（脚底 Y=0 平面）。
   * 应在物理步进之后的下一帧开头调用（见 main 循环）。
   */
  syncToTarget(): void {
    if (this.disposed) return;
    // 禁止翻滚：角速度清零 + 姿态扶正
    this.aggregate.body.setAngularVelocity(Vector3.ZeroReadOnly);
    this.mesh.rotationQuaternion = null;
    this.mesh.rotation.set(0, 0, 0);

    this.tmpPos.copyFrom(this.mesh.position);
    this.target.position.x = this.tmpPos.x;
    this.target.position.z = this.tmpPos.z;
    // 表现层脚底贴逻辑地面；竖直起伏只在物理胶囊上
    this.target.position.y = 0;

    // 若被打飞过高，轻轻压回站立高度（防穿透飞天）
    if (this.tmpPos.y > this.standingCenterY + 0.35) {
      this.mesh.position.y = this.standingCenterY + 0.35;
    }
  }

  /**
   * 将代理瞬移到 target 脚底（出生/重置/复活用）。
   *
   * 不能用 setTargetTransform：那是「设速度去追目标」，会被墙挡住，
   * 下一帧 syncToTarget 又把表现层拉回原处，看起来像原地复活。
   */
  teleportToTarget(): void {
    if (this.disposed) return;
    const c = this.centerFromTarget();
    this.mesh.position.copyFrom(c);
    this.mesh.rotationQuaternion = null;
    this.mesh.rotation.set(0, 0, 0);
    this.mesh.computeWorldMatrix(true);

    const body = this.aggregate.body;
    const plugin = this.mesh.getScene().getPhysicsEngine()?.getPhysicsPlugin();
    if (plugin instanceof HavokPlugin) {
      const wasDisabled = body.disablePreStep;
      body.disablePreStep = false;
      plugin.setPhysicsBodyTransformation(body, this.mesh);
      body.disablePreStep = wasDisabled;
    }

    body.setLinearVelocity(Vector3.ZeroReadOnly);
    body.setAngularVelocity(Vector3.ZeroReadOnly);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.aggregate.dispose();
    this.mesh.dispose();
  }
}
