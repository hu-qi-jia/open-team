import { Toaster } from '@/teamPage/ui/components/ui/sonner'
import { AppShellFrame } from './components/shell/AppShellFrame'
import { ChatHeader } from './components/chat/ChatHeader'
import { Messages } from './components/chat/Messages'
import { Composer } from './components/composer/Composer'
import { ExternalModelsModal } from './components/models/ExternalModelsModal'
import { AllNotesModal } from './components/notes/AllNotesModal'
import { NotesPanel } from './components/notes/NotesPanel'
import { OrchestrationModal } from './components/orchestration/OrchestrationModal'
import { AddPersonModal } from './components/people/AddPersonModal'
import { BuiltinTemplateDetailModal } from './components/people/BuiltinTemplateDetailModal'
import { PeopleLibraryModal } from './components/people/PeopleLibraryModal'
import { PersonTemplateModal } from './components/people/PersonTemplateModal'
import { TemporaryPersonModal } from './components/people/TemporaryPersonModal'
import { FloatingWindowChrome } from './components/shell/FloatingWindowChrome'
import { GroupTemplateModal } from './components/shell/GroupTemplateModal'
import { IframeLayer } from './components/shell/IframeLayer'
import { LanguageSync } from './components/shell/LanguageSync'

/*
 * 壳层全量接管（S1 起 AppShell v2：统一侧栏三态 + workspace 插槽）。
 * 原始 body 的子级顺序在此逐一复刻：
 *   #app → #notes-panel → 隐藏位（template-summary/list、window-launcher）
 *   → 弹窗群 → #iframe-host
 * 关键约束：
 * - #app 与 #notes-panel 相邻是骨架测试锁定的 DOM 契约（legacy 的
 *   `.app-shell.minimized + .notes-panel` 隐藏规则已由 React chrome 态
 *   守卫接替，Task 8 闭环）——#root 以 display:contents 让本组件的子元素
 *   直接参与 body 布局，fragment 顺序即 DOM 顺序。
 * - `.app-shell` 自带 transform 定位，modals / notes / iframe-host 必须留在
 *   #app 之外（transform 会创建包含块，fixed 后代会被劫持）。
 * - #app 内部：FloatingWindowChrome（vanilla floatingWindow 直写的铬件，
 *   React 侧保持静态）+ AppShellFrame（SidebarProvider 受控三态统一侧栏、
 *   自绘拖宽手柄、workspace 插槽）；data-app-size 为 floatingWindow 派生
 *   写入前的档位初值（useAppSizeTier 消费）。
 * - 弹窗群已全部 React 化（notes 面板与全部笔记弹窗由 <NotesPanel/> /
 *   <AllNotesModal/> 接管；人员库 5 弹窗由 people/ 下组件接管，外部模型
 *   弹窗由 <ExternalModelsModal/> 接管，编排三弹窗由 <OrchestrationModal/>
 *   接管，群模板弹窗由 <GroupTemplateModal/> 接管）。
 * - workspace 内的 ChatHeader / Messages / Composer 是真组件
 *   （P2a / P2b / P2c 落地，ChatHeader 已升级为档位收纳的 v2）。
 */
export function App() {
  return (
    <>
      <div id="app" className="app-shell" data-app-size="wide">
        <FloatingWindowChrome />
        <AppShellFrame>
          <ChatHeader />
          <Messages />
          <Composer />
        </AppShellFrame>
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
