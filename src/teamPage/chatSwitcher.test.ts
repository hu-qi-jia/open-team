// @vitest-environment jsdom

import { waitFor } from '@testing-library/dom'
import { describe, expect, it, vi } from 'vitest'
import { createTeamPageState } from './appState'
import { createChatSwitcher } from './chatSwitcher'
import { bindAppState, getAppStateVersion } from './ui/lib/appStore'

/*
 * 切群编排（原 chatListView.switchChat 行为；列表/抽屉/笔记视图均已是
 * React 组件，随 notifyAppState 自行重渲）：立即落本地选中态，
 * rAF 去抖后发 GROUP_CHAT_SWITCH，并以 notifyAppState 回流 React。
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
        runCommand: vi.fn(async () => undefined),
        showError: vi.fn(),
      },
      versionBefore: getAppStateVersion(),
    }
  }

  it('switches the local selection, notifies React and sends GROUP_CHAT_SWITCH on the next frame', async () => {
    const { state, deps, versionBefore } = setup()
    const switcher = createChatSwitcher(deps)

    switcher.switchChat('chat-2')

    expect(state.selectedChatId).toBe('chat-2')
    expect(state.selectedRoleId).toBeUndefined()
    expect(state.selectedReference).toBeUndefined()
    expect(state.peopleDrawerOpen).toBe(false)
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

  it('only re-notifies without sending a command when switching to the current chat', () => {
    const { deps } = setup()
    const switcher = createChatSwitcher(deps)

    switcher.switchChat('chat-1')

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
