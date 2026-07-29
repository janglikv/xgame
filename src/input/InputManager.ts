import { EdgeKeys } from './EdgeKeys';
import { Keyboard } from './Keyboard';

/**
 * 游戏输入管理器：封装键盘与按键边缘触发判定，统一按键轮询与事件绑定
 */
export class InputManager {
  public readonly keyboard = new Keyboard();
  public readonly edges = new EdgeKeys();

  public bind(): void {
    this.keyboard.bind();
  }

  public unbind(): void {
    this.keyboard.unbind();
  }

  public clear(): void {
    this.keyboard.clear();
    this.edges.clear();
  }

  /** 获取归一化二维移动轴 (-1 ~ +1) */
  public getMoveAxis(): { x: number; y: number } {
    return this.keyboard.getMoveAxis();
  }

  /** 封装按键单次下压/边沿判定 */
  public pressed(keyLabel: string, isDown: boolean): boolean {
    return this.edges.pressed(keyLabel, isDown);
  }

  /** 快捷判定某个按键当前是否处于按下状态 */
  public isDown(code: string): boolean {
    return this.keyboard.isDown(code);
  }
}
