import { useT } from '../../hooks/useT'
import { ChatList } from '../chat/ChatList'
import { QuickCreateChatForm, QuickCreateChatProvider, QuickCreateChatTrigger } from './QuickCreateChat'
import { StoreSummary } from './StoreSummary'

/*
 * 群列表侧栏壳（V2 起 shadcnblocks 视觉：品牌块 = bg-primary 方标 +
 * 标题/摘要双行，参照 application-shell1 免费块的 SidebarLogo 模式）。
 * 品牌区（StoreSummary 摘要行）+ 快速建群 + ChatList（P2a 起群列表本体
 * React 化，含 #chat-list 容器 id）。`.panel.sidebar` / `.panel-header`
 * 类保留为布局钩子，视觉由工具类驱动（utilities 层压过 legacy）。
 */
export function Sidebar() {
  const t = useT()
  return (
    <QuickCreateChatProvider>
      <aside className="panel sidebar flex min-h-0 flex-col border-r border-border bg-sidebar">
        <div className="panel-header flex items-start justify-between gap-2 px-3 pb-2 pt-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground" aria-hidden="true">
              O
            </div>
            <div className="min-w-0 leading-tight">
              <div className="flex items-baseline gap-1.5">
                <h1 className="truncate text-sm font-semibold tracking-tight">OpenTeam</h1>
                <span className="sidebar-section-label text-xs text-muted-foreground">{t('群聊')}</span>
              </div>
              <StoreSummary />
            </div>
          </div>
          <div className="sidebar-header-actions shrink-0 pt-0.5">
            <QuickCreateChatTrigger />
          </div>
        </div>
        <QuickCreateChatForm />
        <ChatList />
      </aside>
    </QuickCreateChatProvider>
  )
}
