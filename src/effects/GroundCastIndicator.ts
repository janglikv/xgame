import * as THREE from 'three';

/**
 * 技能地面选点指示：施法距离圈（绕英雄）+ 落点范围圈（跟随鼠标）。
 */
export class GroundCastIndicator extends THREE.Group {
  private readonly castRing: THREE.Mesh;
  private readonly targetRing: THREE.Mesh;
  private readonly targetFill: THREE.Mesh;
  private readonly rangeMat: THREE.MeshBasicMaterial;
  private readonly targetRingMat: THREE.MeshBasicMaterial;
  private readonly targetFillMat: THREE.MeshBasicMaterial;

  private castRange = 1;
  private aoeRadius = 1;
  private inRange = true;

  constructor(color = 0xf9a8d4, emissive = 0xec4899) {
    super();
    this.name = 'GroundCastIndicator';
    this.visible = false;

    this.rangeMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.castRing = new THREE.Mesh(
      new THREE.RingGeometry(0.96, 1, 64),
      this.rangeMat,
    );
    this.castRing.rotation.x = -Math.PI / 2;
    this.castRing.position.y = 0.03;
    this.castRing.renderOrder = 3;
    this.add(this.castRing);

    this.targetFillMat = new THREE.MeshBasicMaterial({
      color: emissive,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.targetFill = new THREE.Mesh(
      new THREE.CircleGeometry(1, 48),
      this.targetFillMat,
    );
    this.targetFill.rotation.x = -Math.PI / 2;
    this.targetFill.position.y = 0.035;
    this.targetFill.renderOrder = 4;
    this.add(this.targetFill);

    this.targetRingMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.targetRing = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1, 48),
      this.targetRingMat,
    );
    this.targetRing.rotation.x = -Math.PI / 2;
    this.targetRing.position.y = 0.04;
    this.targetRing.renderOrder = 5;
    this.add(this.targetRing);
  }

  /**
   * 配置施法距离与落点半径（世界单位）。
   */
  configure(castRange: number, aoeRadius: number): void {
    this.castRange = Math.max(0.1, castRange);
    this.aoeRadius = Math.max(0.1, aoeRadius);
    this.castRing.scale.setScalar(this.castRange);
    this.targetFill.scale.setScalar(this.aoeRadius);
    this.targetRing.scale.setScalar(this.aoeRadius);
  }

  /**
   * @param heroX / heroZ 英雄位置
   * @param aimX / aimZ 鼠标地面落点
   * @param inRange 是否在施法距离内（影响颜色）
   */
  setPose(
    heroX: number,
    heroZ: number,
    aimX: number,
    aimZ: number,
    inRange: boolean,
  ): void {
    this.castRing.position.set(heroX, 0.03, heroZ);
    this.targetFill.position.set(aimX, 0.035, aimZ);
    this.targetRing.position.set(aimX, 0.04, aimZ);
    this.setInRange(inRange);
  }

  setInRange(inRange: boolean): void {
    if (this.inRange === inRange) return;
    this.inRange = inRange;
    if (inRange) {
      this.targetRingMat.color.setHex(0xf9a8d4);
      this.targetFillMat.color.setHex(0xec4899);
      this.targetRingMat.opacity = 0.7;
      this.targetFillMat.opacity = 0.16;
    } else {
      // 超距：偏灰红提示，仍可松手时钳到最大距离
      this.targetRingMat.color.setHex(0xfca5a5);
      this.targetFillMat.color.setHex(0xef4444);
      this.targetRingMat.opacity = 0.55;
      this.targetFillMat.opacity = 0.12;
    }
  }

  setActive(active: boolean): void {
    this.visible = active;
  }

  dispose(): void {
    this.castRing.geometry.dispose();
    this.targetRing.geometry.dispose();
    this.targetFill.geometry.dispose();
    this.rangeMat.dispose();
    this.targetRingMat.dispose();
    this.targetFillMat.dispose();
  }
}
