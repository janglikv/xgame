import * as THREE from 'three';

/**
 * 全局画面亮度：主场景渲染后叠一层黑色透明遮罩压暗。
 * brightness = 1 无压暗；越低越暗（最低见 MIN）。
 */
export class ScreenBrightness {
  static readonly MIN = 0.12;
  static readonly MAX = 1;

  private readonly uiScene = new THREE.Scene();
  private readonly uiCamera: THREE.OrthographicCamera;
  private readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshBasicMaterial;

  private value = 1;

  constructor() {
    this.uiCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    this.uiCamera.position.z = 1;

    this.material = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.mesh.name = 'ScreenBrightnessDim';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.uiScene.add(this.mesh);
  }

  get brightness(): number {
    return this.value;
  }

  /** @param value 0~1，实际会夹到 [MIN, MAX] */
  setBrightness(value: number): void {
    const v = THREE.MathUtils.clamp(
      value,
      ScreenBrightness.MIN,
      ScreenBrightness.MAX,
    );
    this.value = v;
    const opacity = 1 - v;
    this.material.opacity = opacity;
    this.mesh.visible = opacity > 0.001;
  }

  setSize(width: number, height: number): void {
    const w = Math.max(width, 1);
    const h = Math.max(height, 1);
    const aspect = w / h;
    this.uiCamera.left = -aspect;
    this.uiCamera.right = aspect;
    this.uiCamera.top = 1;
    this.uiCamera.bottom = -1;
    this.uiCamera.updateProjectionMatrix();
    this.mesh.scale.set(aspect, 1, 1);
  }

  /** 主场景之后、UI 面板之前调用 */
  render(renderer: THREE.WebGLRenderer): void {
    if (!this.mesh.visible) return;

    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.uiScene, this.uiCamera);
    renderer.autoClear = prevAutoClear;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
