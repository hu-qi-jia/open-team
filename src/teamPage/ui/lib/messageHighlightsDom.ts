import type { MessageHighlight } from '../../../group/types'
import { messageHighlightColorRgb } from '../../../group/highlightColors'

/*
 * 高亮回显（原 messagesView 的 applyHighlightsToBody / wrapTextRange 原样迁移）。
 * 在 React 渲染的 .message-body 容器内做 TreeWalker 切分文本节点；
 * 由 MessageItem 的 effect 在签名变化后重放（dangerouslySetInnerHTML 的
 * innerHTML 替换会冲掉 mark 节点，所以每次签名变化都要重新包一层）。
 */
export function applyHighlightsToBody(body: HTMLElement, highlights: MessageHighlight[]): void {
  const bodyText = body.textContent ?? ''
  const normalized = highlights
    .map(highlight => {
      const renderedStart = bodyText.slice(highlight.startOffset, highlight.endOffset) === highlight.text ? highlight.startOffset : bodyText.indexOf(highlight.text)
      return renderedStart >= 0 ? { ...highlight, startOffset: renderedStart, endOffset: renderedStart + highlight.text.length } : undefined
    })
    .filter((highlight): highlight is MessageHighlight => Boolean(highlight))
    .sort((left, right) => left.startOffset - right.startOffset)

  let cursor = 0
  for (const highlight of normalized) {
    if (highlight.startOffset < cursor) continue
    wrapTextRange(body, highlight.startOffset, highlight.endOffset, highlight.color)
    cursor = highlight.endOffset
  }
}

function wrapTextRange(root: HTMLElement, startOffset: number, endOffset: number, color: MessageHighlight['color']): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let textPosition = 0
  const ranges: Array<{ node: Text; start: number; end: number }> = []

  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    const nodeStart = textPosition
    const nodeEnd = nodeStart + node.data.length
    if (nodeEnd > startOffset && nodeStart < endOffset) {
      ranges.push({
        node,
        start: Math.max(0, startOffset - nodeStart),
        end: Math.min(node.data.length, endOffset - nodeStart),
      })
    }
    textPosition = nodeEnd
  }

  for (const range of ranges.reverse()) {
    const selected = range.node.splitText(range.start)
    selected.splitText(range.end - range.start)
    const mark = document.createElement('span')
    // §4.4 @高亮重塑：legacy .message-highlight 规则退役，视觉改由 utilities
    // （圆角）+ 内联样式（底色/内阴影，沿用 --message-highlight-rgb 变量机制）承担
    mark.className = 'message-highlight rounded-[2px]'
    mark.style.setProperty('--message-highlight-rgb', messageHighlightColorRgb(color))
    mark.style.background = 'rgba(var(--message-highlight-rgb), 0.32)'
    mark.style.boxShadow = 'inset 0 -1px 0 rgba(var(--message-highlight-rgb), 0.72)'
    selected.parentNode?.insertBefore(mark, selected)
    mark.append(selected)
  }
}
