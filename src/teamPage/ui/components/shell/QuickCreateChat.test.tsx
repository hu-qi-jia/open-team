// @vitest-environment jsdom

import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { QuickCreateChatForm, QuickCreateChatProvider, QuickCreateChatTrigger } from './QuickCreateChat'
import { renderWithServices } from '../../test/TestProviders'

afterEach(() => {
  cleanup()
})

function renderQuickCreate() {
  return renderWithServices(
    <QuickCreateChatProvider>
      <QuickCreateChatTrigger />
      <QuickCreateChatForm />
    </QuickCreateChatProvider>,
    {},
  )
}

describe('QuickCreateChat', () => {
  it('keeps the create form hidden until the trigger is clicked, then focuses the name input', async () => {
    const user = userEvent.setup()
    renderQuickCreate()

    expect(document.querySelector('#create-chat-form')).toBeNull()

    await user.click(screen.getByRole('button', { name: '新建群聊' }))

    expect(document.querySelector<HTMLFormElement>('#create-chat-form')).toBeTruthy()
    expect(screen.getByRole('button', { name: '新建群聊' }).getAttribute('aria-expanded')).toBe('true')
    await waitFor(() => expect(document.activeElement?.id).toBe('new-chat-name'))
  })

  it('creates a collaborative chat with the trimmed name and resets the form', async () => {
    const user = userEvent.setup()
    const { services } = renderQuickCreate()

    await user.click(screen.getByRole('button', { name: '新建群聊' }))
    await user.type(screen.getByLabelText('群聊名称'), '  产品方案讨论  ')
    await user.click(screen.getByRole('button', { name: '创建' }))

    expect(vi.mocked(services.runCommand)).toHaveBeenCalledWith('GROUP_CHAT_CREATE', {
      name: '产品方案讨论',
      mode: 'collaborative',
      roles: [],
    })
    await waitFor(() => expect(document.querySelector('#create-chat-form')).toBeNull())
  })

  it('falls back to the default chat name when the input is blank', async () => {
    const user = userEvent.setup()
    const { services } = renderQuickCreate()

    await user.click(screen.getByRole('button', { name: '新建群聊' }))
    await user.click(screen.getByRole('button', { name: '创建' }))

    expect(vi.mocked(services.runCommand)).toHaveBeenCalledWith('GROUP_CHAT_CREATE', expect.objectContaining({ name: '新群聊' }))
  })

  it('supports the independent expert mode', async () => {
    const user = userEvent.setup()
    const { services } = renderQuickCreate()

    await user.click(screen.getByRole('button', { name: '新建群聊' }))
    await user.click(screen.getByLabelText(/独立专家/))
    await user.click(screen.getByRole('button', { name: '创建' }))

    expect(vi.mocked(services.runCommand)).toHaveBeenCalledWith('GROUP_CHAT_CREATE', expect.objectContaining({ mode: 'independent' }))
  })

  it('closes on cancel and reopens cleanly', async () => {
    const user = userEvent.setup()
    renderQuickCreate()

    await user.click(screen.getByRole('button', { name: '新建群聊' }))
    await user.type(screen.getByLabelText('群聊名称'), '临时群')
    await user.click(screen.getByRole('button', { name: '取消' }))

    expect(document.querySelector('#create-chat-form')).toBeNull()

    await user.click(screen.getByRole('button', { name: '新建群聊' }))
    expect((screen.getByLabelText('群聊名称') as HTMLInputElement).value).toBe('')
  })

  it('asks the vanilla side to open the group template picker via uiBus', async () => {
    const user = userEvent.setup()
    const { services } = renderQuickCreate()
    const emit = vi.spyOn(services.uiBus, 'emit')

    await user.click(screen.getByRole('button', { name: '新建群聊' }))
    await user.click(screen.getByRole('button', { name: '从模板中创建' }))

    expect(emit).toHaveBeenCalledWith('open-group-template-create')
  })

  it('closes when the vanilla template flow emits close-create-chat-popover', async () => {
    const user = userEvent.setup()
    const { services } = renderQuickCreate()

    await user.click(screen.getByRole('button', { name: '新建群聊' }))
    expect(document.querySelector('#create-chat-form')).toBeTruthy()

    // teamUiController 模板确认后的回程路径（closeCreateChatPopover dep → uiBus）
    services.uiBus.emit('close-create-chat-popover')

    await waitFor(() => expect(document.querySelector('#create-chat-form')).toBeNull())
  })
})
