// @vitest-environment jsdom

import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import type { GroupChat, GroupMessage, GroupRole } from '../../../../group/types'
import { createTeamPageState } from '../../../appState'
import { ChatHeader } from './ChatHeader'
import type { TeamPageServices } from '../../context/ServicesContext'
import { createFakeServices, renderWithServices } from '../../test/TestProviders'
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

  it('toggles the people drawer through appState and tracks it in aria-expanded', async () => {
    const user = userEvent.setup()
    const { state } = renderWithServices(<ChatHeader />, { state: makeState('collaborative') })

    const drawerToggle = document.querySelector<HTMLButtonElement>('#toggle-people-drawer')!
    expect(drawerToggle.textContent).toBe('成员 0')
    expect(drawerToggle.disabled).toBe(false)
    expect(drawerToggle.getAttribute('aria-expanded')).toBe('false')

    await user.click(drawerToggle)

    expect(state.peopleDrawerOpen).toBe(true)
    await waitFor(() => {
      expect(drawerToggle.getAttribute('aria-expanded')).toBe('true')
      expect(drawerToggle.getAttribute('aria-label')).toBe('收起成员面板')
    })

    await user.click(drawerToggle)

    expect(state.peopleDrawerOpen).toBe(false)
    await waitFor(() => expect(drawerToggle.getAttribute('aria-expanded')).toBe('false'))
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

  it('keeps the theme-switch static block mounted for themeController (restore moved out)', () => {
    renderWithServices(<ChatHeader />, { state: makeState('collaborative') })

    expect(document.querySelector('#theme-switch')).toBeTruthy()
    expect(document.querySelector('#theme-light')).toBeTruthy()
    expect(document.querySelector('#theme-dark')).toBeTruthy()
    expect(document.querySelector('#restore-chat')).toBeTruthy()
  })

  it('restores site-role frames and skips recovery for roles with an assigned iframe', async () => {
    const user = userEvent.setup()
    const restoreChat = vi.fn(() => [
      makeFrame('role-1', 'assigned'),
      makeFrame('role-2', 'assigned'),
    ])
    const services = createFakeServices({ iframeHost: { restoreChat } as unknown as TeamPageServices['iframeHost'] })
    const { state } = renderWithServices(<ChatHeader />, { services, state: makeStateWithRoles() })

    await user.click(document.querySelector<HTMLButtonElement>('#restore-chat')!)

    expect(restoreChat).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'chat-1', roleIds: ['role-1', 'role-2'] }),
      [state.store.rolesById['role-1'], state.store.rolesById['role-2']],
    )
    expect(vi.mocked(services.log.info)).toHaveBeenCalledWith('ui:restore-chat', { chatId: 'chat-1', roleIds: ['role-1', 'role-2'] })
    expect(vi.mocked(services.runCommand)).not.toHaveBeenCalledWith('GROUP_ROLE_RECOVER', expect.anything())
  })

  it('sends GROUP_ROLE_RECOVER for roles whose iframe did not come back assigned', async () => {
    const user = userEvent.setup()
    const restoreChat = vi.fn(() => [
      makeFrame('role-1', 'assigned'),
      makeFrame('role-2', 'recovering'),
    ])
    const services = createFakeServices({ iframeHost: { restoreChat } as unknown as TeamPageServices['iframeHost'] })
    renderWithServices(<ChatHeader />, { services, state: makeStateWithRoles() })

    await user.click(document.querySelector<HTMLButtonElement>('#restore-chat')!)

    await waitFor(() => expect(vi.mocked(services.runCommand)).toHaveBeenCalledWith('GROUP_ROLE_RECOVER', { chatId: 'chat-1', roleId: 'role-2' }))
  })

  it('keeps restore-chat inert without a selected chat', async () => {
    const user = userEvent.setup()
    const restoreChat = vi.fn(() => [])
    const services = createFakeServices({ iframeHost: { restoreChat } as unknown as TeamPageServices['iframeHost'] })
    renderWithServices(<ChatHeader />, { services })

    await user.click(document.querySelector<HTMLButtonElement>('#restore-chat')!)

    expect(restoreChat).not.toHaveBeenCalled()
    expect(vi.mocked(services.runCommand)).not.toHaveBeenCalled()
  })

  it('toggles the notes panel through appState and tracks it in aria-expanded', async () => {
    const user = userEvent.setup()
    const { state } = renderWithServices(<ChatHeader />, { state: makeState('collaborative') })

    const notesToggle = document.querySelector<HTMLButtonElement>('#toggle-notes-panel')!
    expect(notesToggle.getAttribute('aria-expanded')).toBe('false')
    expect(notesToggle.getAttribute('aria-controls')).toBe('notes-panel')

    await user.click(notesToggle)

    expect(state.notesPanelOpen).toBe(true)
    expect(state.activeNoteScope).toBe('chat')
    await waitFor(() => expect(notesToggle.getAttribute('aria-expanded')).toBe('true'))

    await user.click(notesToggle)

    expect(state.notesPanelOpen).toBe(false)
    await waitFor(() => expect(notesToggle.getAttribute('aria-expanded')).toBe('false'))
  })

  it('does not reset the note scope when opening with no chat selected', async () => {
    const user = userEvent.setup()
    const state = createTeamPageState()
    state.activeNoteScope = 'global'

    renderWithServices(<ChatHeader />, { state })

    await user.click(document.querySelector<HTMLButtonElement>('#toggle-notes-panel')!)

    expect(state.notesPanelOpen).toBe(true)
    expect(state.activeNoteScope).toBe('global')
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

function makeStateWithRoles() {
  const state = makeState('collaborative')
  state.store.rolesById['role-1'] = makeRole()
  state.store.rolesById['role-2'] = { ...makeRole(), id: 'role-2', name: 'Reviewer' }
  state.store.chatsById['chat-1'].roleIds = ['role-1', 'role-2']
  return state
}

function makeFrame(roleId: string, status: 'assigned' | 'recovering') {
  return {
    chatId: 'chat-1',
    roleId,
    src: 'https://gemini.google.com/',
    active: true,
    status,
    assignmentAttempts: 1,
  }
}

function makeMessage(): GroupMessage {
  return { id: 'msg-1', chatId: 'chat-1', seq: 1, type: 'user', content: 'Hello', createdAt: 1, status: 'received' }
}
