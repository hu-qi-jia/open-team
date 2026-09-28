import { useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { MESSAGE_HIGHLIGHT_COLORS, messageHighlightColorRgb } from '../../../../group/highlightColors'
import { MARK_MENU_SELECTION_GAP_PX, type MarkMenuController } from '../../hooks/useMarkMenu'

const FALLBACK_HEIGHT_PX = 148

/*
 * 划词菜单浮层（原 renderMarkMenu 的几何原样迁移）：优先出现在选区上方，
 * 放不下则到下方；水平居中并夹在视口内。portal 到 body——原实现也是
 * document.body.append(markMenu)。每次渲染（含换色）后重新测量定位，
 * 与原「重建菜单节点 → 测量 → 摆位」节奏一致。
 * S2 Task 6：换 popover 视觉——fixed 定位坐标仍由下方 useLayoutEffect
 * 逐字写入（legacy 的 .mark-menu 定位规则已退役），色钮底色改由行内
 * CSS 变量 + bg-[rgba(var(--mark-color-rgb),…)] utilities 消费。
 */
export function MarkMenu({ controller }: { controller: MarkMenuController }) {
  const { selectedMark } = controller
  const menuRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!selectedMark || !menuRef.current) return
    const menu = menuRef.current
    const menuRect = menu.getBoundingClientRect()
    const menuHeight = menuRect.height || menu.offsetHeight || FALLBACK_HEIGHT_PX
    const menuWidth = menuRect.width || menu.offsetWidth
    const preferredTop = selectedMark.rect.top - menuHeight - MARK_MENU_SELECTION_GAP_PX
    const top = preferredTop >= 8
      ? preferredTop
      : Math.min(Math.max(8, selectedMark.rect.bottom + MARK_MENU_SELECTION_GAP_PX), window.innerHeight - menuHeight - 8)
    const centeredLeft = selectedMark.rect.left + selectedMark.rect.width / 2 - menuWidth / 2
    const left = Math.min(Math.max(8, centeredLeft), window.innerWidth - menuWidth - 8)
    menu.style.top = `${top}px`
    menu.style.left = `${left}px`
  })

  if (!selectedMark) return null

  return createPortal(
    <div ref={menuRef} className="mark-menu fixed z-50 flex flex-col rounded-md border border-border bg-popover p-1 shadow-md">
      <div className="mark-color-row flex items-center gap-1.5 border-b border-border px-1 pb-1.5" aria-label="高亮颜色">
        {MESSAGE_HIGHLIGHT_COLORS.map(color => (
          // 类名与 ${ 之间必须留空白：Tailwind 扫描器会丢弃紧贴 `${` 的候选
          // （ring-offset-popover${…} → dist/team.css 不生成该类，v4 的
          // --tw-ring-offset-color 初值 #fff 兜底，暗色下露出白圈）。
          <button
            key={color.value}
            type="button"
            className={`mark-color-btn size-5 rounded-full bg-[rgba(var(--mark-color-rgb),0.9)] ring-offset-2 ring-offset-popover ${selectedMark.color === color.value ? ' ring-2 ring-ring' : ''}`}
            aria-label={`高亮颜色：${color.label}`}
            aria-pressed={selectedMark.color === color.value}
            style={{ '--mark-color-rgb': messageHighlightColorRgb(color.value) } as React.CSSProperties}
            onClick={event => {
              event.preventDefault()
              event.stopPropagation()
              controller.setSelectedColor(color.value)
            }}
          ></button>
        ))}
      </div>
      <MarkMenuButton label="高亮" onClick={() => controller.applyMark('highlight')}>高亮</MarkMenuButton>
      <MarkMenuButton label="加入笔记" onClick={() => controller.applyMark('note')}>加入笔记</MarkMenuButton>
      <MarkMenuButton label="高亮并加入笔记" onClick={() => controller.applyMark('both')}>高亮并加入笔记</MarkMenuButton>
    </div>,
    document.body,
  )
}

function MarkMenuButton({ label, onClick, children }: { label: string; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="cursor-pointer text-left rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
      onClick={event => {
        event.preventDefault()
        event.stopPropagation()
        onClick()
      }}
    >{children}</button>
  )
}
