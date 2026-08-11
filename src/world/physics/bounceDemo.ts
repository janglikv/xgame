import {
  Color3,
  Mesh,
  MeshBuilder,
  PhysicsAggregate,
  PhysicsShapeType,
  type Scene,
  ShadowGenerator,
  StandardMaterial,
  Vector3,
} from '@babylonjs/core';

export interface BounceDemoOptions {
  /** 球数量（默认 24） */
  count?: number;
  /** 生成中心 XZ */
  center?: Vector3;
  /** 生成高度范围 [minY, maxY] */
  heightRange?: [number, number];
  /** 水平散布半径 */
  spread?: number;
  shadowGenerator?: ShadowGenerator;
}

/**
 * 弹性球演示：大量动态体 + 回弹，用来压测 / 观察物理是否工作。
 * 不参与玩法，可随时关掉。
 */
export function spawnBounceDemo(
  scene: Scene,
  options: BounceDemoOptions = {},
): Mesh[] {
  const count = options.count ?? 24;
  const center = options.center ?? new Vector3(0, 0, 0);
  const [y0, y1] = options.heightRange ?? [1.2, 3.5];
  const spread = options.spread ?? 2.5;
  const shadowGen = options.shadowGenerator;

  const mats: StandardMaterial[] = [
    makeBallMat(scene, 'bounceRed', 0xef4444),
    makeBallMat(scene, 'bounceAmber', 0xf59e0b),
    makeBallMat(scene, 'bounceSky', 0x38bdf8),
    makeBallMat(scene, 'bounceViolet', 0xa78bfa),
    makeBallMat(scene, 'bounceLime', 0x84cc16),
  ];

  const balls: Mesh[] = [];
  for (let i = 0; i < count; i++) {
    const r = 0.08 + Math.random() * 0.1;
    const ball = MeshBuilder.CreateSphere(
      `BounceBall_${i}`,
      { diameter: r * 2, segments: 12 },
      scene,
    );
    const ox = (Math.random() * 2 - 1) * spread;
    const oz = (Math.random() * 2 - 1) * spread;
    const oy = y0 + Math.random() * (y1 - y0);
    ball.position.set(center.x + ox, oy, center.z + oz);
    ball.material = mats[i % mats.length]!;
    shadowGen?.addShadowCaster(ball);

    // 高弹性 + 一点摩擦，落地会弹几下再停
    const agg = new PhysicsAggregate(
      ball,
      PhysicsShapeType.SPHERE,
      {
        mass: 0.15 + Math.random() * 0.35,
        restitution: 0.72,
        friction: 0.35,
        radius: r,
      },
      scene,
    );
    // 轻微线性阻尼，避免永不停歇
    agg.body.setLinearDamping(0.08);
    agg.body.setAngularDamping(0.2);
    // 给一点初速度，方便互撞
    const kick = new Vector3(
      (Math.random() * 2 - 1) * 1.2,
      Math.random() * 0.5,
      (Math.random() * 2 - 1) * 1.2,
    );
    agg.body.setLinearVelocity(kick);

    balls.push(ball);
  }
  return balls;
}

function makeBallMat(scene: Scene, name: string, hex: number): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = new Color3(
    ((hex >> 16) & 0xff) / 255,
    ((hex >> 8) & 0xff) / 255,
    (hex & 0xff) / 255,
  );
  m.specularColor = Color3.Black();
  m.emissiveColor = m.diffuseColor.scale(0.15);
  return m;
}
