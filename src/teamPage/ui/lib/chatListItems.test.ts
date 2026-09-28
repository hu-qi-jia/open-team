import { describe, expect, it } from 'vitest'
import type { GroupChat, GroupMessage, OpenTeamStore } from '../../../group/types'
import { createDefaultStore } from '../../../group/store'
import { createTeamPageState } from '../../appState'
import { deriveChatListItems, filterChatListItems, isChatListItemsEqual, type ChatListItemVM } from './chatListItems'

describe('deriveChatListItems', () => {
  it('flattens the store chat order into primitive view models', () => {
    const state = createTeamPageState()
    state.store = makeStore(['chat-1', 'chat-2'])
    state.selectedChatId = 'chat-2'
    state.store.viewState = {
      ...state.store.viewState,
      chatHasNewMessageById: { 'chat-1': true },
    }

    const items = deriveChatListItems(state)

    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      id: 'chat-1',
      name: '群聊 chat-1',
      active: false,
      hasActivity: true,
    })
    expect(items[0].initial).toBe('群')
    expect(items[0].tone).toMatch(/^role-tone-\d$/)
    expect(items[0].summary).toContain('暂无消息')
    expect(items[1]).toMatchObject({
      id: 'chat-2',
      active: true,
      hasActivity: false,
    })
  })

  it('summarizes the latest message sender and content', () => {
    const state = createTeamPageState()
    state.store = makeStore(['chat-1'])
    const message: GroupMessage = {
      id: 'msg-1',
      chatId: 'chat-1',
      seq: 1,
      type: 'assistant',
      roleName: '分析师',
      content: '结论先行',
      createdAt: 1,
      status: 'received',
    }
    state.store.messagesById['msg-1'] = message
    state.store.chatsById['chat-1'].messageIds = ['msg-1']

    const [item] = deriveChatListItems(state)

    expect(item.summary).toBe('分析师：结论先行')
  })

  it('drops chats missing from the store map', () => {
    const state = createTeamPageState()
    state.store = makeStore(['chat-1'])
    state.store.chatOrder = ['chat-1', 'ghost']

    expect(deriveChatListItems(state).map(item => item.id)).toEqual(['chat-1'])
  })
})

describe('isChatListItemsEqual', () => {
  it('compares items field by field', () => {
    const base = [{ id: 'a', name: 'A', initial: 'A', tone: 'role-tone-1', summary: 's', timeText: '刚刚', active: true, hasActivity: false }]

    expect(isChatListItemsEqual(base, [{ ...base[0] }])).toBe(true)
    expect(isChatListItemsEqual(base, [{ ...base[0], active: false }])).toBe(false)
    expect(isChatListItemsEqual(base, [{ ...base[0], summary: 'changed' }])).toBe(false)
    expect(isChatListItemsEqual(base, [])).toBe(false)
  })
})

describe('filterChatListItems', () => {
  const items = [
    { id: 'a', name: '设计组', initial: '设', tone: 'role-tone-1', summary: 's1', timeText: '刚刚', active: true, hasActivity: false },
    { id: 'b', name: 'Dev', initial: 'D', tone: 'role-tone-2', summary: 's2', timeText: '刚刚', active: false, hasActivity: false },
  ] satisfies ChatListItemVM[]

  it('matches name case-insensitively', () => {
    expect(filterChatListItems([{ id: 'a', name: '设计组' }, { id: 'b', name: 'Dev' }] as ChatListItemVM[], 'dev'))
      .toEqual([{ id: 'b', name: 'Dev' }])
  })

  it('matches Chinese name substrings', () => {
    expect(filterChatListItems(items, '设计').map(item => item.id)).toEqual(['a'])
  })

  it('returns every item for an empty or whitespace-only query', () => {
    expect(filterChatListItems(items, '')).toEqual(items)
    expect(filterChatListItems(items, '   ')).toEqual(items)
  })

  it('returns nothing when no name matches', () => {
    expect(filterChatListItems(items, '不存在的群聊')).toEqual([])
  })
})

function makeStore(order: string[]): OpenTeamStore {
  const store = createDefaultStore()
  store.chatOrder = order
  store.chatsById = Object.fromEntries(order.map(id => [id, makeChat(id)]))
  return store
}

function makeChat(id: string): GroupChat {
  return {
    id,
    name: `群聊 ${id}`,
    mode: 'collaborative',
    roleIds: [],
    messageIds: [],
    nextMessageSeq: 1,
    status: 'ready',
    createdAt: 1,
    updatedAt: 1,
  }
}
