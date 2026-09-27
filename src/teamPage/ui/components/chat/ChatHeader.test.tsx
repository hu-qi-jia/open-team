// @vitest-environment jsdom

import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GroupChat, GroupMessage, GroupRole } from '../../../../group/types'
import { createTeamPageState } from '../../../appState'
import { ChatHeader } from './ChatHeader'
import type { TeamPageServices } from '../../context/ServicesContext'
import { createFakeServices, renderWithServices } from '../../test/TestProviders'
import { notifyAppState } from '../../lib/appStore'

/*
 * ChatHeader v2（S1 壳层）：状态渲染为 Badge（outline + data-status）、
 * 工具钮全部图标化（Tooltip 提供无障碍名）、主题分段控件退役、
 * compact/medium 档把恢复会话/编排/免@（compact 另含笔记）收纳进
 * 「更多操作」菜单、compact 档新增唤出侧栏钮。
 * useAppSizeTier 在效果阶段对 #app[data-app-size] 挂 MutationObserver，
 * 故每个用例先摆一枚 #app（未摆时初始档位默认 wide）。
 * 注：useSidebarPrefs 是模块级共享 store——涉及 userOpen 的用例放最后，
 * 且以二次点击翻回初值，避免跨用例污染。
 */

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

describe('ChatHeader', () => {
  it('协作模式（默认 wide 档）渲染全套图标钮，且主题分段控件已退役', () => {
    document.body.innerHTML = '<div id="app" data-app-size="wide"></div>'
    renderWithServices(<ChatHeader />, { state: makeState('collaborative') })

    expect(document.getElementById('restore-chat')).not.toBeNull()
    expect(document.getElementById('open-orchestration')).not.toBeNull()
    expect(document.getElementById('toggle-people-drawer')).not.toBeNull()
    expect(document.getElementById('toggle-notes-panel')).not.toBeNull()
    expect(document.getElementById('theme-switch')).toBeNull()
    // 免@ 改为 role="switch"（无障碍名取 mentionRuleHint，故按角色查询、不按名称）
    expect(document.querySelector('[role="switch"]')).not.toBeNull()
    expect(document.querySelector('.lucide-panel-left')).toBeNull() // wide 档无唤出按钮
  })

  it('状态渲染为 Badge（outline），携带 data-status', () => {
    document.body.innerHTML = '<div id="app" data-app-size="wide"></div>'
    renderWithServices(<ChatHeader />, { state: makeState('collaborative') })

    const badge = document.querySelector('header [data-status][data-slot="badge"]')
    expect(badge).not.toBeNull()
    expect(badge?.getAttribute('data-status')).toBe('ready')
    expect(badge?.textContent).toBe('进行中')
  })

  it('compact 档：工具钮收纳，仅剩成员 + 更多 + 唤出侧栏按钮', () => {
    document.body.innerHTML = '<div id="app" data-app-size="compact"></div>'
    renderWithServices(<ChatHeader />, { state: makeState('collaborative') })

    expect(document.getElementById('restore-chat')).toBeNull()
    expect(document.getElementById('toggle-notes-panel')).toBeNull()
    expect(document.getElementById('open-orchestration')).toBeNull()
    expect(document.getElementById('toggle-people-drawer')).not.toBeNull()
    expect(document.querySelector('.lucide-panel-left')).not.toBeNull()
    expect(document.querySelector('[role="switch"]')).toBeNull()
  })

  it('medium 档：恢复/编排/免@ 收纳进菜单，笔记保留，无唤出按钮', () => {
    document.body.innerHTML = '<div id="app" data-app-size="medium"></div>'
    renderWithServices(<ChatHeader />, { state: makeState('collaborative') })

    expect(document.getElementById('restore-chat')).toBeNull()
    expect(document.getElementById('open-orchestration')).toBeNull()
    expect(document.querySelector('[role="switch"]')).toBeNull()
    expect(document.getElementById('toggle-notes-panel')).not.toBeNull()
    expect(document.querySelector('.lucide-panel-left')).toBeNull()
  })

  it('编排与免@仅在协作模式渲染，恢复会话不随模式收起', async () => {
    document.body.innerHTML = '<div id="app" data-app-size="wide"></div>'
    const { state } = renderWithServices(<ChatHeader />, { state: makeState('collaborative') })

    expect(document.getElementById('open-orchestration')).not.toBeNull()
    expect(document.querySelector('[role="switch"]')).not.toBeNull()

    state.store.chatsById['chat-1'].mode = 'independent'
    notifyAppState()

    // notifyAppState 经 queueMicrotask 合并通知，等 React 提交新属性
    await waitFor(() => expect(document.getElementById('open-orchestration')).toBeNull())
    expect(document.querySelector('[role="switch"]')).toBeNull()
    expect(document.getElementById('restore-chat')).not.toBeNull()
  })

  it('编排按钮经 uiBus 发送 open-orchestration', async () => {
    const user = userEvent.setup()
    document.body.innerHTML = '<div id="app" data-app-size="wide"></div>'
    const services = createFakeServices({ uiBus: { emit: vi.fn(), on: vi.fn(() => () => undefined) } as unknown as TeamPageServices['uiBus'] })
    renderWithServices(<ChatHeader />, { services, state: makeState('collaborative') })

    await user.click(document.querySelector<HTMLButtonElement>('#open-orchestration')!)

    expect(vi.mocked(services.uiBus.emit)).toHaveBeenCalledWith('open-orchestration')
  })

  it('renders status Badge and member counts in English mode', () => {
    document.body.innerHTML = '<div id="app" data-app-size="wide"></div>'
    const state = makeState('collaborative', 'en')
    state.store.rolesById['role-1'] = makeRole()
    state.store.chatsById['chat-1'].roleIds = ['role-1']
    state.store.messagesById['msg-1'] = makeMessage()
    state.store.chatsById['chat-1'].messageIds = ['msg-1']

    renderWithServices(<ChatHeader />, { state, language: 'en' })

    expect(document.querySelector('header [data-status][data-slot="badge"]')?.textContent).toBe('Active')
    expect(document.querySelector('#chat-subtitle')?.textContent).toBe('Collaborative mode · 1 members · 1 messages')
    expect(document.querySelector('#chat-title')?.textContent).toBe('群聊')
    expect(screen.getByLabelText('Open people panel')).toBeTruthy()
    expect(screen.getByRole('switch').getAttribute('aria-label')).toBe('When on, plain messages ask all members to reply; when off, only @ members or @all trigger replies.')
  })

  it('toggles manual mention routing through GROUP_CHAT_UPDATE', async () => {
    const user = userEvent.setup()
    document.body.innerHTML = '<div id="app" data-app-size="wide"></div>'
    const { services, state } = renderWithServices(<ChatHeader />, { state: makeState('collaborative') })

    const toggle = document.querySelector<HTMLButtonElement>('[role="switch"]')!
    const hint = '开启后，普通消息也会触发所有成员回复；关闭后，只有 @ 成员或 @所有人才触发回复'
    expect(toggle.title).toBe(hint)
    expect(toggle.getAttribute('aria-checked')).toBe('false')

    await user.click(toggle)

    expect(vi.mocked(services.runCommand)).toHaveBeenCalledWith('GROUP_CHAT_UPDATE', { chatId: 'chat-1', requireManualMention: false })

    state.store.chatsById['chat-1'].requireManualMention = false
    notifyAppState()

    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'))
  })

  it('toggles the people drawer through appState and tracks it in aria-expanded', async () => {
    const user = userEvent.setup()
    document.body.innerHTML = '<div id="app" data-app-size="wide"></div>'
    const { state } = renderWithServices(<ChatHeader />, { state: makeState('collaborative') })

    const drawerToggle = document.querySelector<HTMLButtonElement>('#toggle-people-drawer')!
    expect(drawerToggle.disabled).toBe(false)
    expect(drawerToggle.getAttribute('aria-expanded')).toBe('false')
    expect(drawerToggle.getAttribute('aria-label')).toBe('打开成员面板')

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
    document.body.innerHTML = '<div id="app" data-app-size="wide"></div>'
    renderWithServices(<ChatHeader />, {})

    expect(document.querySelector('#chat-title')?.textContent).toBe('未选择群聊')
    expect(document.querySelector('#chat-subtitle')?.textContent).toBe('创建或选择一个群聊开始协作')
    expect(document.querySelector('header [data-slot="badge"]')).toBeNull()
    const drawerToggle = document.querySelector<HTMLButtonElement>('#toggle-people-drawer')!
    expect(drawerToggle.disabled).toBe(true)
    expect(document.getElementById('open-orchestration')).toBeNull()
    expect(document.getElementById('restore-chat')).not.toBeNull()
  })

  it('restores site-role frames and skips recovery for roles with an assigned iframe', async () => {
    const user = userEvent.setup()
    document.body.innerHTML = '<div id="app" data-app-size="wide"></div>'
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
    document.body.innerHTML = '<div id="app" data-app-size="wide"></div>'
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
    document.body.innerHTML = '<div id="app" data-app-size="wide"></div>'
    const restoreChat = vi.fn(() => [])
    const services = createFakeServices({ iframeHost: { restoreChat } as unknown as TeamPageServices['iframeHost'] })
    renderWithServices(<ChatHeader />, { services })

    await user.click(document.querySelector<HTMLButtonElement>('#restore-chat')!)

    expect(restoreChat).not.toHaveBeenCalled()
    expect(vi.mocked(services.runCommand)).not.toHaveBeenCalled()
  })

  it('toggles the notes panel through appState and tracks it in aria-expanded', async () => {
    const user = userEvent.setup()
    document.body.innerHTML = '<div id="app" data-app-size="wide"></div>'
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
    document.body.innerHTML = '<div id="app" data-app-size="wide"></div>'
    const state = createTeamPageState()
    state.activeNoteScope = 'global'

    renderWithServices(<ChatHeader />, { state })

    await user.click(document.querySelector<HTMLButtonElement>('#toggle-notes-panel')!)

    expect(state.notesPanelOpen).toBe(true)
    expect(state.activeNoteScope).toBe('global')
  })

  it('compact 档：收纳项改从更多菜单触发（恢复会话）', async () => {
    const user = userEvent.setup()
    document.body.innerHTML = '<div id="app" data-app-size="compact"></div>'
    const restoreChat = vi.fn(() => [])
    const services = createFakeServices({ iframeHost: { restoreChat } as unknown as TeamPageServices['iframeHost'] })
    renderWithServices(<ChatHeader />, { services, state: makeStateWithRoles() })

    await user.click(screen.getByRole('button', { name: '更多操作' }))
    await user.click(screen.getByRole('menuitem', { name: '恢复会话' }))

    expect(restoreChat).toHaveBeenCalledWith(expect.objectContaining({ id: 'chat-1' }), expect.anything())
  })

  it('compact 档唤出按钮翻转侧栏偏好（末位执行，二次点击翻回以免污染模块级 store）', async () => {
    const user = userEvent.setup()
    document.body.innerHTML = '<div id="app" data-app-size="compact"></div>'
    renderWithServices(<ChatHeader />, { state: makeState('collaborative') })

    const sidebarToggle = document.querySelector<HTMLButtonElement>('[aria-label="打开侧栏"]')!
    expect(sidebarToggle.getAttribute('aria-expanded')).toBe('false')

    await user.click(sidebarToggle)

    await waitFor(() => {
      expect(sidebarToggle.getAttribute('aria-expanded')).toBe('true')
      expect(sidebarToggle.getAttribute('aria-label')).toBe('收起侧栏')
    })

    await user.click(sidebarToggle)

    await waitFor(() => {
      expect(sidebarToggle.getAttribute('aria-expanded')).toBe('false')
      expect(sidebarToggle.getAttribute('aria-label')).toBe('打开侧栏')
    })
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
