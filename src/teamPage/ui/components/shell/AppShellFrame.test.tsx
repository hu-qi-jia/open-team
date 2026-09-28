// @vitest-environment jsdom

import { cleanup, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GroupChat, OpenTeamStore } from '../../../../group/types'
import { createDefaultStore } from '../../../../group/store'
import { createTeamPageState } from '../../../appState'
import { AppShellFrame } from './AppShellFrame'
import { resetSidebarPrefsForTests } from '../../hooks/useSidebarPrefs'
import { createFakeServices, renderWithServices } from '../../test/TestProviders'

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

/*
 * Rail 退役后，三个入口钮（人员库/全部笔记/添加大模型）迁入侧栏底部
 * 工具行（AppShellFrame ToolButton）。本文件接替 Rail.test.tsx 的契约：
 * 点击必须经 uiBus 发射对应命令（弹窗群据此开启）。
 * useAppSizeTier 在首渲染期就读 #app，注入的壳元素要先于 render 落位。
 */
describe('AppShellFrame footer tool buttons', () => {
  it('emits the people-library, all-notes, and external-models commands on click', () => {
    const services = createFakeServices()
    const emit = vi.spyOn(services.uiBus, 'emit')

    document.body.innerHTML = '<div id="app" class="app-shell" data-app-size="wide"></div>'
    renderWithServices(<AppShellFrame>workspace</AppShellFrame>, { services })

    fireEvent.click(screen.getByRole('button', { name: '人员库' }))
    expect(emit).toHaveBeenCalledWith('open-people-library')
    fireEvent.click(screen.getByRole('button', { name: '全部笔记' }))
    expect(emit).toHaveBeenCalledWith('open-all-notes')
    fireEvent.click(screen.getByRole('button', { name: '添加大模型' }))
    expect(emit).toHaveBeenCalledWith('open-external-models')
  })
})

/*
 * S3 清账（S2 终审挂账：图标条档下搜索过滤词无法清除）：搜索框整行是
 * group-data-[collapsible=icon]:hidden，而 chatQuery 是组件本地 state——
 * 侧栏收起成图标条后过滤词仍在生效，用户看到「群列表少了几条」却无入口清空。
 * 用例走真实交互：wide 档展开态键入过滤词 → SidebarTrigger 收起（图标条
 * 形态）→ 过滤词随形态复位为全量；再展开时搜索框为空串。
 * 档位桩与 prefs 复位照抄本文件既有写法 / ChatList.test.tsx 的搜索用例。
 */
describe('AppShellFrame chat search reset on icon-rail collapse', () => {
  beforeEach(() => {
    resetSidebarPrefsForTests()
    document.body.innerHTML = '<div id="app" class="app-shell" data-app-size="wide"></div>'
  })

  it('clears the chat search query when the sidebar collapses to the icon rail', async () => {
    const user = userEvent.setup()
    renderWithServices(<AppShellFrame>workspace</AppShellFrame>, {
      state: makeState(['设计组', 'Dev']),
    })

    // 1) 键入只匹配部分群聊的词 → 列表被过滤
    const search = screen.getByRole('textbox', { name: '搜索群聊' })
    await user.type(search, '设计')
    expect(screen.getByRole('button', { name: '切换到 设计组' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '切换到 Dev' })).toBeNull()

    // 2) 收起侧栏 → 图标条形态（collapsible=icon 且 open=false，搜索框整行隐藏）
    await user.click(screen.getByRole('button', { name: 'Toggle Sidebar' }))
    expect(document.querySelector('[data-collapsible="icon"]')).not.toBeNull()

    // 3) 过滤词随形态清空：列表恢复全量（图标条档条目仍挂载，逐项可达）
    expect(screen.getByRole('button', { name: '切换到 设计组' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '切换到 Dev' })).toBeTruthy()

    // 4) 再展开：搜索框回到空串（不会带着过期过滤词回场）
    await user.click(screen.getByRole('button', { name: 'Toggle Sidebar' }))
    expect((screen.getByRole('textbox', { name: '搜索群聊' }) as HTMLInputElement).value).toBe('')
  })
})

// 群列表夹具：最小合法 GroupChat（沿用 ChatList.test.tsx 的本地夹具写法）
function makeState(names: string[]) {
  const state = createTeamPageState()
  const store: OpenTeamStore = createDefaultStore()
  store.chatOrder = names.map((_, index) => `chat-${index + 1}`)
  store.chatsById = Object.fromEntries(store.chatOrder.map((id, index) => [id, makeChat(id, names[index]!)]))
  state.store = store
  state.selectedChatId = store.chatOrder[0]!
  return state
}

function makeChat(id: string, name: string): GroupChat {
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
