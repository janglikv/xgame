import * as THREE from 'three';

/**
 * 场景基础光照：环境光 + 主方向光。
 */
export function createSceneLights(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'SceneLights';

  const ambient = new THREE.AmbientLight(0xffffff, 0.7);
  group.add(ambient);

  const dir = new THREE.DirectionalLight(0xfff2e0, 1.35);
  dir.position.set(6, 12, 8);
  dir.name = 'MainDirectionalLight';
  group.add(dir);

  return group;
}
