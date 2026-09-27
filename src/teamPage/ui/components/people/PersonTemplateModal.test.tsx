// @vitest-environment jsdom

import { act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultStore } from '../../../../group/store'
import type { RoleTemplate } from '../../../../group/types'
import { createTeamPageState } from '../../../appState'
import { createFakeServices, renderWithServices } from '../../test/TestProviders'
import { PersonTemplateModal } from './PersonTemplateModal'

/*
 * 人员编辑弹窗 RTL（peopleLibraryView.test.ts 表单部分重写）。GPTs/Grok
 * 条件字段的显隐与提交载荷、空人设创建、AI 生成回填与未知路由重载提示、
 * 50 字名称上限、编辑已有人员（UPDATE 载荷）逐条对应。
 * 已知偏差：新建时默认站点跟随 store.settings.defaultChatSite（默认
 * deepseek）——旧测试断言的 gemini 是裸 fixture 无选中单选的产物。
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

function renderEditor(state = createTeamPageState(), serviceOverrides = {}) {
  return renderWithServices(<PersonTemplateModal />, { state, ...serviceOverrides })
}

function openEditor(services: ReturnType<typeof createFakeServices>): Promise<void> {
  return act(async () => {
    services.uiBus.emit('open-person-template-edit')
  })
}

function submitButton(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>('#people-library-form button[type="submit"]')!
}

describe('team page person template modal', () => {
  let user: ReturnType<typeof userEvent.setup>

  beforeEach(() => {
    user = userEvent.setup()
    vi.mocked(showError).mockClear()
  })

  it('submits a ChatGPT GPTs prefix when creating a library person', async () => {
    const state = createTeamPageState()
    state.store = createDefaultStore()
    const { services } = renderEditor(state)

    await openEditor(services)

    await user.type(document.querySelector<HTMLInputElement>('#template-name')!, '飞飞教练')
    await user.type(document.querySelector<HTMLTextAreaElement>('#template-prompt')!, '以教练方式回应')
    await user.click(document.querySelector<HTMLInputElement>('#template-site-chatgpt')!)
    expect(document.querySelector('#template-chatgpt-gpts-field')).not.toBeNull()
    await user.type(document.querySelector<HTMLInputElement>('#template-chatgpt-gpts-url')!, 'https://chatgpt.com/g/g-LrdzaEiqT-fei-fei-jiao-lian/c/69f7fabe-9878-83a8-a867-88ebb36967d4')
    await user.click(submitButton())

    expect(services.runCommand).toHaveBeenCalledWith('ROLE_TEMPLATE_CREATE', {
      name: '飞飞教练',
      description: '',
      systemPrompt: '以教练方式回应',
      defaultModelSource: 'site',
      defaultChatSite: 'chatgpt',
      defaultExternalModelId: undefined,
      chatGptGptsUrl: 'https://chatgpt.com/g/g-LrdzaEiqT-fei-fei-jiao-lian/c/69f7fabe-9878-83a8-a867-88ebb36967d4',
      grokProjectUrl: undefined,
    })
    // 保存成功后关闭并清空编辑目标
    await waitFor(() => expect(document.querySelector('#person-template-modal')).toBeNull())
    expect(state.selectedTemplateId).toBeUndefined()
  })

  it('hides the ChatGPT GPTs prefix field and drops its value when another site is selected', async () => {
    const state = createTeamPageState()
    state.store = createDefaultStore()
    const { services } = renderEditor(state)

    await openEditor(services)

    await user.click(document.querySelector<HTMLInputElement>('#template-site-chatgpt')!)
    await user.type(document.querySelector<HTMLInputElement>('#template-chatgpt-gpts-url')!, 'https://chatgpt.com/g/g-LrdzaEiqT-fei-fei-jiao-lian')
    await user.click(document.querySelector<HTMLInputElement>('#template-site-deepseek')!)
    // 条件字段卸载 = 值丢弃（原 syncTemplateModelFields 清空对译）
    expect(document.querySelector('#template-chatgpt-gpts-field')).toBeNull()

    await user.click(document.querySelector<HTMLInputElement>('#template-site-chatgpt')!)
    expect(document.querySelector<HTMLInputElement>('#template-chatgpt-gpts-url')!.value).toBe('')
  })

  it('submits a Grok project URL when creating a library person', async () => {
    const state = createTeamPageState()
    state.store = createDefaultStore()
    const { services } = renderEditor(state)

    await openEditor(services)

    await user.type(document.querySelector<HTMLInputElement>('#template-name')!, '项目顾问')
    await user.type(document.querySelector<HTMLTextAreaElement>('#template-prompt')!, '在项目上下文中回应')
    await user.click(document.querySelector<HTMLInputElement>('#template-site-grok')!)
    expect(document.querySelector('#template-grok-project-field')).not.toBeNull()
    await user.type(document.querySelector<HTMLInputElement>('#template-grok-project-url')!, 'https://grok.com/project/a9e415eb-149b-42b8-811a-63b12477ed81?source=share')
    await user.click(submitButton())

    expect(services.runCommand).toHaveBeenCalledWith('ROLE_TEMPLATE_CREATE', {
      name: '项目顾问',
      description: '',
      systemPrompt: '在项目上下文中回应',
      defaultModelSource: 'site',
      defaultChatSite: 'grok',
      defaultExternalModelId: undefined,
      chatGptGptsUrl: undefined,
      grokProjectUrl: 'https://grok.com/project/a9e415eb-149b-42b8-811a-63b12477ed81?source=share',
    })
  })

  it('hides the Grok project field when another site is selected', async () => {
    const state = createTeamPageState()
    state.store = createDefaultStore()
    const { services } = renderEditor(state)

    await openEditor(services)

    await user.click(document.querySelector<HTMLInputElement>('#template-site-grok')!)
    await user.type(document.querySelector<HTMLInputElement>('#template-grok-project-url')!, 'https://grok.com/project/a9e415eb-149b-42b8-811a-63b12477ed81')
    await user.click(document.querySelector<HTMLInputElement>('#template-site-deepseek')!)

    expect(document.querySelector('#template-grok-project-field')).toBeNull()
  })

  it('submits library people with an empty persona', async () => {
    const state = createTeamPageState()
    state.store = createDefaultStore()
    const { services } = renderEditor(state)

    await openEditor(services)

    await user.type(document.querySelector<HTMLInputElement>('#template-name')!, '观察员')
    await user.click(submitButton())

    expect(services.runCommand).toHaveBeenCalledWith('ROLE_TEMPLATE_CREATE', {
      name: '观察员',
      description: '',
      systemPrompt: '',
      defaultModelSource: 'site',
      defaultChatSite: 'deepseek',
      defaultExternalModelId: undefined,
      chatGptGptsUrl: undefined,
      grokProjectUrl: undefined,
    })
  })

  it('fills the new person form from an AI-generated persona draft', async () => {
    const state = createTeamPageState()
    state.store = createDefaultStore()
    const services = createFakeServices({
      sendRuntimeMessage: vi.fn(async () => ({
        ok: true,
        persona: {
          name: '增长顾问',
          description: '负责从获客、转化和复盘角度给建议。',
          systemPrompt: '你是增长顾问。先判断目标和约束，再给出可执行建议。',
        },
      })),
    })
    renderWithServices(<PersonTemplateModal />, { state, services })

    await openEditor(services)

    await user.type(document.querySelector<HTMLTextAreaElement>('#template-ai-description')!, '一个擅长小红书增长的内容顾问')
    await user.click(document.querySelector<HTMLButtonElement>('#generate-template-persona')!)
    await act(async () => {})

    expect(services.sendRuntimeMessage).toHaveBeenCalledWith('ROLE_TEMPLATE_PERSONA_GENERATE', { description: '一个擅长小红书增长的内容顾问' })
    expect(document.querySelector<HTMLInputElement>('#template-name')!.value).toBe('增长顾问')
    expect(document.querySelector<HTMLTextAreaElement>('#template-description')!.value).toBe('负责从获客、转化和复盘角度给建议。')
    expect(document.querySelector<HTMLTextAreaElement>('#template-prompt')!.value).toBe('你是增长顾问。先判断目标和约束，再给出可执行建议。')
    expect(document.querySelector('#template-persona-generation-status')?.textContent).toContain('已生成')
  })

  it('shows a reload hint when the running background does not know the persona generation route', async () => {
    const state = createTeamPageState()
    state.store = createDefaultStore()
    const services = createFakeServices({
      sendRuntimeMessage: vi.fn(async () => {
        throw new Error('Unknown OpenTeam message')
      }),
    })
    renderWithServices(<PersonTemplateModal />, { state, services })

    await openEditor(services)

    await user.type(document.querySelector<HTMLTextAreaElement>('#template-ai-description')!, '一个擅长复盘的教练')
    await user.click(document.querySelector<HTMLButtonElement>('#generate-template-persona')!)
    await act(async () => {})

    expect(showError).toHaveBeenCalledWith('AI 生成人设需要重新加载 OpenTeam 扩展后再使用')
  })

  it('requires an AI description before generating', async () => {
    const state = createTeamPageState()
    state.store = createDefaultStore()
    const { services } = renderEditor(state)

    await openEditor(services)

    await user.click(document.querySelector<HTMLButtonElement>('#generate-template-persona')!)
    await act(async () => {})

    expect(showError).toHaveBeenCalledWith('请先描述想要生成的人设')
    expect(services.sendRuntimeMessage).not.toHaveBeenCalled()
  })

  it('allows library people names up to 50 characters', async () => {
    const state = createTeamPageState()
    state.store = createDefaultStore()
    const { services } = renderEditor(state)
    const longName = '研'.repeat(50)

    await openEditor(services)

    await user.type(document.querySelector<HTMLInputElement>('#template-name')!, longName)
    await user.click(submitButton())

    expect(showError).not.toHaveBeenCalled()
    expect(services.runCommand).toHaveBeenCalledWith('ROLE_TEMPLATE_CREATE', expect.objectContaining({ name: longName }))
  })

  it('rejects an empty name and keeps the editor open', async () => {
    const state = createTeamPageState()
    state.store = createDefaultStore()
    const { services } = renderEditor(state)

    await openEditor(services)

    await user.click(submitButton())

    expect(showError).toHaveBeenCalledWith('人员名称不能为空')
    expect(services.runCommand).not.toHaveBeenCalled()
    expect(document.querySelector('#person-template-modal')).not.toBeNull()
  })

  it('prefills and updates an existing person through ROLE_TEMPLATE_UPDATE', async () => {
    const state = createTeamPageState()
    const store = createDefaultStore()
    const template = makeTemplate(1)
    store.roleTemplateOrder = [template.id]
    store.roleTemplatesById = { [template.id]: template }
    state.store = store
    state.selectedTemplateId = template.id
    const { services } = renderEditor(state)

    await openEditor(services)

    expect(document.querySelector('#template-form-title')?.textContent).toBe('编辑人员：人员1')
    expect(document.querySelector<HTMLInputElement>('#template-name')!.value).toBe('人员1')
    expect(document.querySelector<HTMLTextAreaElement>('#template-description')!.value).toBe('描述1')
    expect(document.querySelector<HTMLTextAreaElement>('#template-prompt')!.value).toBe('提示词1')

    await user.clear(document.querySelector<HTMLInputElement>('#template-name')!)
    await user.type(document.querySelector<HTMLInputElement>('#template-name')!, '改名人员')
    await user.click(submitButton())

    expect(services.runCommand).toHaveBeenCalledWith('ROLE_TEMPLATE_UPDATE', expect.objectContaining({
      templateId: 'template-1',
      name: '改名人员',
      defaultChatSite: 'gemini',
    }))
  })
})
