// @vitest-environment jsdom

import { act, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BUILTIN_GROUP_TEMPLATES } from '../../../../group/builtinGroupTemplates'
import { GroupTemplateModal } from './GroupTemplateModal'
import { createFakeServices, renderWithServices } from '../../test/TestProviders'
import type { TeamPageServices } from '../../context/ServicesContext'

/*
 * 群模板弹窗 RTL（teamUiController.test.ts 群模板段重写，P4d）。打开/
 * 重置、分类与搜索过滤、风险标签与角色数位置、长摘要截断、选中随过滤
 * 失效、确认建群 + 收回快速建群表单、Escape/关闭按钮，逐条对应原断言。
 */

function openGroupTemplate(services: TeamPageServices): void {
  act(() => {
    services.uiBus.emit('open-group-template-create')
  })
}

function optionNames(): string[] {
  return [...document.querySelectorAll<HTMLElement>('.group-template-option strong')].map(el => el.textContent)
}

function searchInput(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>('#group-template-search')!
}

function confirmButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('#confirm-group-template-create')
}

afterEach(() => {
  cleanup()
})

describe('GroupTemplateModal', () => {
  it('stays hidden until the quick-create form asks for it, then opens reset with search focused', () => {
    const services = createFakeServices()
    renderWithServices(<GroupTemplateModal />, { services })

    expect(document.getElementById('group-template-modal')).toBeNull()

    openGroupTemplate(services)

    expect(document.getElementById('group-template-modal')).not.toBeNull()
    expect(searchInput()?.value).toBe('')
    expect(optionNames()).toContain('学霸学习群')
    expect(confirmButton()?.disabled).toBe(true)
    expect(document.getElementById('group-template-search')).toBe(document.activeElement)
  })

  it('creates a new chat from a selected group template and closes the React quick-create form', async () => {
    const user = userEvent.setup()
    const services = createFakeServices()
    const closePopover = vi.fn()
    services.uiBus.on('close-create-chat-popover', closePopover)
    renderWithServices(<GroupTemplateModal />, { services })
    openGroupTemplate(services)

    await user.click(document.querySelector<HTMLButtonElement>('.group-template-option')!)
    const confirm = document.getElementById('confirm-group-template-create') as HTMLButtonElement
    expect(confirm.disabled).toBe(false)
    expect(confirm.textContent).toBe('确认创建')
    await user.click(confirm)

    const template = BUILTIN_GROUP_TEMPLATES[0]
    expect(vi.mocked(services.runCommand)).toHaveBeenCalledWith('GROUP_CHAT_CREATE', {
      name: template.defaultChatName,
      mode: template.defaultMode,
      roles: template.roles,
      welcomeMessage: expect.stringContaining(`欢迎来到「${template.name}」`),
    })
    await waitFor(() => expect(document.getElementById('group-template-modal')).toBeNull())
    expect(closePopover).toHaveBeenCalledTimes(1)
  })

  it('renders and creates group templates in English mode', async () => {
    const user = userEvent.setup()
    const services = createFakeServices()
    renderWithServices(<GroupTemplateModal />, { services, language: 'en' })
    openGroupTemplate(services)

    const firstTemplateButton = document.querySelector<HTMLButtonElement>('.group-template-option')!
    expect(firstTemplateButton.textContent).toContain('Study Master Group')
    expect(firstTemplateButton.textContent).toContain('StudyPlanner')
    expect(firstTemplateButton.textContent).not.toContain('学霸学习群')

    await user.click(firstTemplateButton)
    await user.click(document.querySelector<HTMLButtonElement>('#confirm-group-template-create')!)

    expect(vi.mocked(services.runCommand)).toHaveBeenCalledWith('GROUP_CHAT_CREATE', expect.objectContaining({
      name: 'Study Master Group',
      roles: expect.arrayContaining([expect.objectContaining({ name: 'StudyPlanner' })]),
      welcomeMessage: expect.stringContaining('Welcome to "Study Master Group"'),
    }))
  })

  it('filters group templates by category and search in the picker', async () => {
    const user = userEvent.setup()
    const services = createFakeServices()
    renderWithServices(<GroupTemplateModal />, { services })
    openGroupTemplate(services)

    const categoryButton = [...document.querySelectorAll<HTMLButtonElement>('.group-template-category-filter')]
      .find(button => button.textContent === '技术研发')
    expect(categoryButton).toBeTruthy()
    expect(categoryButton?.getAttribute('aria-pressed')).toBe('false')
    await user.click(categoryButton!)
    await waitFor(() => expect(optionNames()).toEqual([
      '软件开发群',
      'AI Agent 开发群',
      '数据分析群',
    ]))

    const searchEl = document.querySelector<HTMLInputElement>('#group-template-search')!
    await user.type(searchEl, 'Agent')
    await waitFor(() => expect(optionNames()).toEqual(['AI Agent 开发群']))

    await user.clear(searchEl)
    await user.type(searchEl, '不存在的模板')
    await waitFor(() => {
      expect(document.querySelector('.group-template-option')).toBeNull()
      expect(document.querySelector<HTMLElement>('.group-template-empty')?.textContent).toContain('没有找到匹配的小组')
    })
  })

  it('recovers from the empty state via 清空搜索 and 查看全部模板', async () => {
    const user = userEvent.setup()
    const services = createFakeServices()
    renderWithServices(<GroupTemplateModal />, { services })
    openGroupTemplate(services)

    const techButton = [...document.querySelectorAll<HTMLButtonElement>('.group-template-category-filter')]
      .find(button => button.textContent === '技术研发')!
    await user.click(techButton)
    const searchEl = document.querySelector<HTMLInputElement>('#group-template-search')!
    await user.type(searchEl, '不存在的模板')
    await waitFor(() => expect(document.querySelector('.group-template-empty')).not.toBeNull())

    await user.click([...document.querySelectorAll('.group-template-empty-actions .btn')]
      .find(button => button.textContent === '清空搜索') as HTMLButtonElement)

    // 清空搜索只还原查询词，分类保持在「技术研发」
    expect(searchEl.value).toBe('')
    await waitFor(() => expect(optionNames()).toEqual(['软件开发群', 'AI Agent 开发群', '数据分析群']))
    expect(searchEl).toBe(document.activeElement)

    await user.type(searchEl, '不存在的模板')
    await waitFor(() => expect(document.querySelector('.group-template-empty')).not.toBeNull())
    await user.click([...document.querySelectorAll('.group-template-empty-actions .btn')]
      .find(button => button.textContent === '查看全部模板') as HTMLButtonElement)

    await waitFor(() => expect(optionNames()).toContain('学霸学习群'))
    expect([...document.querySelectorAll<HTMLButtonElement>('.group-template-category-filter')]
      .find(button => button.textContent === '全部')?.getAttribute('aria-pressed')).toBe('true')
  })

  it('keeps risk badges beside the template name and role count under the name', () => {
    const services = createFakeServices()
    renderWithServices(<GroupTemplateModal />, { services })
    openGroupTemplate(services)

    const professionalCard = [...document.querySelectorAll<HTMLButtonElement>('.group-template-option')]
      .find(card => card.querySelector('strong')?.textContent === '小公司财务群')

    expect(professionalCard).toBeTruthy()
    const top = professionalCard!.querySelector<HTMLElement>('.group-template-option-top')!
    expect(top.querySelector<HTMLElement>('.group-template-risk')?.textContent).toBe('专业边界')
    expect(top.querySelector<HTMLElement>('.group-template-role-count')?.textContent).toBe('6 个角色')
    expect([...professionalCard!.children].some(child => child.classList.contains('group-template-card-footer'))).toBe(false)
  })

  it('renders a truncated preview of long group template summaries with the full text available on hover', () => {
    const services = createFakeServices()
    renderWithServices(<GroupTemplateModal />, { services })
    openGroupTemplate(services)

    const card = document.querySelector<HTMLButtonElement>('.group-template-option')!
    const summary = card.querySelector<HTMLElement>('.group-template-summary')!
    const template = BUILTIN_GROUP_TEMPLATES[0]

    expect(card.classList.contains('has-long-summary')).toBe(true)
    expect(summary.classList.contains('group-template-summary-collapsed')).toBe(false)
    expect(summary.textContent).toBe(template.summary)
    expect(summary.getAttribute('title')).toBe(template.summary)
  })

  it('drops the selection once it filters out of view, and it does not come back', async () => {
    const user = userEvent.setup()
    const services = createFakeServices()
    renderWithServices(<GroupTemplateModal />, { services })
    openGroupTemplate(services)

    const searchEl = document.querySelector<HTMLInputElement>('#group-template-search')!
    await user.click(document.querySelector<HTMLButtonElement>('[data-template-id="study-master"]')!)
    expect(confirmButton()?.disabled).toBe(false)

    // 选中模板被搜索过滤掉 → 选中清除且确认再次禁用
    await user.type(searchEl, '不存在的模板')
    await waitFor(() => expect(confirmButton()?.disabled).toBe(true))

    await user.clear(searchEl)
    await waitFor(() => expect(optionNames()).toContain('学霸学习群'))
    // 原行为：清除过滤不会恢复刚才的选中
    expect(confirmButton()?.disabled).toBe(true)
  })

  it('closes via the close button and Escape, and reopens reset', async () => {
    const user = userEvent.setup()
    const services = createFakeServices()
    renderWithServices(<GroupTemplateModal />, { services })
    openGroupTemplate(services)

    await user.click(document.querySelector<HTMLButtonElement>('.group-template-option')!)
    expect(confirmButton()?.disabled).toBe(false)

    await user.click(document.querySelector<HTMLButtonElement>('#close-group-template-modal')!)
    await waitFor(() => expect(document.getElementById('group-template-modal')).toBeNull())

    openGroupTemplate(services)
    expect(document.getElementById('group-template-modal')).not.toBeNull()
    // 选中已被关闭动作重置
    expect(confirmButton()?.disabled).toBe(true)
    expect(document.querySelector('.group-template-option.active')).toBeNull()

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await waitFor(() => expect(document.getElementById('group-template-modal')).toBeNull())

    // 外点不关闭（原行为：仅关闭按钮 + Escape 可关；Radix onInteractOutside preventDefault 保真）
    openGroupTemplate(services)
    await user.click(document.querySelector('[data-slot="dialog-overlay"]')!)
    expect(document.getElementById('group-template-modal')).not.toBeNull()
  })
})
