import { useLayoutEffect, useRef, type RefObject } from 'react'

export const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 48

/*
 * 消息流贴底跟随（原 messagesView 的滚动语义对译）：
 * - 判定发生在本次 commit 的 layout effect 里（DOM 已更新、绘制前）。
 *   原实现用「替换子节点前」的测量值判定，React 下等价量是
 *   「上次 commit 后记录的 scrollHeight」+「当前 scrollTop」——底部追加
 *   内容不会改变 scrollTop，因此 current scrollTop 就是原实现的
 *   previousScrollTop；距离 = base scrollHeight - clientHeight - scrollTop。
 * - 首次运行没有历史值，直接用当前值全量测量（原实现空容器首帧
 *   距底 0 → 跟随）。
 * - preserveNextMessageScroll（重发/重同步期间置位）时保持原位。
 */
export function useAutoScroll(
  containerRef: RefObject<HTMLElement | null>,
  version: number,
  shouldPreserve: () => boolean,
): void {
  const previous = useRef<{ scrollHeight: number; clientHeight: number } | undefined>(undefined)

  useLayoutEffect(() => {
    const element = containerRef.current
    if (!element) return
    const baseScrollHeight = previous.current?.scrollHeight ?? element.scrollHeight
    const baseClientHeight = previous.current?.clientHeight ?? element.clientHeight
    const distanceFromBottom = baseScrollHeight - baseClientHeight - element.scrollTop
    if (shouldPreserve() || distanceFromBottom > AUTO_SCROLL_BOTTOM_THRESHOLD_PX) {
      element.scrollTop = element.scrollTop
    } else {
      element.scrollTop = element.scrollHeight
    }
    previous.current = {
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    }
  }, [containerRef, version, shouldPreserve])
}
