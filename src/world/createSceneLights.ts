import * as THREE from 'three';

/**
 * 场景基础光照：环境光 + 主方向光。
 */
export function createSceneLights(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'SceneLights';

  const ambient = new THREE.AmbientLight(0xffffff, 0.7);
  group.add(ambient);

  const dir = new THREE.DirectionalLight(0xffffff, 1.35);
  dir.position.set(6, 12, 8);
  dir.name = 'MainDirectionalLight';
  dir.castShadow = true;
  dir.shadow.mapSize.width = 2048;
  dir.shadow.mapSize.height = 2048;
  dir.shadow.camera.near = 0.5;
  dir.shadow.camera.far = 30;
  dir.shadow.camera.left = -12;
  dir.shadow.camera.right = 12;
  dir.shadow.camera.top = 6;
  dir.shadow.camera.bottom = -6;
  dir.shadow.bias = -0.0005;
  group.add(dir);

  return group;
}
