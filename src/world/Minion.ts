import * as THREE from 'three';

/**
 * 极简五球小兵：身体 + 左手 + 右手 + 左脚 + 右脚。
 */
export class Minion extends THREE.Group {
  private static readonly SCALE = 0.125;

  private static readonly BODY = 0xf3eee6;
  private static readonly LIMB = 0xf3eee6;
  private static readonly BROW = 0x2c1810;
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
  private elapsed = 0;

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

    // 1. 身体（略抬高，与脚保持小间距；正面画俩大眉毛）
    this.body = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 24, 20),
      new THREE.MeshStandardMaterial({
        map: createBodyTextureWithBrows(Minion.BODY, Minion.BROW),
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

    // 三角帽（蓝 / 红）
    const hatMat = new THREE.MeshStandardMaterial({
      color: hatColor,
      roughness: 0.55,
      metalness: 0.08,
    });
    const bandMat = new THREE.MeshStandardMaterial({
      color: hatBandColor,
      roughness: 0.5,
      metalness: 0.1,
    });

    const brim = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.42, 0.045, 20),
      hatMat,
    );
    brim.position.y = 0.66 + 0.32;
    brim.castShadow = true;
    this.bodyRoot.add(brim);

    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.34, 0.58, 16),
      hatMat,
    );
    cone.position.y = 0.66 + 0.32 + 0.29;
    cone.castShadow = true;
    this.bodyRoot.add(cone);

    const band = new THREE.Mesh(
      new THREE.TorusGeometry(0.32, 0.028, 8, 20),
      bandMat,
    );
    band.rotation.x = Math.PI / 2;
    band.position.y = 0.66 + 0.34;
    this.bodyRoot.add(band);

    // 2 / 3. 双手（略离身体，不贴不远）
    this.leftHand = ball(0.1, Minion.LIMB);
    this.leftHand.position.set(-0.54, 0.48, 0.1);
    this.leftHand.castShadow = true;
    this.bodyRoot.add(this.leftHand);

    this.rightHand = ball(0.1, Minion.LIMB);
    this.rightHand.position.set(0.54, 0.48, 0.1);
    this.rightHand.castShadow = true;
    this.bodyRoot.add(this.rightHand);

    // 4 / 5. 双脚（贴地，与身体下沿略分开，左右不过分外张）
    this.leftFoot = ball(0.1, Minion.LIMB);
    this.leftFoot.position.set(-0.14, 0.12, 0.02);
    this.leftFoot.castShadow = true;
    this.add(this.leftFoot);

    this.rightFoot = ball(0.1, Minion.LIMB);
    this.rightFoot.position.set(0.14, 0.12, 0.02);
    this.rightFoot.castShadow = true;
    this.add(this.rightFoot);
  }

  update(delta: number): void {
    this.elapsed += delta;
    const t = this.elapsed;

    const breathe = 1 + Math.sin(t * 2.2) * 0.015;
    this.body.scale.setScalar(breathe);
    this.bodyRoot.position.y = Math.sin(t * 2.2) * 0.01;

    this.leftHand.position.y = 0.48 + Math.sin(t * 1.8) * 0.02;
    this.rightHand.position.y = 0.48 + Math.sin(t * 1.8 + Math.PI) * 0.02;
    this.leftFoot.position.y = 0.12 + Math.sin(t * 2.6) * 0.012;
    this.rightFoot.position.y = 0.12 + Math.sin(t * 2.6 + Math.PI) * 0.012;
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

/** 身体贴图：底色 + 正面两道粗眉毛（球面 UV 中央偏上） */
function createBodyTextureWithBrows(
  bodyColor: number,
  browColor: number,
): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');

  const bodyHex = `#${bodyColor.toString(16).padStart(6, '0')}`;
  const browHex = `#${browColor.toString(16).padStart(6, '0')}`;

  ctx.fillStyle = bodyHex;
  ctx.fillRect(0, 0, size, size);

  // 球面 UV：u=0.5 对应几何 +X；身体已旋转使 +X → 角色正前方
  // 两大眉毛：粗、微微上扬
  ctx.strokeStyle = browHex;
  ctx.lineWidth = 40;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 左眉
  ctx.beginPath();
  ctx.moveTo(size * 0.30, size * 0.40);
  ctx.quadraticCurveTo(size * 0.38, size * 0.30, size * 0.46, size * 0.38);
  ctx.stroke();

  // 右眉
  ctx.beginPath();
  ctx.moveTo(size * 0.54, size * 0.38);
  ctx.quadraticCurveTo(size * 0.62, size * 0.30, size * 0.70, size * 0.40);
  ctx.stroke();

  // 小黑眼睛（点）
  ctx.fillStyle = '#111111';
  const eyeR = size * 0.016;
  ctx.beginPath();
  ctx.arc(size * 0.455, size * 0.48, eyeR, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(size * 0.545, size * 0.48, eyeR, 0, Math.PI * 2);
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}
