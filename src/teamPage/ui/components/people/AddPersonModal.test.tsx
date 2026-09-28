// @vitest-environment jsdom

import { act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultStore } from '../../../../group/store'
import type { GroupChat, OpenTeamStore, RoleTemplate } from '../../../../group/types'
import { createTeamPageState } from '../../../appState'
import { createFakeServices, renderWithServices } from '../../test/TestProviders'
import { AddPersonModal } from './AddPersonModal'
import { TemporaryPersonModal } from './TemporaryPersonModal'

/*
 * 添加人员弹窗 RTL（peopleLibraryView.test.ts add-person 部分重写）。
 * 站点 pill 多选提交（每人每站点一条）、勾选保持、内置/自定义 tab、
 * 默认店铺自定义人员、搜索与空态、分类过滤保持勾选、空提交报错、
 * 临时草稿联投逐条对应；站点解析纯函数在 ui/lib/peopleLibrary.test.ts。
 */

vi.mock('../../lib/toast', () => ({ showError: vi.fn(), showSuccess: vi.fn() }))

import { showError } from '../../lib/toast'

function makeTemplate(index: number): RoleTemplate {
  return {
    id: `template-${index}`,
    type: 'custom',
    name: `人员${index}`,
    description: `描述${index}`,
    defaultChatSite: 'gemini',
    systemPrompt: `提示词${index}`,
    createdAt: index,
    updatedAt: index,
  }
}

function makeChat(id: string): GroupChat {
  return {
    id,
    name: '群聊',
    mode: 'independent',
    roleIds: [],
    messageIds: [],
    nextMessageSeq: 1,
    status: 'ready',
    createdAt: 1,
    updatedAt: 1,
  }
}

/** 默认店铺种子自定义人员以外的受控店铺 */
function makeStore(customs: RoleTemplate[], chat?: GroupChat): OpenTeamStore {
  const store = createDefaultStore()
  store.roleTemplateOrder = customs.map(template => template.id)
  store.roleTemplatesById = Object.fromEntries(customs.map(template => [template.id, template]))
  if (chat) store.chatsById[chat.id] = chat
  return store
}

function renderAddPerson(state = createTeamPageState(), serviceOverrides = {}) {
  return renderWithServices(
    <>
      <AddPersonModal />
      <TemporaryPersonModal />
    </>,
    { state, ...serviceOverrides },
  )
}

function openAddPerson(services: ReturnType<typeof createFakeServices>): Promise<void> {
  return act(async () => {
    services.uiBus.emit('open-add-person')
  })
}

function submitButton(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>('#add-library-people-form button[type="submit"]')!
}

describe('team page add person modal', () => {
  let user: ReturnType<typeof userEvent.setup>

  beforeEach(() => {
    user = userEvent.setup()
    vi.mocked(showError).mockClear()
  })

  it('submits one library person once for every selected chat site', async () => {
    const chat = makeChat('chat-1')
    const template = makeTemplate(1)
    const state = createTeamPageState()
    state.store = makeStore([template], chat)
    state.selectedChatId = chat.id
    const { services } = renderAddPerson(state)

    await openAddPerson(services)

    await user.click(document.querySelector<HTMLInputElement>('input[type="checkbox"][value="site:claude"]')!)
    await user.click(document.querySelector<HTMLInputElement>('input[type="checkbox"][value="library:template-1"]')!)
    await user.click(submitButton())

    expect(services.runCommand).toHaveBeenCalledWith('GROUP_ROLES_CREATE_BATCH', {
      chatId: chat.id,
      items: [
        { source: 'library', roleTemplateId: template.id, modelSource: 'site', chatSite: 'gemini' },
        { source: 'library', roleTemplateId: template.id, modelSource: 'site', chatSite: 'claude' },
      ],
    })
    // 成功后关闭并清空勾选
    await waitFor(() => expect(document.querySelector('#add-person-modal')).toBeNull())
    expect(state.addPersonSelectedKeys.size).toBe(0)
  })

  it('keeps selected people checked while changing their chat sites', async () => {
    const chat = makeChat('chat-1')
    const template = makeTemplate(1)
    const state = createTeamPageState()
    state.store = makeStore([template], chat)
    state.selectedChatId = chat.id
    const { services } = renderAddPerson(state)

    await openAddPerson(services)

    await user.click(document.querySelector<HTMLInputElement>('input[type="checkbox"][value="library:template-1"]')!)
    await user.click(document.querySelector<HTMLInputElement>('input[type="checkbox"][value="site:claude"]')!)

    expect(document.querySelector<HTMLInputElement>('input[type="checkbox"][value="library:template-1"]')!.checked).toBe(true)
    expect(services.runCommand).not.toHaveBeenCalled()
  })

  it('does not submit the last remaining site away', async () => {
    const chat = makeChat('chat-1')
    const template = makeTemplate(1)
    const state = createTeamPageState()
    state.store = makeStore([template], chat)
    state.selectedChatId = chat.id
    const { services } = renderAddPerson(state)

    await openAddPerson(services)

    // 默认只勾选 gemini，取消它应回弹（至少保留一个站点）
    await user.click(document.querySelector<HTMLInputElement>('input[type="checkbox"][value="site:gemini"]')!)
    expect(document.querySelector<HTMLInputElement>('input[type="checkbox"][value="site:gemini"]')!.checked).toBe(true)
    expect(services.runCommand).not.toHaveBeenCalled()
  })

  it('filters add-person choices by built-in and custom tabs', async () => {
    const chat = makeChat('chat-1')
    const state = createTeamPageState()
    state.store = makeStore([makeTemplate(1)], chat)
    state.selectedChatId = chat.id
    const { services } = renderAddPerson(state)

    await openAddPerson(services)

    const list = document.querySelector('#add-library-people-list')!
    expect(list.textContent).toContain('人员1')
    expect(list.textContent).not.toContain('弗兰克尔')
    expect(document.querySelector<HTMLButtonElement>('#add-person-tab-custom')?.className).toContain('active')

    await act(async () => {
      document.querySelector<HTMLButtonElement>('#add-person-tab-builtin')!.click()
    })
    expect(list.textContent).toContain('弗兰克尔')
    expect(list.textContent).not.toContain('人员1')
    expect(document.querySelector<HTMLButtonElement>('#add-person-tab-builtin')?.className).toContain('active')
  })

  it('shows default custom people in the add-person custom tab for a default store', async () => {
    const chat = makeChat('chat-1')
    const state = createTeamPageState()
    // 默认店铺自带种子自定义人员（makeStore 会清掉它们，这里必须保留）
    const store = createDefaultStore()
    store.chatsById[chat.id] = chat
    state.store = store
    state.selectedChatId = chat.id
    const { services } = renderAddPerson(state)

    await openAddPerson(services)

    const list = document.querySelector('#add-library-people-list')!
    expect(list.textContent).toContain('产品经理')
    expect(list.textContent).toContain('工程师')
    expect(list.textContent).toContain('增长顾问')
  })

  it('searches add-person choices by name, description, and persona text', async () => {
    const chat = makeChat('chat-1')
    const state = createTeamPageState()
    state.store = makeStore([], chat)
    state.selectedChatId = chat.id
    const { services } = renderAddPerson(state)

    await openAddPerson(services)
    // 无自定义人员时回退内置页签（原 ensureAddPersonTemplateTypeHasItems 对译）
    await act(async () => {
      document.querySelector<HTMLButtonElement>('#add-person-tab-builtin')!.click()
    })

    const search = document.querySelector<HTMLInputElement>('#add-person-search')!
    await user.type(search, '荒诞')
    const list = document.querySelector('#add-library-people-list')!
    expect(list.textContent).toContain('加缪')
    expect(list.textContent).not.toContain('弗兰克尔')

    await user.clear(search)
    await user.type(search, '没有这个人')
    expect(list.textContent).toContain('没有匹配的内置人员')
  })

  it('filters add-person choices by category while keeping selected people checked', async () => {
    const chat = makeChat('chat-1')
    const engineering: RoleTemplate = {
      ...makeTemplate(1),
      name: 'Prompt规范工程师',
      category: '技术研发',
      sourceTemplateName: 'AI Agent 开发群',
    }
    const study: RoleTemplate = {
      ...makeTemplate(2),
      name: '学习规划师',
      category: '学生与学习',
      sourceTemplateName: '学霸学习群',
    }
    const state = createTeamPageState()
    state.store = makeStore([engineering, study], chat)
    state.selectedChatId = chat.id
    const { services } = renderAddPerson(state)

    await openAddPerson(services)

    const filter = document.querySelector('#add-person-category-filter')!
    await act(async () => {
      filter.querySelector<HTMLButtonElement>('[data-category="技术研发"]')!.click()
    })
    await user.click(document.querySelector<HTMLInputElement>('input[type="checkbox"][value="library:template-1"]')!)

    const list = document.querySelector('#add-library-people-list')!
    expect(list.textContent).toContain('Prompt规范工程师')
    expect(list.textContent).toContain('AI Agent 开发群')
    expect(list.textContent).not.toContain('学习规划师')

    const search = document.querySelector<HTMLInputElement>('#add-person-search')!
    await user.type(search, '学习')
    expect(list.textContent).toContain('当前分类暂无自定义人员')

    await user.clear(search)
    expect(document.querySelector<HTMLInputElement>('input[type="checkbox"][value="library:template-1"]')!.checked).toBe(true)
  })

  it('rejects an empty submission with a hint and no command', async () => {
    const chat = makeChat('chat-1')
    const state = createTeamPageState()
    state.store = makeStore([makeTemplate(1)], chat)
    state.selectedChatId = chat.id
    const { services } = renderAddPerson(state)

    await openAddPerson(services)

    await user.click(submitButton())

    expect(showError).toHaveBeenCalledWith('请选择或填写要添加的人员')
    expect(services.runCommand).not.toHaveBeenCalled()
    expect(document.querySelector('#add-person-modal')).not.toBeNull()
  })

  it('ignores the open command without a current chat', async () => {
    const state = createTeamPageState()
    state.store = makeStore([makeTemplate(1)])
    const { services } = renderAddPerson(state)

    await openAddPerson(services)

    expect(document.querySelector('#add-person-modal')).toBeNull()
  })

  it('renders through the shared modal shell with the xl width token and keeps the row geometry', async () => {
    const chat = makeChat('chat-1')
    const template = makeTemplate(1)
    const state = createTeamPageState()
    state.store = makeStore([template], chat)
    state.selectedChatId = chat.id
    const { services } = renderAddPerson(state)

    await openAddPerson(services)

    const modal = document.querySelector<HTMLElement>('#add-person-modal')
    expect(modal).not.toBeNull()
    // 宽度令牌由 AppModal 的 size="xl" 承担（沟槽统一 48px），原语基类的
    // sm:max-w-lg 必须被 max-w-none sm:max-w-none 抵掉
    expect(modal!.classList.contains('w-[min(820px,calc(100vw-48px))]')).toBe(true)
    expect(modal!.classList.contains('max-w-lg')).toBe(false)
    // p-0 是壳自己的贡献（抵掉原语基类的 p-6）：内容节点确实由 AppModal
    // 渲染，而不是还留着手写的 DialogContent
    expect(modal!.classList.contains('p-0')).toBe(true)
    // 正文内边距必须靠 bodyClassName 补回来（本弹窗自己不带任何 padding，
    // jsdom 不算布局，漏了单测抓不到；只有 T6 的几何断言看得见）
    const bodyRow = modal!.lastElementChild as HTMLElement
    expect(bodyRow.classList.contains('min-h-0')).toBe(true)
    expect(bodyRow.classList.contains('p-6')).toBe(true)

    // 承重契约（screenshot-bugfix-acceptance.mjs 直接断言这一行的几何与取色）：
    // 行容器 / 行内 checkbox / 站点 pill 结构全部原样
    const list = bodyRow.querySelector('#add-library-people-list')
    expect(list).not.toBeNull()
    const row = list!.querySelector<HTMLElement>('.select-row')
    expect(row).not.toBeNull()
    expect(row!.classList.contains('select-row')).toBe(true)
    const checkbox = row!.querySelector<HTMLInputElement>('input[type="checkbox"]')
    expect(checkbox).not.toBeNull()
    expect(checkbox!.classList.contains('size-4')).toBe(true)
    expect(checkbox!.classList.contains('shrink-0')).toBe(true)
    const pill = row!.querySelector<HTMLLabelElement>('label.site-pill.add-person-site-option')
    expect(pill).not.toBeNull()
    expect(pill!.querySelector<HTMLInputElement>('input[type="checkbox"]')).not.toBeNull()

    // 搜索框换官方 Input 原语（不再靠 legacy 全局 input{} 塑形）
    expect(document.querySelector('#add-person-search')?.getAttribute('data-slot')).toBe('input')

    // 关闭钮的 id 生命转移到 AppModal 的 closeId
    const close = document.querySelector<HTMLButtonElement>('#close-add-person')
    expect(close).not.toBeNull()
    await act(async () => { close!.click() })
    await waitFor(() => expect(document.querySelector('#add-person-modal')).toBeNull())
  })

  it('adds a temporary draft through the stacked dialog and submits it as a temporary role', async () => {
    const chat = makeChat('chat-1')
    const state = createTeamPageState()
    state.store = makeStore([], chat)
    state.selectedChatId = chat.id
    const { services } = renderAddPerson(state)

    await openAddPerson(services)
    await user.click(document.querySelector<HTMLButtonElement>('#open-temporary-person')!)
    expect(document.querySelector('#temporary-person-modal')).not.toBeNull()

    await user.type(document.querySelector<HTMLInputElement>('#temporary-person-name')!, '临调员')
    await user.type(document.querySelector<HTMLTextAreaElement>('#temporary-person-description')!, '临时描述')
    await user.type(document.querySelector<HTMLTextAreaElement>('#temporary-person-prompt')!, '临时人设')
    await user.click(document.querySelector<HTMLButtonElement>('#add-temporary-person-form button[type="submit"]')!)
    await waitFor(() => expect(document.querySelector('#temporary-person-modal')).toBeNull())
    expect(state.temporaryPersonDrafts).toHaveLength(1)

    const list = document.querySelector('#add-library-people-list')!
    expect(list.textContent).toContain('临调员')
    expect(list.textContent).toContain('临时人员')

    await user.click(document.querySelector<HTMLInputElement>('input[type="checkbox"][value^="temporary:"]')!)
    await user.click(submitButton())

    expect(services.runCommand).toHaveBeenCalledWith('GROUP_ROLES_CREATE_BATCH', {
      chatId: chat.id,
      items: [
        { source: 'temporary', name: '临调员', description: '临时描述', systemPrompt: '临时人设', modelSource: 'site', chatSite: 'deepseek' },
      ],
    })
    // 成功后清空临时草稿并关闭
    expect(state.temporaryPersonDrafts).toHaveLength(0)
    await waitFor(() => expect(document.querySelector('#add-person-modal')).toBeNull())
  })
})
