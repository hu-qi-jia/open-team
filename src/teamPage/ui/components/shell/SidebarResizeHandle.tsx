import { useRef, useState } from 'react'
import { useSidebarPrefs } from '../../hooks/useSidebarPrefs'

/*
 * 侧栏拖宽手柄（规格 §5.2 修订：官方 Resizable 组件只支持百分比约束，
 * 无法保证 200–320px 像素钳制，故自绘；仅 wide 档且侧栏展开时渲染）。
 * 拖拽调宽；双击重置 240px；宽度经 useSidebarPrefs 持久化。
 * absolute 相对 #app 定位（#app 自身 fixed，恒为包含块，与 floatingWindow
 * 是否清掉 #app 的 transform 无关，见 globals.css）；
 * left 跟随 SidebarProvider 注入的 --sidebar-width。
 * aria-label/title 沿简报原文案，英文键已入 UI_TRANSLATIONS（同
 * FloatingWindowChrome 的 vanilla 铬件模式）。
 */
export function SidebarResizeHandle() {
  const { width, setWidth, resetWidth } = useSidebarPrefs()
  const [resizing, setResizing] = useState(false)
  const drag = useRef<{ pointerId: number; startClientX: number; startWidth: number } | undefined>(undefined)

  return (
    <div
      className="sidebar-resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="调整侧栏宽度"
      title="拖拽调整宽度，双击重置"
      data-resizing={resizing || undefined}
      onPointerDown={event => {
        if (event.button !== 0) return
        drag.current = { pointerId: event.pointerId, startClientX: event.clientX, startWidth: width }
        event.currentTarget.setPointerCapture?.(event.pointerId)
        setResizing(true)
        event.preventDefault()
      }}
      onPointerMove={event => {
        const state = drag.current
        if (!state || state.pointerId !== event.pointerId) return
        setWidth(state.startWidth + event.clientX - state.startClientX)
      }}
      onPointerUp={() => { drag.current = undefined; setResizing(false) }}
      onPointerCancel={() => { drag.current = undefined; setResizing(false) }}
      onDoubleClick={resetWidth}
    />
  )
}
