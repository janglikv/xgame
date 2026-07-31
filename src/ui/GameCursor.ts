/**
 * 游戏指针：两态
 * - default：小手（日常）
 * - attack：短剑（可攻击目标）
 *
 * 资源见 public/assets/cursors/；加载时去黑底、缩放到浏览器友好尺寸。
 */

export type GameCursorKind = 'default' | 'attack';

const CURSOR_SIZE = 40;
/** 近黑像素视为透明（原图为纯黑底） */
const KEY_LUMA = 28;

interface CursorAsset {
  src: string;
  /** 热点相对原图归一化坐标（0~1） */
  hotU: number;
  hotV: number;
  fallback: string;
}

const ASSETS: Record<GameCursorKind, CursorAsset> = {
  default: {
    src: '/assets/cursors/hand.png',
    // 指尖大致在上沿中央
    hotU: 0.5,
    hotV: 0.08,
    fallback: 'default',
  },
  attack: {
    src: '/assets/cursors/sword.png',
    // 剑尖在上沿中央
    hotU: 0.5,
    hotV: 0.06,
    fallback: 'crosshair',
  },
};

const cssCache = new Map<GameCursorKind, string>();
let ready: Promise<void> | null = null;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load cursor: ${src}`));
    img.src = src;
  });
}

/** 去黑底 + 缩放到 CURSOR_SIZE，返回 PNG data-URL 与热点像素 */
function bakeCursor(
  img: HTMLImageElement,
  hotU: number,
  hotV: number,
): { url: string; hotX: number; hotY: number } {
  const size = CURSOR_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { url: '', hotX: 0, hotY: 0 };
  }

  // 等比装入，略留边避免裁切橙边发光
  const pad = 1;
  const fit = size - pad * 2;
  const scale = Math.min(fit / img.naturalWidth, fit / img.naturalHeight);
  const dw = Math.round(img.naturalWidth * scale);
  const dh = Math.round(img.naturalHeight * scale);
  const dx = Math.round((size - dw) / 2);
  const dy = Math.round((size - dh) / 2);

  ctx.clearRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, dx, dy, dw, dh);

  const imageData = ctx.getImageData(0, 0, size, size);
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    // 纯黑 / 近黑 → 透明；保留描边与阴影里略亮的像素
    if (r <= KEY_LUMA && g <= KEY_LUMA && b <= KEY_LUMA) {
      d[i + 3] = 0;
    }
  }
  ctx.putImageData(imageData, 0, 0);

  const hotX = Math.round(dx + hotU * dw);
  const hotY = Math.round(dy + hotV * dh);

  return {
    url: canvas.toDataURL('image/png'),
    hotX: Math.max(0, Math.min(size - 1, hotX)),
    hotY: Math.max(0, Math.min(size - 1, hotY)),
  };
}

async function buildAll(): Promise<void> {
  const kinds = Object.keys(ASSETS) as GameCursorKind[];
  await Promise.all(
    kinds.map(async (kind) => {
      const asset = ASSETS[kind];
      try {
        const img = await loadImage(asset.src);
        const baked = bakeCursor(img, asset.hotU, asset.hotV);
        if (baked.url) {
          cssCache.set(
            kind,
            `url("${baked.url}") ${baked.hotX} ${baked.hotY}, ${asset.fallback}`,
          );
        } else {
          cssCache.set(kind, asset.fallback);
        }
      } catch {
        cssCache.set(kind, asset.fallback);
      }
    }),
  );
}

/** 预加载并烘焙两种指针 */
export function preloadGameCursors(): Promise<void> {
  if (!ready) ready = buildAll();
  return ready;
}

function cssFor(kind: GameCursorKind): string {
  return cssCache.get(kind) ?? ASSETS[kind].fallback;
}

/** 应用指针；未预加载完成时先用系统回退 */
export function setGameCursor(el: HTMLElement, kind: GameCursorKind): void {
  el.style.cursor = cssFor(kind);
  // 若尚未烘焙完，完成后补一次（避免首帧卡在系统指针）
  if (!cssCache.has(kind) && ready) {
    void ready.then(() => {
      el.style.cursor = cssFor(kind);
    });
  }
}
