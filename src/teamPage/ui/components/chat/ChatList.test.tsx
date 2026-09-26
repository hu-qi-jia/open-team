// @vitest-environment jsdom

import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import type { GroupChat, OpenTeamStore } from '../../../../group/types'
import { createDefaultStore } from '../../../../group/store'
import { createTeamPageState } from '../../../appState'
import { ChatList } from './ChatList'
import { renderWithServices, type RenderWithServicesOptions } from '../../test/TestProviders'

afterEach(() => {
  cleanup()
})

describe('ChatList', () => {
  it('renders chat items with name, summary, time and active state', () => {
    const state = makeState(['chat-1', 'chat-2'], 'chat-1')

    renderWithServices(<ChatList />, { state })

    expect(screen.getByRole('button', { name: '切换到 群聊 chat-1' }).className).toContain('active')
    expect(screen.getByRole('button', { name: '切换到 群聊 chat-2' }).className).not.toContain('active')
    expect(screen.getByText('群聊 chat-1')).toBeTruthy()
    expect(document.querySelector('#chat-list .summary-line')?.textContent).toContain('暂无消息')
  })

  it('shows the empty state when there are no chats', () => {
    renderWithServices(<ChatList />, {})

    expect(screen.getByText('还没有群聊')).toBeTruthy()
    expect(screen.getByText('在上方创建一个群聊，然后从人员库添加人员。')).toBeTruthy()
  })

  it('switches chats through services.switchChat on click and keyboard', async () => {
    const user = userEvent.setup()
    const { services } = renderWithServices(<ChatList />, { state: makeState(['chat-1', 'chat-2'], 'chat-1') })

    await user.click(screen.getByRole('button', { name: '切换到 群聊 chat-2' }))

    expect(services.switchChat).toHaveBeenCalledWith('chat-2')
  })

  it('renames a chat via the prompt and GROUP_CHAT_UPDATE', async () => {
    const user = userEvent.setup()
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('  新名字  ')
    const { services } = renderWithServices(<ChatList />, { state: makeState(['chat-1'], 'chat-1') })

    await openChatMenu(user, '群聊 chat-1')
    await user.click(screen.getByRole('menuitem', { name: '编辑名称' }))

    expect(prompt).toHaveBeenCalled()
    expect(vi.mocked(services.runCommand)).toHaveBeenCalledWith('GROUP_CHAT_UPDATE', { chatId: 'chat-1', patch: { name: '新名字' } })
    prompt.mockRestore()
  })

  it('duplicates a chat through GROUP_CHAT_DUPLICATE', async () => {
    const user = userEvent.setup()
    const { services } = renderWithServices(<ChatList />, { state: makeState(['chat-1'], 'chat-1') })

    await openChatMenu(user, '群聊 chat-1')
    await user.click(screen.getByRole('menuitem', { name: '复制群聊' }))

    expect(vi.mocked(services.runCommand)).toHaveBeenCalledWith('GROUP_CHAT_DUPLICATE', { chatId: 'chat-1' })
  })

  it('exports a chat record as a markdown download', async () => {
    const user = userEvent.setup()
    const revokeObjectURL = vi.fn()
    const createObjectURL = vi.fn(() => 'blob:chat-export')
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }))
    // 导出的 <a> 与原实现一样是 detached 元素（不 append），querySelector 拿不到，这里在工厂处捕获
    const anchors: HTMLAnchorElement[] = []
    const originalCreateElement = document.createElement.bind(document)
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
      const el = originalCreateElement(tagName, options)
      if (tagName === 'a') anchors.push(el as HTMLAnchorElement)
      return el
    }) as typeof document.createElement)
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    renderWithServices(<ChatList />, { state: makeState(['chat-1'], 'chat-1') })

    await openChatMenu(user, '群聊 chat-1')
    await user.click(screen.getByRole('menuitem', { name: '导出记录' }))

    expect(createObjectURL).toHaveBeenCalled()
    expect(anchors).toHaveLength(1)
    expect(anchors[0].href).toBe('blob:chat-export')
    // safeChatExportFilename 会把空格规整为连字符
    expect(anchors[0].download).toContain('群聊-chat-1')
    expect(clickSpy).toHaveBeenCalled()
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:chat-export'))
    createElementSpy.mockRestore()
    clickSpy.mockRestore()
    vi.unstubAllGlobals()
  })

  it('closes chat frames without confirmation, then drops the host frames', async () => {
    const user = userEvent.setup()
    const iframeHost = { removeChat: vi.fn(), restoreChat: vi.fn() }
    const { services } = renderWithServices(<ChatList />, {
      state: makeState(['chat-1'], 'chat-1'),
      services: makeServices({ iframeHost }),
    })

    await openChatMenu(user, '群聊 chat-1')
    await user.click(screen.getByRole('menuitem', { name: '关闭群聊' }))

    expect(vi.mocked(services.runCommand)).toHaveBeenCalledWith('GROUP_CHAT_CLOSE', { chatId: 'chat-1' })
    await waitFor(() => expect(iframeHost.removeChat).toHaveBeenCalledWith('chat-1'))
  })

  it('clears messages only after the AlertDialog confirmation', async () => {
    const user = userEvent.setup()
    const { services } = renderWithServices(<ChatList />, { state: makeState(['chat-1'], 'chat-1') })

    await openChatMenu(user, '群聊 chat-1')
    await user.click(screen.getByRole('menuitem', { name: '清空消息' }))

    const dialog = screen.getByRole('alertdialog')
    expect(dialog.textContent).toContain('确定清空「群聊 chat-1」的聊天消息吗？')
    expect(services.chatOperations.clearMessages).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(services.chatOperations.clearMessages).not.toHaveBeenCalled()

    await openChatMenu(user, '群聊 chat-1')
    await user.click(screen.getByRole('menuitem', { name: '清空消息' }))
    await user.click(screen.getByRole('button', { name: '清空消息' }))

    expect(services.chatOperations.clearMessages).toHaveBeenCalledWith('chat-1')
  })

  it('deletes a chat only after the AlertDialog confirmation', async () => {
    const user = userEvent.setup()
    const { services } = renderWithServices(<ChatList />, { state: makeState(['chat-1'], 'chat-1') })

    await openChatMenu(user, '群聊 chat-1')
    await user.click(screen.getByRole('menuitem', { name: '删除群聊' }))

    const dialog = screen.getByRole('alertdialog')
    expect(dialog.textContent).toContain('确定删除「群聊 chat-1」吗？')

    await user.click(screen.getByRole('button', { name: '删除群聊' }))

    expect(services.chatOperations.deleteChat).toHaveBeenCalledWith('chat-1')
  })
})

async function openChatMenu(user: ReturnType<typeof userEvent.setup>, chatName: string): Promise<void> {
  await user.click(screen.getByRole('button', { name: `打开 ${chatName} 的群聊菜单` }))
}

function makeServices(overrides: Record<string, unknown>) {
  return {
    iframeHost: overrides.iframeHost,
    switchChat: vi.fn(),
    chatOperations: {
      clearMessages: vi.fn(async () => undefined),
      deleteChat: vi.fn(async () => undefined),
    },
    runCommand: vi.fn(async () => undefined),
  } as unknown as NonNullable<RenderWithServicesOptions['services']>
}

function makeState(order: string[], selectedChatId: string) {
  const state = createTeamPageState()
  const store: OpenTeamStore = createDefaultStore()
  store.chatOrder = order
  store.chatsById = Object.fromEntries(order.map(id => [id, makeChat(id)]))
  state.store = store
  state.selectedChatId = selectedChatId
  return state
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
