import { describe, expect, it } from 'vitest'
import type { OpenTeamStore, OrchestrationFlow, OrchestrationGraphSnapshot, OrchestrationStage } from '../../../group/types'
import { DEFAULT_ORCHESTRATION_MAX_NODE_EXECUTIONS, DEFAULT_ORCHESTRATION_REVIEW_MAX_ATTEMPTS, MAX_ORCHESTRATION_MAX_NODE_EXECUTIONS } from '../../../group/types'
import {
  autoGenerateSuccessMessage,
  clampMaxNodeExecutions,
  clampReviewAttempts,
  draftFromFlow,
  edgesCanvasKey,
  emptyDraft,
  filterGraphEdges,
  findReusableTemplateRole,
  hasExternalApiConfigured,
  isBuiltinOrchestrationTemplateRoleName,
  isGeneratedEditableRole,
  newId,
  normalizedReviewConfig,
  orderStagesByGraph,
  roleInitial,
  roleModelDisplay,
  roleToneClass,
  selectedRoleIds,
  stagesCanvasKey,
} from './orchestrationDraft'

/*
 * 编排草稿纯函数层单测（原 orchestrationModalView 内联逻辑的外移锁定）：
 * 草稿派生 / 边过滤去重 / 图拓扑排序 / 结构签名（描述不进签名）/ 钳制 /
 * 模板人员复用判断 / 外部 API 配置判断。
 */

function stage(overrides: Partial<OrchestrationStage> = {}): OrchestrationStage {
  return { id: 'stage-1', kind: 'roles', name: '写作', roleIds: ['role-1'], ...overrides }
}

describe('orchestration draft helpers', () => {
  it('creates an empty draft with the default max node executions', () => {
    expect(emptyDraft()).toEqual({
      task: '',
      stages: [],
      graphEdges: [],
      autoPlanHistory: [],
      maxNodeExecutions: DEFAULT_ORCHESTRATION_MAX_NODE_EXECUTIONS,
    })
  })

  it('derives a draft from a saved flow, preferring graph stage nodes and cloning edges', () => {
    const flow: OrchestrationFlow = {
      id: 'flow-1',
      chatId: 'chat-1',
      name: '流程',
      description: '  写文章  ',
      stages: [{ id: 'stage-flat', kind: 'roles', name: '平面', roleIds: ['role-1'] }],
      graph: {
        stageNodes: [stage({ description: '图上的节点' })],
        edges: [{ sourceStageId: 'stage-1', targetStageId: 'stage-2', sourcePort: 'fail', vertices: [{ x: 1, y: 2 }] }],
      },
      maxNodeExecutions: 999,
      maxRounds: 1,
      createdAt: 1,
      updatedAt: 1,
    }

    const draft = draftFromFlow(flow)

    expect(draft.flowId).toBe('flow-1')
    expect(draft.task).toBe('写文章')
    expect(draft.stages).toEqual([stage({ description: '图上的节点' })])
    expect(draft.graphEdges).toEqual([{ sourceStageId: 'stage-1', targetStageId: 'stage-2', sourcePort: 'fail', vertices: [{ x: 1, y: 2 }] }])
    expect(draft.maxNodeExecutions).toBe(MAX_ORCHESTRATION_MAX_NODE_EXECUTIONS)
    expect(draft.graphEdges[0]).not.toBe(flow.graph!.edges[0])
  })

  it('falls back to sequential edges when a flow has no graph snapshot', () => {
    const flow: OrchestrationFlow = {
      id: 'flow-2',
      chatId: 'chat-1',
      name: '流程',
      stages: [stage({ id: 'a' }), stage({ id: 'b' }), stage({ id: 'c' })],
      maxRounds: 1,
      createdAt: 1,
      updatedAt: 1,
    }

    expect(draftFromFlow(flow).graphEdges).toEqual([
      { sourceStageId: 'a', targetStageId: 'b' },
      { sourceStageId: 'b', targetStageId: 'c' },
    ])
  })

  it('filters edges to valid stage pairs, drops self loops, and dedupes identical port topologies', () => {
    const edges: OrchestrationGraphSnapshot['edges'] = [
      { sourceStageId: 'a', targetStageId: 'b' },
      { sourceStageId: 'a', targetStageId: 'a' },
      { sourceStageId: 'a', targetStageId: 'missing' },
      { sourceStageId: 'b', targetStageId: 'a', sourcePort: 'fail', vertices: [{ x: 3, y: 4 }] },
      { sourceStageId: 'b', targetStageId: 'a', sourcePort: 'fail' },
      { sourceStageId: 'b', targetStageId: 'a', sourcePort: 'pass' },
    ]

    expect(filterGraphEdges(edges, [stage({ id: 'a' }), stage({ id: 'b' })])).toEqual([
      { sourceStageId: 'a', targetStageId: 'b' },
      { sourceStageId: 'b', targetStageId: 'a', sourcePort: 'fail', vertices: [{ x: 3, y: 4 }] },
      { sourceStageId: 'b', targetStageId: 'a', sourcePort: 'pass' },
    ])
  })

  it('orders stages by graph edges and appends unreachable stages in original order', () => {
    const unorderedStages = [
      stage({ id: 'stage-2', name: '工程判断', roleIds: ['role-2'] }),
      stage({ id: 'stage-1', name: '产品需求', roleIds: ['role-1'] }),
      stage({ id: 'review-1', kind: 'review', name: '审核', roleIds: ['role-3'], review: { reviewerRoleIds: ['role-3'], instructions: '', maxAttempts: 3, onMaxAttempts: 'stop' } }),
    ]

    const ordered = orderStagesByGraph(unorderedStages, [
      { sourceStageId: 'stage-1', targetStageId: 'stage-2' },
      { sourceStageId: 'stage-2', targetStageId: 'review-1' },
    ])
    expect(ordered.map(item => item.id)).toEqual(['stage-1', 'stage-2', 'review-1'])

    const cyclic = orderStagesByGraph(
      [stage({ id: 'a' }), stage({ id: 'b' }), stage({ id: 'c' })],
      [
        { sourceStageId: 'a', targetStageId: 'b' },
        { sourceStageId: 'b', targetStageId: 'a' },
      ],
    )
    expect(cyclic.map(item => item.id)).toEqual(['c', 'a', 'b'])

    expect(orderStagesByGraph([stage({ id: 'x' }), stage({ id: 'y' })], []).map(item => item.id)).toEqual(['x', 'y'])
  })

  it('keeps description and review edits out of the structural canvas signature', () => {
    const base = [stage({ position: { x: 10, y: 20 } })]
    const described = [stage({ position: { x: 10, y: 20 }, description: '补充说明', review: { reviewerRoleIds: ['role-1'], instructions: '标准', maxAttempts: 2, onMaxAttempts: 'continue' } })]

    expect(stagesCanvasKey(described)).toBe(stagesCanvasKey(base))
    expect(stagesCanvasKey([stage({ name: '改名' })])).not.toBe(stagesCanvasKey(base))
    expect(stagesCanvasKey([stage({ roleIds: ['role-2'] })])).not.toBe(stagesCanvasKey(base))
    expect(stagesCanvasKey([stage({ position: { x: 11, y: 20 } })])).not.toBe(stagesCanvasKey(base))
    expect(stagesCanvasKey([stage({ kind: 'review' })])).not.toBe(stagesCanvasKey(base))

    const edges: OrchestrationGraphSnapshot['edges'] = [{ sourceStageId: 'a', targetStageId: 'b', sourcePort: 'fail', vertices: [{ x: 9, y: 9 }] }]
    expect(edgesCanvasKey(edges)).toBe('a:fail->b:')
    expect(edgesCanvasKey([{ sourceStageId: 'a', targetStageId: 'b' }])).toBe('a:->b:')
    // 顶点拖拽不触发重画
    expect(edgesCanvasKey([{ sourceStageId: 'a', targetStageId: 'b', sourcePort: 'fail', vertices: [{ x: 8, y: 8 }] }])).toBe(edgesCanvasKey(edges))
  })

  it('clamps max node executions and review attempts', () => {
    expect(clampMaxNodeExecutions(Number.NaN)).toBe(DEFAULT_ORCHESTRATION_MAX_NODE_EXECUTIONS)
    expect(clampMaxNodeExecutions(0)).toBe(1)
    expect(clampMaxNodeExecutions(-5)).toBe(1)
    expect(clampMaxNodeExecutions(12.7)).toBe(12)
    expect(clampMaxNodeExecutions(200)).toBe(200)
    expect(clampMaxNodeExecutions(201)).toBe(200)

    expect(clampReviewAttempts(Number.NaN)).toBe(DEFAULT_ORCHESTRATION_REVIEW_MAX_ATTEMPTS)
    expect(clampReviewAttempts(0)).toBe(1)
    expect(clampReviewAttempts(51)).toBe(50)
    expect(clampReviewAttempts(2)).toBe(2)
  })

  it('normalizes review configs with reviewer fallback and clamped attempts', () => {
    const bare = normalizedReviewConfig(stage({ kind: 'review', roleIds: ['role-7', 'role-8'] }))
    expect(bare).toEqual({ reviewerRoleIds: ['role-7'], instructions: '', maxAttempts: DEFAULT_ORCHESTRATION_REVIEW_MAX_ATTEMPTS, onMaxAttempts: 'stop' })

    const patched = normalizedReviewConfig(stage({ kind: 'review', review: { reviewerRoleIds: ['role-1'], instructions: '旧', maxAttempts: 99, onMaxAttempts: 'stop' } }), { instructions: '新', onMaxAttempts: 'continue' })
    expect(patched).toEqual({ reviewerRoleIds: ['role-1'], instructions: '新', maxAttempts: 50, onMaxAttempts: 'continue' })
  })

  it('resolves reviewer role ids with a fallback to the stage roles', () => {
    expect(selectedRoleIds(stage({ kind: 'review', review: { reviewerRoleIds: ['reviewer-1'], instructions: '', maxAttempts: 1, onMaxAttempts: 'stop' } }))).toEqual(['reviewer-1'])
    expect(selectedRoleIds(stage({ kind: 'review', roleIds: ['fallback-1'] }))).toEqual(['fallback-1'])
    expect(selectedRoleIds(stage({ roleIds: ['executor-1', 'executor-2'] }))).toEqual(['executor-1', 'executor-2'])
  })

  it('builds the auto-generate success message from created and reused counts', () => {
    expect(autoGenerateSuccessMessage(1, 2)).toBe('已自动生成编排草稿，复用 2 个成员，新增 1 个人员')
    expect(autoGenerateSuccessMessage(3, 0)).toBe('已自动生成编排草稿，新增 3 个人员')
    expect(autoGenerateSuccessMessage(0, 2)).toBe('已自动生成编排草稿，可继续调整后保存或运行')
  })

  it('reuses template roles by normalized name or alias and skips already-used ids', () => {
    const roles = [
      { id: 'r1', chatId: 'c', name: ' 执行者 ', status: 'ready' as const, contextCursor: 0, createdAt: 1, updatedAt: 1 },
      { id: 'r2', chatId: 'c', name: '产品', status: 'ready' as const, contextCursor: 0, createdAt: 1, updatedAt: 1 },
      { id: 'r3', chatId: 'c', name: '审核', status: 'ready' as const, contextCursor: 0, createdAt: 1, updatedAt: 1 },
    ]
    const used = new Set<string>()

    expect(findReusableTemplateRole({ key: 'writer', name: '执行者', description: '', systemPrompt: '' }, roles, used)?.id).toBe('r1')
    used.add('r1')
    expect(findReusableTemplateRole({ key: 'writer', name: '执行者', description: '', systemPrompt: '' }, roles, used)).toBeUndefined()
    expect(findReusableTemplateRole({ key: 'reviewer', name: '审核员', aliases: ['审核'], description: '', systemPrompt: '' }, roles, used)?.id).toBe('r3')
    expect(findReusableTemplateRole({ key: 'other', name: '路人甲', description: '', systemPrompt: '' }, roles, used)).toBeUndefined()
  })

  it('detects generated roles and builtin template role names', () => {
    expect(isGeneratedEditableRole({ id: 'x', chatId: 'c', name: 'n', createdBy: 'orchestration-auto', status: 'ready', contextCursor: 0, createdAt: 1, updatedAt: 1 })).toBe(true)
    expect(isGeneratedEditableRole({ id: 'x', chatId: 'c', name: 'n', createdBy: 'orchestration-template', status: 'ready', contextCursor: 0, createdAt: 1, updatedAt: 1 })).toBe(true)
    expect(isGeneratedEditableRole({ id: 'x', chatId: 'c', name: 'n', status: 'ready', contextCursor: 0, createdAt: 1, updatedAt: 1 })).toBe(false)

    expect(isBuiltinOrchestrationTemplateRoleName('执行者')).toBe(true)
    expect(isBuiltinOrchestrationTemplateRoleName('  汇总者 ')).toBe(true)
    expect(isBuiltinOrchestrationTemplateRoleName('路人甲')).toBe(false)
  })

  it('formats role identity helpers', () => {
    expect(roleInitial('alice')).toBe('A')
    expect(roleInitial('  ')).toBe('员')
    expect(roleToneClass('role-1')).toMatch(/^tone-(blue|green|purple|orange)$/)
    expect(roleToneClass('role-1')).toBe(roleToneClass('role-1'))
  })

  it('renders model labels for external models and chat sites', () => {
    const store = { settings: { defaultChatSite: 'gemini', externalModelsById: { 'model-1': { id: 'model-1', name: 'OpenRouter Claude' } } } } as unknown as OpenTeamStore

    expect(roleModelDisplay({ modelSource: 'external', externalModelId: 'model-1', chatSite: 'chatgpt' }, store)).toEqual({ label: 'API · OpenRouter Claude', className: 'site-pill-external' })
    expect(roleModelDisplay({ modelSource: 'external', externalModelId: 'missing', chatSite: 'chatgpt' }, store)).toEqual({ label: 'API · 未配置', className: 'site-pill-external' })
    expect(roleModelDisplay({ chatSite: 'chatgpt' }, store)).toEqual({ label: 'ChatGPT', className: 'site-pill-chatgpt' })
    expect(roleModelDisplay({}, store)).toEqual({ label: 'Gemini', className: 'site-pill-gemini' })
  })

  it('requires a fully configured external model before enabling orchestration', () => {
    const store = { settings: { externalModelOrder: ['m1', 'm2'], externalModelsById: {
      m1: { name: 'x', baseUrl: 'https://a', apiKey: '', modelName: 'gpt' },
      m2: { name: 'y', baseUrl: 'https://b', apiKey: 'k', modelName: 'm' },
    } } } as unknown as OpenTeamStore

    expect(hasExternalApiConfigured(store)).toBe(true)
    expect(hasExternalApiConfigured({ settings: { externalModelOrder: ['m1'], externalModelsById: store.settings.externalModelsById } } as unknown as OpenTeamStore)).toBe(false)
    expect(hasExternalApiConfigured({ settings: { externalModelOrder: [], externalModelsById: {} } } as unknown as OpenTeamStore)).toBe(false)
  })

  it('generates prefixed unique ids', () => {
    const first = newId('stage')
    const second = newId('stage')
    expect(first).toMatch(/^stage-/)
    expect(first).not.toBe(second)
    expect(newId('auto-stream')).toMatch(/^auto-stream-/)
  })
})
