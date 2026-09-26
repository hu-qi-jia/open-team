import { useMemo, useRef, type RefObject } from 'react'

export interface FloatingPanelGeometryOptions {
  panelRef: RefObject<HTMLElement | null>
  dragHandleRef: RefObject<HTMLElement | null>
  resizeHandleRef: RefObject<HTMLElement | null>
  minWidth: number
  minHeight: number
  margin: number
  /** 拖拽/缩放起止回调：组件用它切 dragging / resizing 类（原 classList 对译） */
  onDraggingChange?(dragging: boolean): void
  onResizingChange?(resizing: boolean): void
}

interface DragStart {
  pointerId: number
  startX: number
  startY: number
  startLeft: number
  startTop: number
}

interface ResizeStart {
  pointerId: number
  startX: number
  startY: number
  startWidth: number
  startHeight: number
  startLeft: number
  startTop: number
}

/*
 * 浮动面板的拖拽 / 缩放几何（原 notesView.startDragging…startResizing 对译，
 * 与 floatingWindow / 编排浮窗同源）。要点：
 * - pointerdown 起手：位置改写为 left/top 并固定 right/bottom=auto，随后
 *   window 级 pointermove/pointerup/pointercancel 跟随（用完即移除）；
 * - 位置与尺寸以内联样式直写面板元素——组件不得给面板传 style props，
 *   否则 React 重渲会覆写手势中的样式；
 * - clampPosition 供窗口 resize / 面板打开时把面板拉回视口内。
 * options 经 latest-ref 读取，返回的处理器身份稳定，可安全进 effect 依赖。
 */
export function useFloatingPanelGeometry(options: FloatingPanelGeometryOptions): {
  onDragPointerDown(event: React.PointerEvent): void
  onResizePointerDown(event: React.PointerEvent): void
  clampPosition(): void
} {
  const optionsRef = useRef(options)
  optionsRef.current = options

  return useMemo(() => ({
    onDragPointerDown(event: React.PointerEvent): void {
      if (event.button !== 0) return
      const target = event.target as Element | null
      // 手柄内的按钮（如关闭）不触发拖拽
      if (target?.closest('button, input, textarea, select, a, [role="button"]')) return
      const { panelRef, dragHandleRef, margin, onDraggingChange } = optionsRef.current
      const panel = panelRef.current
      const handle = dragHandleRef.current
      if (!panel || !handle) return

      const rect = panel.getBoundingClientRect()
      panel.style.left = `${rect.left}px`
      panel.style.top = `${rect.top}px`
      panel.style.right = 'auto'
      panel.style.bottom = 'auto'
      onDraggingChange?.(true)
      const start: DragStart = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startLeft: rect.left,
        startTop: rect.top,
      }
      handle.setPointerCapture?.(event.pointerId)
      event.preventDefault()
      event.stopPropagation()

      const onMove = (moveEvent: PointerEvent): void => {
        if (!panel.isConnected || moveEvent.pointerId !== start.pointerId) return
        movePanelTo(panel, margin, start.startLeft + moveEvent.clientX - start.startX, start.startTop + moveEvent.clientY - start.startY)
      }
      const onFinish = (endEvent: PointerEvent): void => {
        if (endEvent.pointerId !== start.pointerId) return
        detach()
        onDraggingChange?.(false)
        if (handle.hasPointerCapture?.(endEvent.pointerId)) handle.releasePointerCapture(endEvent.pointerId)
      }
      const onCancel = (cancelEvent: PointerEvent): void => onFinish(cancelEvent)
      const detach = (): void => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onFinish)
        window.removeEventListener('pointercancel', onCancel)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onFinish)
      window.addEventListener('pointercancel', onCancel)
    },

    onResizePointerDown(event: React.PointerEvent): void {
      if (event.button !== 0) return
      const { panelRef, resizeHandleRef, onResizingChange } = optionsRef.current
      const panel = panelRef.current
      const handle = resizeHandleRef.current
      if (!panel || !handle) return

      const rect = panel.getBoundingClientRect()
      panel.style.left = `${rect.left}px`
      panel.style.top = `${rect.top}px`
      panel.style.right = 'auto'
      panel.style.bottom = 'auto'
      onResizingChange?.(true)
      const start: ResizeStart = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startWidth: rect.width,
        startHeight: rect.height,
        startLeft: rect.left,
        startTop: rect.top,
      }
      handle.setPointerCapture?.(event.pointerId)
      event.preventDefault()
      event.stopPropagation()

      const onMove = (moveEvent: PointerEvent): void => {
        if (!panel.isConnected || moveEvent.pointerId !== start.pointerId) return
        resizePanelTo(
          panel,
          optionsRef.current,
          start.startWidth + moveEvent.clientX - start.startX,
          start.startHeight + moveEvent.clientY - start.startY,
          start.startLeft,
          start.startTop,
        )
      }
      const onFinish = (endEvent: PointerEvent): void => {
        if (endEvent.pointerId !== start.pointerId) return
        detach()
        onResizingChange?.(false)
        if (handle.hasPointerCapture?.(endEvent.pointerId)) handle.releasePointerCapture(endEvent.pointerId)
      }
      const onCancel = (cancelEvent: PointerEvent): void => onFinish(cancelEvent)
      const detach = (): void => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onFinish)
        window.removeEventListener('pointercancel', onCancel)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onFinish)
      window.addEventListener('pointercancel', onCancel)
    },

    clampPosition(): void {
      const { panelRef } = optionsRef.current
      const panel = panelRef.current
      if (!panel || !panel.style.left || !panel.style.top) return
      const rect = panel.getBoundingClientRect()
      resizePanelTo(panel, optionsRef.current, rect.width, rect.height, rect.left, rect.top)
      movePanelTo(panel, optionsRef.current.margin, rect.left, rect.top)
    },
  }), [])
}

function movePanelTo(panel: HTMLElement, margin: number, left: number, top: number): void {
  const rect = panel.getBoundingClientRect()
  const panelWidth = Math.min(rect.width, window.innerWidth - margin * 2)
  const panelHeight = Math.min(rect.height, window.innerHeight - margin * 2)
  const maxLeft = Math.max(margin, window.innerWidth - panelWidth - margin)
  const maxTop = Math.max(margin, window.innerHeight - panelHeight - margin)
  panel.style.left = `${Math.min(Math.max(margin, left), maxLeft)}px`
  panel.style.top = `${Math.min(Math.max(margin, top), maxTop)}px`
  panel.style.right = 'auto'
  panel.style.bottom = 'auto'
}

function resizePanelTo(panel: HTMLElement, options: Pick<FloatingPanelGeometryOptions, 'minWidth' | 'minHeight' | 'margin'>, width: number, height: number, left: number, top: number): void {
  const maxWidth = Math.max(options.minWidth, window.innerWidth - left - options.margin)
  const maxHeight = Math.max(options.minHeight, window.innerHeight - top - options.margin)
  panel.style.width = `${Math.min(Math.max(options.minWidth, width), maxWidth)}px`
  panel.style.height = `${Math.min(Math.max(options.minHeight, height), maxHeight)}px`
  panel.style.right = 'auto'
  panel.style.bottom = 'auto'
}
