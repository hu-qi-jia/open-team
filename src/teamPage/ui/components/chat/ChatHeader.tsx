import { memo } from 'react'
import type { GroupChat, RoomMode } from '../../../../group/types'
import { normalizeLanguage, translateUi } from '../../../../shared/i18n'
import type { TeamPageState } from '../../../appState'
import { useServices } from '../../context/ServicesContext'
import { useStoreSelector } from '../../hooks/useStoreSelector'
import { showError } from '../../lib/toast'

/*
 * 聊天头（原 chatHeaderView 整体 React 化）。区域分两种：
 * - 响应区：标题 / 副标题 / 状态 / 免@ / 成员抽屉开关 / 编排显隐——
 *   全部由 selector 驱动；成员抽屉的点击仍在 vanilla（teamUiController），
 *   其 render() 会经 notifyAppState 回流到本组件的 aria 状态。
 * - 静态控制区（memo-true）：主题切换 / 笔记开关 / 恢复会话——vanilla
 *   模块在启动时对它们绑事件并写属性（themeController 写 aria-pressed、
 *   notesView 写 aria-expanded），React 永不重渲染这一块，避免覆写。
 * 免@ 为新增 React 事件（原按钮由 chatHeaderView 动态插入）。
 */
export function ChatHeader() {
  const language = useStoreSelector(state => normalizeLanguage(state.store.settings.language))
  const services = useServices()

  const ui = (source: string) => translateUi(source, language)

  const chatName = useStoreSelector(state => currentChatOf(state)?.name)
  const chatMode = useStoreSelector(state => currentChatOf(state)?.mode)
  const chatStatus = useStoreSelector(state => currentChatOf(state)?.status)
  const requireManualMention = useStoreSelector(state => currentChatOf(state)?.requireManualMention)
  const roleCount = useStoreSelector(roleCountOf)
  const messageCount = useStoreSelector(messageCountOf)
  const drawerOpen = useStoreSelector(state => state.peopleDrawerOpen)
  const chatId = useStoreSelector(state => state.selectedChatId)

  const manualMentionOn = requireManualMention === false
  const mentionRuleHint = ui('开启后，普通消息也会触发所有成员回复；关闭后，只有 @ 成员或 @所有人才触发回复')

  function toggleManualMention(): void {
    if (!chatId) return
    services.runCommand('GROUP_CHAT_UPDATE', { chatId, requireManualMention: manualMentionOn ? true : false })
      .catch(error => showError(error instanceof Error ? error.message : String(error)))
  }

  return (
    <header className="chat-header">
      <div className="chat-title-block">
        <h2 id="chat-title" className="chat-title">{chatName !== undefined ? chatName : ui('未选择群聊')}</h2>
        <p id="chat-subtitle" className="chat-subtitle">
          {chatMode !== undefined
            ? (roleCount ? ui(`${modeLabel(chatMode)} · ${roleCount} 位成员 · ${messageCount} 条消息`) : ui('暂无成员'))
            : ui('创建或选择一个群聊开始协作')}
        </p>
      </div>
      <div className="chat-row">
        <HeaderStaticControls />

        <button id="open-orchestration" className="btn drawer-summary" type="button" hidden={chatMode !== 'collaborative'}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
            <path d="M5 7.5h4.5v4H5z" />
            <path d="M14.5 4.5H19v4h-4.5z" />
            <path d="M14.5 15.5H19v4h-4.5z" />
            <path d="M9.5 9.5h2.8c1.2 0 2.2-1 2.2-2.2v-.8" />
            <path d="M9.5 9.5h2.8c1.2 0 2.2 1 2.2 2.2v5.8" />
          </svg>
          <span>{ui('编排')}</span>
        </button>

        <button
          className="btn drawer-summary manual-mention-toggle"
          type="button"
          role="switch"
          title={mentionRuleHint}
          aria-label={mentionRuleHint}
          aria-pressed={manualMentionOn}
          aria-checked={manualMentionOn}
          hidden={chatMode !== 'collaborative'}
          onClick={toggleManualMention}
        >{ui('免@')}</button>

        <button
          id="toggle-people-drawer"
          className="btn drawer-summary"
          type="button"
          disabled={chatMode === undefined}
          aria-label={ui(drawerOpen ? '收起成员面板' : '打开成员面板')}
          aria-expanded={drawerOpen}
        >{ui(`成员 ${roleCount}`)}</button>

        <span id="chat-status" className={chatStatus !== undefined ? `status-pill status-${chatStatus}` : 'status-pill'}>
          {chatStatus !== undefined ? ui(chatStatusLabel(chatStatus)) : ui('空')}
        </span>
      </div>
    </header>
  )
}

/*
 * 主题切换 / 笔记开关 / 恢复会话：id 与原 team.html 一致，vanilla 模块
 * （themeController / notesView / teamUiController）按 id 绑事件并写属性，
 * memo(..., () => true) 保证 React 重渲永不触碰这块 DOM。
 */
const HeaderStaticControls = memo(function HeaderStaticControls() {
  return (
    <>
      <div id="theme-switch" className="theme-switch" role="group" aria-label="界面模式">
        <button id="theme-light" className="theme-option" type="button" aria-pressed="false" title="浅色模式">
          <span aria-hidden="true">☼</span>
          <span>浅色</span>
        </button>
        <button id="theme-dark" className="theme-option" type="button" aria-pressed="true" title="深色模式">
          <span aria-hidden="true">☾</span>
          <span>深色</span>
        </button>
      </div>
      <button id="toggle-notes-panel" className="btn drawer-summary" type="button" aria-expanded="false" aria-controls="notes-panel">笔记</button>
      <button id="restore-chat" className="btn" type="button">恢复会话</button>
    </>
  )
}, () => true)

function currentChatOf(state: TeamPageState): GroupChat | undefined {
  return state.selectedChatId ? state.store.chatsById[state.selectedChatId] : undefined
}

function roleCountOf(state: TeamPageState): number {
  const chat = currentChatOf(state)
  if (!chat) return 0
  return chat.roleIds.filter(roleId => Boolean(state.store.rolesById[roleId])).length
}

function messageCountOf(state: TeamPageState): number {
  const chat = currentChatOf(state)
  if (!chat) return 0
  return chat.messageIds.filter(messageId => Boolean(state.store.messagesById[messageId])).length
}

export function modeLabel(mode: RoomMode): string {
  return mode === 'collaborative' ? '协作群聊模式' : '独立专家模式'
}

export function chatStatusLabel(status: GroupChat['status']): string {
  const labels: Record<GroupChat['status'], string> = {
    draft: '草稿',
    initializing: '初始化中',
    ready: '进行中',
    running: '运行中',
    error: '异常',
  }
  return labels[status]
}
