import { useMemo, useRef, type RefObject } from 'react'

export interface FloatingPanelGeometryOptions {
  panelRef: RefObject<HTMLElement | null>
  dragHandleRef: RefObject<HTMLElement | null>
  resizeHandleRef: RefObject<HTMLElement | null>
  minWidth: number
  minHeight: number
  margin: number
  /** 缩放尺寸硬上限（如编排状态卡的 720×620；不传保持仅视口约束） */
  maxWidth?: number
  maxHeight?: number
  /**
   * 面板所在的定位容器（absolute 包含块，如编排状态卡的 #app）。
   * 不传 = 以视口为坐标系（fixed 语义，NotesPanel 等既有消费者不受影响）。
   * 起手/钳制均换算为容器坐标，拖拽增量仍用 pointer 的视口位移（容器静置）。
   */
  getContainer?: () => Element | null
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
  frame: FrameRect
}

interface ResizeStart {
  pointerId: number
  startX: number
  startY: number
  startWidth: number
  startHeight: number
  startLeft: number
  startTop: number
  frame: FrameRect
}

/** 定位坐标系：容器 rect（getContainer 命中）或视口（默认） */
interface FrameRect {
  left: number
  top: number
  width: number
  height: number
}

function frameOf(options: Pick<FloatingPanelGeometryOptions, 'getContainer'>): FrameRect {
  const container = options.getContainer?.()
  if (container) return container.getBoundingClientRect()
  return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
}

/*
 * 浮动面板的拖拽 / 缩放几何（原 notesView.startDragging…startResizing 对译，
 * 与 floatingWindow / 编排浮窗同源）。要点：
 * - pointerdown 起手：位置改写为 left/top（坐标系见 getContainer）并固定
 *   right/bottom=auto，随后 window 级 pointermove/pointerup/pointercancel
 *   跟随（用完即移除）；
 * - 位置与尺寸以内联样式直写面板元素——组件不得给面板传 style props，
 *   否则 React 重渲会覆写手势中的样式；
 * - clampPosition 供窗口 resize / 面板打开时把面板拉回坐标系（容器或视口）内。
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
      const frame = frameOf(optionsRef.current)
      // 起手改写为容器坐标（absolute 语义）并固定 right/bottom=auto
      panel.style.left = `${rect.left - frame.left}px`
      panel.style.top = `${rect.top - frame.top}px`
      panel.style.right = 'auto'
      panel.style.bottom = 'auto'
      onDraggingChange?.(true)
      const start: DragStart = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startLeft: rect.left - frame.left,
        startTop: rect.top - frame.top,
        frame,
      }
      handle.setPointerCapture?.(event.pointerId)
      event.preventDefault()
      event.stopPropagation()

      const onMove = (moveEvent: PointerEvent): void => {
        if (!panel.isConnected || moveEvent.pointerId !== start.pointerId) return
        movePanelTo(panel, start.frame, margin, start.startLeft + moveEvent.clientX - start.startX, start.startTop + moveEvent.clientY - start.startY)
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
      const frame = frameOf(optionsRef.current)
      panel.style.left = `${rect.left - frame.left}px`
      panel.style.top = `${rect.top - frame.top}px`
      panel.style.right = 'auto'
      panel.style.bottom = 'auto'
      onResizingChange?.(true)
      const start: ResizeStart = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startWidth: rect.width,
        startHeight: rect.height,
        startLeft: rect.left - frame.left,
        startTop: rect.top - frame.top,
        frame,
      }
      handle.setPointerCapture?.(event.pointerId)
      event.preventDefault()
      event.stopPropagation()

      const onMove = (moveEvent: PointerEvent): void => {
        if (!panel.isConnected || moveEvent.pointerId !== start.pointerId) return
        resizePanelTo(
          panel,
          optionsRef.current,
          start.frame,
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
      const frame = frameOf(optionsRef.current)
      const rect = panel.getBoundingClientRect()
      resizePanelTo(panel, optionsRef.current, frame, rect.width, rect.height, rect.left - frame.left, rect.top - frame.top)
      movePanelTo(panel, frame, optionsRef.current.margin, rect.left - frame.left, rect.top - frame.top)
    },
  }), [])
}

function movePanelTo(panel: HTMLElement, frame: FrameRect, margin: number, left: number, top: number): void {
  const rect = panel.getBoundingClientRect()
  const panelWidth = Math.min(rect.width, frame.width - margin * 2)
  const panelHeight = Math.min(rect.height, frame.height - margin * 2)
  const maxLeft = Math.max(margin, frame.width - panelWidth - margin)
  const maxTop = Math.max(margin, frame.height - panelHeight - margin)
  panel.style.left = `${Math.min(Math.max(margin, left), maxLeft)}px`
  panel.style.top = `${Math.min(Math.max(margin, top), maxTop)}px`
  panel.style.right = 'auto'
  panel.style.bottom = 'auto'
}

function resizePanelTo(panel: HTMLElement, options: Pick<FloatingPanelGeometryOptions, 'minWidth' | 'minHeight' | 'maxWidth' | 'maxHeight' | 'margin'>, frame: FrameRect, width: number, height: number, left: number, top: number): void {
  const frameMaxWidth = Math.max(options.minWidth, frame.width - left - options.margin)
  const frameMaxHeight = Math.max(options.minHeight, frame.height - top - options.margin)
  const maxWidth = options.maxWidth !== undefined ? Math.min(frameMaxWidth, Math.max(options.minWidth, options.maxWidth)) : frameMaxWidth
  const maxHeight = options.maxHeight !== undefined ? Math.min(frameMaxHeight, Math.max(options.minHeight, options.maxHeight)) : frameMaxHeight
  panel.style.width = `${Math.min(Math.max(options.minWidth, width), maxWidth)}px`
  panel.style.height = `${Math.min(Math.max(options.minHeight, height), maxHeight)}px`
  panel.style.right = 'auto'
  panel.style.bottom = 'auto'
}
