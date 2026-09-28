import type { GroupChat } from '../../../group/types'
import type { TeamPageState } from '../../appState'
import { formatChatListTime } from '../../chatExperience'
import { getChatRecentSummary, roleAvatarLabel, roleToneClass } from '../../viewHelpers'

export interface ChatListItemVM {
  id: string
  name: string
  initial: string
  tone: string
  summary: string
  timeText: string
  active: boolean
  hasActivity: boolean
}

/*
 * ChatList 的 selector 派生函数：把 store 状态压平成纯原始值视图模型，
 * 配 isChatListItemsEqual（逐项浅比较）做 selector 等值判断——store 版本
 * 任意跳变时只有真正影响展示的字段才会触发重渲染（selector 模式样板）。
 */
export function deriveChatListItems(state: TeamPageState): ChatListItemVM[] {
  const store = state.store
  return store.chatOrder
    .map(chatId => store.chatsById[chatId])
    .filter((chat): chat is GroupChat => Boolean(chat))
    .map(chat => ({
      id: chat.id,
      name: chat.name,
      initial: roleAvatarLabel(chat.name),
      tone: roleToneClass(chat.name),
      summary: getChatRecentSummary(chat, store),
      timeText: formatChatListTime(chat.updatedAt),
      active: chat.id === state.selectedChatId,
      hasActivity: chat.id !== state.selectedChatId && Boolean(store.viewState?.chatHasNewMessageById?.[chat.id]),
    }))
}

export function isChatListItemsEqual(left: ChatListItemVM[], right: ChatListItemVM[]): boolean {
  if (left.length !== right.length) return false
  return left.every((item, index) => {
    const other = right[index]
    return item.id === other.id
      && item.name === other.name
      && item.initial === other.initial
      && item.tone === other.tone
      && item.summary === other.summary
      && item.timeText === other.timeText
      && item.active === other.active
      && item.hasActivity === other.hasActivity
  })
}

/*
 * §4.2 搜索框的纯过滤：按群名做大小写不敏感的 substring 匹配，空/空白
 * 查询原样返回全量。查询词是组件本地 UI 态（不入 store/持久化），在
 * ChatList 渲染期对 selector 派生结果调用。
 */
export function filterChatListItems(items: ChatListItemVM[], query: string): ChatListItemVM[] {
  const keyword = query.trim().toLowerCase()
  if (!keyword) return items
  return items.filter(item => item.name.toLowerCase().includes(keyword))
}
