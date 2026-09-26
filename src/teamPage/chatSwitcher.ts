import type { TeamPageState } from './appState'
import { notifyAppState } from './ui/lib/appStore'

export interface ChatSwitcherDependencies {
  state: TeamPageState
  renderSelectedChat(): void
  renderRolePanel(): void
  runCommand(type: string, payload?: Record<string, unknown>): Promise<void>
  showError(message: string): void
}

export interface ChatSwitcher {
  switchChat(chatId: string): void
}

/*
 * 切群编排（自 chatListView.switchChat 原样迁入，去掉列表渲染部分）：
 * 立即切换本地选中态并重渲 vanilla 视图，rAF 去抖后才发 GROUP_CHAT_SWITCH
 * （快速连点只发最后一次）；命令回包经 background 推送 → applyStore →
 * syncIframeHost 完成 iframe 跟随。React 的 ChatList 经 services.switchChat
 * 调到这里。
 */
export function createChatSwitcher(deps: ChatSwitcherDependencies): ChatSwitcher {
  function switchChat(chatId: string): void {
    if (chatId === deps.state.selectedChatId) {
      deps.state.roleSiteMenuRoleId = undefined
      deps.renderRolePanel()
      notifyAppState()
      return
    }
    deps.state.selectedChatId = chatId
    deps.state.selectedRoleId = undefined
    deps.state.selectedReference = undefined
    deps.state.peopleDrawerOpen = false
    deps.state.roleSiteMenuRoleId = undefined
    deps.renderSelectedChat()
    if (deps.state.pendingSwitchAnimationFrame !== undefined) window.cancelAnimationFrame(deps.state.pendingSwitchAnimationFrame)
    deps.state.pendingSwitchAnimationFrame = window.requestAnimationFrame(() => {
      deps.state.pendingSwitchAnimationFrame = undefined
      if (deps.state.selectedChatId !== chatId) return
      deps.runCommand('GROUP_CHAT_SWITCH', { chatId })
        .catch(error => deps.showError(error.message))
    })
    notifyAppState()
  }

  return { switchChat }
}
