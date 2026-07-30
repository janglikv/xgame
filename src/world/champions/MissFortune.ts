import * as THREE from 'three';
import { CircleBody } from '../collision/CircleBody';

/**
 * 第一个英雄：厄运小姐。
 * 独立模型（起步形态参考小兵五球+巫师帽，但与小兵代码完全分离，后续可自由改型）。
 * 无小兵 AI：仅站桩展示与地面碰撞。
 */
export class MissFortune extends THREE.Group {
  static readonly DISPLAY_NAME = '厄运小姐';

  /**
   * 相对近战小兵默认 scale(0.125) 的三倍。
   * 写死在此，不引用小兵常量，避免耦合。
   */
  static readonly SCALE = 0.375;
  /** 地面圆碰撞半径（约小兵 0.12 × 3） */
  static readonly COLLIDER_RADIUS = 0.36;

  private static readonly BODY = 0xf3eee6;
  private static readonly LIMB = 0xf3eee6;
  /** 粉色帽子 */
  private static readonly HAT_PINK = 0xec4899;
  private static readonly HAT_PINK_BAND = 0xbe185d;

  readonly collider: CircleBody;

  constructor(x = 0, z = 0) {
    super();
    this.name = MissFortune.DISPLAY_NAME;
    this.position.set(x, 0, z);
    this.scale.setScalar(MissFortune.SCALE);
    // 面朝 +X（本地 +Z → 世界 +X）
    this.rotation.y = Math.PI / 2;

    this.collider = new CircleBody(this, MissFortune.COLLIDER_RADIUS);

    const bodyRoot = new THREE.Group();
    this.add(bodyRoot);

    const ball = (radius: number, color: number): THREE.Mesh =>
      new THREE.Mesh(
        new THREE.SphereGeometry(radius, 20, 16),
        new THREE.MeshStandardMaterial({
          color,
          roughness: 0.6,
          metalness: 0.04,
        }),
      );

    // —— 身体 ——
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 24, 20),
      new THREE.MeshStandardMaterial({
        map: createFaceTexture(MissFortune.BODY),
        roughness: 0.6,
        metalness: 0.04,
      }),
    );
    body.position.y = 0.66;
    body.rotation.y = -Math.PI / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    bodyRoot.add(body);

    // —— 粉色巫师帽 ——
    const hatGroup = new THREE.Group();
    hatGroup.position.set(0, 0.66 + 0.14, -0.06);
    hatGroup.rotation.z = -0.05;
    hatGroup.rotation.x = -0.42;

    const hatMat = new THREE.MeshStandardMaterial({
      color: MissFortune.HAT_PINK,
      roughness: 0.35,
      metalness: 0.05,
    });
    const bandMat = new THREE.MeshStandardMaterial({
      color: MissFortune.HAT_PINK_BAND,
      roughness: 0.3,
      metalness: 0.1,
    });

    const brimRadius = 0.62;
    const brimDisk = new THREE.Mesh(
      new THREE.CylinderGeometry(brimRadius, brimRadius, 0.045, 32),
      hatMat,
    );
    brimDisk.castShadow = true;
    hatGroup.add(brimDisk);

    const brimRim = new THREE.Mesh(
      new THREE.TorusGeometry(brimRadius, 0.03, 12, 32),
      hatMat,
    );
    brimRim.rotation.x = Math.PI / 2;
    hatGroup.add(brimRim);

    const band = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.038, 12, 32),
      bandMat,
    );
    band.rotation.x = Math.PI / 2;
    band.position.y = 0.03;
    hatGroup.add(band);

    const domeRadius = 0.44;
    const domeMesh = new THREE.Mesh(
      new THREE.SphereGeometry(
        domeRadius,
        32,
        24,
        0,
        Math.PI * 2,
        0,
        Math.PI / 2,
      ),
      hatMat,
    );
    domeMesh.scale.set(1, 0.85, 1);
    domeMesh.position.y = 0.01;
    domeMesh.castShadow = true;
    hatGroup.add(domeMesh);
    bodyRoot.add(hatGroup);

    // —— 双手（对称举枪就绪）——
    // 手球半径 0.1；枪挂在球外侧，只贴合不穿模
    const leftHand = ball(0.1, MissFortune.LIMB);
    leftHand.position.set(0.48, 0.62, 0.28);
    leftHand.castShadow = true;
    bodyRoot.add(leftHand);

    const rightHand = ball(0.1, MissFortune.LIMB);
    rightHand.position.set(-0.48, 0.62, 0.28);
    rightHand.castShadow = true;
    bodyRoot.add(rightHand);

    // 粉色双枪：握把贴手球，枪身朝前；左手镜像右手姿态
    // 手半径 0.1；原点≈握把顶端接触点，整体在球外
    const gunPos = new THREE.Vector3(0.0, 0.09, 0.13);
    // 负 Rx：枪口（本地 +Z）略抬高

    const rightGun = createPinkGun();
    rightGun.name = 'PinkGun_Right';
    rightGun.position.copy(gunPos);
    rightGun.rotation.order = 'YXZ';
    rightGun.rotation.set(-0.22, 0.03, -0.15);
    rightHand.add(rightGun);

    const leftGun = createPinkGun();
    leftGun.name = 'PinkGun_Left';
    leftGun.position.copy(gunPos);
    leftGun.rotation.order = 'YXZ';
    // Y / Z 取反，镜像到左手
    leftGun.rotation.set(-0.22, -0.03, 0.15);
    leftHand.add(leftGun);

    // —— 双脚 ——
    const leftFoot = ball(0.1, MissFortune.LIMB);
    leftFoot.position.set(0.14, 0.1, 0.02);
    leftFoot.castShadow = true;
    this.add(leftFoot);

    const rightFoot = ball(0.1, MissFortune.LIMB);
    rightFoot.position.set(-0.14, 0.1, 0.02);
    rightFoot.castShadow = true;
    this.add(rightFoot);
  }

  dispose(): void {
    this.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const material = mesh.material;
      if (!material) return;
      const list = Array.isArray(material) ? material : [material];
      for (const m of list) {
        const std = m as THREE.MeshStandardMaterial;
        std.map?.dispose();
        m.dispose();
      }
    });
  }
}

/** 身体正面可爱表情贴图（本文件私有，不共享小兵实现） */
function createFaceTexture(bodyColor: number): THREE.CanvasTexture {
  const width = 1024;
  const height = 512;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');

  const bodyHex = `#${bodyColor.toString(16).padStart(6, '0')}`;
  const darkBrown = '#2b2123';

  ctx.fillStyle = bodyHex;
  ctx.fillRect(0, 0, width, height);

  const cx = width * 0.5;
  const eyeY = height * 0.49;
  const eyeGap = width * 0.075;
  const eyeRy = height * 0.1;
  const eyeRx = eyeRy;

  const drawBlush = (bx: number) => {
    const g = ctx.createRadialGradient(
      bx,
      height * 0.59,
      0,
      bx,
      height * 0.59,
      height * 0.08,
    );
    g.addColorStop(0, 'rgba(255, 120, 140, 0.52)');
    g.addColorStop(0.5, 'rgba(255, 140, 160, 0.28)');
    g.addColorStop(1, 'rgba(255, 180, 190, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(bx, height * 0.59, eyeRx * 0.9, eyeRy * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
  };
  drawBlush(cx - eyeGap * 1.55);
  drawBlush(cx + eyeGap * 1.55);

  ctx.strokeStyle = darkBrown;
  ctx.lineWidth = height * 0.016;
  ctx.lineCap = 'round';

  ctx.beginPath();
  ctx.ellipse(
    cx - eyeGap - width * 0.005,
    eyeY - eyeRy * 1.15,
    eyeRx * 0.5,
    eyeRy * 0.5,
    0,
    Math.PI * 1.15,
    Math.PI * 1.75,
  );
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(
    cx + eyeGap + width * 0.005,
    eyeY - eyeRy * 1.15,
    eyeRx * 0.5,
    eyeRy * 0.5,
    0,
    Math.PI * 1.25,
    Math.PI * 1.85,
  );
  ctx.stroke();

  const drawEye = (ex: number) => {
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, eyeRx, eyeRy, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#21181b';
    ctx.fill();

    const innerG = ctx.createLinearGradient(ex, eyeY - eyeRy, ex, eyeY + eyeRy);
    innerG.addColorStop(0, '#1d1518');
    innerG.addColorStop(0.65, '#3a2b2f');
    innerG.addColorStop(1, '#664c54');
    ctx.fillStyle = innerG;
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, eyeRx * 0.96, eyeRy * 0.96, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#140c0e';
    ctx.beginPath();
    ctx.ellipse(ex, eyeY + eyeRy * 0.05, eyeRx * 0.7, eyeRy * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(
      ex - eyeRx * 0.32,
      eyeY - eyeRy * 0.32,
      eyeRx * 0.38,
      eyeRy * 0.44,
      -Math.PI / 6,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(
      ex + eyeRx * 0.35,
      eyeY + eyeRy * 0.35,
      eyeRx * 0.2,
      eyeRy * 0.2,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(
      ex - eyeRx * 0.42,
      eyeY + eyeRy * 0.32,
      eyeRx * 0.09,
      eyeRy * 0.09,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  };

  drawEye(cx - eyeGap);
  drawEye(cx + eyeGap);

  ctx.strokeStyle = darkBrown;
  ctx.lineWidth = height * 0.016;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.ellipse(
    cx,
    height * 0.555,
    eyeRx * 0.42,
    eyeRy * 0.42,
    0,
    Math.PI * 0.15,
    Math.PI * 0.85,
  );
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * 粉色卡通手枪（本地坐标：原点≈握把中心，+Z 枪口，-Y 握把向下）。
 * 粉壳 + 深粉握把 + 金色镶边；枪口夸张放大的卡通喇叭口。
 */
function createPinkGun(): THREE.Group {
  const gun = new THREE.Group();
  gun.name = 'PinkGun';

  const pink = new THREE.MeshStandardMaterial({
    color: 0xec4899,
    roughness: 0.38,
    metalness: 0.18,
  });
  const pinkDeep = new THREE.MeshStandardMaterial({
    color: 0xbe185d,
    roughness: 0.42,
    metalness: 0.12,
  });
  const pinkLight = new THREE.MeshStandardMaterial({
    color: 0xf9a8d4,
    roughness: 0.32,
    metalness: 0.2,
  });
  const gold = new THREE.MeshStandardMaterial({
    color: 0xfbbf24,
    roughness: 0.3,
    metalness: 0.75,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x2a0614,
    roughness: 0.55,
    metalness: 0.15,
  });
  // 枪口内膛微光，卡通「蓄能」感
  const boreGlow = new THREE.MeshStandardMaterial({
    color: 0x831843,
    roughness: 0.35,
    metalness: 0.1,
    emissive: 0xf472b6,
    emissiveIntensity: 0.55,
  });

  const cast = (mesh: THREE.Mesh) => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };

  // 本地原点 = 握把顶端（与手球贴合的接触点）；枪身整体在 +Z / -Y，不朝手心叠
  // 1. 握把（从接触点向下）
  const grip = cast(
    new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.13, 0.07), pinkDeep),
  );
  grip.position.set(0, -0.07, 0.0);
  grip.rotation.x = 0.12;
  gun.add(grip);

  const gripCap = cast(
    new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.018, 0.075), gold),
  );
  gripCap.position.set(0, -0.14, -0.012);
  gripCap.rotation.x = 0.12;
  gun.add(gripCap);

  // 2. 枪身（整体前移，离开手球）
  const frame = cast(
    new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.07, 0.14), pink),
  );
  frame.position.set(0, -0.01, 0.1);
  gun.add(frame);

  const topRail = cast(
    new THREE.Mesh(
      new THREE.CylinderGeometry(0.032, 0.034, 0.12, 14),
      pinkLight,
    ),
  );
  topRail.rotation.x = Math.PI / 2;
  topRail.position.set(0, 0.02, 0.1);
  gun.add(topRail);

  // 3. 短粗枪管 → 大喇叭口
  const barrel = cast(
    new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.03, 0.12, 16),
      pink,
    ),
  );
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.0, 0.22);
  gun.add(barrel);

  // 4. ★ 夸张卡通大枪口
  const muzzleY = 0.0;
  const muzzleZ = 0.36;

  const muzzleBell = cast(
    new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.07, 0.1, 24),
      pinkLight,
    ),
  );
  muzzleBell.rotation.x = Math.PI / 2;
  muzzleBell.position.set(0, muzzleY, muzzleZ);
  gun.add(muzzleBell);

  const muzzleLip = cast(
    new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.028, 12, 28), gold),
  );
  muzzleLip.position.set(0, muzzleY, muzzleZ + 0.055);
  gun.add(muzzleLip);

  const muzzleRim = cast(
    new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.016, 10, 24), pinkDeep),
  );
  muzzleRim.position.set(0, muzzleY, muzzleZ + 0.04);
  gun.add(muzzleRim);

  const muzzleFace = cast(
    new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, 0.02, 24),
      pinkDeep,
    ),
  );
  muzzleFace.rotation.x = Math.PI / 2;
  muzzleFace.position.set(0, muzzleY, muzzleZ + 0.02);
  gun.add(muzzleFace);

  const bore = cast(
    new THREE.Mesh(new THREE.SphereGeometry(0.072, 20, 16), dark),
  );
  bore.scale.set(1, 1, 0.55);
  bore.position.set(0, muzzleY, muzzleZ + 0.01);
  gun.add(bore);

  const boreCore = cast(
    new THREE.Mesh(new THREE.SphereGeometry(0.038, 14, 12), boreGlow),
  );
  boreCore.scale.set(1, 1, 0.5);
  boreCore.position.set(0, muzzleY, muzzleZ + 0.005);
  gun.add(boreCore);

  // 5. 扳机护圈 / 扳机（在握把与枪身交接处前方）
  const guard = cast(
    new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.009, 8, 16, Math.PI), gold),
  );
  guard.rotation.y = Math.PI / 2;
  guard.rotation.z = Math.PI;
  guard.position.set(0, -0.04, 0.07);
  gun.add(guard);

  const trigger = cast(
    new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.028, 0.016), dark),
  );
  trigger.position.set(0, -0.035, 0.075);
  trigger.rotation.x = 0.25;
  gun.add(trigger);

  // 6. 后机匣（略在握把上方后侧，仍在手球外）
  const hammer = cast(
    new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.04, 0.035), pinkDeep),
  );
  hammer.position.set(0, 0.015, 0.02);
  hammer.rotation.x = -0.25;
  gun.add(hammer);

  // 7. 侧板心形装饰
  const heart = cast(
    new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), pinkLight),
  );
  heart.scale.set(1, 0.85, 0.55);
  heart.position.set(0.042, 0.0, 0.1);
  gun.add(heart);

  const heart2 = heart.clone();
  heart2.position.x = -0.042;
  gun.add(heart2);

  return gun;
}
