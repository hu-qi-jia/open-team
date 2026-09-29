// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import type { GroupChat, OpenTeamStore } from '../../../../group/types'
import { createDefaultStore } from '../../../../group/store'
import { createTeamPageState } from '../../../appState'
import { ChatList } from './ChatList'
import { AppShellFrame } from '../shell/AppShellFrame'
import { resetSidebarPrefsForTests } from '../../hooks/useSidebarPrefs'
import { SidebarProvider } from '../ui/sidebar'
import { renderWithServices, type RenderWithServicesOptions } from '../../test/TestProviders'

afterEach(() => {
  cleanup()
})

describe('ChatList', () => {
  it('renders chat items with name, summary, time and active state', () => {
    const state = makeState(['chat-1', 'chat-2'], 'chat-1')

    renderChatList({ state })

    // SidebarMenuButton 原语类名自带 data-[active=true]:* 变体串，钩子用 classList 断言
    expect(screen.getByRole('button', { name: '切换到 群聊 chat-1' }).classList.contains('active')).toBe(true)
    expect(screen.getByRole('button', { name: '切换到 群聊 chat-2' }).classList.contains('active')).toBe(false)
    expect(screen.getByRole('button', { name: '切换到 群聊 chat-1' }).getAttribute('data-active')).toBe('true')
    expect(screen.getByText('群聊 chat-1')).toBeTruthy()
    expect(document.querySelector('#chat-list .summary-line')?.textContent).toContain('暂无消息')
  })

  it('renders items as SidebarMenu/SidebarMenuButton with isActive wiring', () => {
    renderChatList({ state: makeState(['chat-1', 'chat-2'], 'chat-1') })

    // §4.2 词汇锁定：ul[data-sidebar=menu] > li > button[data-sidebar=menu-button]
    expect(document.querySelector('[data-sidebar="menu"]')).not.toBeNull()
    const buttons = [...document.querySelectorAll('[data-sidebar="menu-button"]')]
    expect(buttons).toHaveLength(2)
    expect(buttons[0]!.getAttribute('data-active')).toBe('true')
    expect(buttons[0]!.classList.contains('active')).toBe(true)
    expect(buttons[1]!.getAttribute('data-active')).toBe('false')
    // 选中视觉走 isActive（data-active → bg-sidebar-accent，与 --accent 同值）
    expect(buttons[0]!.className).toContain('data-[active=true]:bg-sidebar-accent')
  })

  it('shows the empty state when there are no chats', () => {
    renderChatList({})

    expect(screen.getByText('还没有群聊')).toBeTruthy()
    expect(screen.getByText('在上方创建一个群聊，然后从人员库添加人员。')).toBeTruthy()
  })

  it('switches chats through services.switchChat on click and keyboard', async () => {
    const user = userEvent.setup()
    const { services } = renderChatList({ state: makeState(['chat-1', 'chat-2'], 'chat-1') })

    await user.click(screen.getByRole('button', { name: '切换到 群聊 chat-2' }))

    expect(services.switchChat).toHaveBeenCalledWith('chat-2')

    // SidebarMenuButton 是原生 button：聚焦后 Enter 原生触发切群
    screen.getByRole('button', { name: '切换到 群聊 chat-1' }).focus()
    await user.keyboard('{Enter}')

    expect(services.switchChat).toHaveBeenCalledWith('chat-1')
  })

  it('renames a chat via the prompt and GROUP_CHAT_UPDATE', async () => {
    const user = userEvent.setup()
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('  新名字  ')
    const { services } = renderChatList({ state: makeState(['chat-1'], 'chat-1') })

    await openChatMenu(user, '群聊 chat-1')
    await user.click(screen.getByRole('menuitem', { name: '编辑名称' }))

    expect(prompt).toHaveBeenCalled()
    expect(vi.mocked(services.runCommand)).toHaveBeenCalledWith('GROUP_CHAT_UPDATE', { chatId: 'chat-1', patch: { name: '新名字' } })
    prompt.mockRestore()
  })

  it('duplicates a chat through GROUP_CHAT_DUPLICATE', async () => {
    const user = userEvent.setup()
    const { services } = renderChatList({ state: makeState(['chat-1'], 'chat-1') })

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

    renderChatList({ state: makeState(['chat-1'], 'chat-1') })

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
    const { services } = renderChatList({
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
    const { services } = renderChatList({ state: makeState(['chat-1'], 'chat-1') })

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
    const { services } = renderChatList({ state: makeState(['chat-1'], 'chat-1') })

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

// SidebarMenuButton 无条件消费 useSidebar()，裸 <ChatList/> 渲染需套 SidebarProvider
function renderChatList(options: RenderWithServicesOptions = {}) {
  return renderWithServices(
    <SidebarProvider><ChatList /></SidebarProvider>,
    options,
  )
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

function makeState(order: string[], selectedChatId: string, names?: string[]) {
  const state = createTeamPageState()
  const store: OpenTeamStore = createDefaultStore()
  store.chatOrder = order
  store.chatsById = Object.fromEntries(order.map((id, index) => [id, makeChat(id, names?.[index])]))
  state.store = store
  state.selectedChatId = selectedChatId
  return state
}

function makeChat(id: string, name = `群聊 ${id}`): GroupChat {
  return {
    id,
    name,
    mode: 'collaborative',
    roleIds: [],
    messageIds: [],
    nextMessageSeq: 1,
    status: 'ready',
    createdAt: 1,
    updatedAt: 1,
  }
}

/*
 * S2 Task 7（§4.2 精修）：搜索框受控过滤 + 图标条档 Avatar-only 形态。
 * 搜索框在侧栏组合（AppShellFrame）里，因此这两个用例照 AppShellFrame.test
 * 的装配方式挂 #app[data-app-size] 后渲染整壳；档位默认开合由
 * useSidebarPrefs 单例决定，用例前重置防串态。
 */
describe('ChatList sidebar search', () => {
  beforeEach(() => {
    resetSidebarPrefsForTests()
    document.body.innerHTML = '<div id="app" class="app-shell" data-app-size="wide"></div>'
  })

  afterEach(() => {
    cleanup()
    document.body.innerHTML = ''
  })

  it('search input filters the visible chat list', async () => {
    const user = userEvent.setup()
    renderWithServices(<AppShellFrame>workspace</AppShellFrame>, {
      state: makeState(['chat-1', 'chat-2'], 'chat-1', ['设计组', 'Dev']),
    })

    const search = screen.getByRole('textbox', { name: '搜索群聊' })
    await user.type(search, '设计')

    expect(screen.getByRole('button', { name: '切换到 设计组' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '切换到 Dev' })).toBeNull()

    // 清空搜索恢复全量（过滤是受控纯派生，不入持久化）
    await user.clear(search)
    expect(screen.getByRole('button', { name: '切换到 设计组' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '切换到 Dev' })).toBeTruthy()
  })

  it('falls back to a no-match hint instead of the no-chats empty state', async () => {
    const user = userEvent.setup()
    renderWithServices(<AppShellFrame>workspace</AppShellFrame>, {
      state: makeState(['chat-1'], 'chat-1', ['设计组']),
    })

    await user.type(screen.getByRole('textbox', { name: '搜索群聊' }), '不存在')

    expect(screen.getByText('没有匹配的群聊')).toBeTruthy()
    expect(screen.queryByText('还没有群聊')).toBeNull()
  })
})

describe('ChatList icon-strip form (medium tier)', () => {
  beforeEach(() => {
    resetSidebarPrefsForTests()
    document.body.innerHTML = '<div id="app" class="app-shell" data-app-size="medium"></div>'
  })

  afterEach(() => {
    cleanup()
    document.body.innerHTML = ''
  })

  it('icon-mode items show avatar-only with tooltip and keep the overflow menu reachable', () => {
    renderWithServices(<AppShellFrame>workspace</AppShellFrame>, {
      state: makeState(['chat-1'], 'chat-1', ['设计组']),
    })

    // medium 档默认收起 → 侧栏确实进入图标条形态（变体类的生效前提）
    expect(document.querySelector('[data-collapsible="icon"]')).not.toBeNull()

    // 群名文本容器在图标条档隐藏（视觉只剩居中 Avatar）
    const title = document.querySelector('.chat-item-title')
    expect(title?.className).toContain('group-data-[collapsible=icon]:hidden')
    const summary = document.querySelector('.summary-line')
    expect(summary?.className).toContain('group-data-[collapsible=icon]:hidden')
    expect(document.querySelector('.chat-time')?.className).toContain('group-data-[collapsible=icon]:hidden')

    // 群名经触发元素 aria-label 与 Avatar tooltip（title）可达
    const item = screen.getByRole('button', { name: '切换到 设计组' })
    expect(item.getAttribute('aria-label')).toContain('设计组')
    expect(item.querySelector('.chat-avatar')?.getAttribute('title')).toBe('设计组')

    // 溢出动作菜单（重命名/导出/删除…）在图标条档仍可达
    expect(screen.getByRole('button', { name: '打开 设计组 的群聊菜单' })).toBeTruthy()
  })
})

describe('ChatList legacy.css retirement', () => {
  it('retires the .chat-list/.chat-item families from legacy.css', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/teamPage/ui/styles/legacy.css'), 'utf8')
    const cssWithoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')

    for (const retired of [
      '.chat-list',
      '.chat-item',
      '.chat-item-title',
      '.chat-item-body',
      '.chat-item-side',
      '.chat-time {',
      '.summary-line {',
      '.chat-name {',
      '.chat-name:hover',
    ]) {
      expect(cssWithoutComments, `expected ${retired} to be retired`).not.toContain(retired)
    }

    // S7/T5：共享规则本身也随通用族退役——.role-row/.role-name/.template-actions
    // 的 flex 行与截断四件套由各消费点的 utilities 承担（类名留在 TSX 上作钩子）。
    expect(cssWithoutComments).not.toContain('.role-row')
    expect(cssWithoutComments).not.toContain('.role-name')
    expect(cssWithoutComments).not.toContain('.template-actions')
    // 承接方：RolePanel 的 .role-row/.role-name 行与 PersonTemplateModal 的
    // .template-actions 都已写成行内 utilities。
    const rolePanel = readFileSync(resolve(process.cwd(), 'src/teamPage/ui/components/panel/RolePanel.tsx'), 'utf8')
    expect(rolePanel).toContain('role-row flex min-w-0 items-center justify-between gap-2')
    expect(rolePanel).toContain('role-name mention-shortcut min-w-0 flex-1 cursor-pointer truncate')
    const personTemplate = readFileSync(resolve(process.cwd(), 'src/teamPage/ui/components/people/PersonTemplateModal.tsx'), 'utf8')
    expect(personTemplate).toContain('template-actions flex items-center justify-between gap-2.5')

    // S3 Task 4：浅色 role-tone 平涂随动态色板一并归位到 globals components 层
    expect(cssWithoutComments).not.toContain('.chat-avatar.role-tone-0')
    const globals = readFileSync(resolve(process.cwd(), 'src/teamPage/ui/styles/globals.css'), 'utf8')
    expect(globals).toContain('.chat-avatar.role-tone-0')
  })
})
