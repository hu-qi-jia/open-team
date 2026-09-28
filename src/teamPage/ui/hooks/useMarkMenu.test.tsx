// src/teamPage/ui/hooks/useMarkMenu.test.tsx
// @vitest-environment jsdom
import { useCallback, useState } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GroupMessage } from '../../../group/types'
import { useMarkMenu } from './useMarkMenu'

const MESSAGE_TEXT = '这里有一段重点内容'
const MESSAGE = {
  id: 'msg-1',
  chatId: 'chat-1',
  seq: 1,
  type: 'assistant',
  roleId: 'role-1',
  roleName: '甲',
  content: MESSAGE_TEXT,
  status: 'received',
  createdAt: 1,
} as GroupMessage

/*
 * 探针镜像 Messages 的接线：callback ref 把容器元素同时写进 state 喂给
 * useMarkMenu。containerKey 变化时 React 卸载旧元素、挂载新元素——等价于
 * ScrollArea Viewport 被重建（S2 终审 I5 的场景）。
 */
function MarkMenuProbe({ containerKey }: { containerKey: string }) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const containerRef = useCallback((node: HTMLDivElement | null) => {
    setContainer(node)
  }, [])
  const controller = useMarkMenu({
    container,
    resolveMessage: messageId => (messageId === MESSAGE.id ? MESSAGE : undefined),
    onHighlight: () => undefined,
    onInsertIntoNote: () => undefined,
  })
  return (
    <div>
      <div key={containerKey} ref={containerRef} className="scroll-container">
        <article className="message-row" data-message-id={MESSAGE.id}>
          <div className="message-body">{MESSAGE_TEXT}</div>
        </article>
      </div>
      {controller.selectedMark ? <div className="mark-menu">{controller.selectedMark.text}</div> : null}
    </div>
  )
}

function selectMessageText(container: HTMLElement): void {
  const body = container.querySelector('.message-body')
  const textNode = body?.firstChild
  if (!body || !textNode) throw new Error('探针缺少 .message-body 文本节点')
  const range = document.createRange()
  range.selectNodeContents(textNode)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

function settleMarkMenu(): void {
  act(() => {
    vi.advanceTimersByTime(90)
  })
}

describe('useMarkMenu', () => {
  afterEach(() => {
    window.getSelection()?.removeAllRanges()
    cleanup()
    vi.useRealTimers()
  })

  it('容器元素被替换后划选菜单仍能工作（监听器随元素重绑）', () => {
    const { container, rerender } = render(<MarkMenuProbe containerKey="a" />)
    const firstContainer = container.querySelector<HTMLElement>('.scroll-container')
    expect(firstContainer).not.toBeNull()

    vi.useFakeTimers()
    selectMessageText(firstContainer!)
    fireEvent.mouseUp(firstContainer!)
    settleMarkMenu()
    expect(container.querySelector('.mark-menu')?.textContent).toBe(MESSAGE_TEXT)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(container.querySelector('.mark-menu')).toBeNull()

    // 替换容器元素（React 卸载旧节点、挂载新节点）
    rerender(<MarkMenuProbe containerKey="b" />)
    const secondContainer = container.querySelector<HTMLElement>('.scroll-container')
    expect(secondContainer).not.toBeNull()
    expect(secondContainer).not.toBe(firstContainer)

    selectMessageText(secondContainer!)
    fireEvent.mouseUp(secondContainer!)
    settleMarkMenu()
    // 旧写法（effect deps 不含元素）监听器留在已卸载的旧节点上：
    // container.contains(body) 恒 false，这里拿不到菜单
    expect(container.querySelector('.mark-menu')?.textContent).toBe(MESSAGE_TEXT)
  })
})
