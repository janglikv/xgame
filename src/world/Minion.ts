import * as THREE from 'three';

/**
 * 极简五球小兵：身体 + 左手 + 右手 + 左脚 + 右脚。
 */
export class Minion extends THREE.Group {
  private static readonly SCALE = 0.125;

  private static readonly BODY = 0xf3eee6;
  private static readonly LIMB = 0xf3eee6;
  private static readonly HAT_BLUE = 0x3b82f6;
  private static readonly HAT_BLUE_BAND = 0x1d4ed8;
  private static readonly HAT_RED = 0xef4444;
  private static readonly HAT_RED_BAND = 0xb91c1c;

  private readonly bodyRoot: THREE.Group;
  private readonly body: THREE.Mesh;
  private readonly leftHand: THREE.Mesh;
  private readonly rightHand: THREE.Mesh;
  private readonly leftFoot: THREE.Mesh;
  private readonly rightFoot: THREE.Mesh;

  /**
   * @param team 蓝方蓝帽面朝 +X，红方红帽面朝 -X
   */
  constructor(x: number, z = 0, team: 'blue' | 'red' = x >= 0 ? 'red' : 'blue') {
    super();
    this.name = `Minion_${team}_${x}_${z}`;
    this.position.set(x, 0, z);
    this.scale.setScalar(Minion.SCALE);
    // 蓝方面朝 +X，红方面朝 -X（相向）
    this.rotation.y = team === 'red' ? -Math.PI / 2 : Math.PI / 2;

    const hatColor = team === 'red' ? Minion.HAT_RED : Minion.HAT_BLUE;
    const hatBandColor =
      team === 'red' ? Minion.HAT_RED_BAND : Minion.HAT_BLUE_BAND;

    this.bodyRoot = new THREE.Group();
    this.add(this.bodyRoot);

    const ball = (radius: number, color: number): THREE.Mesh =>
      new THREE.Mesh(
        new THREE.SphereGeometry(radius, 20, 16),
        new THREE.MeshStandardMaterial({
          color,
          roughness: 0.6,
          metalness: 0.04,
        }),
      );

    // 1. 身体（略抬高，与脚保持小间距；正面画可爱表情）
    this.body = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 24, 20),
      new THREE.MeshStandardMaterial({
        map: createBodyFaceTexture(Minion.BODY),
        roughness: 0.6,
        metalness: 0.04,
      }),
    );
    this.body.position.y = 0.66;
    // 球面 UV 在 +X 最完整；转到局部 +Z，再随角色朝向转到世界 +X
    this.body.rotation.y = -Math.PI / 2;
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    this.bodyRoot.add(this.body);

    // 魔法巫师帽（按参考图优雅重新设计：圆润帽檐 + 贴合帽环 + 锥形帽身 + 帽顶圆球）
    const hatGroup = new THREE.Group();
    // 帽子进一步下移，深扣在头上
    hatGroup.position.set(0, 0.66 + 0.14, -0.06);
    hatGroup.rotation.z = -0.05;
    hatGroup.rotation.x = -0.42; // 大角度向后倾斜

    const hatMat = new THREE.MeshStandardMaterial({
      color: hatColor,
      roughness: 0.35,
      metalness: 0.05,
    });
    const bandMat = new THREE.MeshStandardMaterial({
      color: hatBandColor,
      roughness: 0.3,
      metalness: 0.1,
    });

    // 1. 帽檐底盘（平滑圆盘，放大帽檐尺寸）
    const brimRadius = 0.62;
    const brimDisk = new THREE.Mesh(
      new THREE.CylinderGeometry(brimRadius, brimRadius, 0.045, 32),
      hatMat,
    );
    brimDisk.castShadow = true;
    hatGroup.add(brimDisk);

    // 2. 帽檐外侧圆润包边 (Torus 边缘包边)
    const brimRim = new THREE.Mesh(
      new THREE.TorusGeometry(brimRadius, 0.03, 12, 32),
      hatMat,
    );
    brimRim.rotation.x = Math.PI / 2;
    hatGroup.add(brimRim);

    // 3. 饰带 (帽环)
    const band = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.038, 12, 32),
      bandMat,
    );
    band.rotation.x = Math.PI / 2;
    band.position.y = 0.03;
    hatGroup.add(band);

    // 4. 纯正光滑半球帽顶（加大半球半径，突出丰满大半圆球帽顶）
    const domeRadius = 0.44;
    const domeMesh = new THREE.Mesh(
      new THREE.SphereGeometry(
        domeRadius,
        32,
        24,
        0,
        Math.PI * 2,
        0,
        Math.PI / 2, // 只取上半球
      ),
      hatMat,
    );
    // 纵向比例 0.85，呈现更大更饱满的大圆球帽顶
    domeMesh.scale.set(1, 0.85, 1);
    domeMesh.position.y = 0.01;
    domeMesh.castShadow = true;
    hatGroup.add(domeMesh);

    this.bodyRoot.add(hatGroup);

    // 2 / 3. 双手（小兵自身面向 +Z：左手为 +X，右手为 -X）
    this.leftHand = ball(0.1, Minion.LIMB);
    this.leftHand.position.set(0.47, 0.48, 0.1);
    this.leftHand.castShadow = true;
    this.bodyRoot.add(this.leftHand);

    this.rightHand = ball(0.1, Minion.LIMB);
    this.rightHand.position.set(-0.47, 0.48, 0.1);
    this.rightHand.castShadow = true;
    this.bodyRoot.add(this.rightHand);

    // 给右手配持卡通短剑
    const sword = createCartoonShortSword();
    // 调整剑在右手中的持握位置与朝向（向前上方斜指，向外倾斜）
    sword.position.set(0, 0, 0.02);
    sword.rotation.x = Math.PI / 3.2; // 向上向前方倾斜
    sword.rotation.z = Math.PI / 8;   // 向右外侧微微倾斜
    sword.rotation.y = -Math.PI / 6;  // 剑刃朝向
    this.rightHand.add(sword);

    // 4 / 5. 双脚（脚底精确贴合 Y = 0 地面，左脚为 +X，右脚为 -X）
    this.leftFoot = ball(0.1, Minion.LIMB);
    this.leftFoot.position.set(0.14, 0.10, 0.02);
    this.leftFoot.castShadow = true;
    this.add(this.leftFoot);

    this.rightFoot = ball(0.1, Minion.LIMB);
    this.rightFoot.position.set(-0.14, 0.10, 0.02);
    this.rightFoot.castShadow = true;
    this.add(this.rightFoot);
  }

  update(_delta: number): void {
    // 呼吸/浮动动画已删除，保持静态贴地状态
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

/**
 * 身体贴图：底色 + 正面可爱表情（参考：大圆眼 + 腮红 + 微笑）
 * 球面 UV：u=0.5 对应几何 +X；身体已旋转使 +X → 角色正前方
 */
function createBodyFaceTexture(
  bodyColor: number,
): THREE.CanvasTexture {
  // 球面等距矩形(Equirectangular)映射的标准宽高比为 2:1 (例如 1024 x 512)
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

  // 正面中心在 u = 0.5 (即 width * 0.5)
  const cx = width * 0.5;
  // 将眼睛高度下移（从 0.44 下移到 0.49，让额头展示空间更丰富，面部更Q萌）
  const eyeY = height * 0.49;
  
  // 比例调整为 1.0 (正圆)，使在 3D 视角正面呈现饱满的大圆眼
  const eyeGap = width * 0.075;
  const eyeRy = height * 0.1;        // 纵向半径
  const eyeRx = eyeRy;               // 1:1 正圆比例

  // —— 腮红 ——
  const drawBlush = (bx: number) => {
    const g = ctx.createRadialGradient(bx, height * 0.59, 0, bx, height * 0.59, height * 0.08);
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

  // —— 短小弧形小眉毛（贴近眼睛，微微降低）——
  ctx.strokeStyle = darkBrown;
  ctx.lineWidth = height * 0.016;
  ctx.lineCap = 'round';

  // 左眉
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

  // 右眉
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

  // —— 效果图风格大眼（在 2:1 画布上抗拉伸）——
  const drawEye = (ex: number) => {
    // 眼睛基本大眼框
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, eyeRx, eyeRy, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#21181b';
    ctx.fill();

    // 眼睛底部渐变亮影
    const innerG = ctx.createLinearGradient(ex, eyeY - eyeRy, ex, eyeY + eyeRy);
    innerG.addColorStop(0, '#1d1518');
    innerG.addColorStop(0.65, '#3a2b2f');
    innerG.addColorStop(1, '#664c54');
    ctx.fillStyle = innerG;
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, eyeRx * 0.96, eyeRy * 0.96, 0, 0, Math.PI * 2);
    ctx.fill();

    // 内部深色瞳孔
    ctx.fillStyle = '#140c0e';
    ctx.beginPath();
    ctx.ellipse(ex, eyeY + eyeRy * 0.05, eyeRx * 0.7, eyeRy * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();

    // 1. 左上角特大主高光
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

    // 2. 右下角副高光
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

    // 3. 左下辅助微高光
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

  // —— 微笑嘴 ——
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
 * 极简短剑：剑首 + 握柄 + 一字护手 + 扁平尖刃。
 * 沿本地 +Y 伸出（剑柄在下、剑尖在上），整体尺寸适配手球半径 ~0.1。
 */
function createCartoonShortSword(): THREE.Group {
  const sword = new THREE.Group();

  const steel = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.28,
    metalness: 0.7,
  });
  const gripMat = new THREE.MeshStandardMaterial({
    color: 0x5c3a21,
    roughness: 0.8,
    metalness: 0.05,
  });

  // 1. 剑首：小金属球
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 10), steel);
  pommel.position.y = 0;
  pommel.castShadow = true;
  sword.add(pommel);

  // 2. 握柄：棕色短圆柱
  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.022, 0.12, 10),
    gripMat,
  );
  handle.position.y = 0.07;
  handle.castShadow = true;
  sword.add(handle);

  // 3. 护手：简单一字横档
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.022, 0.036), steel);
  guard.position.y = 0.14;
  guard.castShadow = true;
  sword.add(guard);

  // 4. 剑身：扁平轮廓挤出（底部宽、收尖），一眼就是短剑
  // 本地 Shape 在 XY，挤出沿 +Z；建好后绕 X 转正，使剑刃沿 +Y
  const outline = new THREE.Shape();
  outline.moveTo(0, 0.3); // 剑尖
  outline.lineTo(0.038, 0.22);
  outline.lineTo(0.042, 0.04);
  outline.lineTo(0.04, 0); // 护手侧根部
  outline.lineTo(-0.04, 0);
  outline.lineTo(-0.042, 0.04);
  outline.lineTo(-0.038, 0.22);
  outline.closePath();

  const bladeDepth = 0.012;
  const blade = new THREE.Mesh(
    new THREE.ExtrudeGeometry(outline, {
      depth: bladeDepth,
      bevelEnabled: false,
      curveSegments: 1,
    }),
    steel,
  );
  // Extrude 原点在护手处、沿 +Y 出尖；厚度居中
  blade.position.set(0, 0.15, -bladeDepth * 0.5);
  blade.castShadow = true;
  sword.add(blade);

  return sword;
}



