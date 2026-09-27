import type { ChatSite, MessageReference, OpenTeamStore, RoleTemplate } from '../group/types'
import { createDefaultStore } from '../group/store'
import { OPENTEAM_CONTROL_DEFAULT_PORT, type OpenTeamControlConnectionStatus } from '../shared/localControlProtocol'

export type CachedMessageNode = { signature: string; node: HTMLElement; streamingSignature?: string }
export type TemporaryPersonDraft = Pick<RoleTemplate, 'name' | 'description' | 'systemPrompt'> & { id: string; chatSite: ChatSite }

export interface RoleReadyWaiter {
  chatId: string
  roleIds: Set<string>
  resolve: () => void
  reject: (error: Error) => void
  timeoutId: number
  pollTimeoutId?: number
}

// P5 收敛后的共享可变状态：仅保留「跨组件 / 保留 vanilla 模块仍读写」
// 的条目。纯组件内 UI 态（搜索词、分类 tab、分页等）自 P4 起已下沉到
// 各 React 组件的本地 state；selectedTemplateId / previewTemplateId /
// temporaryPersonDrafts / addPersonSiteByKey 是弹窗间的既定传输约定
// （见 ui/lib/uiBus.ts 注释），peopleDrawerOpen 由 chatSwitcher 翻转。
export interface TeamPageState {
  store: OpenTeamStore
  controlStatus: OpenTeamControlConnectionStatus
  selectedChatId?: string
  selectedRoleId?: string
  selectedTemplateId?: string
  selectedReference?: MessageReference
  hostTabId?: number
  peopleDrawerOpen: boolean
  notesPanelOpen: boolean
  activeNoteScope: 'global' | 'chat'
  previewTemplateId?: string
  pendingSwitchAnimationFrame?: number
  messageNodeCache: Map<string, CachedMessageNode>
  preserveNextMessageScroll: boolean
  reconnectingRoleKeys: Set<string>
  roleReadyWaiters: Set<RoleReadyWaiter>
  temporaryPersonDrafts: TemporaryPersonDraft[]
  addPersonSiteByKey: Map<string, Set<string>>
  addPersonSelectedKeys: Set<string>
}

export function createTeamPageState(): TeamPageState {
  return {
    store: createDefaultStore(),
    controlStatus: { state: 'disabled', port: OPENTEAM_CONTROL_DEFAULT_PORT },
    peopleDrawerOpen: false,
    messageNodeCache: new Map<string, CachedMessageNode>(),
    preserveNextMessageScroll: false,
    reconnectingRoleKeys: new Set<string>(),
    roleReadyWaiters: new Set<RoleReadyWaiter>(),
    temporaryPersonDrafts: [],
    addPersonSiteByKey: new Map<string, Set<string>>(),
    addPersonSelectedKeys: new Set<string>(),
    notesPanelOpen: false,
    activeNoteScope: 'chat',
  }
}

export function pickSelectedChatId(state: TeamPageState): string | undefined {
  const store = state.store
  if (store.currentChatId && store.chatsById[store.currentChatId]) return store.currentChatId
  if (state.selectedChatId && store.chatsById[state.selectedChatId]) return state.selectedChatId
  return [...store.chatOrder]
    .sort((left, right) => (store.chatsById[right]?.updatedAt ?? 0) - (store.chatsById[left]?.updatedAt ?? 0))
    .find(chatId => Boolean(store.chatsById[chatId]))
}
