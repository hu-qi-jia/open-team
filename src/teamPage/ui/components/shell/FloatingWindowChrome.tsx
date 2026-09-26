/*
 * 浮窗铬件：工具条三钮 + 缩放手柄。id 与初始 attribute 必须与原 team.html
 * 逐字一致——floatingWindow.ts 按 id 绑定事件并直接改写 aria-expanded /
 * aria-pressed / style / className，React 侧保持静态（永不重渲）。
 */
export function FloatingWindowChrome() {
  return (
    <>
      <div id="floating-toolbar" className="floating-toolbar">
        <button id="close-window" className="icon-btn window-dot window-dot-close" type="button" aria-label="缩小窗口" title="缩小窗口">×</button>
        <button id="toggle-window-size" className="icon-btn window-dot window-dot-minimize" type="button" aria-expanded="true" aria-label="缩小窗口" title="缩小窗口">−</button>
        <button id="toggle-fullscreen" className="icon-btn window-dot window-dot-fullscreen" type="button" aria-pressed="false" aria-label="全屏窗口" title="全屏窗口">⛶</button>
      </div>
      <button id="window-resize-handle" className="window-resize-handle" type="button" aria-label="调整窗口大小" title="调整窗口大小"></button>
    </>
  )
}
