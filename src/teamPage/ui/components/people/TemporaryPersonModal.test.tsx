// @vitest-environment jsdom

import { act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultStore } from '../../../../group/store'
import { createTeamPageState } from '../../../appState'
import { createFakeServices, renderWithServices } from '../../test/TestProviders'
import { TemporaryPersonModal } from './TemporaryPersonModal'

/*
 * 临时添加弹窗 RTL（peopleLibraryView openTemporaryPersonDialog /
 * addTemporaryPersonForm 重写）。提交写入 appState.temporaryPersonDrafts
 * 与 addPersonSiteByKey 后关闭；空名称报错并保持打开。
 */

vi.mock('../../lib/toast', () => ({ showError: vi.fn(), showSuccess: vi.fn() }))

import { showError } from '../../lib/toast'

function openTemporary(services: ReturnType<typeof createFakeServices>): Promise<void> {
  return act(async () => {
    services.uiBus.emit('open-temporary-person')
  })
}

describe('team page temporary person modal', () => {
  let user: ReturnType<typeof userEvent.setup>

  beforeEach(() => {
    user = userEvent.setup()
    vi.mocked(showError).mockClear()
  })

  it('stores a validated draft with the default chat site and closes', async () => {
    const state = createTeamPageState()
    state.store = createDefaultStore()
    const { services } = renderWithServices(<TemporaryPersonModal />, { state })

    await openTemporary(services)

    // 打开即清空上次输入（原 openTemporaryPersonDialog 清表单对译）
    await user.type(document.querySelector<HTMLInputElement>('#temporary-person-name')!, '临调员')
    await user.type(document.querySelector<HTMLTextAreaElement>('#temporary-person-description')!, '临时描述')
    await user.type(document.querySelector<HTMLTextAreaElement>('#temporary-person-prompt')!, '临时人设')
    await user.click(document.querySelector<HTMLButtonElement>('#add-temporary-person-form button[type="submit"]')!)

    expect(showError).not.toHaveBeenCalled()
    expect(state.temporaryPersonDrafts).toHaveLength(1)
    const draft = state.temporaryPersonDrafts[0]
    expect(draft.id).toMatch(/^temporary-/)
    expect(draft.name).toBe('临调员')
    expect(draft.description).toBe('临时描述')
    expect(draft.systemPrompt).toBe('临时人设')
    expect(draft.chatSite).toBe('deepseek')
    expect(state.addPersonSiteByKey.get(`temporary:${draft.id}`)).toEqual(new Set(['site:deepseek']))
    // Radix Dialog 关闭即卸载（原 hidden 属性断言对译）
    await waitFor(() => expect(document.querySelector('#temporary-person-modal')).toBeNull())
  })

  it('renders through the shared modal shell with the sm width token and its own close button', async () => {
    const state = createTeamPageState()
    state.store = createDefaultStore()
    const { services } = renderWithServices(<TemporaryPersonModal />, { state })

    await openTemporary(services)

    const modal = document.querySelector<HTMLElement>('#temporary-person-modal')
    expect(modal).not.toBeNull()
    // 宽度令牌由 AppModal 的 size="sm" 承担（沟槽统一 48px），原语基类的
    // sm:max-w-lg 必须被 max-w-none sm:max-w-none 抵掉
    expect(modal!.classList.contains('w-[min(520px,calc(100vw-48px))]')).toBe(true)
    expect(modal!.classList.contains('max-w-lg')).toBe(false)
    // p-0 是壳自己的贡献（抵掉原语基类的 p-6）：内容节点确实由 AppModal 渲染，
    // 而不是还留着手写的 DialogContent
    expect(modal!.classList.contains('p-0')).toBe(true)
    // 正文内边距必须靠 bodyClassName 补回来（本弹窗自己不带任何 padding，
    // jsdom 不算布局，漏了单测抓不到）
    const bodyRow = modal!.lastElementChild as HTMLElement
    expect(bodyRow.classList.contains('min-h-0')).toBe(true)
    expect(bodyRow.classList.contains('p-6')).toBe(true)
    expect(bodyRow.querySelector('#add-temporary-person-form')).not.toBeNull()

    // 首焦收敛到壳的 initialFocusId（原 onOpenAutoFocus + getElementById 的等价改写）
    await waitFor(() => expect(document.activeElement?.id).toBe('temporary-person-name'))

    // 自绘 × 的 id 生命转移到 AppModal 的 closeId
    const close = document.querySelector<HTMLButtonElement>('#close-temporary-person')
    expect(close).not.toBeNull()

    await user.type(document.querySelector<HTMLInputElement>('#temporary-person-name')!, '临时草稿')
    await act(async () => { close!.click() })
    await waitFor(() => expect(document.querySelector('#temporary-person-modal')).toBeNull())

    // 重新打开即清空上次输入（原 openTemporaryPersonDialog 清表单对译）
    await openTemporary(services)
    expect(document.querySelector<HTMLInputElement>('#temporary-person-name')!.value).toBe('')
  })

  it('rejects an empty name and stays open', async () => {
    const state = createTeamPageState()
    state.store = createDefaultStore()
    const { services } = renderWithServices(<TemporaryPersonModal />, { state })

    await openTemporary(services)

    await user.click(document.querySelector<HTMLButtonElement>('#add-temporary-person-form button[type="submit"]')!)

    expect(showError).toHaveBeenCalledWith('人员名称不能为空')
    expect(state.temporaryPersonDrafts).toHaveLength(0)
    expect(document.querySelector('#temporary-person-modal')).not.toBeNull()
  })

  it('closes from the close button and the Escape key', async () => {
    const state = createTeamPageState()
    state.store = createDefaultStore()
    const { services } = renderWithServices(<TemporaryPersonModal />, { state })

    await openTemporary(services)
    expect(document.querySelector('#temporary-person-modal')).not.toBeNull()

    await act(async () => {
      document.querySelector<HTMLButtonElement>('#close-temporary-person')!.click()
    })
    await waitFor(() => expect(document.querySelector('#temporary-person-modal')).toBeNull())

    await openTemporary(services)
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await waitFor(() => expect(document.querySelector('#temporary-person-modal')).toBeNull())
  })
})
