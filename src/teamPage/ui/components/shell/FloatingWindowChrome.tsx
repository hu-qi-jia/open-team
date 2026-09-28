import { Maximize2, Minimize2, Minus, X } from 'lucide-react'
import { useT } from '../../hooks/useT'
import { Button } from '../ui/button'

/*
 * 浮窗铬件：工具条三钮 + 缩放手柄。id 与初始 attribute 必须与原 team.html
 * 逐字一致——floatingWindow.ts 按 id 绑定事件并直接改写 aria-expanded /
 * aria-pressed / style / className；aria-label / title 走翻译表（语言切换
 * 会重渲本组件，但 React 只补写差异 prop，不会碰 vanilla 直写的属性）。
 *
 * 三钮为同族 lucide 图标（最小化 / 全屏 / 关闭，用户 2026-09-28 报「换成
 * 同类型的 icon」），按用户给的顺序左→右排在壳层右上角；此前是 macOS 交通
 * 灯圆点 + CSS 伪元素字形（legacy 的 .window-dot 家族已一并退役），尺寸与
 * hover/focus 环改走 shadcn Button（icon-xs = 24px）。
 *
 * 全屏钮的图标随状态翻转：状态只写在 #app 的类上（vanilla 直写，React 不
 * 订阅），故翻转由祖先类 .fullscreen 的 arbitrary variant 承担。
 * floatingWindow.ts 原先直写 textContent 换字形，那会清掉 React 渲染的
 * svg——已改为只维护 aria-label / title。
 * 最小化钮无翻转图标：.app-shell.minimized 令整壳 display:none（退役的
 * 「□」字形用户永远看不到），恢复入口在 #window-launcher。
 */
export function FloatingWindowChrome() {
  const t = useT()
  return (
    <>
      {/* 3×size-6 + 2×gap-0.5 = 76px，右缩进 12px → 占壳层右缘 88px 宽带；
          与 ChatHeader 的 pr-[96px] 让位配对（s1 验收断言 compact 档零重叠）。
          top-4 让 24px 高的钮行中心落在外层 h-14 头部的垂直中点（16+12=28），
          与头部右侧 size-8 工具钮（12..44）视觉对齐。
          pointer-events-auto：.app-shell 自身 pointer-events:none，铬件必须
          收回事件（原 legacy .floating-toolbar 的职责，逐字保留）。 */}
      <div id="floating-toolbar" className="floating-toolbar pointer-events-auto absolute top-4 right-3 z-12 flex items-center gap-0.5">
        <Button
          id="toggle-window-size"
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground"
          type="button"
          aria-expanded="true"
          aria-label={t('缩小窗口')}
          title={t('缩小窗口')}
        >
          <Minus className="size-3.5" aria-hidden="true" />
        </Button>
        <Button
          id="toggle-fullscreen"
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground"
          type="button"
          aria-pressed="false"
          aria-label={t('全屏窗口')}
          title={t('全屏窗口')}
        >
          <Maximize2 className="size-3.5 [.fullscreen_&]:hidden" aria-hidden="true" />
          <Minimize2 className="hidden size-3.5 [.fullscreen_&]:block" aria-hidden="true" />
        </Button>
        <Button
          id="close-window"
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground"
          type="button"
          aria-label={t('关闭窗口')}
          title={t('关闭窗口')}
        >
          <X className="size-3.5" aria-hidden="true" />
        </Button>
      </div>
      <button id="window-resize-handle" className="window-resize-handle" type="button" aria-label={t('调整窗口大小')} title={t('调整窗口大小')}></button>
      <button id="window-resize-handle-right" className="window-resize-handle window-resize-handle-right" type="button" aria-label={t('调整窗口宽度')} title={t('调整窗口宽度')}></button>
      <button id="window-resize-handle-bottom" className="window-resize-handle window-resize-handle-bottom" type="button" aria-label={t('调整窗口高度')} title={t('调整窗口高度')}></button>
    </>
  )
}
