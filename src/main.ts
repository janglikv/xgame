import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

function initEmpty3DScene(): void {
  const container = document.getElementById('app');
  if (!container) {
    throw new Error('#app element not found');
  }

  // 1. 创建场景
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f172a); // 深蓝夜色背景

  // 2. 创建相机
  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    1000,
  );
  camera.position.set(10, 10, 10);

  // 3. 创建渲染器
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  // 4. 轨道控制器
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;

  // 5. 基础光照
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
  dirLight.position.set(15, 20, 10);
  dirLight.castShadow = true;
  scene.add(dirLight);

  // 6. 空场景网格与坐标辅助线
  const gridHelper = new THREE.GridHelper(20, 20, 0x38bdf8, 0x334155);
  scene.add(gridHelper);

  const axesHelper = new THREE.AxesHelper(3);
  scene.add(axesHelper);

  // 7. 窗口调整响应
  window.addEventListener('resize', () => {
    const width = window.innerWidth;
    const height = window.innerHeight;

    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  });

  // 8. 渲染循环
  function animate(): void {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }

  animate();
}

initEmpty3DScene();
