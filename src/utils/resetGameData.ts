import { resetMapDraftsInMemory } from '../data/maps';

/**
 * 删除游戏所有数据（清空 localStorage、sessionStorage、内存草稿）并刷新页面回到初始状态。
 */
export function resetAllGameData(): void {
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch (e) {
    console.warn('[resetAllGameData] Storage clear failed:', e);
  }
  resetMapDraftsInMemory();
  window.location.reload();
}

/**
 * 带有二次确认的重置逻辑
 */
export function confirmAndResetGameData(): void {
  const confirmed = window.confirm(
    '确定要删除游戏所有数据并重置吗？\n这将清空所有游戏进度与自定义地图草稿，并恢复至初始状态。',
  );
  if (confirmed) {
    resetAllGameData();
  }
}
