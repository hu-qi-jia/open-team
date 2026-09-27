import { memo } from 'react'
import type { GroupChat, GroupRole, RoomMode } from '../../../../group/types'
import { normalizeLanguage, translateUi } from '../../../../shared/i18n'
import type { TeamPageState } from '../../../appState'
import { useServices } from '../../context/ServicesContext'
import { useStoreSelector } from '../../hooks/useStoreSelector'
import { getAppState, notifyAppState } from '../../lib/appStore'
import { showError } from '../../lib/toast'

/*
 * 聊天头（原 chatHeaderView 整体 React 化）。区域分两种：
 * - 响应区：标题 / 副标题 / 状态 / 免@ / 恢复会话 / 成员抽屉开关 / 笔记
 *   开关 / 编排显隐——全部由 selector 驱动、React 自持事件（P4d 起
 *   成员抽屉开关与恢复会话从 teamUiController 收编：前者翻转
 *   appState.peopleDrawerOpen，后者走 services.iframeHost.restoreChat +
 *   GROUP_ROLE_RECOVER，与原 controller 逐行同义）。笔记开关（P3 起）
 *   直接翻转 appState.notesPanelOpen，aria-expanded 与 <NotesPanel/> 同源。
 * - 静态控制区（memo-true）：主题切换——themeController 在启动时对它绑
 *   事件并写属性（aria-pressed），React 永不重渲染这一块，避免覆写。
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
  const notesPanelOpen = useStoreSelector(state => state.notesPanelOpen)

  const manualMentionOn = requireManualMention === false
  const mentionRuleHint = ui('开启后，普通消息也会触发所有成员回复；关闭后，只有 @ 成员或 @所有人才触发回复')

  function toggleManualMention(): void {
    if (!chatId) return
    services.runCommand('GROUP_CHAT_UPDATE', { chatId, requireManualMention: manualMentionOn ? true : false })
      .catch(error => showError(error instanceof Error ? error.message : String(error)))
  }

  function toggleNotesPanel(): void {
    const state = getAppState()
    // 有群聊时打开面板回默认 chat 范围（原 notesView.selectDefaultOpenScope）
    if (!state.notesPanelOpen && state.selectedChatId && state.store.chatsById[state.selectedChatId]) state.activeNoteScope = 'chat'
    state.notesPanelOpen = !state.notesPanelOpen
    notifyAppState()
  }

  function togglePeopleDrawer(): void {
    const state = getAppState()
    state.peopleDrawerOpen = !state.peopleDrawerOpen
    notifyAppState()
  }

  // 原teamUiController #restore-chat：重摆全部站点人员 iframe，未分配到
  // 窗口的走 GROUP_ROLE_RECOVER 补救（API 成员不参与）
  function restoreChat(): void {
    const state = getAppState()
    const chat = state.selectedChatId ? state.store.chatsById[state.selectedChatId] : undefined
    if (!chat) return
    const roles = chat.roleIds
      .map(roleId => state.store.rolesById[roleId])
      .filter((role): role is GroupRole => Boolean(role) && role.modelSource !== 'external')
    services.log.info('ui:restore-chat', { chatId: chat.id, roleIds: roles.map(role => role.id) })
    const restoredFrames = services.iframeHost.restoreChat({ ...chat, roleIds: roles.map(role => role.id) }, roles)
    const assignedRoleIds = new Set(restoredFrames.filter(frame => frame.status === 'assigned').map(frame => frame.roleId))
    const rolesToRecover = roles.filter(role => !assignedRoleIds.has(role.id))
    Promise.all(rolesToRecover.map(role => services.runCommand('GROUP_ROLE_RECOVER', { chatId: chat.id, roleId: role.id })))
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

        <button
          id="restore-chat"
          className="btn"
          type="button"
          onClick={restoreChat}
        >{ui('恢复会话')}</button>

        <button
          id="open-orchestration"
          className="btn drawer-summary"
          type="button"
          hidden={chatMode !== 'collaborative'}
          onClick={() => services.uiBus.emit('open-orchestration')}
        >
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
          onClick={togglePeopleDrawer}
        >{ui(`成员 ${roleCount}`)}</button>

        <button
          id="toggle-notes-panel"
          className="btn drawer-summary"
          type="button"
          aria-expanded={notesPanelOpen}
          aria-controls="notes-panel"
          onClick={toggleNotesPanel}
        >{ui('笔记')}</button>

        <span id="chat-status" className={chatStatus !== undefined ? `status-pill status-${chatStatus}` : 'status-pill'}>
          {chatStatus !== undefined ? ui(chatStatusLabel(chatStatus)) : ui('空')}
        </span>
      </div>
    </header>
  )
}

/*
 * 主题切换：id 与原 team.html 一致，themeController 按 id 绑事件并写
 * 属性（aria-pressed），memo(..., () => true) 保证 React 重渲永不触碰
 * 这块 DOM。恢复会话已移出（P4d 起由上方响应区渲染并自持事件）。
 */
const HeaderStaticControls = memo(function HeaderStaticControls() {
  return (
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
