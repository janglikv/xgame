/**
 * 兼容旧路径：请改用 `./level1/Level1World` 与 `./level1/config`。
 * @deprecated
 */
export {
  LEVEL1_MAP_SIZE as BLANK_MAP_SIZE,
  LEVEL1_MAP_HALF as BLANK_MAP_HALF,
  LEVEL1_FLOOR_EXTEND as BLANK_FLOOR_EXTEND,
  LEVEL1_PAD_X as BLANK_PAD_X,
  LEVEL1_PAD_Z as BLANK_PAD_Z,
  clampLevel1Position as clampBlankMapPosition,
  LEVEL1_MAP_SIZE,
  LEVEL1_MAP_HALF,
  LEVEL1_FLOOR_EXTEND,
  LEVEL1_PAD_X,
  LEVEL1_PAD_Z,
  clampLevel1Position,
} from './level1/config';

export {
  Level1World,
  createLevel1World,
  type Level1Enemy,
  type CreateLevel1WorldOptions,
} from './level1/Level1World';

/** @deprecated 使用 Level1World */
export type BlankWorld = import('./level1/Level1World').Level1World;

/** @deprecated 使用 createLevel1World / Level1World.create */
export { createLevel1World as createBlankWorld } from './level1/Level1World';
