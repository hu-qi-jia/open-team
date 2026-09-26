import { useT } from '../../hooks/useT'
import { ChatList } from '../chat/ChatList'
import { QuickCreateChatForm, QuickCreateChatProvider, QuickCreateChatTrigger } from './QuickCreateChat'
import { StoreSummary } from './StoreSummary'

/*
 * 群列表侧栏壳：品牌区（StoreSummary 摘要行）+ 快速建群 + ChatList（P2a 起
 * 群列表本体 React 化，含 #chat-list 容器 id）。
 */
export function Sidebar() {
  const t = useT()
  return (
    <QuickCreateChatProvider>
      <aside className="panel sidebar">
        <div className="panel-header">
          <div className="brand-mark">
            <div className="logo-dot" aria-hidden="true"></div>
            <div className="sidebar-brand-copy">
              <div className="sidebar-brand-line">
                <h1>OpenTeam</h1>
                <span className="sidebar-section-label">{t('群聊')}</span>
              </div>
              <StoreSummary />
            </div>
          </div>
          <div className="sidebar-header-actions">
            <QuickCreateChatTrigger />
          </div>
        </div>
        <QuickCreateChatForm />
        <ChatList />
      </aside>
    </QuickCreateChatProvider>
  )
}
