// @vitest-environment jsdom

import { act } from '@testing-library/react'
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
    expect(document.querySelector<HTMLElement>('#temporary-person-modal')?.hidden).toBe(true)
  })

  it('rejects an empty name and stays open', async () => {
    const state = createTeamPageState()
    state.store = createDefaultStore()
    const { services } = renderWithServices(<TemporaryPersonModal />, { state })

    await openTemporary(services)

    await user.click(document.querySelector<HTMLButtonElement>('#add-temporary-person-form button[type="submit"]')!)

    expect(showError).toHaveBeenCalledWith('人员名称不能为空')
    expect(state.temporaryPersonDrafts).toHaveLength(0)
    expect(document.querySelector<HTMLElement>('#temporary-person-modal')?.hidden).toBe(false)
  })

  it('closes from the close button and the Escape key', async () => {
    const state = createTeamPageState()
    state.store = createDefaultStore()
    const { services } = renderWithServices(<TemporaryPersonModal />, { state })

    await openTemporary(services)
    expect(document.querySelector<HTMLElement>('#temporary-person-modal')?.hidden).toBe(false)

    await act(async () => {
      document.querySelector<HTMLButtonElement>('#close-temporary-person')!.click()
    })
    expect(document.querySelector<HTMLElement>('#temporary-person-modal')?.hidden).toBe(true)

    await openTemporary(services)
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(document.querySelector<HTMLElement>('#temporary-person-modal')?.hidden).toBe(true)
  })
})
