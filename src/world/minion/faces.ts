import {
  DynamicTexture,
  type Scene,
  Texture,
} from '@babylonjs/core';

export type FaceStyle = 'cute' | 'fierce' | 'dumb' | 'sad' | 'blank';

/** 脸贴图按「底色+表情+马赛克+闭眼」缓存 */
const faceTextureCache = new Map<string, DynamicTexture>();
const FACE_TEX_VERSION = 21;

function isTextureDisposed(tex: DynamicTexture): boolean {
  if (!tex) return true;
  const d = (tex as unknown as { isDisposed?: boolean | (() => boolean) }).isDisposed;
  if (typeof d === 'function') return d();
  if (typeof d === 'boolean') return d;
  return !tex.getScene();
}

export function getFaceTexture(
  scene: Scene,
  bodyColor: number,
  style: FaceStyle = 'cute',
  mosaic = false,
  /** 闭眼帧（眨眼待机） */
  eyesClosed = false,
): DynamicTexture {
  const sceneId = (scene as Scene & { uid?: string }).uid ?? 'sc';
  const key = `${sceneId}_${bodyColor.toString(16)}_${style}_m${mosaic ? 1 : 0}_c${eyesClosed ? 1 : 0}`;
  const cached = faceTextureCache.get(key);
  if (cached && !isTextureDisposed(cached) && cached.getScene() === scene) {
    const v = (cached as DynamicTexture & { _faceVer?: number })._faceVer;
    if (v === FACE_TEX_VERSION) return cached;
    cached.dispose();
    faceTextureCache.delete(key);
  } else if (cached) {
    faceTextureCache.delete(key);
  }
  let tex: DynamicTexture;
  if (style === 'fierce') {
    tex = createFierceFaceTexture(scene, bodyColor, eyesClosed);
  } else if (style === 'dumb') {
    tex = createDumbFaceTexture(scene, bodyColor, eyesClosed);
  } else if (style === 'sad') {
    tex = createSadFaceTexture(scene, bodyColor, eyesClosed);
  } else if (style === 'blank') {
    tex = createBlankFaceTexture(scene, bodyColor, eyesClosed);
  } else {
    tex = createCuteFaceTexture(scene, bodyColor, eyesClosed);
  }
  if (mosaic) {
    // 块大小：越大越「马赛克」
    applyMosaicFilter(tex, 12);
  }
  (tex as DynamicTexture & { _faceVer?: number })._faceVer = FACE_TEX_VERSION;
  faceTextureCache.set(key, tex);
  return tex;
}

/**
 * 闭眼描线：柔和下弯弧（^ 反过来的弧线感）。
 * curve>0 弧心偏下（可爱）；curve<0 弧心偏上。
 */
function strokeClosedEye(
  ctx: CanvasRenderingContext2D,
  ex: number,
  eyeY: number,
  halfW: number,
  curve: number,
  lineWidth: number,
  color: string,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // 主睑线
  ctx.beginPath();
  ctx.moveTo(ex - halfW, eyeY);
  ctx.quadraticCurveTo(ex, eyeY + curve, ex + halfW, eyeY);
  ctx.stroke();
  // 略粗一点的第二笔，增强厚度
  ctx.lineWidth = lineWidth * 0.55;
  ctx.beginPath();
  ctx.moveTo(ex - halfW * 0.85, eyeY - lineWidth * 0.15);
  ctx.quadraticCurveTo(ex, eyeY + curve * 0.65, ex + halfW * 0.85, eyeY - lineWidth * 0.15);
  ctx.stroke();
}

/**
 * 通用马赛克滤镜：对已有脸贴图按 block×block 取平均色填块，
 * 与表情绘制无关，cute / fierce 均可。
 */
function applyMosaicFilter(tex: DynamicTexture, blockSize: number): void {
  const size = tex.getSize();
  const w = size.width;
  const h = size.height;
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const src = ctx.getImageData(0, 0, w, h);
  const data = src.data;
  const block = Math.max(2, Math.floor(blockSize));

  for (let y = 0; y < h; y += block) {
    const bh = Math.min(block, h - y);
    for (let x = 0; x < w; x += block) {
      const bw = Math.min(block, w - x);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let py = 0; py < bh; py++) {
        for (let px = 0; px < bw; px++) {
          const i = ((y + py) * w + (x + px)) * 4;
          r += data[i]!;
          g += data[i + 1]!;
          b += data[i + 2]!;
          a += data[i + 3]!;
          n++;
        }
      }
      if (n === 0) continue;
      r = Math.round(r / n);
      g = Math.round(g / n);
      b = Math.round(b / n);
      a = Math.round(a / n);
      for (let py = 0; py < bh; py++) {
        for (let px = 0; px < bw; px++) {
          const i = ((y + py) * w + (x + px)) * 4;
          data[i] = r;
          data[i + 1] = g;
          data[i + 2] = b;
          data[i + 3] = a;
        }
      }
    }
  }

  ctx.putImageData(src, 0, 0);
  tex.update();
  tex.updateSamplingMode(Texture.NEAREST_SAMPLINGMODE);
}

function makeFaceCanvas(
  scene: Scene,
  name: string,
  bodyColor: number,
): {
  tex: DynamicTexture;
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
} {
  const width = 1024;
  const height = 512;
  const tex = new DynamicTexture(
    name,
    { width, height },
    scene,
    false,
    undefined,
    undefined,
    false,
  );
  // 球面 UV 翻转适配 Babylon
  tex.uScale = -1;
  tex.uOffset = 1;
  tex.vScale = -1;
  tex.vOffset = 1;
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const bodyHex = `#${bodyColor.toString(16).padStart(6, '0')}`;
  ctx.fillStyle = bodyHex;
  ctx.fillRect(0, 0, width, height);
  return { tex, ctx, width, height };
}

/**
 * 可爱表情：大圆眼 + 腮红 + 微笑。
 * 球面 UV：u=0.5 对应几何 +X；身体已旋转使 +X → 角色正前方。
 */
function createCuteFaceTexture(
  scene: Scene,
  bodyColor: number,
  eyesClosed = false,
): DynamicTexture {
  const { tex, ctx, width, height } = makeFaceCanvas(
    scene,
    eyesClosed ? 'minionFaceCuteClosed' : 'minionFaceCute',
    bodyColor,
  );
  const darkBrown = '#2b2123';

  const cx = width * 0.5;
  const eyeY = height * 0.49;
  const eyeGap = width * 0.075;
  const eyeRy = height * 0.1;
  const eyeRx = eyeRy;

  const drawBlush = (bx: number): void => {
    const g = ctx.createRadialGradient(
      bx,
      height * 0.59,
      0,
      bx,
      height * 0.59,
      height * 0.08,
    );
    g.addColorStop(0, 'rgba(255, 120, 140, 0.52)');
    g.addColorStop(0.5, 'rgba(255, 140, 160, 0.28)');
    g.addColorStop(1, 'rgba(255, 180, 190, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(
      bx,
      height * 0.59,
      eyeRx * 0.9,
      eyeRy * 0.55,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  };
  drawBlush(cx - eyeGap * 1.55);
  drawBlush(cx + eyeGap * 1.55);

  ctx.strokeStyle = darkBrown;
  ctx.lineWidth = height * 0.016;
  ctx.lineCap = 'round';

  // 闭眼时眉线仍保留，略收一点
  ctx.beginPath();
  ctx.ellipse(
    cx - eyeGap - width * 0.005,
    eyeY - eyeRy * 1.15,
    eyeRx * 0.5,
    eyeRy * 0.5,
    0,
    Math.PI * 1.15,
    Math.PI * 1.75,
  );
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(
    cx + eyeGap + width * 0.005,
    eyeY - eyeRy * 1.15,
    eyeRx * 0.5,
    eyeRy * 0.5,
    0,
    Math.PI * 1.25,
    Math.PI * 1.85,
  );
  ctx.stroke();

  if (eyesClosed) {
    const lidW = eyeRx * 1.05;
    const lw = height * 0.028;
    strokeClosedEye(ctx, cx - eyeGap, eyeY + eyeRy * 0.05, lidW, eyeRy * 0.42, lw, darkBrown);
    strokeClosedEye(ctx, cx + eyeGap, eyeY + eyeRy * 0.05, lidW, eyeRy * 0.42, lw, darkBrown);
  } else {
    const drawEye = (ex: number): void => {
      ctx.beginPath();
      ctx.ellipse(ex, eyeY, eyeRx, eyeRy, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#21181b';
      ctx.fill();

      const innerG = ctx.createLinearGradient(
        ex,
        eyeY - eyeRy,
        ex,
        eyeY + eyeRy,
      );
      innerG.addColorStop(0, '#1d1518');
      innerG.addColorStop(0.65, '#3a2b2f');
      innerG.addColorStop(1, '#664c54');
      ctx.fillStyle = innerG;
      ctx.beginPath();
      ctx.ellipse(ex, eyeY, eyeRx * 0.96, eyeRy * 0.96, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#140c0e';
      ctx.beginPath();
      ctx.ellipse(
        ex,
        eyeY + eyeRy * 0.05,
        eyeRx * 0.7,
        eyeRy * 0.7,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(
        ex - eyeRx * 0.32,
        eyeY - eyeRy * 0.32,
        eyeRx * 0.38,
        eyeRy * 0.44,
        -Math.PI / 6,
        0,
        Math.PI * 2,
      );
      ctx.fill();

      ctx.beginPath();
      ctx.ellipse(
        ex + eyeRx * 0.35,
        eyeY + eyeRy * 0.35,
        eyeRx * 0.2,
        eyeRy * 0.2,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();

      ctx.beginPath();
      ctx.ellipse(
        ex - eyeRx * 0.42,
        eyeY + eyeRy * 0.32,
        eyeRx * 0.09,
        eyeRy * 0.09,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    };

    drawEye(cx - eyeGap);
    drawEye(cx + eyeGap);
  }

  ctx.strokeStyle = darkBrown;
  ctx.lineWidth = height * 0.016;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.ellipse(
    cx,
    height * 0.555,
    eyeRx * 0.42,
    eyeRy * 0.42,
    0,
    Math.PI * 0.15,
    Math.PI * 0.85,
  );
  ctx.stroke();

  tex.update();
  return tex;
}

/**
 * 凶狠表情：浓粗倒八字眉 + 超大怒目 + 怒目眼白少 + 龇牙/皱嘴，无腮红。
 */
function createFierceFaceTexture(
  scene: Scene,
  bodyColor: number,
  eyesClosed = false,
): DynamicTexture {
  const { tex, ctx, width, height } = makeFaceCanvas(
    scene,
    eyesClosed ? 'minionFaceFierceClosed' : 'minionFaceFierce',
    bodyColor,
  );
  const ink = '#1a1012';
  const brow = '#0d0809';

  const cx = width * 0.5;
  const eyeY = height * 0.48;
  const eyeGap = width * 0.09;
  // 更大眼睛
  const eyeRy = height * 0.135;
  const eyeRx = eyeRy * 1.05;

  // 眉心竖纹（怒）
  ctx.strokeStyle = ink;
  ctx.lineWidth = height * 0.012;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - width * 0.012, eyeY - eyeRy * 1.55);
  ctx.lineTo(cx - width * 0.004, eyeY - eyeRy * 1.15);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + width * 0.012, eyeY - eyeRy * 1.55);
  ctx.lineTo(cx + width * 0.004, eyeY - eyeRy * 1.15);
  ctx.stroke();

  // 浓粗倒八字眉（内侧下压）
  const drawBrow = (side: -1 | 1): void => {
    const ex = cx + side * eyeGap;
    ctx.strokeStyle = brow;
    ctx.lineWidth = height * 0.055;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    // 外高内低
    ctx.moveTo(ex + side * eyeRx * 1.15, eyeY - eyeRy * 1.55);
    ctx.quadraticCurveTo(
      ex + side * eyeRx * 0.15,
      eyeY - eyeRy * 1.75,
      ex - side * eyeRx * 0.55,
      eyeY - eyeRy * 0.95,
    );
    ctx.stroke();
    // 加粗第二笔
    ctx.lineWidth = height * 0.03;
    ctx.beginPath();
    ctx.moveTo(ex + side * eyeRx * 1.05, eyeY - eyeRy * 1.4);
    ctx.quadraticCurveTo(
      ex + side * eyeRx * 0.1,
      eyeY - eyeRy * 1.55,
      ex - side * eyeRx * 0.4,
      eyeY - eyeRy * 0.85,
    );
    ctx.stroke();
  };
  drawBrow(-1);
  drawBrow(1);

  if (eyesClosed) {
    // 凶狠闭眼：略下压的粗折线 + 锐利眼尾
    const drawFierceClosed = (ex: number, side: -1 | 1): void => {
      ctx.strokeStyle = ink;
      ctx.lineWidth = height * 0.034;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(ex - side * eyeRx * 1.05, eyeY - eyeRy * 0.15);
      ctx.quadraticCurveTo(
        ex,
        eyeY + eyeRy * 0.35,
        ex + side * eyeRx * 1.05,
        eyeY - eyeRy * 0.25,
      );
      ctx.stroke();
      // 下睑细线
      ctx.lineWidth = height * 0.014;
      ctx.beginPath();
      ctx.moveTo(ex - side * eyeRx * 0.85, eyeY + eyeRy * 0.05);
      ctx.quadraticCurveTo(
        ex,
        eyeY + eyeRy * 0.42,
        ex + side * eyeRx * 0.85,
        eyeY - eyeRy * 0.05,
      );
      ctx.stroke();
    };
    drawFierceClosed(cx - eyeGap, -1);
    drawFierceClosed(cx + eyeGap, 1);
  } else {
    const drawFierceEye = (ex: number, side: -1 | 1): void => {
      // 外轮廓（略扁圆、带锐角感）
      ctx.beginPath();
      ctx.ellipse(ex, eyeY, eyeRx, eyeRy, side * 0.08, 0, Math.PI * 2);
      ctx.fillStyle = '#1a0508';
      ctx.fill();

      // 鲜明威严的凶悍赤红虹膜，不再漆黑死寂
      const scleraG = ctx.createRadialGradient(
        ex,
        eyeY,
        eyeRx * 0.15,
        ex,
        eyeY,
        eyeRx,
      );
      scleraG.addColorStop(0, '#ff4433');
      scleraG.addColorStop(0.45, '#cc1122');
      scleraG.addColorStop(0.85, '#550812');
      scleraG.addColorStop(1, '#1a0508');
      ctx.fillStyle = scleraG;
      ctx.beginPath();
      ctx.ellipse(ex, eyeY, eyeRx * 0.97, eyeRy * 0.97, side * 0.08, 0, Math.PI * 2);
      ctx.fill();

      // 凶猛竖瞳/深黑瞳孔
      ctx.fillStyle = '#080203';
      ctx.beginPath();
      ctx.ellipse(
        ex + side * eyeRx * 0.04,
        eyeY + eyeRy * 0.04,
        eyeRx * 0.48,
        eyeRy * 0.72,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();

      // 锐利白亮高光（醒目）
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(
        ex - side * eyeRx * 0.22,
        eyeY - eyeRy * 0.28,
        eyeRx * 0.22,
        eyeRy * 0.26,
        -Math.PI / 5,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(
        ex + side * eyeRx * 0.28,
        eyeY + eyeRy * 0.22,
        eyeRx * 0.1,
        eyeRy * 0.11,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();

      // 上眼睑厚阴影（压低视线）
      ctx.fillStyle = 'rgba(20,5,8,0.65)';
      ctx.beginPath();
      ctx.ellipse(
        ex,
        eyeY - eyeRy * 0.55,
        eyeRx * 1.02,
        eyeRy * 0.55,
        side * 0.1,
        Math.PI * 1.05,
        Math.PI * 1.95,
      );
      ctx.fill();
    };

    drawFierceEye(cx - eyeGap, -1);
    drawFierceEye(cx + eyeGap, 1);
  }

  // 鼻梁阴影（凶相更立体）
  ctx.strokeStyle = 'rgba(30,18,20,0.35)';
  ctx.lineWidth = height * 0.01;
  ctx.beginPath();
  ctx.moveTo(cx, eyeY + eyeRy * 0.55);
  ctx.lineTo(cx, height * 0.58);
  ctx.stroke();

  // 龇牙怒嘴：扁宽 + 锯齿上牙
  const mouthY = height * 0.62;
  const mouthW = eyeRx * 1.35;
  const mouthH = eyeRy * 0.55;

  ctx.fillStyle = '#1a0c10';
  ctx.beginPath();
  ctx.ellipse(cx, mouthY, mouthW, mouthH, 0, 0, Math.PI * 2);
  ctx.fill();

  // 上排牙（纯白）
  ctx.fillStyle = '#ffffff';
  const teeth = 5;
  for (let i = 0; i < teeth; i++) {
    const tx =
      cx - mouthW * 0.55 + (i + 0.5) * ((mouthW * 1.1) / teeth);
    const tw = mouthW * 0.16;
    ctx.beginPath();
    ctx.moveTo(tx - tw * 0.5, mouthY - mouthH * 0.15);
    ctx.lineTo(tx + tw * 0.5, mouthY - mouthH * 0.15);
    ctx.lineTo(tx + tw * 0.35, mouthY + mouthH * 0.55);
    ctx.lineTo(tx - tw * 0.35, mouthY + mouthH * 0.55);
    ctx.closePath();
    ctx.fill();
  }

  // 嘴角下撇描边
  ctx.strokeStyle = ink;
  ctx.lineWidth = height * 0.018;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.ellipse(cx, mouthY, mouthW * 1.02, mouthH * 1.05, 0, 0.05 * Math.PI, 0.95 * Math.PI);
  ctx.stroke();

  tex.update();
  return tex;
}

/**
 * 呆萌表情：参考浓连心眉（两端粗、眉心相连）+ 小小圆眼 + O 型香肠嘴。
 */
function createDumbFaceTexture(
  scene: Scene,
  bodyColor: number,
  eyesClosed = false,
): DynamicTexture {
  const { tex, ctx, width, height } = makeFaceCanvas(
    scene,
    eyesClosed ? 'minionFaceDumbClosed' : 'minionFaceDumb',
    bodyColor,
  );
  const ink = '#1c1210';
  const browDark = '#14100e';

  const cx = width * 0.5;
  const eyeY = height * 0.49;
  const eyeGap = width * 0.072;
  // 小眼睛
  const eyeR = height * 0.022;

  // —— 浓眉：更大、更夸张；近乎连心、两端粗壮、带毛流感 ——
  const drawBushyBrow = (side: -1 | 1): void => {
    const outerX = cx + side * (eyeGap + eyeR * 6.5);
    const innerX = cx + side * (width * 0.008); // 几乎连到眉心
    const midX = cx + side * eyeGap * 1.05;
    // 眉峰更高，外梢略低
    const outerY = eyeY - eyeR * 1.6;
    const midY = eyeY - eyeR * 5.2;
    const innerY = eyeY - eyeR * 3.4;
    const thickOuter = height * 0.065;
    const thickMid = height * 0.11;
    const thickInner = height * 0.078;

    // 主体填充：上下沿贝塞尔
    ctx.beginPath();
    // 上沿 outer → inner
    ctx.moveTo(outerX, outerY);
    ctx.bezierCurveTo(
      midX + side * eyeR * 0.5,
      midY - thickMid * 0.55,
      midX - side * eyeR * 0.2,
      midY - thickMid * 0.45,
      innerX,
      innerY - thickInner * 0.35,
    );
    // 下沿 inner → outer
    ctx.bezierCurveTo(
      midX - side * eyeR * 0.1,
      midY + thickMid * 0.55,
      midX + side * eyeR * 0.8,
      outerY + thickOuter * 0.85,
      outerX,
      outerY + thickOuter * 0.15,
    );
    ctx.closePath();
    ctx.fillStyle = browDark;
    ctx.fill();

    // 毛流感：沿眉走向画一撮撮短线
    ctx.strokeStyle = ink;
    ctx.lineCap = 'round';
    for (let i = 0; i < 18; i++) {
      const t = i / 17;
      // 位置从外到内
      const x =
        outerX * (1 - t) * (1 - t) +
        2 * midX * (1 - t) * t +
        innerX * t * t;
      const yBase =
        outerY * (1 - t) * (1 - t) +
        2 * midY * (1 - t) * t +
        innerY * t * t;
      const thick =
        thickOuter * (1 - t) * (1 - t) +
        2 * thickMid * (1 - t) * t +
        thickInner * t * t;
      const ang = side > 0 ? -0.35 - t * 0.25 : Math.PI + 0.35 + t * 0.25;
      const len = thick * (0.55 + (i % 3) * 0.12);
      ctx.lineWidth = height * (0.008 + (i % 2) * 0.004);
      ctx.globalAlpha = 0.55 + (i % 3) * 0.12;
      ctx.beginPath();
      ctx.moveTo(x - Math.cos(ang) * len * 0.15, yBase - Math.sin(ang) * len * 0.1);
      ctx.lineTo(
        x + Math.cos(ang) * len * 0.7,
        yBase - thick * 0.35 + Math.sin(ang) * len * 0.15,
      );
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 眉心加厚衔接（两侧都画一点，叠成连心）
    ctx.fillStyle = browDark;
    ctx.beginPath();
    ctx.ellipse(
      cx + side * width * 0.014,
      eyeY - eyeR * 3.5,
      width * 0.028,
      height * 0.042,
      side * 0.2,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  };
  drawBushyBrow(-1);
  drawBushyBrow(1);

  // 眉心中缝再盖一笔，真正“连心”
  ctx.fillStyle = browDark;
  ctx.beginPath();
  ctx.ellipse(cx, eyeY - eyeR * 3.6, width * 0.036, height * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();
  // 眉心短竖毛
  ctx.strokeStyle = ink;
  ctx.lineWidth = height * 0.012;
  ctx.globalAlpha = 0.7;
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath();
    ctx.moveTo(cx + i * width * 0.007, eyeY - eyeR * 4.4);
    ctx.lineTo(cx + i * width * 0.005, eyeY - eyeR * 2.6);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // 眼睛：睁 = 小黑点；闭 = 短弧线
  if (eyesClosed) {
    const lw = height * 0.018;
    for (const ex of [cx - eyeGap, cx + eyeGap]) {
      strokeClosedEye(ctx, ex, eyeY, eyeR * 2.4, eyeR * 1.1, lw, '#0a0808');
    }
  } else {
    ctx.fillStyle = '#0a0808';
    for (const ex of [cx - eyeGap, cx + eyeGap]) {
      ctx.beginPath();
      ctx.arc(ex, eyeY, eyeR * 0.85, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // O 型香肠嘴：厚描边椭圆环，中间留空（像香肠圈/惊叹 O 嘴）
  const mouthY = height * 0.64;
  const mouthRx = width * 0.095;
  const mouthRy = height * 0.12;

  // 外圈填充（细嘴唇：内孔更大 → 环更细）
  const lipInner = 0.78;
  ctx.beginPath();
  ctx.ellipse(cx, mouthY, mouthRx, mouthRy, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#2b2123';
  ctx.fill();
  // 内圈挖空（用身体色）
  const bodyHex = `#${bodyColor.toString(16).padStart(6, '0')}`;
  ctx.beginPath();
  ctx.ellipse(cx, mouthY, mouthRx * lipInner, mouthRy * lipInner, 0, 0, Math.PI * 2);
  ctx.fillStyle = bodyHex;
  ctx.fill();
  // 细描边
  ctx.strokeStyle = ink;
  ctx.lineWidth = height * 0.008;
  ctx.beginPath();
  ctx.ellipse(cx, mouthY, mouthRx, mouthRy, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(cx, mouthY, mouthRx * lipInner, mouthRy * lipInner, 0, 0, Math.PI * 2);
  ctx.stroke();

  tex.update();
  return tex;
}

/**
 * 悲伤表情：八字眉下垂 + 含泪圆眼 + 下撇小嘴 + 泪珠。
 */
function createSadFaceTexture(
  scene: Scene,
  bodyColor: number,
  eyesClosed = false,
): DynamicTexture {
  const { tex, ctx, width, height } = makeFaceCanvas(
    scene,
    eyesClosed ? 'minionFaceSadClosed' : 'minionFaceSad',
    bodyColor,
  );
  const ink = '#2b2123';
  const tearBlue = 'rgba(120, 180, 230, 0.85)';

  const cx = width * 0.5;
  const eyeY = height * 0.48;
  const eyeGap = width * 0.078;
  const eyeRy = height * 0.085;
  const eyeRx = eyeRy * 0.95;

  // 八字眉：内侧高、外侧低（悲伤下垂）
  const drawSadBrow = (side: -1 | 1): void => {
    const ex = cx + side * eyeGap;
    ctx.strokeStyle = ink;
    ctx.lineWidth = height * 0.022;
    ctx.lineCap = 'round';
    ctx.beginPath();
    // 内高外低
    ctx.moveTo(ex - side * eyeRx * 0.15, eyeY - eyeRy * 1.55);
    ctx.quadraticCurveTo(
      ex + side * eyeRx * 0.35,
      eyeY - eyeRy * 1.15,
      ex + side * eyeRx * 1.05,
      eyeY - eyeRy * 0.85,
    );
    ctx.stroke();
  };
  drawSadBrow(-1);
  drawSadBrow(1);

  if (eyesClosed) {
    const lw = height * 0.024;
    strokeClosedEye(ctx, cx - eyeGap, eyeY + eyeRy * 0.08, eyeRx * 1.05, eyeRy * 0.5, lw, ink);
    strokeClosedEye(ctx, cx + eyeGap, eyeY + eyeRy * 0.08, eyeRx * 1.05, eyeRy * 0.5, lw, ink);
  } else {
    const drawSadEye = (ex: number, side: -1 | 1): void => {
      // 眼白
      ctx.beginPath();
      ctx.ellipse(ex, eyeY, eyeRx, eyeRy, side * 0.05, 0, Math.PI * 2);
      ctx.fillStyle = '#21181b';
      ctx.fill();

      // 虹膜偏下（含泪下垂感）
      const pupilY = eyeY + eyeRy * 0.12;
      ctx.fillStyle = '#140c0e';
      ctx.beginPath();
      ctx.ellipse(ex, pupilY, eyeRx * 0.62, eyeRy * 0.68, 0, 0, Math.PI * 2);
      ctx.fill();

      // 高光
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(
        ex - eyeRx * 0.28,
        eyeY - eyeRy * 0.22,
        eyeRx * 0.28,
        eyeRy * 0.32,
        -Math.PI / 7,
        0,
        Math.PI * 2,
      );
      ctx.fill();

      // 下眼睑泪光
      ctx.fillStyle = 'rgba(160, 200, 230, 0.35)';
      ctx.beginPath();
      ctx.ellipse(
        ex,
        eyeY + eyeRy * 0.55,
        eyeRx * 0.75,
        eyeRy * 0.35,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    };
    drawSadEye(cx - eyeGap, -1);
    drawSadEye(cx + eyeGap, 1);
  }

  // 泪珠（左眼下一滴）
  ctx.fillStyle = tearBlue;
  ctx.beginPath();
  const tearX = cx - eyeGap - eyeRx * 0.15;
  const tearY = eyeY + eyeRy * 1.15;
  ctx.moveTo(tearX, tearY - height * 0.012);
  ctx.quadraticCurveTo(
    tearX + width * 0.012,
    tearY + height * 0.02,
    tearX,
    tearY + height * 0.045,
  );
  ctx.quadraticCurveTo(
    tearX - width * 0.012,
    tearY + height * 0.02,
    tearX,
    tearY - height * 0.012,
  );
  ctx.fill();
  // 泪珠高光
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.ellipse(
    tearX - width * 0.003,
    tearY + height * 0.008,
    width * 0.004,
    height * 0.006,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // 右侧小泪痕
  ctx.strokeStyle = 'rgba(120, 180, 230, 0.55)';
  ctx.lineWidth = height * 0.01;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx + eyeGap + eyeRx * 0.2, eyeY + eyeRy * 0.9);
  ctx.quadraticCurveTo(
    cx + eyeGap + eyeRx * 0.35,
    eyeY + eyeRy * 1.4,
    cx + eyeGap + eyeRx * 0.15,
    eyeY + eyeRy * 1.7,
  );
  ctx.stroke();

  // 下撇悲伤小嘴
  ctx.strokeStyle = ink;
  ctx.lineWidth = height * 0.018;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.ellipse(
    cx,
    height * 0.64,
    eyeRx * 0.55,
    eyeRy * 0.42,
    0,
    Math.PI * 1.15,
    Math.PI * 1.85,
  );
  ctx.stroke();

  tex.update();
  return tex;
}

/**
 * 面无表情：极简平直五官，无喜怒，像发呆/扑克脸。
 */
function createBlankFaceTexture(
  scene: Scene,
  bodyColor: number,
  eyesClosed = false,
): DynamicTexture {
  const { tex, ctx, width, height } = makeFaceCanvas(
    scene,
    eyesClosed ? 'minionFaceBlankClosed' : 'minionFaceBlank',
    bodyColor,
  );
  const ink = '#2a2224';

  const cx = width * 0.5;
  const eyeY = height * 0.49;
  const eyeGap = width * 0.075;
  const eyeR = height * 0.028;

  // 极细平眉
  ctx.strokeStyle = ink;
  ctx.lineWidth = height * 0.012;
  ctx.lineCap = 'round';
  const browY = eyeY - eyeR * 2.4;
  const browHalf = eyeR * 2.0;
  for (const side of [-1, 1] as const) {
    const ex = cx + side * eyeGap;
    ctx.beginPath();
    ctx.moveTo(ex - browHalf, browY);
    ctx.lineTo(ex + browHalf, browY);
    ctx.stroke();
  }

  if (eyesClosed) {
    // 扑克脸闭眼：几乎平直的短线
    ctx.lineWidth = height * 0.014;
    for (const side of [-1, 1] as const) {
      const ex = cx + side * eyeGap;
      ctx.beginPath();
      ctx.moveTo(ex - eyeR * 1.6, eyeY);
      ctx.lineTo(ex + eyeR * 1.6, eyeY);
      ctx.stroke();
    }
  } else {
    // 小圆眼，无高光（更呆滞）
    ctx.fillStyle = ink;
    for (const side of [-1, 1] as const) {
      ctx.beginPath();
      ctx.arc(cx + side * eyeGap, eyeY, eyeR, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 一字平嘴（无上扬/下撇）
  ctx.lineWidth = height * 0.014;
  ctx.beginPath();
  ctx.moveTo(cx - width * 0.035, height * 0.62);
  ctx.lineTo(cx + width * 0.035, height * 0.62);
  ctx.stroke();

  tex.update();
  return tex;
}
