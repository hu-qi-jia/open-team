import { useCallback, useEffect, useRef, useState } from 'react'
import type { GroupMessage } from '../../../group/types'
import { DEFAULT_MESSAGE_HIGHLIGHT_COLOR, type MessageHighlightColor } from '../../../group/highlightColors'

export const MARK_MENU_SELECTION_GAP_PX = 12
const MARK_MENU_SELECTION_SETTLE_DELAY_MS = 80

export interface SelectedMark {
  message: GroupMessage
  text: string
  startOffset: number
  endOffset: number
  rect: DOMRect
  color: MessageHighlightColor
}

export interface MarkMenuController {
  selectedMark: SelectedMark | undefined
  selectedColor: MessageHighlightColor
  setSelectedColor(color: MessageHighlightColor): void
  applyMark(action: 'highlight' | 'note' | 'both'): void
  hide(): void
}

interface UseMarkMenuOptions {
  containerRef: React.RefObject<HTMLElement | null>
  /** 由调用方每轮渲染刷新（闭包读取最新 store），监听器内经 ref 取用 */
  resolveMessage(messageId: string): GroupMessage | undefined
  onHighlight(mark: SelectedMark): void
  onInsertIntoNote(text: string): void
}

/*
 * 划词菜单（原 messagesView 的选区监听状态机原样迁移）：
 * - mousedown/pointerdown 在消息区按下 → 进入拖拽态并隐藏菜单；
 * - mouseup/pointerup 落定后延迟 80ms 结算选区（等浏览器定稿选区）；
 * - selectionchange 只在非拖拽态响应（例如键盘选区）；
 * - 菜单外的点击 / Escape 关闭；dragstart 取消。
 * 几何与结算逻辑不变；菜单本体由 <MarkMenu> portal 渲染。
 */
export function useMarkMenu(options: UseMarkMenuOptions): MarkMenuController {
  const { containerRef } = options
  const [selectedMark, setSelectedMark] = useState<SelectedMark | undefined>(undefined)
  const [selectedColor, setSelectedColorState] = useState<MessageHighlightColor>(DEFAULT_MESSAGE_HIGHLIGHT_COLOR)

  const optionsRef = useRef(options)
  optionsRef.current = options
  const selectedMarkRef = useRef<SelectedMark | undefined>(undefined)
  const selectedColorRef = useRef<MessageHighlightColor>(DEFAULT_MESSAGE_HIGHLIGHT_COLOR)
  const selectionDragActiveRef = useRef(false)
  const ignoreNextDocumentClickRef = useRef(false)
  const markMenuUpdateTimerRef = useRef<number | undefined>(undefined)

  const hide = useCallback(() => {
    clearMarkMenuUpdate()
    selectedMarkRef.current = undefined
    setSelectedMark(undefined)
  }, [])

  const clearMarkMenuUpdate = () => {
    if (markMenuUpdateTimerRef.current === undefined) return
    window.clearTimeout(markMenuUpdateTimerRef.current)
    markMenuUpdateTimerRef.current = undefined
  }

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const beginSelectionDrag = (event: MouseEvent | PointerEvent): void => {
      const target = event.target as Element | null
      if (!target || target.closest('button, input, textarea, select, a, [role="button"]')) return
      if (!container.contains(target)) return
      selectionDragActiveRef.current = true
      clearMarkMenuUpdate()
      hide()
    }

    const finishSelectionDrag = (event: MouseEvent | PointerEvent): void => {
      const target = event.target as Node | null
      if (!selectionDragActiveRef.current && (!target || !container.contains(target))) return
      selectionDragActiveRef.current = false
      ignoreNextDocumentClickRef.current = true
      scheduleMarkMenuFromSelection()
    }

    const cancelSelectionMarking = (): void => {
      selectionDragActiveRef.current = false
      ignoreNextDocumentClickRef.current = false
      clearMarkMenuUpdate()
      hide()
    }

    const scheduleMarkMenuFromSelection = (): void => {
      clearMarkMenuUpdate()
      markMenuUpdateTimerRef.current = window.setTimeout(() => {
        markMenuUpdateTimerRef.current = undefined
        showMarkMenuFromSelection()
      }, MARK_MENU_SELECTION_SETTLE_DELAY_MS)
    }

    const showMarkMenuFromSelection = (): void => {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        hide()
        return
      }

      const range = selection.getRangeAt(0)
      const body = closestMessageBody(range.commonAncestorContainer)
      if (!body || !container.contains(body)) {
        hide()
        return
      }

      const article = body.closest<HTMLElement>('.message-row[data-message-id]')
      const messageId = article?.dataset.messageId
      const message = messageId ? optionsRef.current.resolveMessage(messageId) : undefined
      const selectedText = selection.toString().trim()
      if (!message || !selectedText) {
        hide()
        return
      }

      const startOffset = message.content.indexOf(selectedText)
      if (startOffset < 0) {
        hide()
        return
      }

      const mark: SelectedMark = {
        message,
        text: selectedText,
        startOffset,
        endOffset: startOffset + selectedText.length,
        rect: rangeRect(range),
        color: selectedColorRef.current,
      }
      selectedMarkRef.current = mark
      setSelectedMark(mark)
    }

    const onSelectionChange = (): void => {
      if (selectionDragActiveRef.current) return
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        hide()
        return
      }
      scheduleMarkMenuFromSelection()
    }

    const onDocumentClick = (event: MouseEvent): void => {
      if (ignoreNextDocumentClickRef.current) {
        ignoreNextDocumentClickRef.current = false
        return
      }
      const menu = document.querySelector('.mark-menu')
      if (menu?.contains(event.target as Node)) return
      const target = event.target as Element | null
      if (target?.closest('.message-body')) return
      hide()
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') hide()
    }

    const onDragStart = (): void => cancelSelectionMarking()

    container.addEventListener('mousedown', beginSelectionDrag)
    container.addEventListener('pointerdown', beginSelectionDrag)
    container.addEventListener('dragstart', onDragStart)
    document.addEventListener('mouseup', finishSelectionDrag)
    document.addEventListener('pointerup', finishSelectionDrag)
    document.addEventListener('selectionchange', onSelectionChange)
    document.addEventListener('click', onDocumentClick)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      container.removeEventListener('mousedown', beginSelectionDrag)
      container.removeEventListener('pointerdown', beginSelectionDrag)
      container.removeEventListener('dragstart', onDragStart)
      document.removeEventListener('mouseup', finishSelectionDrag)
      document.removeEventListener('pointerup', finishSelectionDrag)
      document.removeEventListener('selectionchange', onSelectionChange)
      document.removeEventListener('click', onDocumentClick)
      document.removeEventListener('keydown', onKeyDown)
      clearMarkMenuUpdate()
    }
  }, [containerRef, hide])

  const setSelectedColor = useCallback((color: MessageHighlightColor) => {
    selectedColorRef.current = color
    setSelectedColorState(color)
    if (selectedMarkRef.current) {
      const next = { ...selectedMarkRef.current, color }
      selectedMarkRef.current = next
      setSelectedMark(next)
    }
  }, [])

  const applyMark = useCallback((action: 'highlight' | 'note' | 'both') => {
    const mark = selectedMarkRef.current
    if (!mark) return
    if (action === 'note' || action === 'both') optionsRef.current.onInsertIntoNote(mark.text)
    if (action === 'highlight' || action === 'both') optionsRef.current.onHighlight(mark)
    window.getSelection()?.removeAllRanges()
    hide()
  }, [hide])

  return { selectedMark, selectedColor, setSelectedColor, applyMark, hide }
}

function closestMessageBody(node: Node): HTMLElement | undefined {
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement
  return element?.closest<HTMLElement>('.message-body') ?? undefined
}

function rangeRect(range: Range): DOMRect {
  if (typeof range.getBoundingClientRect === 'function') return range.getBoundingClientRect()
  return new DOMRect(8, 8, 1, 1)
}
