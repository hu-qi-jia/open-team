import { useT } from '../../hooks/useT'
import { QuickCreateChatForm, QuickCreateChatProvider, QuickCreateChatTrigger } from './QuickCreateChat'
import { StoreSummary } from './StoreSummary'

/*
 * 群列表侧栏壳：品牌区（StoreSummary 摘要行）+ 快速建群 + #chat-list。
 * #chat-list 仍是 vanilla chatListView 的输出容器（P2a React 化），
 * id/class 与 domRefs 契约一致。
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
        <div id="chat-list" className="chat-list"></div>
      </aside>
    </QuickCreateChatProvider>
  )
}
