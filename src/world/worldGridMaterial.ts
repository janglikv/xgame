import * as THREE from 'three';

export interface WorldGridMaterialOptions {
  /** 底色 */
  color: number;
  /** 网格线颜色 */
  lineColor?: number;
  /** 网格间距（米），默认 0.25 */
  cellSize?: number;
  roughness?: number;
  metalness?: number;
  envMapIntensity?: number;
  flatShading?: boolean;
  polygonOffset?: boolean;
  polygonOffsetFactor?: number;
  polygonOffsetUnits?: number;
}

/**
 * 世界空间米制网格材质（MeshStandardMaterial + 着色器注入）。
 * 线宽约 1 屏幕像素；高密度/掠射角下自动降采样，减轻虚线/摩尔纹。
 */
export function createWorldGridMaterial(
  options: WorldGridMaterialOptions,
): THREE.MeshStandardMaterial {
  const cellSize = options.cellSize ?? 0.25;
  const lineColor = new THREE.Color(options.lineColor ?? 0x2a3038);

  const material = new THREE.MeshStandardMaterial({
    color: options.color,
    roughness: options.roughness ?? 0.6,
    metalness: options.metalness ?? 0.1,
    envMapIntensity: options.envMapIntensity ?? 0.6,
    flatShading: options.flatShading ?? false,
    polygonOffset: options.polygonOffset ?? false,
    polygonOffsetFactor: options.polygonOffsetFactor ?? 0,
    polygonOffsetUnits: options.polygonOffsetUnits ?? 0,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGridCell = { value: cellSize };
    shader.uniforms.uGridLineColor = { value: lineColor };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        varying vec3 vWorldGridPos;
        varying vec3 vWorldGridNormal;
        `,
      )
      .replace(
        '#include <project_vertex>',
        /* glsl */ `
        #include <project_vertex>
        vec4 gridWorldPos = modelMatrix * vec4( transformed, 1.0 );
        vWorldGridPos = gridWorldPos.xyz;
        vWorldGridNormal = normalize( mat3( modelMatrix ) * objectNormal );
        `,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        varying vec3 vWorldGridPos;
        varying vec3 vWorldGridNormal;
        uniform float uGridCell;
        uniform vec3 uGridLineColor;

        /**
         * 单轴网格线：
         * - fwidth 估 1px 线宽
         * - fw 过大（一格占不到 1 像素）时淡出，避免掠射/远处出现虚线摩尔纹
         * - 软边过滤，减轻三角面边界处 dFdx/dFdy 跳变造成的断线
         */
        float gridAxisPx( float coord, float cell ) {
          float c = coord / cell;
          float fw = max( fwidth( c ), 1e-6 );
          // 一格在屏幕上 < ~1.2px 时逐渐不画该轴
          float lod = 1.0 - smoothstep( 0.28, 0.72, fw );
          if ( lod <= 0.001 ) return 0.0;

          // 到最近格线的距离（周期单位，0=在线上，最大 0.5）
          float dist = abs( fract( c - 0.5 ) - 0.5 );
          // ~1px 半宽；略放宽外沿，减少 2x2 导数不连续造成的碎点
          float halfW = 0.5 * fw;
          float line = 1.0 - smoothstep( halfW * 0.25, halfW * 1.35, dist );
          return line * lod;
        }
        `,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `
        #include <color_fragment>

        vec3 gp = vWorldGridPos;
        vec3 wn = abs( normalize( vWorldGridNormal ) );

        float gx = gridAxisPx( gp.x, uGridCell );
        float gy = gridAxisPx( gp.y, uGridCell );
        float gz = gridAxisPx( gp.z, uGridCell );

        // 沿法线轴向的格线在该面上恒亮，需压掉；过渡放缓避免立面“跳断”
        float wx = 1.0 - smoothstep( 0.45, 0.98, wn.x );
        float wy = 1.0 - smoothstep( 0.45, 0.98, wn.y );
        float wz = 1.0 - smoothstep( 0.45, 0.98, wn.z );
        float line = max( max( gx * wx, gy * wy ), gz * wz );

        diffuseColor.rgb = mix( diffuseColor.rgb, uGridLineColor, line * 0.88 );
        `,
      );
  };

  material.customProgramCacheKey = () => `worldGrid1pxLod_c${cellSize}`;

  return material;
}
