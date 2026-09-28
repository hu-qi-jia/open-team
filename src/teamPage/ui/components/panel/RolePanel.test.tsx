// @vitest-environment jsdom

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import userEvent from '@testing-library/user-event'
import { act, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultStore } from '../../../../group/store'
import type { GroupChat, GroupRole, OpenTeamStore } from '../../../../group/types'
import { createTeamPageState } from '../../../appState'
import { createFakeServices, renderWithServices } from '../../test/TestProviders'
import type { TeamPageServices } from '../../context/ServicesContext'
import { notifyAppState } from '../../lib/appStore'
import { RolePanel } from './RolePanel'

/*
 * 成员抽屉 RTL（rolePanelView.test.ts 重写）。卡片动作（刷新 / 跳转 /
 * 删除确认 / 提示词详情）、站点菜单切换、健康详情与摘要文案逐条对应；
 * 原挂 body 的 .role-prompt-modal 对译为受控 Dialog；删除确认由
 * window.confirm 升级为 AlertDialog（计划内偏差，同 P2a 群列表）。
 */

vi.mock('../../lib/toast', () => ({ showError: vi.fn(), showSuccess: vi.fn() }))

import { showError } from '../../lib/toast'

describe('team page role panel boundary', () => {
  it('keeps role panel rendering out of the entrypoint and removes the vanilla view module', () => {
    const entrySource = readFileSync(resolve(process.cwd(), 'src/teamPage/index.tsx'), 'utf8')

    expect(entrySource).not.toContain('createRolePanelView')
    expect(entrySource).not.toContain('renderRolePanel')
    expect(existsSync(resolve(process.cwd(), 'src/teamPage/rolePanelView.ts'))).toBe(false)
    expect(existsSync(resolve(process.cwd(), 'src/teamPage/rolePanelView.test.ts'))).toBe(false)
    // P4a 起添加人员表单由 RolePanel 自管（uiBus 'open-add-person'），
    // 人员库视图模块不应再被入口引用
    expect(entrySource).not.toContain('createPeopleLibraryView')
    expect(entrySource).not.toContain('renderAddPersonDialog')
  })
})

describe('team page role panel cards', () => {
  it('renders a refresh action on each member card and rebuilds only that iframe', async () => {
    const iframeHost = { recoverRole: vi.fn() }
    const { services } = renderPanel({ iframeHost })

    const refresh = document.querySelector<HTMLButtonElement>('[data-role-refresh="role-1"]')
    expect(refresh).not.toBeNull()
    expect(refresh?.getAttribute('aria-label')).toBe('刷新 产品经理 的成员窗口')
    expect(document.querySelector('[data-role-list-refresh]')).toBeNull()

    await act(async () => {
      refresh?.click()
    })

    expect(iframeHost.recoverRole).toHaveBeenCalledWith(expect.objectContaining({ id: 'role-1' }))
    await waitFor(() => {
      expect(services.runCommand).toHaveBeenCalledWith('GROUP_ROLE_RECOVER', { chatId: 'chat-1', roleId: 'role-1' })
    })
    expect(showError).not.toHaveBeenCalled()
  })

  it('confirms before removing a member and then sends GROUP_ROLE_DELETE', async () => {
    const user = userEvent.setup()
    const { services } = renderPanel()

    const remove = document.querySelector<HTMLButtonElement>('[data-role-delete="role-1"]')
    expect(remove?.querySelector('svg')).not.toBeNull()
    expect(remove?.getAttribute('aria-label')).toBe('删除 产品经理')
    await user.click(remove!)

    const dialog = await waitFor(() => {
      const element = document.querySelector('[role="alertdialog"]')
      if (!element) throw new Error('confirm dialog not open')
      return element
    })
    expect(dialog.textContent).toContain('确定将「产品经理」移出当前群聊吗？历史聊天记录会保留。')
    expect(services.runCommand).not.toHaveBeenCalled()

    await user.click(withinDialog(dialog, '删除成员'))

    await waitFor(() => expect(services.runCommand).toHaveBeenCalledWith('GROUP_ROLE_DELETE', { roleId: 'role-1' }))
  })

  it('keeps the delete dialog closed after cancelling', async () => {
    const user = userEvent.setup()
    const { services } = renderPanel()

    await user.click(document.querySelector<HTMLButtonElement>('[data-role-delete="role-1"]')!)
    await waitFor(() => expect(document.querySelector('[role="alertdialog"]')).not.toBeNull())

    await user.click(withinDialog(document.querySelector('[role="alertdialog"]')!, '取消'))

    await waitFor(() => expect(document.querySelector('[role="alertdialog"]')).toBeNull())
    expect(services.runCommand).not.toHaveBeenCalled()
  })

  it('opens a member prompt detail dialog from the member card and closes it', async () => {
    const user = userEvent.setup()
    renderPanel({
      patchRole: role => {
        role.description = '拆解需求和验收标准'
        role.systemPrompt = '你是产品经理。请先澄清目标，再输出可执行方案。'
      },
    })

    const detail = document.querySelector<HTMLButtonElement>('[data-role-prompt-detail="role-1"]')
    expect(detail?.getAttribute('aria-label')).toBe('查看 产品经理 的提示词')
    expect(detail?.querySelector('svg')).not.toBeNull()
    await user.click(detail!)

    await waitFor(() => {
      const title = document.getElementById('role-prompt-detail-title')
      if (!title) throw new Error('prompt dialog not open')
      expect(title.textContent).toBe('产品经理')
      expect(document.body.textContent).toContain('拆解需求和验收标准')
      expect(document.querySelector('.template-prompt-preview')?.textContent).toBe('你是产品经理。请先澄清目标，再输出可执行方案。')
    })

    await user.keyboard('{Escape}')
    await waitFor(() => expect(document.getElementById('role-prompt-detail-title')).toBeNull())
  })

  it('renders the latest AI page health detail on the member card', () => {
    renderPanel({
      patchRole: role => {
        role.siteHealth = {
          siteId: 'chatgpt',
          status: 'blocked',
          detail: 'Access Denied',
          updatedAt: 100,
        }
      },
    })

    expect(document.querySelector('.role-meta')?.textContent).toContain('页面被阻止：Access Denied')
  })

  it('summarizes member count and the selected member in the drawer header', async () => {
    const { state } = renderPanel()

    expect(document.getElementById('role-summary')?.textContent).toBe('1 人员 · 当前：产品经理')
    expect(document.querySelector('.role-card')?.className).toContain('active')

    await act(async () => {
      state.selectedRoleId = undefined
      notifyAppState()
    })
    expect(document.getElementById('role-summary')?.textContent).toBe('1 人员')
  })

  it('shows empty states when no chat or no members are present', () => {
    renderPanel({ withoutChat: true })
    expect(document.getElementById('role-list')?.textContent).toContain('未选择群聊')
  })

  it('inserts a mention from the avatar shortcut without selecting the card', async () => {
    const { services, state } = renderPanel({ withoutSelection: true })

    // mention-shortcut 处理器挂在 AvatarFallback 上（Avatar 根只是容器，
    // 同 brief 的 RoleCard 造型）；Fallback 铺满根元素，即用户看到的头像面
    const avatar = document.querySelector<HTMLElement>('.role-card .role-avatar [data-slot="avatar-fallback"]')
    await act(async () => {
      avatar?.click()
    })

    expect(services.messageActions.insertMention).toHaveBeenCalled()
    expect(state.selectedRoleId).toBeUndefined()
  })

  it('marks external members as not refreshable', () => {
    renderPanel({ patchRole: role => { role.modelSource = 'external' } })

    const refresh = document.querySelector<HTMLButtonElement>('[data-role-refresh="role-1"]')
    expect(refresh?.disabled).toBe(true)
    expect(refresh?.title).toBe('API 成员无需刷新窗口')
  })
})

describe('team page role panel drawer chrome', () => {
  it('closes the drawer from the collapse button', async () => {
    const user = userEvent.setup()
    const { state } = renderPanel()
    act(() => {
      state.peopleDrawerOpen = true
      notifyAppState()
    })
    await waitFor(() => expect(document.querySelector('.role-panel')?.classList.contains('open')).toBe(true))

    await user.click(document.querySelector<HTMLButtonElement>('#close-people-drawer')!)

    expect(state.peopleDrawerOpen).toBe(false)
    await waitFor(() => expect(document.querySelector('.role-panel')?.classList.contains('open')).toBe(false))
  })

  it('keeps the sheet mounted while closed (forceMount) with data-state=closed', () => {
    renderPanel()

    const panel = document.querySelector('.role-panel')
    expect(panel).not.toBeNull()
    expect(panel?.getAttribute('data-state')).toBe('closed')
  })

  it('renders the drawer as a non-modal dialog', async () => {
    const { state } = renderPanel()
    act(() => {
      state.peopleDrawerOpen = true
      notifyAppState()
    })
    await waitFor(() => expect(document.querySelector('.role-panel')?.getAttribute('data-state')).toBe('open'))

    const panel = document.querySelector('.role-panel')!
    expect(panel.getAttribute('role')).toBe('dialog')
    // 非模态：Radix 只在 modal 时写 aria-modal / 渲染遮罩
    expect(panel.getAttribute('aria-modal')).toBeNull()
    expect(panel.querySelector('#role-list')).not.toBeNull()
    // 「落在 #app 内」不在单测断言：RTL 环境没有 #app（portal 回落 body），
    // 该契约由浏览器验收的 s3-1 覆盖
  })

  it('closes the drawer on an outside pointer interaction but not on clicks inside it', async () => {
    const user = userEvent.setup()
    const { state } = renderPanel({ iframeHost: { recoverRole: vi.fn() } })
    act(() => {
      state.peopleDrawerOpen = true
      notifyAppState()
    })
    await waitFor(() => expect(document.querySelector('.role-panel')?.classList.contains('open')).toBe(true))

    // 抽屉内容内点击：不关闭
    await user.click(document.querySelector('.role-panel')!)
    expect(state.peopleDrawerOpen).toBe(true)

    // 站点菜单传送至 body（DOM 上不在抽屉内），但它是模态层
    // （react-menu 的 disableOutsidePointerEvents: context.open）：菜单打开期间
    // 抽屉层的 isPointerEventsEnabled 为 false，Radix 因此不判「抽屉外」
    // ——旧实现里 [data-radix-popper-content-wrapper] 白名单退役
    await user.click(document.querySelector<HTMLButtonElement>('.site-pill')!)
    const option = await waitFor(() => {
      const element = document.querySelector('.role-site-menu .role-site-option.active')
      if (!element) throw new Error('site menu not open')
      return element
    })
    await user.click(option)
    expect(state.peopleDrawerOpen).toBe(true)

    // 真实外点：Radix 只在主键（button === 0）时把外点判定推迟到随后的 click，
    // 且要求 click 未被 stopPropagation 拦截 —— 两个事件都要发
    fireEvent.pointerDown(document.body)
    fireEvent.click(document.body)
    await waitFor(() => expect(state.peopleDrawerOpen).toBe(false))
  })

  it('does not treat the header toggle as an outside interaction (no double toggle)', async () => {
    const { state } = renderPanel()
    act(() => {
      state.peopleDrawerOpen = true
      notifyAppState()
    })
    await waitFor(() => expect(document.querySelector('.role-panel')?.classList.contains('open')).toBe(true))

    // 开关按钮属于 ChatHeader，本组件单独渲染时手动补一枚（接线复刻其 onClick）
    const toggle = document.createElement('button')
    toggle.id = 'toggle-people-drawer'
    toggle.addEventListener('click', () => {
      state.peopleDrawerOpen = !state.peopleDrawerOpen
      notifyAppState()
    })
    document.body.append(toggle)

    // 非主键 pointerdown 不做延迟（Radix 仅在 button === 0 时推迟到 click）：
    // onInteractOutside 必须被 preventDefault，否则这里已被 Radix 先关一次
    fireEvent.pointerDown(toggle, { button: 2 })
    expect(state.peopleDrawerOpen).toBe(true)

    // 主键路径：click 只由按钮自身处理器翻转一次（若 Radix 也当外点，净效果是「关→再开」）
    fireEvent.pointerDown(toggle)
    fireEvent.click(toggle)
    await waitFor(() => expect(state.peopleDrawerOpen).toBe(false))
    expect(state.peopleDrawerOpen).toBe(false)

    toggle.remove()
  })

  it('opens the AI site login page through the services bridge', async () => {
    const user = userEvent.setup()
    const { services } = renderPanel()

    const login = document.querySelector<HTMLButtonElement>('#open-gemini-login')
    expect(login?.getAttribute('aria-label')).toBe('AI 站点登录')
    await user.click(login!)
    expect(services.openAiSiteLogin).toHaveBeenCalledTimes(1)
  })
})

describe('team page role panel site menu', () => {
  it('switches the member site and recovers the frame afterwards', async () => {
    const user = userEvent.setup()
    const { services } = renderPanel({ iframeHost: { recoverRole: vi.fn() } })

    await user.click(document.querySelector<HTMLButtonElement>('.site-pill')!)
    const menu = await waitFor(() => {
      const element = document.querySelector('.role-site-menu')
      if (!element) throw new Error('site menu not open')
      return element
    })
    // 当前站点是 ChatGPT（带 ✓），切换目标选一个未激活的站点
    const geminiOption = [...menu.querySelectorAll('.role-site-option')]
      .find(option => option.textContent === 'Gemini')
    expect(geminiOption).toBeTruthy()

    await user.click(geminiOption!)

    await waitFor(() => expect(services.runCommand).toHaveBeenCalledWith('GROUP_ROLE_UPDATE', {
      roleId: 'role-1',
      patch: { modelSource: 'site', chatSite: 'gemini' },
    }))
    await waitFor(() => expect(services.runCommand).toHaveBeenCalledWith('GROUP_ROLE_RECOVER', { chatId: 'chat-1', roleId: 'role-1' }))
  })

  it('shows the active model with a checkmark and skips switching when it is already active', async () => {
    const user = userEvent.setup()
    const { services } = renderPanel()

    await user.click(document.querySelector<HTMLButtonElement>('.site-pill')!)
    const menu = await waitFor(() => {
      const element = document.querySelector('.role-site-menu')
      if (!element) throw new Error('site menu not open')
      return element
    })
    expect(menu.querySelector('.role-site-option.active')?.textContent).toBe('✓ ChatGPT')

    await user.click(menu.querySelector('.role-site-option.active')!)

    await waitFor(() => expect(document.querySelector('.role-site-menu')).toBeNull())
    expect(services.runCommand).not.toHaveBeenCalledWith('GROUP_ROLE_UPDATE', expect.anything())
  })
})

// ---------- 装配与工具 ----------

interface RenderPanelOptions {
  patchRole?(role: GroupRole): void
  withoutChat?: boolean
  withoutSelection?: boolean
  iframeHost?: { recoverRole(role: GroupRole): void }
}

function renderPanel(options: RenderPanelOptions = {}) {
  const state = makeState(options)
  const overrides: Partial<TeamPageServices> = options.iframeHost
    ? { iframeHost: options.iframeHost as unknown as TeamPageServices['iframeHost'] }
    : {}
  const services = createFakeServices(overrides)
  const utils = renderWithServices(<RolePanel />, { services, state })
  return { ...utils, state }
}

function withinDialog(dialog: Element, name: string): HTMLButtonElement {
  const button = [...dialog.querySelectorAll<HTMLButtonElement>('button')].find(element => element.textContent === name)
  if (!button) throw new Error(`dialog button not found: ${name}`)
  return button
}

function makeState(options: RenderPanelOptions) {
  const store: OpenTeamStore = createDefaultStore()
  store.settings.language = 'zh-CN'
  const role: GroupRole = {
    id: 'role-1',
    chatId: 'chat-1',
    name: '产品经理',
    status: 'error',
    contextCursor: 0,
    chatSite: 'chatgpt',
    createdAt: 1,
    updatedAt: 1,
  }
  options.patchRole?.(role)
  const chat: GroupChat = {
    id: 'chat-1',
    name: '产品会',
    mode: 'independent',
    roleIds: ['role-1'],
    messageIds: [],
    nextMessageSeq: 1,
    status: 'ready',
    createdAt: 1,
    updatedAt: 1,
  }
  if (!options.withoutChat) {
    store.currentChatId = chat.id
    store.chatOrder = [chat.id]
    store.chatsById[chat.id] = chat
  }
  store.rolesById[role.id] = role

  const state = createTeamPageState()
  state.store = store
  state.selectedChatId = options.withoutChat ? undefined : chat.id
  state.selectedRoleId = options.withoutChat || options.withoutSelection ? undefined : role.id
  return state
}

beforeEach(() => {
  vi.mocked(showError).mockClear()
})
