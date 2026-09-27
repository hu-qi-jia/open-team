// @vitest-environment jsdom

import { act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { createDefaultStore } from '../../../../group/store'
import type { ExternalModelConfig, OpenTeamStore } from '../../../../group/types'
import { createTeamPageState } from '../../../appState'
import { createFakeServices, renderWithServices } from '../../test/TestProviders'
import { ExternalModelsModal } from './ExternalModelsModal'

/*
 * 外部模型弹窗 RTL（externalModelsView.test.ts 重写）。卡片操作（测试/
 * 编辑/删除）、创建与更新载荷、删除确认（window.confirm → AlertDialog）、
 * 新建按钮清表单、英文模式、空态逐条对应；测试按钮的 测试中/测试通过/
 * 失败还原状态机一并覆盖。
 */

vi.mock('../../lib/toast', () => ({ showError: vi.fn(), showSuccess: vi.fn() }))

import { showError } from '../../lib/toast'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function makeModel(overrides: Partial<ExternalModelConfig> = {}): ExternalModelConfig {
  return {
    id: 'external-model-1',
    name: '本地模型',
    format: 'openai',
    baseUrl: 'https://api.example.test/v1',
    apiKey: 'sk-test',
    modelName: 'local-chat-model',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function makeStoreWithModel(model: ExternalModelConfig | undefined, language: 'zh-CN' | 'en' = 'zh-CN'): OpenTeamStore {
  const store = createDefaultStore()
  store.settings.language = language
  if (model) {
    store.settings.externalModelOrder = [model.id]
    store.settings.externalModelsById[model.id] = model
  }
  return store
}

function renderModal(state = createTeamPageState(), serviceOverrides = {}) {
  return renderWithServices(<ExternalModelsModal />, { state, ...serviceOverrides })
}

async function openModal(services: ReturnType<typeof createFakeServices>): Promise<void> {
  await act(async () => {
    services.uiBus.emit('open-external-models')
  })
}

describe('team page external models modal', () => {
  let user: ReturnType<typeof userEvent.setup>

  beforeEach(() => {
    user = userEvent.setup()
    vi.mocked(showError).mockClear()
  })

  it('lists saved models with test, edit, and delete actions', async () => {
    const state = createTeamPageState()
    state.store = makeStoreWithModel(makeModel())
    const { services } = renderModal(state)

    await openModal(services)

    const list = document.querySelector('#external-models-list')!
    expect(list.textContent).toContain('本地模型')
    expect(list.textContent).toContain('OpenAI · local-chat-model')
    expect(list.textContent).toContain('https://api.example.test/v1')
    expect(list.querySelector('.external-model-test')).not.toBeNull()
    expect(list.querySelector('.external-model-edit')).not.toBeNull()
    expect(list.querySelector('.external-model-delete')).not.toBeNull()
  })

  it('runs the connectivity test and shows 测试通过 without sending commands', async () => {
    const state = createTeamPageState()
    state.store = makeStoreWithModel(makeModel())
    // 延迟兑现：让「测试中」阶段在断言时仍可见（即时 resolve 会直接跳到
    // 测试通过，user.click 内部的 microtask 冲刷就已完成整个流程）
    let resolveTest: (response: { ok: boolean }) => void = () => {}
    const services = createFakeServices({
      sendRuntimeMessage: vi.fn(() => new Promise<{ ok: boolean }>(resolve => {
        resolveTest = resolve
      })),
    })
    renderModal(state, { services })

    await openModal(services)

    const testButton = document.querySelector<HTMLButtonElement>('.external-model-test')!
    await user.click(testButton)
    expect(testButton.disabled).toBe(true)
    expect(testButton.textContent).toBe('测试中')

    await act(async () => {
      resolveTest({ ok: true })
    })

    expect(services.sendRuntimeMessage).toHaveBeenCalledWith('EXTERNAL_MODEL_TEST', { modelId: 'external-model-1' })
    expect(services.runCommand).not.toHaveBeenCalled()
    expect(showError).not.toHaveBeenCalled()
    expect(testButton.textContent).toBe('测试通过')
  })

  it('restores the test button after the success timeout', async () => {
    const state = createTeamPageState()
    state.store = makeStoreWithModel(makeModel())
    const services = createFakeServices({
      sendRuntimeMessage: vi.fn(async () => ({ ok: true })),
    })
    renderModal(state, { services })

    await openModal(services)
    await user.click(document.querySelector<HTMLButtonElement>('.external-model-test')!)
    await act(async () => {})
    expect(document.querySelector<HTMLButtonElement>('.external-model-test')!.textContent).toBe('测试通过')

    // 1200ms 后还原（原 testModel 的 setTimeout 对译；真实定时器直等）
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 1300))
    })
    const testButton = document.querySelector<HTMLButtonElement>('.external-model-test')!
    expect(testButton.textContent).toBe('测试')
    expect(testButton.disabled).toBe(false)
  })

  it('shows an error and restores the button when the test fails', async () => {
    const state = createTeamPageState()
    state.store = makeStoreWithModel(makeModel())
    const services = createFakeServices({
      sendRuntimeMessage: vi.fn(async () => ({ ok: false, error: '连接失败' })),
    })
    renderModal(state, { services })

    await openModal(services)
    await user.click(document.querySelector<HTMLButtonElement>('.external-model-test')!)
    await act(async () => {})

    expect(showError).toHaveBeenCalledWith('连接失败')
    const testButton = document.querySelector<HTMLButtonElement>('.external-model-test')!
    expect(testButton.textContent).toBe('测试')
    expect(testButton.disabled).toBe(false)
  })

  it('creates an external model from the form and resets it', async () => {
    const state = createTeamPageState()
    state.store = makeStoreWithModel(undefined)
    const { services } = renderModal(state)

    await openModal(services)

    await user.type(document.querySelector<HTMLInputElement>('#external-model-name')!, '中转模型')
    await user.selectOptions(document.querySelector<HTMLSelectElement>('#external-model-format')!, 'anthropic')
    await user.type(document.querySelector<HTMLInputElement>('#external-model-base-url')!, 'https://relay.example.com/v1')
    await user.type(document.querySelector<HTMLInputElement>('#external-model-api-key')!, 'sk-relay')
    await user.type(document.querySelector<HTMLInputElement>('#external-model-model-name')!, 'claude-sonnet')
    await user.click(document.querySelector<HTMLButtonElement>('#external-model-form button[type="submit"]')!)

    expect(services.runCommand).toHaveBeenCalledWith('EXTERNAL_MODEL_CREATE', {
      name: '中转模型',
      format: 'anthropic',
      baseUrl: 'https://relay.example.com/v1',
      apiKey: 'sk-relay',
      modelName: 'claude-sonnet',
    })
    // 保存成功后表单回到新建态（原 resetForm 对译）
    expect(document.querySelector<HTMLInputElement>('#external-model-name')!.value).toBe('')
    expect(document.querySelector<HTMLInputElement>('#external-model-id')!.value).toBe('')
  })

  it('prefills the form for editing and submits EXTERNAL_MODEL_UPDATE', async () => {
    const state = createTeamPageState()
    state.store = makeStoreWithModel(makeModel())
    const { services } = renderModal(state)

    await openModal(services)

    await user.click(document.querySelector<HTMLButtonElement>('.external-model-edit')!)
    expect(document.querySelector<HTMLInputElement>('#external-model-name')!.value).toBe('本地模型')
    expect(document.querySelector<HTMLInputElement>('#external-model-id')!.value).toBe('external-model-1')
    expect((document.querySelector<HTMLSelectElement>('#external-model-format')! as HTMLSelectElement).value).toBe('openai')
    expect(document.querySelector<HTMLInputElement>('#external-model-api-key')!.value).toBe('sk-test')

    await user.clear(document.querySelector<HTMLInputElement>('#external-model-name')!)
    await user.type(document.querySelector<HTMLInputElement>('#external-model-name')!, '改名模型')
    await user.click(document.querySelector<HTMLButtonElement>('#external-model-form button[type="submit"]')!)

    expect(services.runCommand).toHaveBeenCalledWith('EXTERNAL_MODEL_UPDATE', {
      modelId: 'external-model-1',
      name: '改名模型',
      format: 'openai',
      baseUrl: 'https://api.example.test/v1',
      apiKey: 'sk-test',
      modelName: 'local-chat-model',
    })
  })

  it('resets the editing draft through the 新建 button', async () => {
    const state = createTeamPageState()
    state.store = makeStoreWithModel(makeModel())
    const { services } = renderModal(state)

    await openModal(services)

    await user.click(document.querySelector<HTMLButtonElement>('.external-model-edit')!)
    expect(document.querySelector<HTMLInputElement>('#external-model-name')!.value).toBe('本地模型')

    await user.click(document.querySelector<HTMLButtonElement>('#reset-external-model-form')!)
    expect(document.querySelector<HTMLInputElement>('#external-model-name')!.value).toBe('')
    expect(document.querySelector<HTMLInputElement>('#external-model-id')!.value).toBe('')
    expect(services.runCommand).not.toHaveBeenCalled()
  })

  it('deletes a model through the confirm dialog', async () => {
    const state = createTeamPageState()
    state.store = makeStoreWithModel(makeModel())
    const { services } = renderModal(state)

    await openModal(services)

    await user.click(document.querySelector<HTMLButtonElement>('.external-model-delete')!)
    const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement
    expect(dialog.textContent).toContain('确定删除外部模型「本地模型」吗？')

    await user.click(within(dialog).getByRole('button', { name: '删除' }))
    expect(services.runCommand).toHaveBeenCalledWith('EXTERNAL_MODEL_DELETE', { modelId: 'external-model-1' })
    expect(showError).not.toHaveBeenCalled()
  })

  it('shows the empty state without saved models', async () => {
    const state = createTeamPageState()
    state.store = makeStoreWithModel(undefined)
    const { services } = renderModal(state)

    await openModal(services)

    expect(document.querySelector('#external-models-list')?.textContent).toContain('暂无外部模型')
  })

  it('renders external model actions in English mode', async () => {
    const state = createTeamPageState()
    state.store = makeStoreWithModel(makeModel(), 'en')
    const { services } = renderModal(state, { language: 'en' })

    await openModal(services)

    const list = document.querySelector('#external-models-list')!
    expect(list.textContent).toContain('Test')
    expect(list.textContent).toContain('Edit')
    expect(list.textContent).toContain('Delete')
    expect(list.textContent).not.toContain('测试')
  })

  it('closes from the close button, backdrop, and Escape key', async () => {
    const state = createTeamPageState()
    state.store = makeStoreWithModel(makeModel())
    const { services } = renderModal(state)

    await openModal(services)
    expect(document.querySelector<HTMLElement>('#external-models-modal')?.hidden).toBe(false)

    await user.click(document.querySelector<HTMLButtonElement>('#close-external-models')!)
    expect(document.querySelector<HTMLElement>('#external-models-modal')?.hidden).toBe(true)

    await openModal(services)
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(document.querySelector<HTMLElement>('#external-models-modal')?.hidden).toBe(true)

    await openModal(services)
    const backdrop = document.querySelector<HTMLElement>('#external-models-modal')!
    await user.click(backdrop)
    expect(document.querySelector<HTMLElement>('#external-models-modal')?.hidden).toBe(true)
  })

  it('focuses the name field after opening', async () => {
    const state = createTeamPageState()
    state.store = makeStoreWithModel(makeModel())
    const { services } = renderModal(state)

    await openModal(services)

    expect(document.activeElement).toBe(document.querySelector('#external-model-name'))
  })
})
