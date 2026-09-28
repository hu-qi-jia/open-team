// @vitest-environment jsdom

import { act, waitFor, within } from '@testing-library/react'
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

  it('closes from the close button, overlay, and Escape key', async () => {
    const state = createTeamPageState()
    state.store = makeStoreWithModel(makeModel())
    const { services } = renderModal(state)

    await openModal(services)
    expect(document.querySelector('#external-models-modal')).not.toBeNull()

    await user.click(document.querySelector<HTMLButtonElement>('#close-external-models')!)
    await waitFor(() => expect(document.querySelector('#external-models-modal')).toBeNull())

    await openModal(services)
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await waitFor(() => expect(document.querySelector('#external-models-modal')).toBeNull())

    // Radix 遮罩：deferPointerDownOutside 把关闭推迟到后续 click，
    // user.click 的完整指针序列正好触发
    await openModal(services)
    await user.click(document.querySelector('[data-slot="dialog-overlay"]')!)
    await waitFor(() => expect(document.querySelector('#external-models-modal')).toBeNull())
  })

  it('focuses the name field after opening', async () => {
    const state = createTeamPageState()
    state.store = makeStoreWithModel(makeModel())
    const { services } = renderModal(state)

    await openModal(services)

    expect(document.activeElement).toBe(document.querySelector('#external-model-name'))
  })

  it('renders through the shared modal shell with the sm token and an auto height cap', async () => {
    const state = createTeamPageState()
    state.store = makeStoreWithModel(makeModel())
    const { services } = renderModal(state)

    await openModal(services)

    const modal = document.querySelector<HTMLElement>('#external-models-modal')
    expect(modal).not.toBeNull()
    // 宽度令牌由 AppModal 的 size="sm" 承担（520 / 沟槽统一 48px），原语基类的
    // sm:max-w-lg 必须被 max-w-none sm:max-w-none 抵掉
    expect(modal!.classList.contains('w-[min(520px,calc(100vw-48px))]')).toBe(true)
    expect(modal!.classList.contains('max-w-none')).toBe(true)
    expect(modal!.classList.contains('sm:max-w-none')).toBe(true)
    expect(modal!.classList.contains('max-w-lg')).toBe(false)
    // 高度上限是本任务补的洞：迁移前这个弹窗是全库唯一没有任何 max-h 的
    // 弹窗（内容可撑破视口），height="auto" 的整壳封顶 + 整壳滚动正好补上
    expect(modal!.classList.contains('max-h-[min(760px,calc(100vh-48px))]')).toBe(true)
    expect(modal!.classList.contains('overflow-auto')).toBe(true)
    // .template-editor-modal 退役（legacy 规则同 commit 删除）
    expect(modal!.classList.contains('template-editor-modal')).toBe(false)
    // p-0 是壳自己的贡献（抵掉原语基类的 p-6）：内容节点确实由 AppModal 渲染
    expect(modal!.classList.contains('p-0')).toBe(true)
    expect(modal!.getAttribute('aria-labelledby')).toBe('external-models-title')

    // 正文内边距必须靠 bodyClassName 补回来（本弹窗自己不带任何 padding，
    // jsdom 不算布局；s4-1b 用 #external-model-form 的 left 差值实测）。
    // height="auto" 下正文行不再加 overflow-auto——滚动归壳，避免双滚动条
    const bodyRow = modal!.lastElementChild as HTMLElement
    expect(bodyRow.classList.contains('min-h-0')).toBe(true)
    expect(bodyRow.classList.contains('p-6')).toBe(true)
    expect(bodyRow.classList.contains('overflow-auto')).toBe(false)

    // 共享族类名逐字保留：.template-list 的另一个使用者是已过审的
    // PeopleLibraryModal，.modal-form 的三个使用者是 T3/T4 已过审的弹窗——
    // 两族的 legacy 规则都不许在 T5 删，这里把「本弹窗照常消费」钉住
    const list = bodyRow.querySelector<HTMLElement>('#external-models-list')
    expect(list).not.toBeNull()
    expect(list!.classList.contains('template-list')).toBe(true)
    const form = bodyRow.querySelector<HTMLFormElement>('#external-model-form')
    expect(form).not.toBeNull()
    expect(form!.classList.contains('modal-form')).toBe(true)

    // 4 个可见文本框换官方 Input 原语（不再靠 legacy 全局 input{} 塑形）；
    // #external-model-id（type=hidden）无视觉、保持裸 input；
    // 原生 <select> 保持原生——换 Radix Select 会改键盘与取值行为
    for (const id of ['external-model-name', 'external-model-base-url', 'external-model-api-key', 'external-model-model-name']) {
      const input = form!.querySelector<HTMLInputElement>(`#${id}`)
      expect(input).not.toBeNull()
      expect(input!.getAttribute('data-slot')).toBe('input')
    }
    const hidden = form!.querySelector<HTMLInputElement>('#external-model-id')
    expect(hidden!.type).toBe('hidden')
    const format = form!.querySelector<HTMLSelectElement>('#external-model-format')
    expect(format).not.toBeNull()
    expect(format!.tagName).toBe('SELECT')
    expect(format!.getAttribute('data-slot')).toBeNull()

    // 自绘 × 字形换成壳的 lucide 图标钮（s4-3 断言「恰好一个可见 svg 关闭钮」）
    const close = modal!.querySelector<HTMLButtonElement>('#close-external-models')
    expect(close).not.toBeNull()
    expect(close!.getAttribute('aria-label')).toBe('关闭外部模型')
    expect(close!.querySelector('svg')).not.toBeNull()
    expect(close!.textContent).toBe('')

    // 头部与列表的 2026-09-28 修复三件套原样保留
    expect(modal!.querySelector('#external-models-title')!.textContent).toBe('外部模型')
    const card = list!.querySelector<HTMLElement>('.template-card')!
    expect(card.querySelector('[data-slot="card-header"]')!.classList.contains('gap-1')).toBe(true)
    expect(card.querySelector('[data-slot="card-header"]')!.classList.contains('px-0')).toBe(true)
    const action = card.querySelector<HTMLElement>('[data-slot="card-action"]')!
    expect(action.classList.contains('flex')).toBe(true)
    expect(action.classList.contains('items-center')).toBe(true)
    expect(action.classList.contains('gap-1')).toBe(true)
    const content = card.querySelector<HTMLElement>('[data-slot="card-content"]')!
    expect(content.classList.contains('px-0')).toBe(true)
    expect(content.classList.contains('text-muted-foreground')).toBe(true)
  })

  it('closes from #close-external-models and resets the draft', async () => {
    const state = createTeamPageState()
    state.store = makeStoreWithModel(makeModel())
    const { services } = renderModal(state)

    await openModal(services)
    await user.click(document.querySelector<HTMLButtonElement>('.external-model-edit')!)
    expect(document.querySelector<HTMLInputElement>('#external-model-name')!.value).toBe('本地模型')

    await user.click(document.querySelector<HTMLButtonElement>('#close-external-models')!)
    await waitFor(() => expect(document.querySelector('#external-models-modal')).toBeNull())

    // 再次打开：draft 已复位（close() 与 uiBus 打开路径都回 EMPTY_DRAFT）
    await openModal(services)
    expect(document.querySelector<HTMLInputElement>('#external-model-name')!.value).toBe('')
    expect(document.querySelector<HTMLInputElement>('#external-model-id')!.value).toBe('')
    expect(document.querySelector<HTMLSelectElement>('#external-model-format')!.value).toBe('openai')
  })
})
