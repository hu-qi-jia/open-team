// @vitest-environment jsdom

import { act, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultStore } from '../../../../group/store'
import type { GroupChat, GroupRole, OpenTeamStore, OrchestrationFlow } from '../../../../group/types'
import { createTeamPageState } from '../../../appState'
import type { TeamPageServices } from '../../context/ServicesContext'
import { applyOrchestrationAutoStreamChunk, endOrchestrationAutoStream } from '../../lib/orchestrationStreamStore'
import { createFakeServices, renderWithServices } from '../../test/TestProviders'
import { OrchestrationModal } from './OrchestrationModal'

/*
 * 编排弹窗 RTL（orchestrationModalView.test.ts 重写）。开弹窗 / 拖人成节点
 * （drop 事件 → CanvasPortal 内部 orchestrationCanvas 转交）/ 节点设置
 * （MockGraph.selectNode 模拟 node:click）/ 校验与保存运行载荷 / 重连顺序 /
 * 模板套用（二次套用走 AlertDialog 替换确认）/ 自动编排流式（独立
 * orchestrationStreamStore 注入 chunk）/ 重复运行防抖逐条对应。
 * X6 经 services.loadX6 注入 MockGraph（生产为真实动态 import）。
 */

vi.mock('../../lib/toast', () => ({ showError: vi.fn(), showSuccess: vi.fn() }))

import { showError, showSuccess } from '../../lib/toast'

class MockGraph {
  static instances: MockGraph[] = []
  nodes: Array<{ id?: string; label?: string; data?: Record<string, unknown> }> = []
  clearCalls = 0
  addNodeCalls = 0
  handlers = new Map<string, Array<(args: { node?: { getData(): Record<string, unknown> } }) => void>>()

  static latest(): MockGraph {
    const graph = MockGraph.instances[MockGraph.instances.length - 1]
    if (!graph) throw new Error('MockGraph was not mounted')
    return graph
  }

  constructor(public options: Record<string, unknown>) {
    MockGraph.instances.push(this)
  }
  clearCells(): void {
    this.clearCalls += 1
    this.nodes = []
  }
  addNode(node: unknown): unknown {
    this.addNodeCalls += 1
    this.nodes.push(node as { id?: string; data?: Record<string, unknown> })
    return node
  }
  addEdge(edge: unknown): unknown { return edge }
  on(eventName: string, handler: (args: { node?: { getData(): Record<string, unknown> } }) => void): void {
    this.handlers.set(eventName, [...this.handlers.get(eventName) ?? [], handler])
  }
  selectNode(stageId: string): void {
    act(() => {
      for (const handler of this.handlers.get('node:click') ?? []) handler({ node: { getData: () => ({ stageId }) } })
    })
  }
  getNodes(): Array<{ getData(): Record<string, unknown>; attr(path: string, value: unknown): void }> {
    return this.nodes.map(node => ({
      getData: () => node.data ?? {},
      attr: vi.fn(),
    }))
  }
  dispose(): void {}
}

type OrchestrationResponse = { ok?: boolean; error?: string; store?: OpenTeamStore; flow?: OrchestrationFlow; roles?: GroupRole[]; createdRoleIds?: string[]; reusedRoleIds?: string[] }

function makeStore(): OpenTeamStore {
  const store = createDefaultStore()
  const chat: GroupChat = { id: 'chat-1', name: '测试群聊', mode: 'collaborative', roleIds: ['role-1', 'role-2'], messageIds: [], nextMessageSeq: 1, status: 'ready', createdAt: 1, updatedAt: 1 }
  const roleOne: GroupRole = { id: 'role-1', chatId: 'chat-1', name: '产品', chatSite: 'chatgpt', status: 'ready', contextCursor: 0, createdAt: 1, updatedAt: 1 }
  const roleTwo: GroupRole = { id: 'role-2', chatId: 'chat-1', name: '评审', modelSource: 'external', externalModelId: 'model-1', status: 'ready', contextCursor: 0, createdAt: 1, updatedAt: 1 }
  store.currentChatId = chat.id
  store.chatOrder = [chat.id]
  store.chatsById[chat.id] = chat
  store.rolesById[roleOne.id] = roleOne
  store.rolesById[roleTwo.id] = roleTwo
  store.settings.externalModelOrder = ['model-1']
  store.settings.externalModelsById = {
    'model-1': { id: 'model-1', name: 'OpenRouter Claude', format: 'openai', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'key', modelName: 'anthropic/claude-sonnet-4', createdAt: 1, updatedAt: 1 },
  }
  return store
}

function storeWithRoles(baseStore: OpenTeamStore, roles: GroupRole[]): OpenTeamStore {
  const store = structuredClone(baseStore)
  store.chatsById['chat-1'].roleIds.push(...roles.map(role => role.id))
  for (const role of roles) store.rolesById[role.id] = role
  return store
}

function makeRole(id: string, name: string, overrides: Partial<GroupRole> = {}): GroupRole {
  return { id, chatId: 'chat-1', name, chatSite: 'deepseek', status: 'pending', contextCursor: 0, createdAt: 2, updatedAt: 2, ...overrides }
}

interface ModalHarness {
  state: ReturnType<typeof createTeamPageState>
  services: ReturnType<typeof createFakeServices>
  user: ReturnType<typeof userEvent.setup>
}

function renderModal(store: OpenTeamStore = makeStore(), serviceOverrides: Partial<TeamPageServices> = {}): ModalHarness {
  const state = createTeamPageState()
  state.store = store
  state.selectedChatId = 'chat-1'
  const services = createFakeServices({
    loadX6: (async () => ({ Graph: MockGraph })) as unknown as TeamPageServices['loadX6'],
    ...serviceOverrides,
  })
  const user = userEvent.setup()
  renderWithServices(<OrchestrationModal />, { state, services })
  return { state, services, user }
}

async function openModal(harness: ModalHarness): Promise<void> {
  await act(async () => {
    harness.services.uiBus.emit('open-orchestration')
  })
  await flushAsync()
}

function dropRole(roleId: string): void {
  act(() => {
    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', { value: { getData: () => roleId, types: ['application/x-openteam-role-id'] } })
    document.querySelector('#orchestration-stage-canvas')!.dispatchEvent(drop)
  })
}

function typeInto(selector: string, value: string): void {
  fireEvent.change(document.querySelector(selector)!, { target: { value } })
}

function commandPayload(harness: ModalHarness, type: string): Record<string, unknown> | undefined {
  return vi.mocked(harness.services.runCommand).mock.calls.find(call => call[0] === type)?.[1] as Record<string, unknown> | undefined
}

function flushAsync(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

beforeEach(() => {
  MockGraph.instances = []
  vi.mocked(showError).mockClear()
  vi.mocked(showSuccess).mockClear()
})

afterEach(() => {
  cleanup()
  endOrchestrationAutoStream()
})

describe('orchestration modal', () => {
  it('opens with drag-only people cards and creates one single-role node per drop without exposing stages', async () => {
    const harness = renderModal()
    await openModal(harness)

    const modal = document.querySelector('#orchestration-modal') as HTMLElement
    expect(modal).not.toBeNull()
    expect((document.querySelector('#orchestration-empty-hint') as HTMLElement).hidden).toBe(false)
    expect((document.querySelector('#orchestration-max-rounds') as HTMLInputElement).value).toBe('50')
    const people = document.querySelector('#orchestration-people-list')!
    expect(people.textContent).not.toContain('新阶段')
    expect(people.textContent).not.toContain('并行加入')
    expect(people.textContent).not.toContain('设为审核')
    expect(modal.textContent).not.toContain('阶段')
    expect([...people.querySelectorAll('.site-pill')].map(item => item.textContent)).toEqual(['ChatGPT', 'API · OpenRouter Claude'])

    dropRole('role-1')
    dropRole('role-2')
    await flushAsync()
    typeInto('#orchestration-task', '完成方案评审')
    await userEvent.click(document.querySelector('#run-orchestration')!)
    await flushAsync()

    const runPayload = commandPayload(harness, 'GROUP_ORCHESTRATION_RUN') as { flow?: OrchestrationFlow }
    expect(runPayload.flow?.stages.map(stage => stage.roleIds)).toEqual([['role-1'], ['role-2']])
    expect(runPayload.flow?.graph?.edges).toEqual([])
    // 运行成功后自动收起弹窗（原 run 成功分支的 close 对译）
    await waitFor(() => expect(document.querySelector('#orchestration-modal')).toBeNull())
  })

  it('opens orchestration setup without redirecting to external model setup', async () => {
    const store = makeStore()
    store.settings.externalModelOrder = []
    store.settings.externalModelsById = {}
    const harness = renderModal(store)

    await openModal(harness)

    expect(showError).not.toHaveBeenCalledWith('编排依赖外部模型 API，请先配置一个外部模型。')
    expect(document.querySelector('#orchestration-modal')).not.toBeNull()
  })

  it('prompts users to configure an external API before running an already-open draft', async () => {
    const openExternalModels = vi.fn()
    const harness = renderModal(undefined, {})
    harness.services.uiBus.on('open-external-models', openExternalModels)
    await openModal(harness)
    dropRole('role-1')
    await flushAsync()
    typeInto('#orchestration-task', '完成方案评审')
    const store = harness.state.store
    store.settings.externalModelOrder = []
    store.settings.externalModelsById = {}

    await userEvent.click(document.querySelector('#run-orchestration')!)
    await flushAsync()

    expect(showError).toHaveBeenCalledWith('编排依赖外部模型 API，请先配置一个外部模型。')
    expect(openExternalModels).toHaveBeenCalledTimes(1)
    expect(harness.services.runCommand).not.toHaveBeenCalledWith('GROUP_ORCHESTRATION_RUN', expect.anything())
  })

  it('refuses to run when the chat has no roles yet', async () => {
    const store = makeStore()
    store.chatsById['chat-1'].roleIds = []
    const harness = renderModal(store)
    await openModal(harness)

    expect(document.querySelector('#orchestration-people-list')!.textContent).toContain('当前群聊暂无人员')
    typeInto('#orchestration-task', '完成方案评审')
    await userEvent.click(document.querySelector('#run-orchestration')!)
    await flushAsync()

    expect(showError).toHaveBeenCalledWith('当前群聊暂无人员，无法编排任务')
    expect(harness.services.runCommand).not.toHaveBeenCalledWith('GROUP_ORCHESTRATION_RUN', expect.anything())
  })

  it('opens built-in orchestration templates from a compact picker button', async () => {
    const harness = renderModal()
    await openModal(harness)

    const trigger = document.querySelector('#open-orchestration-template')!
    expect(trigger.textContent).toContain('模板')
    expect(document.querySelector('#orchestration-template-modal')).toBeNull()
    await userEvent.click(trigger)

    expect(document.querySelector('#orchestration-template-modal')).not.toBeNull()
    const content = document.querySelector('#orchestration-template-content')!
    expect(content.textContent).toContain('编排类型')
    expect(content.textContent).toContain('业务场景')
    expect(content.textContent).toContain('并行汇总')
    expect(content.textContent).toContain('循环审核')
  })

  it('applies a built-in loop template by creating missing roles and generating a review fail edge', async () => {
    const store = makeStore()
    const createdRoles: GroupRole[] = [
      makeRole('role-writer', '执行者'),
      makeRole('role-reviewer', '审核员'),
    ]
    const nextStore = storeWithRoles(store, createdRoles)
    const harness = renderModal(store, {
      sendRuntimeMessage: vi.fn(async () => ({ ok: true, store: nextStore, roles: createdRoles })) as TeamPageServices['sendRuntimeMessage'],
    })
    await openModal(harness)

    // 模板选择改为 Radix Dialog：内容随 open 挂载，先点「模板」打开（原实现常驻 hidden DOM 可直接点卡片）
    await userEvent.click(document.querySelector('#open-orchestration-template')!)
    await userEvent.click(document.querySelector('[data-template-id="review-loop"]')!)
    await flushAsync()

    expect(harness.services.sendRuntimeMessage).toHaveBeenCalledWith('GROUP_ROLES_CREATE_BATCH', expect.objectContaining({
      chatId: 'chat-1',
      items: expect.arrayContaining([
        expect.objectContaining({ source: 'temporary', createdBy: 'orchestration-template', name: '执行者', chatSite: 'deepseek' }),
        expect.objectContaining({ source: 'temporary', createdBy: 'orchestration-template', name: '审核员', chatSite: 'deepseek' }),
      ]),
    }))
    await waitFor(() => expect(document.querySelector('#orchestration-template-modal')).toBeNull())
    expect(showSuccess).toHaveBeenLastCalledWith(expect.stringContaining('循环审核'))
    typeInto('#orchestration-task', '打磨一篇发布文案')
    await userEvent.click(document.querySelector('#save-orchestration')!)
    await flushAsync()

    const savePayload = commandPayload(harness, 'GROUP_ORCHESTRATION_FLOW_SAVE') as { flow?: OrchestrationFlow }
    expect(savePayload.flow?.stages.map(stage => stage.name)).toEqual(['产出初稿', '修改完善', '审核把关'])
    expect(savePayload.flow?.graph?.edges).toContainEqual(expect.objectContaining({ sourceStageId: expect.any(String), targetStageId: expect.any(String), sourcePort: 'fail' }))
    expect(savePayload.flow?.stages.find(stage => stage.kind === 'review')?.review?.instructions).toContain('通过')
  })

  it('fills an empty task from the selected built-in template so it can run immediately', async () => {
    const createdRoles: GroupRole[] = [
      makeRole('role-angle-a', '视角A'),
      makeRole('role-angle-b', '视角B'),
      makeRole('role-angle-c', '视角C'),
      makeRole('role-merger', '汇总者'),
    ]
    const store = makeStore()
    const harness = renderModal(store, {
      sendRuntimeMessage: vi.fn(async () => ({ ok: true, store: storeWithRoles(store, createdRoles), roles: createdRoles })) as TeamPageServices['sendRuntimeMessage'],
    })
    await openModal(harness)

    await userEvent.click(document.querySelector('#open-orchestration-template')!)
    await userEvent.click(document.querySelector('[data-template-id="parallel-merge"]')!)
    await flushAsync()

    expect((document.querySelector('#orchestration-task') as HTMLTextAreaElement).value).toBe('请从用户价值、成本风险、增长传播三个视角评估“是否要上线团队共享知识库”，并汇总成优先级明确的建议。')
    await userEvent.click(document.querySelector('#run-orchestration')!)
    await flushAsync()
    expect(harness.services.runCommand).toHaveBeenCalledWith('GROUP_ORCHESTRATION_RUN', expect.objectContaining({ task: '请从用户价值、成本风险、增长传播三个视角评估“是否要上线团队共享知识库”，并汇总成优先级明确的建议。' }))
  })

  it('keeps a user-written task when applying a built-in template', async () => {
    const harness = renderModal()
    await openModal(harness)
    typeInto('#orchestration-task', '评估我们自己的 OpenTeam 模板体验。')

    await userEvent.click(document.querySelector('#open-orchestration-template')!)
    await userEvent.click(document.querySelector('[data-template-id="parallel-merge"]')!)
    await flushAsync()

    expect((document.querySelector('#orchestration-task') as HTMLTextAreaElement).value).toBe('评估我们自己的 OpenTeam 模板体验。')
  })

  it('removes previously template-created roles before applying another built-in template', async () => {
    const store = makeStore()
    const loopRoles: GroupRole[] = [makeRole('role-loop-writer', '执行者'), makeRole('role-loop-reviewer', '审核员')]
    const parallelRoles: GroupRole[] = [makeRole('role-angle-a', '视角A', { createdAt: 3, updatedAt: 3 }), makeRole('role-angle-b', '视角B', { createdAt: 3, updatedAt: 3 }), makeRole('role-angle-c', '视角C', { createdAt: 3, updatedAt: 3 }), makeRole('role-merger', '汇总者', { createdAt: 3, updatedAt: 3 })]
    const harness = renderModal(store, {
      sendRuntimeMessage: vi.fn()
        .mockResolvedValueOnce({ ok: true, store: storeWithRoles(store, loopRoles), roles: loopRoles })
        .mockResolvedValueOnce({ ok: true, store: storeWithRoles(store, parallelRoles), roles: parallelRoles }) as TeamPageServices['sendRuntimeMessage'],
    })
    vi.mocked(harness.services.runCommand).mockImplementation(async (type: string, payload?: Record<string, unknown>) => {
      if (type !== 'GROUP_ROLE_DELETE') return
      const roleId = (payload as { roleId?: string } | undefined)?.roleId
      if (!roleId) return
      delete harness.state.store.rolesById[roleId]
      harness.state.store.chatsById['chat-1'].roleIds = harness.state.store.chatsById['chat-1'].roleIds.filter(id => id !== roleId)
    })
    await openModal(harness)

    await userEvent.click(document.querySelector('#open-orchestration-template')!)
    await userEvent.click(document.querySelector('[data-template-id="review-loop"]')!)
    await flushAsync()
    // 套用后选择弹窗自动关闭，二次套模板重新打开；画布已有节点先弹替换确认（原 window.confirm → AlertDialog）
    await userEvent.click(document.querySelector('#open-orchestration-template')!)
    await userEvent.click(document.querySelector('[data-template-id="parallel-merge"]')!)
    await userEvent.click(within(document.body).getByRole('button', { name: '替换' }))
    await flushAsync()

    expect(harness.services.runCommand).toHaveBeenCalledWith('GROUP_ROLE_DELETE', { roleId: 'role-loop-writer' })
    expect(harness.services.runCommand).toHaveBeenCalledWith('GROUP_ROLE_DELETE', { roleId: 'role-loop-reviewer' })
    const roleIds = harness.state.store.chatsById['chat-1'].roleIds
    expect(roleIds).not.toEqual(expect.arrayContaining(['role-loop-writer', 'role-loop-reviewer']))
    expect(roleIds).toEqual(expect.arrayContaining(['role-angle-a', 'role-angle-b', 'role-angle-c', 'role-merger']))
    expect(roleIds).toEqual(expect.arrayContaining(['role-1', 'role-2']))
  })

  it('removes legacy template roles that were previously marked as auto-generated', async () => {
    const store = makeStore()
    const legacyTemplateRoles: GroupRole[] = [
      makeRole('role-legacy-writer', '执行者', { createdBy: 'orchestration-auto', systemPrompt: '旧写作人设' }),
      makeRole('role-legacy-reviewer', '审核员', { createdBy: 'orchestration-auto', systemPrompt: '旧审核人设' }),
    ]
    const seeded = storeWithRoles(store, legacyTemplateRoles)
    const parallelRoles: GroupRole[] = [makeRole('role-angle-a', '视角A', { createdAt: 3, updatedAt: 3 }), makeRole('role-angle-b', '视角B', { createdAt: 3, updatedAt: 3 }), makeRole('role-angle-c', '视角C', { createdAt: 3, updatedAt: 3 }), makeRole('role-merger', '汇总者', { createdAt: 3, updatedAt: 3 })]
    const harness = renderModal(seeded, {
      sendRuntimeMessage: vi.fn(async () => ({ ok: true, store: storeWithRoles(seeded, parallelRoles), roles: parallelRoles })) as TeamPageServices['sendRuntimeMessage'],
    })
    vi.mocked(harness.services.runCommand).mockImplementation(async (type: string, payload?: Record<string, unknown>) => {
      if (type !== 'GROUP_ROLE_DELETE') return
      const roleId = (payload as { roleId?: string } | undefined)?.roleId
      if (!roleId) return
      delete harness.state.store.rolesById[roleId]
      harness.state.store.chatsById['chat-1'].roleIds = harness.state.store.chatsById['chat-1'].roleIds.filter(id => id !== roleId)
    })
    await openModal(harness)

    await userEvent.click(document.querySelector('#open-orchestration-template')!)
    await userEvent.click(document.querySelector('[data-template-id="parallel-merge"]')!)
    await flushAsync()

    expect(harness.services.runCommand).toHaveBeenCalledWith('GROUP_ROLE_DELETE', { roleId: 'role-legacy-writer' })
    expect(harness.services.runCommand).toHaveBeenCalledWith('GROUP_ROLE_DELETE', { roleId: 'role-legacy-reviewer' })
    const roleIds = harness.state.store.chatsById['chat-1'].roleIds
    expect(roleIds).not.toEqual(expect.arrayContaining(['role-legacy-writer', 'role-legacy-reviewer']))
    expect(roleIds).toEqual(expect.arrayContaining(['role-angle-a', 'role-angle-b', 'role-angle-c', 'role-merger']))
    expect(roleIds).toEqual(expect.arrayContaining(['role-1', 'role-2']))
  })

  it('deletes roles created by the previous template even when the store has no template marker', async () => {
    const store = makeStore()
    const loopRoles: GroupRole[] = [makeRole('role-loop-writer', '执行者'), makeRole('role-loop-reviewer', '审核员')]
    const parallelRoles: GroupRole[] = [makeRole('role-angle-a', '视角A', { createdAt: 3, updatedAt: 3 }), makeRole('role-angle-b', '视角B', { createdAt: 3, updatedAt: 3 }), makeRole('role-angle-c', '视角C', { createdAt: 3, updatedAt: 3 }), makeRole('role-merger', '汇总者', { createdAt: 3, updatedAt: 3 })]
    const harness = renderModal(store, {
      sendRuntimeMessage: vi.fn()
        .mockResolvedValueOnce({ ok: true, store: storeWithRoles(store, loopRoles), roles: loopRoles })
        .mockResolvedValueOnce({ ok: true, store: storeWithRoles(store, parallelRoles), roles: parallelRoles }) as TeamPageServices['sendRuntimeMessage'],
    })
    vi.mocked(harness.services.runCommand).mockImplementation(async (type: string, payload?: Record<string, unknown>) => {
      if (type !== 'GROUP_ROLE_DELETE') return
      const roleId = (payload as { roleId?: string } | undefined)?.roleId
      if (!roleId) return
      delete harness.state.store.rolesById[roleId]
      harness.state.store.chatsById['chat-1'].roleIds = harness.state.store.chatsById['chat-1'].roleIds.filter(id => id !== roleId)
    })
    await openModal(harness)

    await userEvent.click(document.querySelector('#open-orchestration-template')!)
    await userEvent.click(document.querySelector('[data-template-id="review-loop"]')!)
    await flushAsync()
    // 套用后选择弹窗自动关闭，二次套模板重新打开（画布已有节点先弹替换确认）
    await userEvent.click(document.querySelector('#open-orchestration-template')!)
    await userEvent.click(document.querySelector('[data-template-id="parallel-merge"]')!)
    await userEvent.click(within(document.body).getByRole('button', { name: '替换' }))
    await flushAsync()

    expect(harness.services.runCommand).toHaveBeenCalledWith('GROUP_ROLE_DELETE', { roleId: 'role-loop-writer' })
    expect(harness.services.runCommand).toHaveBeenCalledWith('GROUP_ROLE_DELETE', { roleId: 'role-loop-reviewer' })
    const roleIds = harness.state.store.chatsById['chat-1'].roleIds
    expect(roleIds).not.toEqual(expect.arrayContaining(['role-loop-writer', 'role-loop-reviewer']))
    expect(roleIds).toEqual(expect.arrayContaining(['role-angle-a', 'role-angle-b', 'role-angle-c', 'role-merger']))
    expect(roleIds).toEqual(expect.arrayContaining(['role-1', 'role-2']))
  })

  it('opens a blank draft by default when the chat has no saved orchestration flow', async () => {
    const harness = renderModal()
    await openModal(harness)

    expect((document.querySelector('#orchestration-empty-hint') as HTMLElement).hidden).toBe(false)
    expect(document.querySelector('#orchestration-stage-settings')).toBeNull()
    expect((document.querySelector('.orchestration-settings') as HTMLElement).hidden).toBe(true)
  })

  it('shows stage settings only after the user selects a canvas node', async () => {
    const harness = renderModal()
    await openModal(harness)
    dropRole('role-1')
    await flushAsync()

    expect(document.querySelector('#orchestration-stage-settings')).toBeNull()
    expect((document.querySelector('.orchestration-settings') as HTMLElement).hidden).toBe(true)

    const stageId = MockGraph.latest().nodes[0].id
    expect(stageId).toBeTruthy()
    MockGraph.latest().selectNode(stageId as string)
    await flushAsync()

    const settings = document.querySelector('#orchestration-stage-settings')!
    expect(settings.textContent).toContain('节点名称')
    expect(settings.textContent).toContain('任务描述')
    expect(settings.textContent).not.toContain('阶段')
    expect(settings.textContent).toContain('执行人员')
    expect(settings.querySelector('.stage-role-chip button')).toBeNull()
    expect((document.querySelector('.orchestration-settings') as HTMLElement).hidden).toBe(false)
  })

  it('does not rebuild the graph when selecting a node for editing', async () => {
    const harness = renderModal()
    await openModal(harness)
    dropRole('role-1')
    dropRole('role-2')
    await flushAsync()
    const graph = MockGraph.latest()
    const clearCalls = graph.clearCalls
    const addNodeCalls = graph.addNodeCalls
    const stageId = graph.nodes[0].id
    expect(stageId).toBeTruthy()

    graph.selectNode(stageId as string)
    await flushAsync()

    expect(graph.clearCalls).toBe(clearCalls)
    expect(graph.addNodeCalls).toBe(addNodeCalls)
    expect(document.querySelector('#orchestration-stage-settings')!.textContent).toContain('任务描述')
  })

  it('closes node settings without rebuilding the canvas', async () => {
    const harness = renderModal()
    await openModal(harness)
    dropRole('role-1')
    await flushAsync()
    const graph = MockGraph.latest()
    const stageId = graph.nodes[0].id
    expect(stageId).toBeTruthy()
    graph.selectNode(stageId as string)
    await flushAsync()
    const clearCalls = graph.clearCalls
    const addNodeCalls = graph.addNodeCalls

    const closeButton = document.querySelector<HTMLButtonElement>('[aria-label="关闭节点设置"]')
    expect(closeButton).not.toBeNull()
    await userEvent.click(closeButton!)
    await flushAsync()

    expect(document.querySelector('#orchestration-stage-settings')).toBeNull()
    expect((document.querySelector('.orchestration-settings') as HTMLElement).hidden).toBe(true)
    expect(graph.clearCalls).toBe(clearCalls)
    expect(graph.addNodeCalls).toBe(addNodeCalls)
  })

  it('saves a selected node task description with the orchestration flow', async () => {
    const harness = renderModal()
    await openModal(harness)
    dropRole('role-1')
    await flushAsync()
    const stageId = MockGraph.latest().nodes[0].id as string
    MockGraph.latest().selectNode(stageId)
    await flushAsync()
    const description = document.querySelector('#orchestration-stage-settings textarea') as HTMLTextAreaElement
    fireEvent.input(description, { target: { value: '先澄清用户目标，并输出优先级列表。' } })
    typeInto('#orchestration-task', '保存这次任务')

    await userEvent.click(document.querySelector('#save-orchestration')!)
    await flushAsync()

    const savePayload = commandPayload(harness, 'GROUP_ORCHESTRATION_FLOW_SAVE') as { flow?: OrchestrationFlow }
    expect(savePayload.flow?.stages[0].description).toBe('先澄清用户目标，并输出优先级列表。')
    expect(savePayload.flow?.graph?.stageNodes[0].description).toBe('先澄清用户目标，并输出优先级列表。')
  })

  it('arranges the canvas from the top-right toolbar and saves node positions', async () => {
    const harness = renderModal()
    await openModal(harness)
    dropRole('role-1')
    dropRole('role-2')
    await flushAsync()
    await userEvent.click(document.querySelector('#arrange-orchestration')!)
    await flushAsync()
    typeInto('#orchestration-task', '整理后保存')
    await userEvent.click(document.querySelector('#save-orchestration')!)
    await flushAsync()

    const savePayload = commandPayload(harness, 'GROUP_ORCHESTRATION_FLOW_SAVE') as { flow?: OrchestrationFlow }
    expect(savePayload.flow?.graph?.stageNodes.map(stage => stage.position)).toEqual([
      { x: 56, y: 96 },
      { x: 236, y: 96 },
    ])
  })

  it('restores a saved orchestration flow for the current chat after refresh', async () => {
    const store = makeStore()
    const savedFlow: OrchestrationFlow = {
      id: 'flow-saved',
      chatId: 'chat-1',
      name: '已保存流程',
      description: '保存过的任务',
      stages: [
        { id: 'stage-saved-1', kind: 'roles', name: '旧阶段 1', roleIds: ['role-1'], description: '保存过的节点说明' },
        { id: 'stage-saved-2', kind: 'roles', name: '旧阶段 2', roleIds: ['role-2'] },
      ],
      graph: {
        stageNodes: [
          { id: 'stage-saved-1', kind: 'roles', name: '旧阶段 1', roleIds: ['role-1'], description: '保存过的节点说明' },
          { id: 'stage-saved-2', kind: 'roles', name: '旧阶段 2', roleIds: ['role-2'] },
        ],
        edges: [{ sourceStageId: 'stage-saved-1', targetStageId: 'stage-saved-2' }],
      },
      maxNodeExecutions: 8,
      maxRounds: 3,
      createdAt: 1,
      updatedAt: 1,
    }
    store.orchestrationFlowsById[savedFlow.id] = savedFlow
    store.orchestrationFlowOrderByChatId['chat-1'] = [savedFlow.id]
    const harness = renderModal(store)
    await openModal(harness)

    expect((document.querySelector('#orchestration-empty-hint') as HTMLElement).hidden).toBe(true)
    expect(document.querySelector('#orchestration-stage-settings')).toBeNull()
    MockGraph.latest().selectNode('stage-saved-1')
    await flushAsync()
    expect((document.querySelector('#orchestration-stage-settings input') as HTMLInputElement).value).toBe('旧阶段 1')
    expect((document.querySelector('#orchestration-stage-settings textarea') as HTMLTextAreaElement).value).toBe('保存过的节点说明')
    expect((document.querySelector('#orchestration-max-rounds') as HTMLInputElement).value).toBe('8')
    expect((document.querySelector('#orchestration-task') as HTMLTextAreaElement).value).toBe('保存过的任务')
    typeInto('#orchestration-task', '继续执行')
    await userEvent.click(document.querySelector('#run-orchestration')!)
    await flushAsync()

    const runPayload = commandPayload(harness, 'GROUP_ORCHESTRATION_RUN') as { flow?: OrchestrationFlow }
    expect(runPayload.flow?.id).toBe('flow-saved')
    expect(runPayload.flow?.graph?.edges).toEqual([{ sourceStageId: 'stage-saved-1', targetStageId: 'stage-saved-2' }])
  })

  it('validates max node executions and saves a stage draft through GROUP_ORCHESTRATION_FLOW_SAVE', async () => {
    const harness = renderModal()
    await openModal(harness)
    dropRole('role-1')
    typeInto('#orchestration-task', '保存这次任务')
    typeInto('#orchestration-max-rounds', '201')

    await userEvent.click(document.querySelector('#save-orchestration')!)
    await flushAsync()
    expect(showError).toHaveBeenCalledWith('最大节点执行数需在 1-200 之间')

    typeInto('#orchestration-max-rounds', '12')
    await userEvent.click(document.querySelector('#save-orchestration')!)
    await flushAsync()

    expect(harness.services.runCommand).toHaveBeenCalledWith('GROUP_ORCHESTRATION_FLOW_SAVE', expect.objectContaining({ chatId: 'chat-1', flow: expect.objectContaining({ description: '保存这次任务', maxNodeExecutions: 12, maxRounds: 12 }) }))
  })

  it('validates run task and review settings before GROUP_ORCHESTRATION_RUN', async () => {
    const harness = renderModal()
    await openModal(harness)
    dropRole('role-2')
    await flushAsync()
    MockGraph.latest().selectNode(MockGraph.latest().nodes[0].id as string)
    await flushAsync()
    const typeSelect = document.querySelector('select[data-stage-kind]') as HTMLSelectElement
    fireEvent.change(typeSelect, { target: { value: 'review' } })
    await flushAsync()
    expect(document.querySelector('.stage-role-chip button')).toBeNull()
    const reviewSettings = document.querySelector('#orchestration-review-settings')!
    expect(reviewSettings.textContent).not.toContain('审核人员')
    expect(reviewSettings.textContent).toContain('最大审核次数')
    expect(reviewSettings.textContent).toContain('达到上限后')
    const attempts = reviewSettings.querySelector('input[type="number"]') as HTMLInputElement
    const maxAction = reviewSettings.querySelector('select') as HTMLSelectElement
    expect(attempts.value).toBe('3')
    expect(maxAction.value).toBe('stop')

    await userEvent.click(document.querySelector('#run-orchestration')!)
    await flushAsync()
    expect(showError).toHaveBeenCalledWith('请输入编排任务')

    typeInto('#orchestration-task', '完成方案评审')
    await userEvent.click(document.querySelector('#run-orchestration')!)
    await flushAsync()
    expect(showError).toHaveBeenCalledWith('审核节点需要审核人员和审核标准')

    const criteria = reviewSettings.querySelector('textarea') as HTMLTextAreaElement
    fireEvent.change(criteria, { target: { value: '必须包含结论' } })
    fireEvent.input(attempts, { target: { value: '2' } })
    fireEvent.change(maxAction, { target: { value: 'continue' } })
    await userEvent.click(document.querySelector('#run-orchestration')!)
    await flushAsync()

    expect(harness.services.runCommand).toHaveBeenCalledWith('GROUP_ORCHESTRATION_RUN', expect.objectContaining({ chatId: 'chat-1', task: '完成方案评审', flow: expect.any(Object) }))
    const runPayload = commandPayload(harness, 'GROUP_ORCHESTRATION_RUN') as { flow?: OrchestrationFlow }
    expect(runPayload.flow?.stages[0].review).toMatchObject({ maxAttempts: 2, onMaxAttempts: 'continue' })
  })

  it('recovers stage roles before running an orchestration', async () => {
    const store = makeStore()
    const harness = renderModal(store)
    await openModal(harness)
    dropRole('role-1')
    dropRole('role-2')
    await flushAsync()
    typeInto('#orchestration-task', '完成方案评审')

    await userEvent.click(document.querySelector('#run-orchestration')!)
    await flushAsync()

    expect(harness.services.reconnectRolesForSend).toHaveBeenCalledWith(store.chatsById['chat-1'], [store.rolesById['role-1'], store.rolesById['role-2']])
    expect(vi.mocked(harness.services.runCommand).mock.invocationCallOrder[0]).toBeGreaterThan(vi.mocked(harness.services.reconnectRolesForSend).mock.invocationCallOrder[0])
  })

  it('auto-generates a draft from a chat-style dialog with streaming assistant text', async () => {
    const store = makeStore()
    const generatedStore = structuredClone(store)
    generatedStore.chatsById['chat-1'].roleIds.push('role-new')
    generatedStore.rolesById['role-new'] = makeRole('role-new', '写手', { createdBy: 'orchestration-auto', chatSite: 'chatgpt', systemPrompt: '旧写作人设' })
    const generatedFlow: OrchestrationFlow = {
      id: 'flow-auto',
      chatId: 'chat-1',
      name: '自动流程',
      description: '自动任务',
      stages: [
        { id: 'stage-plan', kind: 'roles', name: '规划', roleIds: ['role-1'], description: '拆解任务' },
        { id: 'stage-write', kind: 'roles', name: '写作', roleIds: ['role-new'], description: '输出初稿' },
        { id: 'stage-review', kind: 'review', name: '审核', roleIds: ['role-2'], description: '判断质量', review: { reviewerRoleIds: ['role-2'], instructions: '必须可交付', maxAttempts: 3, onMaxAttempts: 'stop' } },
      ],
      graph: {
        stageNodes: [
          { id: 'stage-plan', kind: 'roles', name: '规划', roleIds: ['role-1'], description: '拆解任务' },
          { id: 'stage-write', kind: 'roles', name: '写作', roleIds: ['role-new'], description: '输出初稿' },
          { id: 'stage-review', kind: 'review', name: '审核', roleIds: ['role-2'], description: '判断质量', review: { reviewerRoleIds: ['role-2'], instructions: '必须可交付', maxAttempts: 3, onMaxAttempts: 'stop' } },
        ],
        edges: [
          { sourceStageId: 'stage-plan', targetStageId: 'stage-write' },
          { sourceStageId: 'stage-write', targetStageId: 'stage-review' },
          { sourceStageId: 'stage-review', targetStageId: 'stage-write', sourcePort: 'fail' },
        ],
      },
      maxNodeExecutions: 30,
      maxRounds: 30,
      autoPlanHistory: [
        { id: 'auto-history-1', role: 'user', content: '写一篇文章', createdAt: 2 },
        { id: 'auto-history-2', role: 'assistant', content: '已生成自动流程', createdAt: 2 },
      ],
      createdAt: 2,
      updatedAt: 2,
    }
    generatedStore.orchestrationFlowsById[generatedFlow.id] = generatedFlow
    generatedStore.orchestrationFlowOrderByChatId['chat-1'] = [generatedFlow.id]
    let resolveAuto: (response: OrchestrationResponse) => void = () => {}
    const harness = renderModal(store, {
      // 延迟兑现：让流式中间态在断言时仍可见（即时 resolve 会直接跳到完成态）
      sendRuntimeMessage: vi.fn(() => new Promise<OrchestrationResponse>(resolve => {
        resolveAuto = resolve
      })) as TeamPageServices['sendRuntimeMessage'],
    })
    await openModal(harness)
    typeInto('#orchestration-task', '写一篇文章')

    await userEvent.click(document.querySelector('#auto-orchestration')!)
    expect(harness.services.sendRuntimeMessage).not.toHaveBeenCalled()
    const autoModal = document.querySelector('#orchestration-auto-modal') as HTMLElement
    expect(autoModal).not.toBeNull()
    const chat = autoModal.querySelector<HTMLElement>('.orchestration-auto-chat')
    expect(chat).not.toBeNull()
    expect(chat?.querySelector('.orchestration-auto-task-preview')).toBeNull()
    expect(chat?.querySelector('.orchestration-auto-history')).toBeNull()
    // S6/T3：输入行进了壳的 footer 槽（在 body 之外），textarea/发送键改从
    // 弹窗根查询；断言语义不变（chat 容器断言不受影响——消息区仍在 body 内）。
    const input = autoModal.querySelector<HTMLTextAreaElement>('.orchestration-auto-input')
    expect(input).not.toBeNull()
    fireEvent.change(input!, { target: { value: '先规划，再写作，最后审核' } })
    await userEvent.click(autoModal.querySelector<HTMLButtonElement>('.orchestration-auto-submit')!)

    const call = vi.mocked(harness.services.sendRuntimeMessage).mock.calls[0]
    expect(call[0]).toBe('GROUP_ORCHESTRATION_AUTO_GENERATE')
    const payload = call[1] as { streamId?: string }
    expect(payload).toMatchObject({ chatId: 'chat-1', task: '写一篇文章', instruction: '先规划，再写作，最后审核', flowId: undefined })
    expect(payload.streamId).toMatch(/^auto-stream-/)

    act(() => {
      applyOrchestrationAutoStreamChunk({ streamId: payload.streamId, chunk: '正在生成自动流程', content: '正在生成自动流程' })
    })
    const autoContent = document.querySelector('#orchestration-auto-content')!
    expect(autoContent.textContent).toContain('先规划，再写作，最后审核')
    expect(autoContent.textContent).toContain('正在生成自动流程')

    await act(async () => {
      resolveAuto({ ok: true, store: generatedStore, flow: generatedFlow, createdRoleIds: ['role-new'], reusedRoleIds: ['role-1', 'role-2'] })
    })
    await flushAsync()

    expect(harness.services.sendRuntimeMessage).toHaveBeenCalledWith('GROUP_ORCHESTRATION_AUTO_GENERATE', expect.objectContaining({ chatId: 'chat-1', task: '写一篇文章', instruction: '先规划，再写作，最后审核', flowId: undefined, streamId: expect.any(String) }))
    expect(document.querySelector('#orchestration-people-list')!.textContent).toContain('写手')
    expect(document.querySelector('#orchestration-auto-modal')).not.toBeNull()
    expect(autoContent.querySelector('.orchestration-auto-chat')).not.toBeNull()
    expect(autoContent.textContent).toContain('已生成自动流程')
    expect(MockGraph.latest().nodes.find(node => node.id === 'stage-write')?.label).toContain('ChatGPT')
    expect(showSuccess).toHaveBeenLastCalledWith(expect.stringContaining('新增 1 个人员'))

    MockGraph.latest().selectNode('stage-plan')
    await flushAsync()
    expect(document.querySelector('.orchestration-auto-role-site-row')).toBeNull()
    MockGraph.latest().selectNode('stage-write')
    await flushAsync()
    const siteSelect = document.querySelector<HTMLSelectElement>('.orchestration-auto-role-site-row select')
    expect(siteSelect?.value).toBe('chatgpt')
    fireEvent.change(siteSelect!, { target: { value: 'deepseek' } })
    await flushAsync()
    expect(harness.services.runCommand).toHaveBeenCalledWith('GROUP_ROLE_UPDATE', { roleId: 'role-new', patch: { modelSource: 'site', chatSite: 'deepseek' } })
    const promptInput = document.querySelector<HTMLTextAreaElement>('.orchestration-auto-role-prompt')
    expect(promptInput?.value).toBe('旧写作人设')
    fireEvent.change(promptInput!, { target: { value: '新的写作人设' } })
    fireEvent.blur(promptInput!)
    await flushAsync()
    expect(harness.services.runCommand).toHaveBeenCalledWith('GROUP_ROLE_UPDATE', { roleId: 'role-new', patch: { systemPrompt: '新的写作人设' } })

    // 自动编排为独立 Radix Dialog（覆盖主弹窗时主弹窗不可点）：保存前先关闭聊天面板，历史已回写流程
    await userEvent.click(document.querySelector('#close-auto-orchestration')!)
    await flushAsync()
    await userEvent.click(document.querySelector('#save-orchestration')!)
    await flushAsync()
    const savePayload = commandPayload(harness, 'GROUP_ORCHESTRATION_FLOW_SAVE') as { flow?: OrchestrationFlow }
    expect(savePayload.flow?.stages.map(stage => stage.id)).toEqual(['stage-plan', 'stage-write', 'stage-review'])
    expect(savePayload.flow?.graph?.edges).toContainEqual({ sourceStageId: 'stage-review', targetStageId: 'stage-write', sourcePort: 'fail', vertices: expect.any(Array) })
    expect(savePayload.flow?.autoPlanHistory?.map(entry => entry.role)).toEqual(['user', 'assistant'])

    await userEvent.click(document.querySelector('#close-orchestration')!)
    await openModal(harness)
    await userEvent.click(document.querySelector('#auto-orchestration')!)
    const reopenedContent = document.querySelector('#orchestration-auto-content')!
    expect(reopenedContent.textContent).toContain('写一篇文章')
    expect(reopenedContent.textContent).toContain('已生成自动流程')
  })

  it('opens automatic orchestration in a separate dialog instead of embedding it in the main editor', async () => {
    const harness = renderModal()
    await openModal(harness)

    await userEvent.click(document.querySelector('#auto-orchestration')!)

    expect(document.querySelector('#orchestration-auto-modal')).not.toBeNull()
    expect(document.querySelector('.orchestration-auto-chat')).not.toBeNull()
    expect(document.querySelector('.orchestration-auto-panel-header')).toBeNull()
    expect(document.querySelector('[aria-label="关闭自动编排面板"]')).toBeNull()
    expect(document.querySelector('#orchestration-modal')!.querySelector('.orchestration-auto-chat')).toBeNull()
  })

  it('sends the current draft and auto history when modifying an existing orchestration from the panel', async () => {
    const store = makeStore()
    const savedFlow: OrchestrationFlow = {
      id: 'flow-saved',
      chatId: 'chat-1',
      name: '已有流程',
      description: '写文章',
      stages: [{ id: 'stage-saved-1', kind: 'roles', name: '写作', roleIds: ['role-1'], description: '写初稿' }],
      graph: { stageNodes: [{ id: 'stage-saved-1', kind: 'roles', name: '写作', roleIds: ['role-1'], description: '写初稿' }], edges: [] },
      autoPlanHistory: [
        { id: 'auto-history-1', role: 'user', content: '先写作', createdAt: 1 },
        { id: 'auto-history-2', role: 'assistant', content: '已生成写作节点', createdAt: 2 },
      ],
      maxNodeExecutions: 20,
      maxRounds: 20,
      createdAt: 1,
      updatedAt: 2,
    }
    store.orchestrationFlowsById[savedFlow.id] = savedFlow
    store.orchestrationFlowOrderByChatId['chat-1'] = [savedFlow.id]
    const harness = renderModal(store, {
      sendRuntimeMessage: vi.fn(async () => ({ ok: true, store, flow: savedFlow, createdRoleIds: [], reusedRoleIds: ['role-1'] })) as TeamPageServices['sendRuntimeMessage'],
    })
    await openModal(harness)

    await userEvent.click(document.querySelector('#auto-orchestration')!)
    // S6/T3：同上——输入行在壳 footer 槽，从弹窗根查（消息区仍在 chat 内）。
    const autoRoot = document.querySelector('#orchestration-auto-modal')!
    const chat = document.querySelector('.orchestration-auto-chat')!
    expect(chat.textContent).toContain('已生成写作节点')
    const input = autoRoot.querySelector<HTMLTextAreaElement>('.orchestration-auto-input')!
    fireEvent.change(input, { target: { value: '增加审核失败回写作' } })
    await userEvent.click(autoRoot.querySelector<HTMLButtonElement>('.orchestration-auto-submit')!)
    await flushAsync()

    const payload = vi.mocked(harness.services.sendRuntimeMessage).mock.calls[0][1] as { instruction?: string; flow?: OrchestrationFlow; history?: unknown[] }
    expect(payload.instruction).toBe('增加审核失败回写作')
    expect(payload.flow?.id).toBe('flow-saved')
    expect(payload.flow?.graph?.stageNodes[0].description).toBe('写初稿')
    expect(payload.history).toEqual(savedFlow.autoPlanHistory)
  })

  it('ignores repeated run clicks while the first run is still starting', async () => {
    let finishRun: (() => void) | undefined
    const runCommand = vi.fn(async (type: string) => {
      if (type !== 'GROUP_ORCHESTRATION_RUN') return
      await new Promise<void>(resolve => {
        finishRun = resolve
      })
    })
    const harness = renderModal(undefined, { runCommand: runCommand as unknown as TeamPageServices['runCommand'] })
    await openModal(harness)
    dropRole('role-1')
    await flushAsync()
    typeInto('#orchestration-task', '完成方案评审')

    const runButton = document.querySelector('#run-orchestration') as HTMLButtonElement
    await userEvent.click(runButton)
    await userEvent.click(runButton)
    await flushAsync()

    expect(runCommand.mock.calls.filter(call => call[0] === 'GROUP_ORCHESTRATION_RUN')).toHaveLength(1)
    expect(runButton.disabled).toBe(true)
    await act(async () => {
      finishRun?.()
    })
    await flushAsync()
  })

  it('keeps the auto panel and canvas alive with the shared CanvasPortal element id', async () => {
    const harness = renderModal()
    await openModal(harness)

    expect(document.querySelector('#orchestration-stage-canvas')).not.toBeNull()
    expect(document.querySelector('#orchestration-modal')!.contains(document.querySelector('#orchestration-stage-canvas'))).toBe(true)
    expect(document.querySelector('#orchestration-auto-modal')).toBeNull()
  })
})
