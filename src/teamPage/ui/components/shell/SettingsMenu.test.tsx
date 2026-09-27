// @vitest-environment jsdom

import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { createTeamPageState } from '../../../appState'
import { SettingsMenu } from './SettingsMenu'
import { getPendingLanguage } from '../../lib/languageOverride'
import { renderWithServices, createFakeServices } from '../../test/TestProviders'

afterEach(() => {
  cleanup()
})

function renderMenu(overrides = {}) {
  return renderWithServices(<SettingsMenu />, { services: createFakeServices(overrides) })
}

describe('SettingsMenu', () => {
  it('opens from the rail settings trigger and offers theme / language / agent control entries', async () => {
    const user = userEvent.setup()
    renderMenu()

    await user.click(screen.getByRole('button', { name: '设置' }))

    expect(await screen.findByRole('menuitemradio', { name: '浅色' })).toBeTruthy()
    expect(screen.getByRole('menuitemradio', { name: '深色' })).toBeTruthy()
    expect(screen.getByRole('menuitemradio', { name: 'English' })).toBeTruthy()
    expect(screen.getByRole('menuitemradio', { name: '中文' })).toBeTruthy()
    expect(screen.getByRole('menuitemcheckbox', { name: '本机智能体控制' })).toBeTruthy()
    expect(screen.getByText('端口 19305，仅允许本机连接。开启后本机工具可创建群聊并发送任务。')).toBeTruthy()
  })

  it('issues the theme change through services.theme', async () => {
    const user = userEvent.setup()
    const { services } = renderMenu()

    await user.click(screen.getByRole('button', { name: '设置' }))
    await user.click(await screen.findByRole('menuitemradio', { name: '浅色' }))

    expect(vi.mocked(services.theme.setTheme)).toHaveBeenCalledWith('light')
  })

  it('switches language optimistically and issues GROUP_SETTINGS_UPDATE', async () => {
    const user = userEvent.setup()
    const { services } = renderMenu()

    await user.click(screen.getByRole('button', { name: '设置' }))
    await user.click(await screen.findByRole('menuitemradio', { name: 'English' }))

    expect(vi.mocked(services.runCommand)).toHaveBeenCalledWith('GROUP_SETTINGS_UPDATE', { language: 'en' })
    // 乐观生效：命令回包前全页（含 documentElement 标记）已切到目标语言
    expect(document.documentElement.dataset.language).toBe('en')

    // 命令落定后 pending 清除（假 runCommand 立即 resolve，microtask 内完成）
    await waitFor(() => expect(getPendingLanguage()).toBeUndefined())
  })

  it('falls back to the previous language when the command fails', async () => {
    const user = userEvent.setup()
    renderMenu({ runCommand: vi.fn(async () => { throw new Error('命令失败') }) })

    await user.click(screen.getByRole('button', { name: '设置' }))
    await user.click(await screen.findByRole('menuitemradio', { name: 'English' }))

    await waitFor(() => expect(getPendingLanguage()).toBeUndefined())
    expect(document.documentElement.dataset.language).toBe('zh-CN')
  })

  it('toggles agent control through GROUP_SETTINGS_UPDATE and reflects the connection state', async () => {
    const user = userEvent.setup()
    const state = createTeamPageState()
    state.store.settings.agentControlEnabled = true
    state.controlStatus = { state: 'connected', port: 19305 }
    const { services } = renderWithServices(<SettingsMenu />, { state })

    await user.click(screen.getByRole('button', { name: '设置' }))

    const checkbox = await screen.findByRole('menuitemcheckbox', { name: '本机智能体控制' })
    expect(checkbox.getAttribute('data-state')).toBe('checked')
    expect(screen.getByText('已连接 OpenTeam CLI daemon（端口 19305）。本机工具可以创建群聊并发送任务。')).toBeTruthy()

    await user.click(checkbox)
    expect(vi.mocked(services.runCommand)).toHaveBeenCalledWith('GROUP_SETTINGS_UPDATE', { agentControlEnabled: false })
  })
})
