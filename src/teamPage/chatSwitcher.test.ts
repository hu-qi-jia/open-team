// @vitest-environment jsdom

import { waitFor } from '@testing-library/dom'
import { describe, expect, it, vi } from 'vitest'
import { createTeamPageState } from './appState'
import { createChatSwitcher } from './chatSwitcher'
import { bindAppState, getAppStateVersion } from './ui/lib/appStore'

/*
 * 切群编排（原 chatListView.switchChat 行为，列表渲染部分已 React 化）：
 * 立即落本地选中态 + 重渲 vanilla 视图，rAF 去抖后发 GROUP_CHAT_SWITCH，
 * 并以 notifyAppState 回流 React。
 */
describe('createChatSwitcher', () => {
  function setup() {
    const state = createTeamPageState()
    state.selectedChatId = 'chat-1'
    bindAppState(state)
    return {
      state,
      deps: {
        state,
        renderSelectedChat: vi.fn(),
        renderRolePanel: vi.fn(),
        runCommand: vi.fn(async () => undefined),
        showError: vi.fn(),
      },
      versionBefore: getAppStateVersion(),
    }
  }

  it('switches the local selection, re-renders vanilla views and sends GROUP_CHAT_SWITCH on the next frame', async () => {
    const { state, deps, versionBefore } = setup()
    const switcher = createChatSwitcher(deps)

    switcher.switchChat('chat-2')

    expect(state.selectedChatId).toBe('chat-2')
    expect(state.selectedRoleId).toBeUndefined()
    expect(state.selectedReference).toBeUndefined()
    expect(state.peopleDrawerOpen).toBe(false)
    expect(deps.renderSelectedChat).toHaveBeenCalledTimes(1)
    expect(deps.runCommand).not.toHaveBeenCalled()

    await waitFor(() => expect(deps.runCommand).toHaveBeenCalledWith('GROUP_CHAT_SWITCH', { chatId: 'chat-2' }))
    expect(getAppStateVersion()).toBeGreaterThan(versionBefore)
  })

  it('cancels the pending switch command when the user switches again before the frame fires', async () => {
    const { deps } = setup()
    const switcher = createChatSwitcher(deps)

    switcher.switchChat('chat-2')
    switcher.switchChat('chat-3')

    await waitFor(() => expect(deps.runCommand).toHaveBeenCalledTimes(1))
    expect(deps.runCommand).toHaveBeenCalledWith('GROUP_CHAT_SWITCH', { chatId: 'chat-3' })
  })

  it('only closes open menus and re-renders the role panel when switching to the current chat', () => {
    const { state, deps } = setup()
    state.roleSiteMenuRoleId = 'role-1'
    const switcher = createChatSwitcher(deps)

    switcher.switchChat('chat-1')

    expect(state.roleSiteMenuRoleId).toBeUndefined()
    expect(deps.renderRolePanel).toHaveBeenCalledTimes(1)
    expect(deps.renderSelectedChat).not.toHaveBeenCalled()
    expect(deps.runCommand).not.toHaveBeenCalled()
  })

  it('surfaces command failures through showError', async () => {
    const { deps } = setup()
    deps.runCommand = vi.fn(async (): Promise<undefined> => { throw new Error('切换失败') })
    const switcher = createChatSwitcher(deps)

    switcher.switchChat('chat-2')

    await waitFor(() => expect(deps.showError).toHaveBeenCalledWith('切换失败'))
  })
})
