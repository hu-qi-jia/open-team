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

    await user.click([...document.querySelectorAll('.group-template-empty-actions button')]
      .find(button => button.textContent === '清空搜索') as HTMLButtonElement)

    // 清空搜索只还原查询词，分类保持在「技术研发」
    expect(searchEl.value).toBe('')
    await waitFor(() => expect(optionNames()).toEqual(['软件开发群', 'AI Agent 开发群', '数据分析群']))
    expect(searchEl).toBe(document.activeElement)

    await user.type(searchEl, '不存在的模板')
    await waitFor(() => expect(document.querySelector('.group-template-empty')).not.toBeNull())
    await user.click([...document.querySelectorAll('.group-template-empty-actions button')]
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

  /*
   * 壳契约（S5 / T3）：弹窗迁到 common/AppModal 后，宽度/高度令牌、自绘关闭钮的
   * 形状、footer 槽的落点都由壳的 utilities 承担；正文行的内边距与「唯一滚动容器」
   * 则由 bodyClassName 补（壳用 p-0 收掉原语的 p-6）。这些属性 jsdom 不算布局，
   * 只能钉类名（与 S4/T2 各迁移用例同口径）；真正的几何量测归 T5 的 s5-1/s5-1b/s5-2
   * 与 T3 的真浏览器探针。
   */
  it('uses the full width token and the fixed height token of the shared shell', () => {
    const services = createFakeServices()
    renderWithServices(<GroupTemplateModal />, { services })
    openGroupTemplate(services)

    const modal = document.querySelector<HTMLElement>('#group-template-modal')!
    // 宽度令牌 full（1500 / 沟槽 48，原 32）；定高 760 取代 legacy 的
    // min-height min(820,100vh-24) + max-height calc(100vh-24)
    expect(modal.classList.contains('w-[min(1500px,calc(100vw-48px))]')).toBe(true)
    expect(modal.classList.contains('h-[min(760px,calc(100vh-48px))]')).toBe(true)
    expect(modal.classList.contains('w-[min(1500px,calc(100vw-32px))]')).toBe(false)
    // legacy 的 min-height 不在壳的覆盖清单里（层序只对「写了的属性」生效），
    // 必须显式中立，否则 820 会压过 760 的定高
    expect(modal.classList.contains('min-h-0')).toBe(true)
  })

  it('renders the svg close button with the translated aria-label', () => {
    const services = createFakeServices()
    renderWithServices(<GroupTemplateModal />, { services })
    openGroupTemplate(services)

    // 关闭钮：壳渲染的 svg 图标，不再是裸 `×` 文本节点
    const close = document.querySelector<HTMLElement>('#close-group-template-modal')
    expect(close).not.toBeNull()
    expect(close!.querySelector('svg')).not.toBeNull()
    expect(close!.textContent).not.toContain('×')
    expect(close!.getAttribute('aria-label')).toBe('关闭群聊模板')
  })

  it('puts the confirm button in the shell footer slot and keeps the body row grid + padding', () => {
    const services = createFakeServices()
    renderWithServices(<GroupTemplateModal />, { services })
    openGroupTemplate(services)

    const modal = document.querySelector<HTMLElement>('#group-template-modal')!
    // footer 槽：确认创建钮在壳的 footer 行里（不在正文滚动区内），
    // 对齐方式由 footerClassName 给（壳不焊死 flex/justify-end）
    const footer = modal.querySelector<HTMLElement>('[data-slot="modal-footer"]')
    expect(footer).not.toBeNull()
    expect(footer!.classList.contains('flex')).toBe(true)
    expect(footer!.classList.contains('justify-end')).toBe(true)
    expect(footer!.querySelector('#confirm-group-template-create')).not.toBeNull()
    expect(modal.querySelector('[data-slot="modal-body"] #confirm-group-template-create')).toBeNull()
    expect(modal.querySelector('[data-slot="modal-body"] [data-slot="modal-footer"]')).toBeNull()

    // 正文行：px-6 补回壳用 p-0 收掉的原语内边距（本弹窗自身不带 padding，
    // 头/脚各自 px-6 py-4 补过，正文没有别的来源）；overflow-hidden 抵掉
    // height="fixed" 给正文行加的 overflow-auto——整壳唯一的滚动容器是
    // #group-template-list（否则两层滚动叠成双滚动条）
    const body = modal.querySelector<HTMLElement>(':scope > [data-slot="modal-body"]')!
    expect(body.classList.contains('grid')).toBe(true)
    expect(body.classList.contains('grid-rows-[auto_minmax(0,1fr)]')).toBe(true)
    expect(body.classList.contains('min-h-0')).toBe(true)
    // gap-4 补回原语 ui/dialog.tsx 的 gap-4：旧路径下 4 个子元素间各有 16px，
    // 壳用 gap-0 收掉后「工具行 ↔ 列表」的可见间距凭空归零（真浏览器实测
    // 分类条底边 → 列表顶边 0px，legacy 同口径 16px；jsdom 不算布局，只能钉类名）
    expect(body.classList.contains('gap-4')).toBe(true)
    expect(body.classList.contains('px-6')).toBe(true)
    expect(body.classList.contains('overflow-hidden')).toBe(true)
    expect(body.classList.contains('overflow-auto')).toBe(false)
  })

  it('neutralises the legacy max-height on the list and keeps the auto-fit card grid', () => {
    const services = createFakeServices()
    renderWithServices(<GroupTemplateModal />, { services })
    openGroupTemplate(services)

    // 定高由壳给；legacy 的 max-height min(720,100vh-240) 必须显式中立，
    // 否则 T4 删规则那天列表会突然换高，且可能与 s5-2 的「列表内部可滚」打架
    const list = document.getElementById('group-template-list')!
    expect(list.classList.contains('grid-cols-[repeat(auto-fit,minmax(520px,1fr))]')).toBe(true)
    expect(list.classList.contains('max-h-none')).toBe(true)
    expect(list.classList.contains('overflow-auto')).toBe(true)
    expect(list.classList.contains('min-h-0')).toBe(true)
  })

  /*
   * B 组的状态值不变量（legacy 1396–1398 / 1359–1361 是各自一条分组规则、同一批
   * 声明；两族里没有别的同特异性规则靠源码顺序取胜）。Tailwind 把 hover/focus-visible
   * 变体排在基础工具类之后，一旦 active 与 hover 写成不同值，悬停选中项就会看到 hover
   * 的值（T2 的事故形态）。这里用「变体类集合必须逐字相等」把它钉死。
   */
  it('keeps hover / focus-visible / selected values identical for both option and category chip', () => {
    const services = createFakeServices()
    renderWithServices(<GroupTemplateModal />, { services })
    openGroupTemplate(services)

    const variantsOf = (element: Element, prefix: string) => [...element.classList]
      .filter(name => name.startsWith(prefix))
      .map(name => name.slice(prefix.length))
      .sort()

    for (const selector of ['.group-template-option', '.group-template-category-filter']) {
      const element = document.querySelector(selector)!
      expect(variantsOf(element, 'hover:').length).toBeGreaterThan(0)
      expect(variantsOf(element, 'aria-pressed:')).toEqual(variantsOf(element, 'hover:'))
      expect(variantsOf(element, 'focus-visible:')).toEqual(variantsOf(element, 'hover:'))
    }

    // 浅色块 2348–2356 里那条「浅色专属 .active 内阴影」
    // （inset 0 0 0 1px rgba(113,113,122,.14)，同规则还挂着 .theme-option/.mode-option）
    // 必须显式中立：B 组本身没有这个属性，不中立则浅色下 active 比 hover 多一层
    // （破坏上一条不变量），而且 T4 摘掉 2351 行那天它会无声消失。
    // jsdom 算不出 box-shadow 的最终计算值，这里只钉类名——真浏览器实测（两主题）
    // 与 legacy 剥离对照见 T3 报告 §7 与 _scratch/t3-probe-*.txt。
    const chip = document.querySelector<HTMLElement>('.group-template-category-filter')!
    expect(chip.classList.contains('shadow-none')).toBe(true)

    // 选中态由 aria-pressed 驱动（.active 只是 legacy 钩子，不承担视觉）
    const option = document.querySelector<HTMLElement>('.group-template-option')!
    expect(option.getAttribute('aria-pressed')).toBe('false')
    expect(option.classList.contains('active')).toBe(false)
  })
})
