// @vitest-environment jsdom

import { act, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultStore } from '../../../../group/store'
import type { OpenTeamStore, RoleTemplate } from '../../../../group/types'
import { createTeamPageState } from '../../../appState'
import { createFakeServices, renderWithServices } from '../../test/TestProviders'
import { BuiltinTemplateDetailModal } from './BuiltinTemplateDetailModal'
import { PeopleLibraryModal } from './PeopleLibraryModal'
import { PersonTemplateModal } from './PersonTemplateModal'

/*
 * 人员库弹窗 RTL（peopleLibraryView.test.ts 重写）。分页（每页 5 条）、
 * 内置/自定义 tab、英文模式、按名称/描述/人设搜索、分类过滤 + 来源群
 * 元数据、内置人员只读详情、删除确认（window.confirm → AlertDialog）、
 * 新建入口逐条对应；纯派生在 ui/lib/peopleLibrary.test.ts。
 */

vi.mock('../../lib/toast', () => ({ showError: vi.fn(), showSuccess: vi.fn() }))

import { showError } from '../../lib/toast'

function makeTemplate(index: number): RoleTemplate {
  return {
    id: `template-${index}`,
    type: 'custom',
    name: `人员${index}`,
    description: `描述${index}`,
    defaultChatSite: 'deepseek',
    systemPrompt: `提示词${index}`,
    createdAt: index,
    updatedAt: index,
  }
}

function makeStore(customs: RoleTemplate[]): OpenTeamStore {
  const store = createDefaultStore()
  store.roleTemplateOrder = customs.map(template => template.id)
  store.roleTemplatesById = Object.fromEntries(customs.map(template => [template.id, template]))
  return store
}

function renderLibrary(state = createTeamPageState(), options = {}) {
  const rendered = renderWithServices(
    <>
      <PeopleLibraryModal />
      <PersonTemplateModal />
      <BuiltinTemplateDetailModal />
    </>,
    { state, ...options },
  )
  return rendered
}

function openLibrary(services: ReturnType<typeof createFakeServices>): Promise<void> {
  return act(async () => {
    services.uiBus.emit('open-people-library')
  })
}

describe('team page people library modal', () => {
  let user: ReturnType<typeof userEvent.setup>

  beforeEach(() => {
    user = userEvent.setup()
    vi.mocked(showError).mockClear()
  })

  it('renders five people library entries per page and paginates', async () => {
    const customs = Array.from({ length: 6 }, (_, index) => makeTemplate(index + 1))
    const state = createTeamPageState()
    state.store = makeStore(customs)
    const { services } = renderLibrary(state)

    await openLibrary(services)

    expect(document.querySelector<HTMLElement>('#people-library-modal')?.hidden).toBe(false)
    expect(document.querySelectorAll('#people-library-list .template-card')).toHaveLength(5)
    expect(document.querySelector('#people-library-summary')?.textContent).toBe('6 人')
    expect(document.querySelector('#people-library-pagination')?.textContent).toContain('1 / 2')

    await act(async () => {
      document.querySelector<HTMLButtonElement>('#people-library-pagination button:last-child')!.click()
    })
    expect(document.querySelectorAll('#people-library-list .template-card')).toHaveLength(1)
    expect(document.querySelector('#people-library-list')?.textContent).toContain('人员6')
    expect(document.querySelector('#people-library-pagination')?.textContent).toContain('2 / 2')
  })

  it('filters the people library by built-in and custom tabs', async () => {
    const state = createTeamPageState()
    state.store = makeStore([makeTemplate(1)])
    const { services } = renderLibrary(state)

    await openLibrary(services)

    const list = document.querySelector('#people-library-list')!
    expect(list.textContent).toContain('人员1')
    expect(list.textContent).toContain('自定义')
    expect(list.textContent).not.toContain('弗兰克尔')
    expect(document.querySelector<HTMLButtonElement>('#people-library-tab-custom')?.className).toContain('active')
    expect(list.querySelector('.template-delete')).not.toBeNull()

    await act(async () => {
      document.querySelector<HTMLButtonElement>('#people-library-tab-builtin')!.click()
    })
    expect(list.textContent).toContain('弗兰克尔')
    expect(list.textContent).toContain('内置')
    expect(list.textContent).not.toContain('人员1')
    expect(document.querySelector<HTMLButtonElement>('#people-library-tab-builtin')?.className).toContain('active')
    expect(list.querySelector('.template-delete')).toBeNull()
    expect(list.querySelector('.template-detail')).not.toBeNull()
  })

  it('renders built-in people library content in English mode', async () => {
    const state = createTeamPageState()
    state.store = makeStore([])
    const { services } = renderLibrary(state, { language: 'en' })

    await openLibrary(services)
    // 自定义人员为空时自动回退到内置页签（原 ensureTypeHasItems 对译）
    expect(document.querySelector<HTMLButtonElement>('#people-library-tab-builtin')?.className).toContain('active')

    await act(async () => {
      document.querySelector<HTMLButtonElement>('#people-library-tab-builtin')!.click()
    })

    const list = document.querySelector('#people-library-list')!
    expect(list.textContent).toContain('ViktorFrankl')
    expect(list.textContent).toContain('Built-in')
    expect(list.textContent).not.toContain('弗兰克尔')
    expect(list.textContent).not.toContain('内置人员')
  })

  it('searches people library entries by name, description, and persona text', async () => {
    const state = createTeamPageState()
    state.store = makeStore([])
    const { services } = renderLibrary(state)

    await openLibrary(services)

    const search = document.querySelector<HTMLInputElement>('#people-library-search')!
    await user.type(search, '荒诞')

    const list = document.querySelector('#people-library-list')!
    expect(list.textContent).toContain('加缪')
    expect(list.textContent).not.toContain('弗兰克尔')
    expect(document.querySelector('#people-library-pagination')?.textContent).toBe('')

    await user.clear(search)
    await user.type(search, '没有这个人')
    expect(list.textContent).toContain('没有匹配的内置人员')
  })

  it('filters people library entries by category and keeps source group metadata', async () => {
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
    state.store = makeStore([engineering, study])
    const { services } = renderLibrary(state)

    await openLibrary(services)

    const filter = document.querySelector('#people-library-category-filter')!
    expect(filter.textContent).toContain('全部')
    expect(filter.textContent).toContain('技术研发')

    await act(async () => {
      filter.querySelector<HTMLButtonElement>('[data-category="技术研发"]')!.click()
    })

    const list = document.querySelector('#people-library-list')!
    expect(list.textContent).toContain('Prompt规范工程师')
    expect(list.textContent).toContain('AI Agent 开发群')
    expect(list.textContent).not.toContain('学习规划师')

    const search = document.querySelector<HTMLInputElement>('#people-library-search')!
    await user.type(search, '学霸学习')
    expect(list.textContent).toContain('当前分类暂无自定义人员')
  })

  it('opens a read-only prompt detail modal for built-in people', async () => {
    const state = createTeamPageState()
    state.store = makeStore([])
    const { services } = renderLibrary(state)

    await openLibrary(services)

    await act(async () => {
      document.querySelector<HTMLButtonElement>('#people-library-tab-builtin')!.click()
    })
    await act(async () => {
      document.querySelector<HTMLButtonElement>('#people-library-list .template-detail')!.click()
    })

    expect(document.querySelector('#builtin-template-detail-modal')).not.toBeNull()
    expect(document.querySelector('#builtin-template-detail-title')?.textContent).toBe('弗兰克尔')
    expect(document.querySelector('#builtin-template-detail-meta')?.textContent).toContain('内置人员')
    const prompt = document.querySelector('#builtin-template-detail-prompt')?.textContent ?? ''
    expect(prompt).toContain('弗兰克尔式意义顾问')
    expect(prompt).toContain('意义疗法')

    await act(async () => {
      document.querySelector<HTMLButtonElement>('#close-builtin-template-detail')!.click()
    })
    await waitFor(() => expect(document.querySelector('#builtin-template-detail-modal')).toBeNull())
    expect(state.previewTemplateId).toBeUndefined()
  })

  it('deletes an unused custom person through a confirm dialog', async () => {
    const state = createTeamPageState()
    state.store = makeStore([makeTemplate(1)])
    const { services } = renderLibrary(state)

    await openLibrary(services)

    await user.click(document.querySelector<HTMLButtonElement>('#people-library-list .template-delete')!)
    const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement
    expect(dialog.textContent).toContain('确定删除「人员1」吗？')

    await user.click(within(dialog).getByRole('button', { name: '删除' }))
    expect(services.runCommand).toHaveBeenCalledWith('ROLE_TEMPLATE_DELETE', { templateId: 'template-1' })
    expect(showError).not.toHaveBeenCalled()
  })

  it('opens the person editor for 新建 without an edit target', async () => {
    const state = createTeamPageState()
    state.store = makeStore([])
    const { services } = renderLibrary(state)

    await openLibrary(services)
    await user.click(document.querySelector<HTMLButtonElement>('#new-template')!)

    expect(document.querySelector<HTMLElement>('#person-template-modal')?.hidden).toBe(false)
    expect(document.querySelector('#template-form-title')?.textContent).toContain('新建人员')
    expect(state.selectedTemplateId).toBeUndefined()
  })
})
