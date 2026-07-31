import * as THREE from 'three';

/**
 * 地板点击移动特效：
 * 在玩家右键点击地面移动时，在落点位置产生向内收聚与外扩波纹的青绿色光圈动画。
 */
export class GroundClickEffect extends THREE.Group {
  /** 特效动画总时长（秒） */
  static readonly DURATION = 0.38;

  private readonly centerDot: THREE.Mesh;
  private readonly centerDotMat: THREE.MeshBasicMaterial;

  private readonly mainRing: THREE.Mesh;
  private readonly mainRingMat: THREE.MeshBasicMaterial;

  private readonly echoRing: THREE.Mesh;
  private readonly echoRingMat: THREE.MeshBasicMaterial;

  private readonly chevrons: THREE.Mesh[] = [];
  private readonly chevronMat: THREE.MeshBasicMaterial;

  private age = 0;
  private _alive = true;

  constructor(x: number, z: number) {
    super();
    this.name = 'GroundClickEffect';
    this.position.set(x, 0, z);

    // 1. 中心高亮闪点
    this.centerDotMat = new THREE.MeshBasicMaterial({
      color: 0xdcfce7,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.centerDot = new THREE.Mesh(
      new THREE.CircleGeometry(0.04, 20),
      this.centerDotMat,
    );
    this.centerDot.rotation.x = -Math.PI / 2;
    this.centerDot.position.y = 0.035;
    this.centerDot.renderOrder = 6;
    this.add(this.centerDot);

    // 2. 主波纹扩散环
    this.mainRingMat = new THREE.MeshBasicMaterial({
      color: 0x22c55e,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mainRing = new THREE.Mesh(
      new THREE.RingGeometry(0.12, 0.15, 36),
      this.mainRingMat,
    );
    this.mainRing.rotation.x = -Math.PI / 2;
    this.mainRing.position.y = 0.036;
    this.mainRing.renderOrder = 6;
    this.add(this.mainRing);

    // 3. 次级回音扩散环
    this.echoRingMat = new THREE.MeshBasicMaterial({
      color: 0x4ade80,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.echoRing = new THREE.Mesh(
      new THREE.RingGeometry(0.06, 0.08, 24),
      this.echoRingMat,
    );
    this.echoRing.rotation.x = -Math.PI / 2;
    this.echoRing.position.y = 0.034;
    this.echoRing.renderOrder = 6;
    this.add(this.echoRing);

    // 4. 四角向内收拢的菱形指针
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.03);
    shape.lineTo(0.013, 0);
    shape.lineTo(0, -0.03);
    shape.lineTo(-0.013, 0);
    shape.closePath();

    const chevronGeo = new THREE.ShapeGeometry(shape);
    this.chevronMat = new THREE.MeshBasicMaterial({
      color: 0x86efac,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    for (let i = 0; i < 4; i++) {
      const mesh = new THREE.Mesh(chevronGeo, this.chevronMat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0.037;
      mesh.renderOrder = 7;
      this.chevrons.push(mesh);
      this.add(mesh);
    }
  }

  get alive(): boolean {
    return this._alive;
  }

  /**
   * 帧更新逻辑
   * @param delta 秒
   * @returns 是否继续存活
   */
  update(delta: number): boolean {
    if (!this._alive) return false;
    this.age += delta;
    const t = Math.min(1, this.age / GroundClickEffect.DURATION);

    if (t >= 1) {
      this._alive = false;
      return false;
    }

    // 缓动曲线 easeOutCubic
    const easeOut = 1 - Math.pow(1 - t, 3);
    const fadeOut = Math.max(0, 1 - Math.pow(t, 1.5));

    // 中心点放缩与淡出
    const centerScale = 1 + easeOut * 0.4;
    this.centerDot.scale.setScalar(centerScale);
    this.centerDotMat.opacity = 0.95 * fadeOut;

    // 主环扩散
    const mainScale = 0.4 + easeOut * 0.8;
    this.mainRing.scale.setScalar(mainScale);
    this.mainRingMat.opacity = 0.85 * fadeOut;

    // 回音环滞后扩散
    const echoScale = 0.3 + easeOut * 1.0;
    this.echoRing.scale.setScalar(echoScale);
    this.echoRingMat.opacity = 0.6 * Math.max(0, 1 - t * 1.2);

    // 四角指针向中心收拢 + 微调淡出
    const chevronDist = 0.22 - easeOut * 0.08;
    this.chevronMat.opacity = 0.9 * fadeOut;

    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2 + t * 0.2; // 极微量旋转
      const cx = Math.cos(angle) * chevronDist;
      const cz = Math.sin(angle) * chevronDist;
      const mesh = this.chevrons[i];
      mesh.position.set(cx, 0.037, cz);
      // 指针朝向中心
      mesh.rotation.z = angle + Math.PI / 2;
    }

    return true;
  }

  dispose(): void {
    this.centerDot.geometry.dispose();
    this.centerDotMat.dispose();

    this.mainRing.geometry.dispose();
    this.mainRingMat.dispose();

    this.echoRing.geometry.dispose();
    this.echoRingMat.dispose();

    if (this.chevrons.length > 0) {
      this.chevrons[0].geometry.dispose();
      this.chevronMat.dispose();
    }
  }
}
