import { Toaster } from '@/teamPage/ui/components/ui/sonner'
import { ChatHeader } from './components/chat/ChatHeader'
import { Messages } from './components/chat/Messages'
import { Composer } from './components/composer/Composer'
import { ExternalModelsModal } from './components/models/ExternalModelsModal'
import { AllNotesModal } from './components/notes/AllNotesModal'
import { NotesPanel } from './components/notes/NotesPanel'
import { OrchestrationModal } from './components/orchestration/OrchestrationModal'
import { RolePanel } from './components/panel/RolePanel'
import { AddPersonModal } from './components/people/AddPersonModal'
import { BuiltinTemplateDetailModal } from './components/people/BuiltinTemplateDetailModal'
import { PeopleLibraryModal } from './components/people/PeopleLibraryModal'
import { PersonTemplateModal } from './components/people/PersonTemplateModal'
import { TemporaryPersonModal } from './components/people/TemporaryPersonModal'
import { FloatingWindowChrome } from './components/shell/FloatingWindowChrome'
import { GroupTemplateModal } from './components/shell/GroupTemplateModal'
import { IframeLayer } from './components/shell/IframeLayer'
import { LanguageSync } from './components/shell/LanguageSync'
import { Rail } from './components/shell/Rail'
import { Sidebar } from './components/shell/Sidebar'

/*
 * 壳层全量接管（P1 起，P2a 工作区头部落地）。原始 body 的子级顺序在此逐一复刻：
 *   #app → #notes-panel → 隐藏位（template-summary/list、window-launcher）
 *   → 弹窗群 → #iframe-host
 * 关键约束：
 * - `.app-shell.minimized + .notes-panel`（legacy.css）要求 #app 与
 *   #notes-panel 相邻——#root 以 display:contents 让本组件的子元素直接
 *   参与 body 布局，fragment 顺序即 DOM 顺序。
 * - `.app-shell` 自带 transform 定位，modals / notes / iframe-host 必须留在
 *   #app 之外（transform 会创建包含块，fixed 后代会被劫持）。
 * - 弹窗群已全部 React 化（role-panel 已于 P3 由 <RolePanel/>、notes 面板
 *   与全部笔记弹窗由 <NotesPanel/> / <AllNotesModal/> 接管；人员库 5 弹窗
 *   已于 P4a 由 people/ 下组件接管，外部模型弹窗已于 P4b 由
 *   <ExternalModelsModal/> 接管，编排三弹窗已于 P4c 由 <OrchestrationModal/>
 *   接管，群模板弹窗已于 P4d 由 <GroupTemplateModal/> 接管）。
 * - workspace 内的 ChatHeader / Messages / Composer 与 aside RolePanel 是
 *   真组件（P2a / P2b / P2c / P3 落地）。
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
          <Messages />
          <Composer />
        </main>
        <RolePanel />
      </div>

      <NotesPanel />

      <span id="template-summary" hidden></span>
      <div id="template-list" hidden></div>
      <button id="window-launcher" className="launcher" type="button" aria-label="打开 OpenTeam" hidden>⌁</button>

      <AllNotesModal />
      <PeopleLibraryModal />
      <PersonTemplateModal />
      <BuiltinTemplateDetailModal />
      <AddPersonModal />
      <TemporaryPersonModal />
      <ExternalModelsModal />
      <OrchestrationModal />
      <GroupTemplateModal />

      <IframeLayer />

      <LanguageSync />
      <Toaster position="top-center" />
    </>
  )
}
