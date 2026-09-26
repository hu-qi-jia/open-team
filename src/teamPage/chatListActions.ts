import { createDefaultStore, loadStore, saveStore } from '../group/store'
import type { GroupChat, GroupRole, OpenTeamStore } from '../group/types'
import type { RuntimeResponse } from './runtimeClient'
import type { TeamPageState } from './appState'

interface ChatActionsIframeHost {
  removeChat(chatId: string): void
  restoreChat(chat: GroupChat, roles: GroupRole[]): void
}

export interface ChatListActionsDependencies {
  state: TeamPageState
  getStore(): OpenTeamStore
  applyStore(store: OpenTeamStore): void
  iframeHost: ChatActionsIframeHost
  runCommand(type: string, payload?: Record<string, unknown>): Promise<void>
  sendRuntimeMessage<T = unknown>(type: string, payload?: Record<string, unknown>): Promise<RuntimeResponse<T>>
  log: {
    warn(event: string, details?: Record<string, unknown>): void
  }
  showError(message: string): void
}

export interface ChatListActions {
  clearChatMessages(chatId: string): Promise<void>
  deleteChat(chatId: string): Promise<void>
}

/*
 * 群聊菜单的破坏性操作（自 chatListView 原样迁入）：清空与删除需要触碰
 * messageNodeCache / iframeHost / applyStore / 本地存储回退，这些都在
 * vanilla 侧，React 经 services.chatOperations 调用。
 */
export function createChatListActions(deps: ChatListActionsDependencies): ChatListActions {
  async function clearChatMessages(chatId: string): Promise<void> {
    await deps.runCommand('GROUP_CHAT_CLEAR_MESSAGES', { chatId })
    deps.state.messageNodeCache.clear()
    deps.iframeHost.removeChat(chatId)
    const store = deps.getStore()
    const chat = store.chatsById[chatId]
    if (chat && deps.state.selectedChatId === chatId) {
      const roles = chat.roleIds.map(roleId => store.rolesById[roleId]).filter((role): role is GroupRole => Boolean(role) && role.modelSource !== 'external')
      deps.iframeHost.restoreChat({ ...chat, roleIds: roles.map(role => role.id) }, roles)
    }
  }

  async function deleteChat(chatId: string): Promise<void> {
    const response = await deps.sendRuntimeMessage('GROUP_CHAT_DELETE', { chatId })
    if (response.ok === false) {
      if (response.error === 'Unknown OpenTeam message') {
        deps.log.warn('chat-delete:fallback-local-store', { chatId, error: response.error })
        await deleteChatFromLocalStore(chatId)
        return
      }
      throw new Error(response.error || '删除群聊失败')
    }
    deps.iframeHost.removeChat(chatId)
    deps.applyStore(response.store ?? createDefaultStore())
  }

  async function deleteChatFromLocalStore(chatId: string): Promise<void> {
    const nextStore = await loadStore()
    const chat = nextStore.chatsById[chatId]
    if (!chat) throw new Error(`找不到群聊：${chatId}`)

    for (const roleId of chat.roleIds) delete nextStore.rolesById[roleId]
    for (const messageId of chat.messageIds) delete nextStore.messagesById[messageId]
    nextStore.chatOrder = nextStore.chatOrder.filter(id => id !== chat.id)
    delete nextStore.chatsById[chat.id]
    if (nextStore.currentChatId === chat.id) nextStore.currentChatId = nextStore.chatOrder[0]
    if (nextStore.viewState?.chatReadSeqById) delete nextStore.viewState.chatReadSeqById[chat.id]
    if (nextStore.viewState?.chatHasNewMessageById) delete nextStore.viewState.chatHasNewMessageById[chat.id]

    await saveStore(nextStore)
    deps.iframeHost.removeChat(chatId)
    deps.applyStore(nextStore)
  }

  return { clearChatMessages, deleteChat }
}
