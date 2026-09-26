// @vitest-environment jsdom

import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import type { GroupChat, GroupMessage, GroupRole } from '../../../../group/types'
import { createTeamPageState } from '../../../appState'
import { ChatHeader } from './ChatHeader'
import { renderWithServices } from '../../test/TestProviders'
import { notifyAppState } from '../../lib/appStore'

afterEach(() => {
  cleanup()
})

describe('ChatHeader', () => {
  it('only shows orchestration and the manual-mention switch for collaborative chats', async () => {
    const { state } = renderWithServices(<ChatHeader />, { state: makeState('collaborative') })

    expect(document.querySelector<HTMLButtonElement>('#open-orchestration')?.hidden).toBe(false)
    expect(document.querySelector<HTMLButtonElement>('.manual-mention-toggle')?.hidden).toBe(false)

    state.store.chatsById['chat-1'].mode = 'independent'
    notifyAppState()

    // notifyAppState 经 queueMicrotask 合并通知，等 React 提交新属性
    await waitFor(() => expect(document.querySelector<HTMLButtonElement>('#open-orchestration')?.hidden).toBe(true))
    expect(document.querySelector<HTMLButtonElement>('.manual-mention-toggle')?.hidden).toBe(true)
  })

  it('renders chat status and member counts in English mode', () => {
    const state = makeState('collaborative', 'en')
    state.store.rolesById['role-1'] = makeRole()
    state.store.chatsById['chat-1'].roleIds = ['role-1']
    state.store.messagesById['msg-1'] = makeMessage()
    state.store.chatsById['chat-1'].messageIds = ['msg-1']

    renderWithServices(<ChatHeader />, { state, language: 'en' })

    expect(document.querySelector('#chat-status')?.textContent).toBe('Active')
    expect(document.querySelector('#chat-subtitle')?.textContent).toBe('Collaborative mode · 1 members · 1 messages')
    expect(screen.getByText('Members 1')).toBeTruthy()
    expect(document.querySelector('#chat-title')?.textContent).toBe('群聊')
  })

  it('toggles manual mention routing through GROUP_CHAT_UPDATE', async () => {
    const user = userEvent.setup()
    const { services, state } = renderWithServices(<ChatHeader />, { state: makeState('collaborative') })

    const toggle = document.querySelector<HTMLButtonElement>('.manual-mention-toggle')!
    expect(toggle.textContent).toBe('免@')
    expect(toggle.title).toBe('开启后，普通消息也会触发所有成员回复；关闭后，只有 @ 成员或 @所有人才触发回复')
    expect(toggle.getAttribute('aria-pressed')).toBe('false')

    await user.click(toggle)

    expect(vi.mocked(services.runCommand)).toHaveBeenCalledWith('GROUP_CHAT_UPDATE', { chatId: 'chat-1', requireManualMention: false })

    state.store.chatsById['chat-1'].requireManualMention = false
    notifyAppState()

    await waitFor(() => expect(toggle.getAttribute('aria-pressed')).toBe('true'))
  })

  it('reflects the vanilla-driven people drawer state through aria-expanded', async () => {
    const { state } = renderWithServices(<ChatHeader />, { state: makeState('collaborative') })

    const drawerToggle = document.querySelector<HTMLButtonElement>('#toggle-people-drawer')!
    expect(drawerToggle.textContent).toBe('成员 0')
    expect(drawerToggle.disabled).toBe(false)
    expect(drawerToggle.getAttribute('aria-expanded')).toBe('false')

    // teamUiController 的 vanilla 点击处理翻 peopleDrawerOpen 后调 render() → notifyAppState
    state.peopleDrawerOpen = true
    notifyAppState()

    await waitFor(() => {
      expect(drawerToggle.getAttribute('aria-expanded')).toBe('true')
      expect(drawerToggle.getAttribute('aria-label')).toBe('收起成员面板')
    })
  })

  it('renders the empty state when no chat is selected', () => {
    renderWithServices(<ChatHeader />, {})

    expect(document.querySelector('#chat-title')?.textContent).toBe('未选择群聊')
    expect(document.querySelector('#chat-subtitle')?.textContent).toBe('创建或选择一个群聊开始协作')
    expect(document.querySelector('#chat-status')?.textContent).toBe('空')
    expect(screen.getByText('成员 0')).toBeTruthy()
    const drawerToggle = document.querySelector<HTMLButtonElement>('#toggle-people-drawer')!
    expect(drawerToggle.disabled).toBe(true)
    expect(document.querySelector<HTMLButtonElement>('#open-orchestration')?.hidden).toBe(true)
  })

  it('keeps the vanilla-bound static controls mounted (theme switch, notes toggle, restore)', () => {
    renderWithServices(<ChatHeader />, { state: makeState('collaborative') })

    expect(document.querySelector('#theme-switch')).toBeTruthy()
    expect(document.querySelector('#theme-light')).toBeTruthy()
    expect(document.querySelector('#theme-dark')).toBeTruthy()
    expect(document.querySelector('#toggle-notes-panel')).toBeTruthy()
    expect(document.querySelector('#restore-chat')).toBeTruthy()
  })
})

function makeState(mode: GroupChat['mode'], language: 'en' | 'zh-CN' = 'zh-CN') {
  const state = createTeamPageState()
  state.store.settings.language = language
  state.store.chatOrder = ['chat-1']
  state.store.chatsById = { 'chat-1': makeChat(mode) }
  state.selectedChatId = 'chat-1'
  return state
}

function makeChat(mode: 'collaborative' | 'independent'): GroupChat {
  return {
    id: 'chat-1',
    name: '群聊',
    mode,
    roleIds: [],
    messageIds: [],
    nextMessageSeq: 1,
    status: 'ready',
    createdAt: 1,
    updatedAt: 1,
  }
}

function makeRole(): GroupRole {
  return { id: 'role-1', chatId: 'chat-1', name: 'Engineer', status: 'ready', contextCursor: 0, createdAt: 1, updatedAt: 1 }
}

function makeMessage(): GroupMessage {
  return { id: 'msg-1', chatId: 'chat-1', seq: 1, type: 'user', content: 'Hello', createdAt: 1, status: 'received' }
}
