import * as THREE from 'three';

export interface WorldGridMaterialOptions {
  /** 底色 */
  color: number;
  /** 1m 网格线颜色 */
  lineColor?: number;
  /** 主网格线颜色（每 majorEvery 米） */
  majorLineColor?: number;
  /** 主网格间距（米） */
  cellSize?: number;
  /** 主线间隔（几个 cell 一条，默认 5） */
  majorEvery?: number;
  /** 细线半宽（世界米） */
  lineWidth?: number;
  /** 主线半宽（世界米） */
  majorLineWidth?: number;
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
 * 按面法线选择可见轴向：地板画 XZ，立面画对应竖直/水平格，三块表面可对齐。
 */
export function createWorldGridMaterial(
  options: WorldGridMaterialOptions,
): THREE.MeshStandardMaterial {
  const cellSize = options.cellSize ?? 1;
  const majorEvery = options.majorEvery ?? 5;
  const lineWidth = options.lineWidth ?? 0.028;
  const majorLineWidth = options.majorLineWidth ?? 0.045;
  const lineColor = new THREE.Color(options.lineColor ?? 0x4b5568);
  const majorLineColor = new THREE.Color(options.majorLineColor ?? 0x6b7a90);

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
    shader.uniforms.uGridMajorEvery = { value: majorEvery };
    shader.uniforms.uGridLineWidth = { value: lineWidth };
    shader.uniforms.uGridMajorWidth = { value: majorLineWidth };
    shader.uniforms.uGridLineColor = { value: lineColor };
    shader.uniforms.uGridMajorColor = { value: majorLineColor };

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
        '#include <begin_vertex>',
        /* glsl */ `
        #include <begin_vertex>
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
        uniform float uGridMajorEvery;
        uniform float uGridLineWidth;
        uniform float uGridMajorWidth;
        uniform vec3 uGridLineColor;
        uniform vec3 uGridMajorColor;

        // 单轴：靠近 cell 整数倍时为 1
        float gridAxis( float coord, float cell, float halfWidth ) {
          float m = abs( mod( coord + cell * 0.5, cell ) - cell * 0.5 );
          float aa = fwidth( coord ) * 1.25;
          return 1.0 - smoothstep( halfWidth, halfWidth + aa, m );
        }
        `,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `
        #include <color_fragment>

        vec3 gp = vWorldGridPos;
        vec3 wn = abs( normalize( vWorldGridNormal ) );

        // 细线（1m）
        float gx = gridAxis( gp.x, uGridCell, uGridLineWidth );
        float gy = gridAxis( gp.y, uGridCell, uGridLineWidth );
        float gz = gridAxis( gp.z, uGridCell, uGridLineWidth );
        // 立面不画沿法线方向的“整面填满”线
        float wx = 1.0 - smoothstep( 0.55, 0.92, wn.x );
        float wy = 1.0 - smoothstep( 0.55, 0.92, wn.y );
        float wz = 1.0 - smoothstep( 0.55, 0.92, wn.z );
        float line = max( max( gx * wx, gy * wy ), gz * wz );

        // 主线（每 majorEvery m）
        float majorCell = uGridCell * uGridMajorEvery;
        float mx = gridAxis( gp.x, majorCell, uGridMajorWidth );
        float my = gridAxis( gp.y, majorCell, uGridMajorWidth );
        float mz = gridAxis( gp.z, majorCell, uGridMajorWidth );
        float major = max( max( mx * wx, my * wy ), mz * wz );

        vec3 gridCol = mix( uGridLineColor, uGridMajorColor, clamp( major, 0.0, 1.0 ) );
        float gridMix = max( line, major );
        diffuseColor.rgb = mix( diffuseColor.rgb, gridCol, gridMix * 0.85 );
        `,
      );
  };

  // 避免与其它 Standard 材质共用错误 program
  material.customProgramCacheKey = () =>
    `worldGrid_c${cellSize}_m${majorEvery}_lw${lineWidth}_mw${majorLineWidth}`;

  return material;
}
