import { Toaster } from '@/teamPage/ui/components/ui/sonner'
import { ChatHeader } from './components/chat/ChatHeader'
import { FloatingWindowChrome } from './components/shell/FloatingWindowChrome'
import { IframeLayer } from './components/shell/IframeLayer'
import { LanguageSync } from './components/shell/LanguageSync'
import { Rail } from './components/shell/Rail'
import { LegacySlot } from './components/shell/LegacySlot'
import {
  COMPOSER_INNER_HTML,
  MODALS_INNER_HTML,
  NOTES_PANEL_INNER_HTML,
  ROLE_PANEL_INNER_HTML,
} from './components/shell/legacyMarkup'
import { Sidebar } from './components/shell/Sidebar'

/*
 * 壳层全量接管（P1 起，P2a 工作区头部落地）。原始 body 的子级顺序在此逐一复刻：
 *   #app → #notes-panel → 隐藏位（template-summary/list、window-launcher）
 *   → 弹窗群 → #iframe-host → #error
 * 关键约束：
 * - `.app-shell.minimized + .notes-panel`（legacy.css）要求 #app 与
 *   #notes-panel 相邻——#root 以 display:contents 让本组件的子元素直接
 *   参与 body 布局，fragment 顺序即 DOM 顺序。
 * - `.app-shell` 自带 transform 定位，modals / notes / iframe-host 必须留在
 *   #app 之外（transform 会创建包含块，fixed 后代会被劫持）。
 * - LegacySlot 区域（#messages / #composer / role-panel / notes 内部 / 弹窗群）
 *   尚未 React 化，由 vanilla 视图按 id 写入，slot 永不重渲。
 * - workspace 内的 ChatHeader 是真组件；#messages 保持空容器由 messagesView
 *   填充；#composer 保留原静态骨架（composerView P2c 前仍绑定其中 id）。
 */
export function App() {
  return (
    <>
      <div id="app" className="app-shell">
        <FloatingWindowChrome />
        <Rail />
        <Sidebar />
        <main className="panel workspace">
          <ChatHeader />
          <LegacySlot as="section" id="messages" className="messages" aria-live="polite" html="" />
          {/* composer 的静态骨架（#target-preview 等）P2c 迁移前仍由 composerView 绑定，不能空 */}
          <LegacySlot as="form" id="composer" className="composer" html={COMPOSER_INNER_HTML} />
        </main>
        <LegacySlot as="aside" className="panel role-panel" html={ROLE_PANEL_INNER_HTML} />
      </div>

      <LegacySlot
        as="aside"
        id="notes-panel"
        className="panel notes-panel"
        aria-label="笔记面板"
        html={NOTES_PANEL_INNER_HTML}
      />

      <span id="template-summary" hidden></span>
      <div id="template-list" hidden></div>
      <button id="window-launcher" className="launcher" type="button" aria-label="打开 OpenTeam" hidden>⌁</button>

      <LegacySlot html={MODALS_INNER_HTML} />

      <IframeLayer />
      <div id="error" className="toast" hidden></div>

      <LanguageSync />
      <Toaster position="top-center" />
    </>
  )
}
