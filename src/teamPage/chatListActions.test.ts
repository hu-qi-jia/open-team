// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import type { GroupChat, GroupRole, OpenTeamStore } from '../group/types'
import { createDefaultStore } from '../group/store'
import { createTeamPageState } from './appState'
import { createChatListActions } from './chatListActions'
import type { RuntimeResponse } from './runtimeClient'

/*
 * 群聊菜单的破坏性操作（原 chatListView 内 clear/delete 逻辑原样迁移）。
 * loadStore / saveStore 仅在「删除命令不被 background 识别」的本地回退中用到。
 */
vi.mock('../group/store', async importOriginal => {
  const actual = await importOriginal<typeof import('../group/store')>()
  return {
    ...actual,
    loadStore: vi.fn(),
    saveStore: vi.fn(),
  }
})

describe('createChatListActions', () => {
  it('clears messages: resets the node cache and recreates frames for the selected chat', async () => {
    const harness = setup({ selectedChatId: 'chat-1', selected: true })

    await harness.actions.clearChatMessages('chat-1')

    expect(harness.deps.runCommand).toHaveBeenCalledWith('GROUP_CHAT_CLEAR_MESSAGES', { chatId: 'chat-1' })
    expect(harness.state.messageNodeCache.size).toBe(0)
    expect(harness.removeChat).toHaveBeenCalledWith('chat-1')
    expect(harness.restoreChat).toHaveBeenCalledWith(
      { ...harness.chat, roleIds: ['role-site'] },
      [harness.siteRole],
    )
  })

  it('clearing a non-selected chat does not recreate frames', async () => {
    const harness = setup({ selectedChatId: 'other' })

    await harness.actions.clearChatMessages('chat-1')

    expect(harness.restoreChat).not.toHaveBeenCalled()
  })

  it('deletes a chat via runtime message, drops frames and applies the returned store', async () => {
    const harness = setup({})
    const nextStore = createDefaultStore()
    vi.mocked(harness.deps.sendRuntimeMessage).mockImplementation(async () => ({ ok: true, store: nextStore }))

    await harness.actions.deleteChat('chat-1')

    expect(harness.deps.sendRuntimeMessage).toHaveBeenCalledWith('GROUP_CHAT_DELETE', { chatId: 'chat-1' })
    expect(harness.removeChat).toHaveBeenCalledWith('chat-1')
    expect(harness.deps.applyStore).toHaveBeenCalledWith(nextStore)
  })

  it('falls back to the local store when the background does not know the delete message', async () => {
    const { loadStore, saveStore } = await import('../group/store')
    const harness = setup({})
    vi.mocked(harness.deps.sendRuntimeMessage).mockImplementation(async () => ({ ok: false, error: 'Unknown OpenTeam message' }))
    const localStore = createDefaultStore()
    localStore.chatOrder = ['chat-1']
    localStore.chatsById = { 'chat-1': harness.chat }
    localStore.rolesById = { 'role-site': harness.siteRole }
    vi.mocked(loadStore).mockResolvedValue(localStore)

    await harness.actions.deleteChat('chat-1')

    expect(loadStore).toHaveBeenCalled()
    expect(saveStore).toHaveBeenCalledWith(expect.objectContaining({ chatOrder: [] }))
    expect(localStore.rolesById).toEqual({})
    expect(harness.removeChat).toHaveBeenCalledWith('chat-1')
    expect(harness.deps.applyStore).toHaveBeenCalledWith(localStore)
  })

  it('rethrows unknown delete failures', async () => {
    const harness = setup({})
    vi.mocked(harness.deps.sendRuntimeMessage).mockImplementation(async () => ({ ok: false, error: '存储已锁定' }))

    await expect(harness.actions.deleteChat('chat-1')).rejects.toThrow('存储已锁定')
    expect(harness.removeChat).not.toHaveBeenCalled()
  })
})

function setup(options: { selectedChatId?: string; selected?: boolean }) {
  const state = createTeamPageState()
  const chat: GroupChat = {
    id: 'chat-1',
    name: '群聊',
    mode: 'collaborative',
    roleIds: ['role-site', 'role-external'],
    messageIds: [],
    nextMessageSeq: 1,
    status: 'ready',
    createdAt: 1,
    updatedAt: 1,
  }
  const siteRole: GroupRole = { id: 'role-site', chatId: 'chat-1', name: '站内', status: 'ready', contextCursor: 0, createdAt: 1, updatedAt: 1 }
  const externalRole: GroupRole = { id: 'role-external', chatId: 'chat-1', name: '外部', status: 'ready', contextCursor: 0, createdAt: 1, updatedAt: 1, modelSource: 'external' }
  const store: OpenTeamStore = createDefaultStore()
  store.chatOrder = ['chat-1']
  store.chatsById = { 'chat-1': chat }
  store.rolesById = { 'role-site': siteRole, 'role-external': externalRole }
  state.store = store
  if (options.selectedChatId) state.selectedChatId = options.selectedChatId
  state.messageNodeCache.set('msg-1', { signature: 'sig', node: document.createElement('div') })

  const removeChat = vi.fn()
  const restoreChat = vi.fn(() => [])
  const deps = {
    state,
    getStore: () => store,
    applyStore: vi.fn(),
    iframeHost: { removeChat, restoreChat },
    runCommand: vi.fn(async () => undefined),
    // 显式宽返回类型：deleteChat 用例会把 mock 换成带 store / error 的变体
    sendRuntimeMessage: vi.fn(async (): Promise<RuntimeResponse<never>> => ({ ok: true })),
    log: { warn: vi.fn() },
    showError: vi.fn(),
  }
  const actions = createChatListActions(deps)
  return { state, chat, siteRole, externalRole, deps, actions, removeChat, restoreChat }
}
