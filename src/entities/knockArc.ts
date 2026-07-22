/**
 * 被炸击飞的抛物线运动（地面平面 + 高度）。
 * 水平速度沿地面推开，竖直方向受重力 → 空中弧线，落地后刹停。
 */

/** 重力加速度（像素/秒²） */
export const KNOCK_GRAVITY = 1650;

/**
 * 水平冲量 → 初升速度的比例。
 * impulse≈920 时 up≈500 → 滞空约 0.6s、峰高约 76px。
 */
export const KNOCK_LAUNCH_UP = 0.55;

/** 有效击中时的最低起跳速度（像素/秒） */
export const KNOCK_MIN_UP = 160;

/** 升速上限，避免连爆飞出屏幕 */
export const KNOCK_MAX_UP = 920;

/** 空中水平阻力（很轻，保持抛物线感） */
export const KNOCK_AIR_DRAG = 0.22;

/** 落地后残留水平速度比例 */
export const KNOCK_LAND_REMAIN = 0.1;

/** 落地后残留速度低于此则清零 */
export const KNOCK_STOP_SPEED = 18;

export type KnockArcState = {
  /** 地面平面速度 X（世界像素/秒） */
  velX: number;
  /** 地面平面速度 Y（世界像素/秒） */
  velY: number;
  /** 竖直速度（正 = 向上，像素/秒） */
  velZ: number;
  /** 离地高度（像素） */
  height: number;
};

export function createKnockArcState(): KnockArcState {
  return { velX: 0, velY: 0, velZ: 0, height: 0 };
}

/** 是否在空中（有高度或仍有上升速度） */
export function isKnockAirborne(state: KnockArcState): boolean {
  return state.height > 0.5 || state.velZ > 8;
}

/**
 * 叠加一次击飞冲量：水平速度相加，并按冲量大小注入升速。
 */
export function applyKnockImpulse(
  state: KnockArcState,
  knockVelX: number,
  knockVelY: number,
  scale = 1,
): void {
  const vx = knockVelX * scale;
  const vy = knockVelY * scale;
  state.velX += vx;
  state.velY += vy;

  const impulse = Math.hypot(vx, vy);
  if (impulse < 1) return;

  const up = Math.max(KNOCK_MIN_UP, impulse * KNOCK_LAUNCH_UP);
  state.velZ = Math.min(KNOCK_MAX_UP, Math.max(0, state.velZ) + up);
}

/**
 * 武器后坐小跳：沿 dir 方向把水平速度「补到」speed，不叠加超速；
 * 每次出手把升速刷新到 hopUp（可空中连跳），用 max 而非累加，避免越跳越高。
 *
 * @param dirX / dirY 后坐方向（已可为单位向量，内部会归一化）
 * @param speed 目标水平后坐速度（像素/秒）
 * @param hopUp 起跳升速（像素/秒）；连射时反复刷新到此值
 */
export function applyRecoilHop(
  state: KnockArcState,
  dirX: number,
  dirY: number,
  speed: number,
  hopUp = KNOCK_MIN_UP,
): void {
  const len = Math.hypot(dirX, dirY);
  if (len < 1e-6 || speed < 1) return;
  const rx = dirX / len;
  const ry = dirY / len;

  // 只补到目标后坐速度，已有更快分量则不再加速
  const along = state.velX * rx + state.velY * ry;
  if (along < speed) {
    const need = speed - along;
    state.velX += rx * need;
    state.velY += ry * need;
  }

  // 连跳：每次出手刷新到 hopUp；已有更高升速（如被炸）则保留
  state.velZ = Math.max(state.velZ, hopUp);
}

export type KnockStepResult = {
  /** 本帧地面位移 */
  dx: number;
  dy: number;
  /** 是否有任何运动（地面或高度） */
  moved: boolean;
  /** 当前是否离地 */
  airborne: boolean;
  /** 本帧刚落地 */
  justLanded: boolean;
};

/**
 * 推进一帧击飞抛物线。
 * 调用方负责：worldX += dx; worldY += dy; 并把 height 映射到屏幕抬升。
 */
export function stepKnockArc(state: KnockArcState, dt: number): KnockStepResult {
  const wasAirborne = isKnockAirborne(state);
  const speed = Math.hypot(state.velX, state.velY);

  if (speed < 0.5 && !wasAirborne && state.height <= 0) {
    state.velX = 0;
    state.velY = 0;
    state.velZ = 0;
    state.height = 0;
    return { dx: 0, dy: 0, moved: false, airborne: false, justLanded: false };
  }

  const dx = state.velX * dt;
  const dy = state.velY * dt;

  // 竖直：匀加速下落
  state.height += state.velZ * dt;
  state.velZ -= KNOCK_GRAVITY * dt;

  // 空中：轻微水平阻尼；贴地残留：较快刹停
  const airborneNow = state.height > 0 || state.velZ > 0;
  const drag = airborneNow ? KNOCK_AIR_DRAG : 5.5;
  const damp = Math.exp(-drag * dt);
  state.velX *= damp;
  state.velY *= damp;

  let justLanded = false;
  if (state.height <= 0) {
    if (wasAirborne || state.velZ < 0) {
      justLanded = wasAirborne;
      state.velX *= KNOCK_LAND_REMAIN;
      state.velY *= KNOCK_LAND_REMAIN;
      if (Math.hypot(state.velX, state.velY) < KNOCK_STOP_SPEED) {
        state.velX = 0;
        state.velY = 0;
      }
    }
    state.height = 0;
    state.velZ = 0;
  }

  const airborne = isKnockAirborne(state);
  const moved =
    Math.abs(dx) > 0.01 ||
    Math.abs(dy) > 0.01 ||
    state.height > 0 ||
    justLanded;

  return { dx, dy, moved, airborne, justLanded };
}
