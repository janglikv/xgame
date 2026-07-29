import * as THREE from 'three';

/**
 * 防御塔（LoL 风格示意，非官方素材）。
 * 特征：厚重基座、分段石塔身、金属箍、顶部能量水晶。
 */
export class DefenseTower extends THREE.Group {
  /** 水平缩放 */
  private static readonly SCALE_XZ = 0.65;
  /** 高度缩放（更矮） */
  private static readonly SCALE_Y = 0.48;

  // 召唤师峡谷蓝方气质配色
  private static readonly STONE = 0x5c6b7a;
  private static readonly STONE_DARK = 0x3a4654;
  private static readonly STONE_MID = 0x4d5c6b;
  private static readonly METAL = 0xc4a035;
  private static readonly METAL_DARK = 0x8a7020;
  private static readonly CRYSTAL_BLUE = 0x4fc3f7;
  private static readonly CRYSTAL_BLUE_CORE = 0xe0f7ff;
  private static readonly CRYSTAL_RED = 0xef4444;
  private static readonly CRYSTAL_RED_CORE = 0xffe4e6;

  private readonly crystal: THREE.Mesh;
  private readonly crystalLight: THREE.PointLight;
  private readonly crystalGroup: THREE.Group;
  private elapsed = 0;

  /**
   * @param x 世界 X；x > 0 为红方水晶，x < 0 为蓝方水晶
   */
  constructor(x: number, z = 0) {
    super();
    this.name = `DefenseTower_${x}_${z}`;
    this.position.set(x, 0, z);

    const isRed = x > 0;
    const crystalColor = isRed
      ? DefenseTower.CRYSTAL_RED
      : DefenseTower.CRYSTAL_BLUE;
    const crystalCore = isRed
      ? DefenseTower.CRYSTAL_RED_CORE
      : DefenseTower.CRYSTAL_BLUE_CORE;
    this.scale.set(
      DefenseTower.SCALE_XZ,
      DefenseTower.SCALE_Y,
      DefenseTower.SCALE_XZ,
    );

    const stone = (color: number) =>
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.9,
        metalness: 0.05,
      });
    const metal = (color: number) =>
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.45,
        metalness: 0.75,
      });

    // —— 基座（多层台阶，LoL 塔底座很“沉”）——
    const baseBottom = mesh(
      new THREE.CylinderGeometry(0.55, 0.62, 0.12, 8),
      stone(DefenseTower.STONE_DARK),
      0.06,
    );
    this.add(baseBottom);

    const baseMid = mesh(
      new THREE.CylinderGeometry(0.46, 0.52, 0.14, 8),
      stone(DefenseTower.STONE_MID),
      0.19,
    );
    this.add(baseMid);

    const baseTop = mesh(
      new THREE.CylinderGeometry(0.38, 0.42, 0.1, 8),
      stone(DefenseTower.STONE),
      0.31,
    );
    this.add(baseTop);

    // 底座金边
    this.add(
      ring(0.4, 0.03, DefenseTower.METAL_DARK, 0.36, metal(DefenseTower.METAL_DARK)),
    );

    // —— 下塔身（粗）——
    const lowerShaft = mesh(
      new THREE.CylinderGeometry(0.28, 0.36, 0.85, 8),
      stone(DefenseTower.STONE),
      0.36 + 0.425,
    );
    this.add(lowerShaft);

    // 下段金属箍
    this.add(ring(0.3, 0.025, DefenseTower.METAL, 0.55, metal(DefenseTower.METAL)));
    this.add(ring(0.29, 0.022, DefenseTower.METAL, 1.05, metal(DefenseTower.METAL)));

    // —— 中段收腰 ——
    const midShaft = mesh(
      new THREE.CylinderGeometry(0.24, 0.28, 0.55, 8),
      stone(DefenseTower.STONE_MID),
      1.21 + 0.275,
    );
    this.add(midShaft);

    // 中段饰带
    const collar = mesh(
      new THREE.CylinderGeometry(0.32, 0.32, 0.1, 8),
      metal(DefenseTower.METAL),
      1.55,
    );
    this.add(collar);

    // —— 上塔身 ——
    const upperShaft = mesh(
      new THREE.CylinderGeometry(0.22, 0.26, 0.5, 8),
      stone(DefenseTower.STONE),
      1.6 + 0.25,
    );
    this.add(upperShaft);

    // —— 顶部平台（托住水晶）——
    const crown = mesh(
      new THREE.CylinderGeometry(0.34, 0.3, 0.12, 8),
      stone(DefenseTower.STONE_DARK),
      2.16,
    );
    this.add(crown);
    this.add(ring(0.33, 0.02, DefenseTower.METAL, 2.23, metal(DefenseTower.METAL)));

    // 托架“爪”：四根斜撑，类似塔顶金属支架
    const clawMat = metal(DefenseTower.METAL_DARK);
    const clawGeo = new THREE.BoxGeometry(0.06, 0.38, 0.08);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const claw = new THREE.Mesh(clawGeo, clawMat);
      claw.position.set(Math.cos(a) * 0.22, 2.38, Math.sin(a) * 0.22);
      claw.lookAt(0, 2.7, 0);
      claw.castShadow = true;
      this.add(claw);
    }

    // 短柱支撑水晶
    const pedestal = mesh(
      new THREE.CylinderGeometry(0.08, 0.12, 0.16, 8),
      metal(DefenseTower.METAL),
      2.3,
    );
    this.add(pedestal);

    // —— 能量水晶（LoL 塔核心识别点）——
    this.crystalGroup = new THREE.Group();
    this.crystalGroup.position.y = 2.55;
    this.add(this.crystalGroup);

    const crystalMat = new THREE.MeshStandardMaterial({
      color: crystalColor,
      emissive: crystalColor,
      emissiveIntensity: 0.85,
      roughness: 0.2,
      metalness: 0.15,
      transparent: true,
      opacity: 0.92,
    });
    this.crystal = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.22, 0),
      crystalMat,
    );
    this.crystal.castShadow = true;
    this.crystalGroup.add(this.crystal);

    // 内核高亮
    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.1, 0),
      new THREE.MeshStandardMaterial({
        color: crystalCore,
        emissive: crystalCore,
        emissiveIntensity: 1.2,
        roughness: 0.15,
        metalness: 0.1,
      }),
    );
    this.crystalGroup.add(core);

    // 水晶光晕
    this.crystalLight = new THREE.PointLight(crystalColor, 1.1, 6, 2);
    this.crystalLight.position.set(0, 0, 0);
    this.crystalGroup.add(this.crystalLight);

    // 底部一圈小符文石（装饰）
    const runeMat = metal(DefenseTower.METAL);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const rune = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.1, 0.05),
        runeMat,
      );
      rune.position.set(Math.cos(a) * 0.48, 0.28, Math.sin(a) * 0.48);
      rune.rotation.y = -a;
      this.add(rune);
    }
  }

  /** 水晶轻微旋转 + 呼吸光 */
  update(delta: number): void {
    this.elapsed += delta;
    this.crystal.rotation.y += delta * 0.6;
    this.crystal.rotation.x = Math.sin(this.elapsed * 0.8) * 0.08;

    const pulse = 0.75 + Math.sin(this.elapsed * 2.4) * 0.25;
    this.crystalLight.intensity = 0.85 + pulse * 0.45;
    const mat = this.crystal.material as THREE.MeshStandardMaterial;
    mat.emissiveIntensity = 0.65 + pulse * 0.45;

    this.crystalGroup.position.y = 2.55 + Math.sin(this.elapsed * 1.6) * 0.03;
  }

  dispose(): void {
    this.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const material = mesh.material;
      if (!material) return;
      const list = Array.isArray(material) ? material : [material];
      for (const m of list) m.dispose();
    });
  }
}

function mesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  y: number,
): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.position.y = y;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function ring(
  radius: number,
  tube: number,
  _color: number,
  y: number,
  material: THREE.Material,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 8, 20), material);
  m.rotation.x = Math.PI / 2;
  m.position.y = y;
  m.castShadow = true;
  return m;
}
