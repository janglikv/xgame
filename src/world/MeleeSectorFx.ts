import {
  Color3,
  Mesh,
  MeshBuilder,
  type Scene,
  StandardMaterial,
  Vector3,
} from '@babylonjs/core';

/**
 * 可以在主角攻击时触发的前方扇形波纹/弧光特效。
 * @param scene 场景对象
 * @param originPos 特效起始原点（主角位置）
 * @param forwardDir 主角正前方方向（标准归一化 Vector3）
 * @param radius 扇形半径（默认 2.1m）
 * @param angleRad 扇形张角弧度（默认 110 度 = ~1.92rad）
 */
/**
 * 拳头落点处的冲击波特效
 */
export function spawnPunchImpactFx(
  scene: Scene,
  impactPos: Vector3,
  radius = 0.5,
  style: 'gold' | 'cyan' = 'gold',
): void {
  const DURATION = 0.15;
  const disc = MeshBuilder.CreateDisc(
    'punchImpactFx',
    { radius, tessellation: 24 },
    scene,
  );

  const mat = new StandardMaterial('punchImpactMat', scene);
  const glowColor =
    style === 'cyan'
      ? new Color3(0.1, 0.9, 1.0)
      : new Color3(1.0, 0.85, 0.25);

  mat.diffuseColor = glowColor;
  mat.emissiveColor = glowColor;
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  mat.alpha = 0.9;
  disc.material = mat;
  disc.isPickable = false;

  disc.rotation.x = Math.PI / 2;
  disc.position.copyFrom(impactPos);

  let elapsed = 0;
  disc.scaling.set(0.2, 0.2, 0.2);

  const observer = scene.onBeforeRenderObservable.add(() => {
    const dt = scene.getEngine().getDeltaTime() / 1000;
    elapsed += dt;

    const progress = Math.min(1, elapsed / DURATION);
    const scale = 0.2 + 1.1 * Math.sin(progress * (Math.PI / 2));
    disc.scaling.set(scale, scale, scale);
    mat.alpha = 0.9 * (1 - progress);

    if (progress >= 1) {
      scene.onBeforeRenderObservable.remove(observer);
      mat.dispose();
      disc.dispose();
    }
  });
}

export function spawnSectorSweepFx(
  scene: Scene,
  originPos: Vector3,
  forwardDir: Vector3,
  radius = 1.25,
  angleRad = (75 * Math.PI) / 180,
  style: 'arcane' | 'gold' | 'cyan' = 'gold',
): void {
  // 气浪扩散耗时 (秒)
  const DURATION = 0.18;
  const arcRatio = angleRad / (Math.PI * 2);

  const disc = MeshBuilder.CreateDisc(
    'meleeSectorFx',
    { radius, tessellation: 32, arc: arcRatio },
    scene,
  );

  const mat = new StandardMaterial('meleeSectorMat', scene);
  const glowColor =
    style === 'arcane'
      ? new Color3(0.75, 0.2, 1.0)
      : style === 'cyan'
        ? new Color3(0.1, 0.9, 1.0)
        : new Color3(1.0, 0.85, 0.25);

  mat.diffuseColor = glowColor;
  mat.emissiveColor = glowColor;
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  mat.alpha = 0.85;
  disc.material = mat;
  disc.isPickable = false;

  // 基础摆放：Disc 在 XY 平面上，默认弧度从 +X (0) 逆时针开 arcRatio*2PI。
  // 调整其旋转使得扇形中心对准 +Z，然后再转向 forwardDir
  disc.rotation.x = Math.PI / 2;
  disc.rotation.y = -angleRad / 2;

  // 使用 TransformNode 统一驱动方向与动画
  const container = new Mesh('meleeSectorContainer', scene);
  container.position = originPos.clone();
  container.position.y += 0.35; // 浮空腰部高度

  disc.parent = container;

  // 让 container 朝向 forwardDir
  const yaw = Math.atan2(forwardDir.x, forwardDir.z);
  container.rotation.y = yaw;

  // 动画驱动
  let elapsed = 0;
  disc.scaling.set(0.3, 0.3, 0.3);

  const observer = scene.onBeforeRenderObservable.add(() => {
    const dt = scene.getEngine().getDeltaTime() / 1000;
    elapsed += dt;

    const progress = Math.min(1, elapsed / DURATION);
    // 快速展大
    const scale = 0.35 + 0.75 * Math.sin(progress * (Math.PI / 2));
    disc.scaling.set(scale, scale, scale);

    // 透明度淡出
    mat.alpha = 0.85 * (1 - progress);

    if (progress >= 1) {
      scene.onBeforeRenderObservable.remove(observer);
      mat.dispose();
      disc.dispose();
      container.dispose();
    }
  });
}

/**
 * 敌人受击瞬间的爆破火花/粒子散落
 */
export function spawnHitSparkFx(
  scene: Scene,
  hitPos: Vector3,
  hitDir?: Vector3,
): void {
  const sparkCount = 6;
  const DURATION = 0.22;
  const dir = hitDir
    ? hitDir.normalizeToNew()
    : new Vector3(0, 0, 1);

  const mat = new StandardMaterial('hitSparkMat', scene);
  mat.diffuseColor = new Color3(1.0, 0.9, 0.4);
  mat.emissiveColor = new Color3(1.0, 0.9, 0.4);
  mat.disableLighting = true;
  mat.backFaceCulling = false;

  const sparks: { mesh: Mesh; vel: Vector3 }[] = [];

  for (let i = 0; i < sparkCount; i++) {
    const spark = MeshBuilder.CreateDisc(
      'spark',
      { radius: 0.05, tessellation: 8 },
      scene,
    );
    spark.material = mat;
    spark.billboardMode = Mesh.BILLBOARDMODE_ALL;
    spark.isPickable = false;

    // 起始位置在受击中心附近随机偏移
    spark.position = hitPos.clone().add(
      new Vector3(
        (Math.random() - 0.5) * 0.2,
        0.3 + (Math.random() - 0.5) * 0.2,
        (Math.random() - 0.5) * 0.2,
      ),
    );

    // 沿击中方向散开 + 随机向上
    const spreadVel = dir
      .scale(2.0 + Math.random() * 2.0)
      .add(
        new Vector3(
          (Math.random() - 0.5) * 2.5,
          1.0 + Math.random() * 2.0,
          (Math.random() - 0.5) * 2.5,
        ),
      );

    sparks.push({ mesh: spark, vel: spreadVel });
  }

  let elapsed = 0;
  const observer = scene.onBeforeRenderObservable.add(() => {
    const dt = scene.getEngine().getDeltaTime() / 1000;
    elapsed += dt;

    const progress = Math.min(1, elapsed / DURATION);
    mat.alpha = 1 - progress;

    for (const s of sparks) {
      s.mesh.position.addInPlace(s.vel.scale(dt));
      s.vel.y -= 9.8 * dt; // 重力下坠
      const sScale = Math.max(0.01, 1 - progress);
      s.mesh.scaling.set(sScale, sScale, sScale);
    }

    if (progress >= 1) {
      scene.onBeforeRenderObservable.remove(observer);
      mat.dispose();
      for (const s of sparks) {
        s.mesh.dispose();
      }
    }
  });
}
