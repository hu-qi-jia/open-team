import { useT } from '../../hooks/useT'

/*
 * 浮窗铬件：工具条三钮 + 缩放手柄。id 与初始 attribute 必须与原 team.html
 * 逐字一致——floatingWindow.ts 按 id 绑定事件并直接改写 aria-expanded /
 * aria-pressed / style / className；aria-label / title 走翻译表（语言切换
 * 会重渲本组件，但 React 只补写差异 prop，不会碰 vanilla 直写的属性）。
 */
export function FloatingWindowChrome() {
  const t = useT()
  return (
    <>
      <div id="floating-toolbar" className="floating-toolbar">
        <button id="close-window" className="icon-btn window-dot window-dot-close" type="button" aria-label={t('关闭窗口')} title={t('关闭窗口')}>×</button>
        <button id="toggle-window-size" className="icon-btn window-dot window-dot-minimize" type="button" aria-expanded="true" aria-label={t('缩小窗口')} title={t('缩小窗口')}>−</button>
        <button id="toggle-fullscreen" className="icon-btn window-dot window-dot-fullscreen" type="button" aria-pressed="false" aria-label={t('全屏窗口')} title={t('全屏窗口')}>⛶</button>
      </div>
      <button id="window-resize-handle" className="window-resize-handle" type="button" aria-label={t('调整窗口大小')} title={t('调整窗口大小')}></button>
      <button id="window-resize-handle-right" className="window-resize-handle window-resize-handle-right" type="button" aria-label={t('调整窗口宽度')} title={t('调整窗口宽度')}></button>
      <button id="window-resize-handle-bottom" className="window-resize-handle window-resize-handle-bottom" type="button" aria-label={t('调整窗口高度')} title={t('调整窗口高度')}></button>
    </>
  )
}
