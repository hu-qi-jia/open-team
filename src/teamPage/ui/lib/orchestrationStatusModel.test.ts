import { describe, expect, it } from 'vitest'
import { createDefaultStore } from '../../../group/store'
import type { GroupChat, GroupRole, OpenTeamStore, OrchestrationFlow, OrchestrationGraphEdge, OrchestrationRun, OrchestrationStage, OrchestrationStageRun } from '../../../group/types'
import {
  STATUS_LABELS,
  buildOrchestrationStatusModel,
  currentStageRun,
  currentNodeText,
  currentStatusText,
  diagramBounds,
  diagramNodes,
  edgeLabelPoint,
  edgePath,
  getVisibleRun,
  graphEdges,
  maxExecutions,
  miniNodeLines,
  miniNodeState,
  reviewAttemptCount,
  reviewEdgeBranch,
  reviewMaxAttempts,
  runTaskText,
  stageStatusLabel,
  type DiagramNode,
} from './orchestrationStatusModel'

/*
 * 编排状态浮层纯模型层单测（原 orchestrationStatusView 的可见 run 选择、
 * 文案拼装与迷你流程图 SVG 几何）：可见 run 优先级、当前节点/状态文案、
 * 审核次数、折线几何（直线 / 中点转折 / fail 通道 / 已存顶点正交折线）、
 * 分支判定与标签落点、高亮分类逐条锁定。
 */

function role(overrides: Partial<GroupRole> = {}): GroupRole {
  return { id: 'role-1', chatId: 'chat-1', name: '产品', chatSite: 'chatgpt', status: 'ready', contextCursor: 0, createdAt: 1, updatedAt: 1, ...overrides }
}

function stage(overrides: Partial<OrchestrationStage> = {}): OrchestrationStage {
  return { id: 'stage-1', kind: 'roles', name: '分析', roleIds: ['role-1'], ...overrides }
}

function stageRun(overrides: Partial<OrchestrationStageRun> = {}): OrchestrationStageRun {
  return { stageId: 'stage-1', stageIndex: 0, kind: 'roles', round: 1, status: 'running', roleRuns: {}, ...overrides }
}

function run(overrides: Partial<OrchestrationRun> = {}): OrchestrationRun {
  return {
    id: 'run-1',
    chatId: 'chat-1',
    flowId: 'flow-1',
    status: 'running',
    currentRound: 1,
    maxNodeExecutions: 50,
    maxRounds: 2,
    stageRuns: [stageRun()],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function flow(overrides: Partial<OrchestrationFlow> = {}): OrchestrationFlow {
  return {
    id: 'flow-1',
    chatId: 'chat-1',
    name: '默认编排',
    stages: [
      stage({ id: 'stage-1', name: '分析', roleIds: ['role-1'] }),
      stage({ id: 'stage-2', name: '实现', roleIds: ['role-2'] }),
      stage({ id: 'stage-3', kind: 'review', name: '复核', roleIds: [], review: { reviewerRoleIds: ['role-1'], instructions: '', maxAttempts: 3, onMaxAttempts: 'continue' } }),
    ],
    maxRounds: 2,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as OrchestrationFlow
}

function diagramNode(overrides: Partial<DiagramNode> = {}): DiagramNode {
  return { stage: stage(), x: 40, y: 70, width: 128, height: 64, ...overrides }
}

/** 与状态卡测试同源的三节点画布：两矩形 + 一个审核菱形 + fail 回边 */
function graphFlow(): OrchestrationFlow {
  return flow({
    graph: {
      stageNodes: [
        { ...stage({ id: 'stage-1', name: '分析', roleIds: ['role-1'] }), position: { x: 40, y: 70 } },
        { ...stage({ id: 'stage-2', name: '实现', roleIds: ['role-2'] }), position: { x: 220, y: 70 } },
        { ...stage({ id: 'stage-3', kind: 'review', name: '复核', roleIds: [], review: { reviewerRoleIds: ['role-1'], instructions: '', maxAttempts: 3, onMaxAttempts: 'continue' } }), position: { x: 400, y: 60 } },
      ],
      edges: [
        { sourceStageId: 'stage-1', targetStageId: 'stage-2' },
        { sourceStageId: 'stage-2', targetStageId: 'stage-3' },
        { sourceStageId: 'stage-3', targetStageId: 'stage-2', sourcePort: 'fail', vertices: [{ x: 440, y: 180 }, { x: 220, y: 180 }] },
      ],
    },
  })
}

function rolesMap(...roles: GroupRole[]): Map<string, GroupRole> {
  return new Map(roles.map(item => [item.id, item]))
}

function storeWith(parts: Partial<OpenTeamStore> = {}): OpenTeamStore {
  const store = createDefaultStore()
  return { ...store, ...parts }
}

describe('orchestration status labels', () => {
  it('maps every run status to its headline label', () => {
    expect(STATUS_LABELS).toEqual({
      pending: '编排等待中',
      running: '编排运行中',
      completed: '编排已完成',
      stopped: '编排已停止',
      error: '编排出错',
    })
  })

  it('prefers the active run, then falls back to the most recently updated run', () => {
    const store = storeWith({
      orchestrationRunsById: {
        'run-old': run({ id: 'run-old', updatedAt: 1000 }),
        'run-new': run({ id: 'run-new', updatedAt: 2000 }),
      },
    })

    expect(getVisibleRun(store, 'chat-1')?.id).toBe('run-new')

    store.activeOrchestrationRunIdByChatId['chat-1'] = 'run-old'
    expect(getVisibleRun(store, 'chat-1')?.id).toBe('run-old')

    expect(getVisibleRun(storeWith(), 'chat-1')).toBeUndefined()
  })

  it('picks the last running or error stage run, else the final stage run', () => {
    expect(currentStageRun(run({ stageRuns: [stageRun({ status: 'completed' }), stageRun({ status: 'running' }), stageRun({ status: 'error' })] }))?.status).toBe('error')
    expect(currentStageRun(run({ stageRuns: [stageRun({ status: 'completed' }), stageRun({ status: 'skipped', stageId: 'stage-2' })] }))?.stageId).toBe('stage-2')
    expect(currentStageRun(run({ stageRuns: [] }))).toBeUndefined()
  })

  it('describes the current node as review or stage name, or 未开始', () => {
    const graphed = graphFlow()
    expect(currentNodeText(run({ stageRuns: [stageRun({ stageIndex: 2, kind: 'review', stageId: 'stage-3' })] }), graphed)).toBe('审核')
    expect(currentNodeText(run({ stageRuns: [stageRun({ stageIndex: 1, stageId: 'stage-2' })] }), graphed)).toBe('实现')
    expect(currentNodeText(run({ stageRuns: [stageRun({ stageIndex: 9, stageId: 'stage-x' })] }), graphed)).toBe('未开始')
  })

  it('covers every current status wording branch', () => {
    expect(currentStatusText(stageRun({ status: 'running', kind: 'roles' }))).toBe('正在执行')
    expect(currentStatusText(stageRun({ status: 'running', kind: 'review' }))).toBe('正在判断流程走向')
    expect(currentStatusText(stageRun({ status: 'error', kind: 'roles' }))).toBe('节点失败')
    expect(currentStatusText(stageRun({ status: 'error', kind: 'review' }))).toBe('审核失败')
    expect(currentStatusText(stageRun({ status: 'skipped' }))).toBe('已停止，等待继续')
    expect(currentStatusText(stageRun({ status: 'completed' }))).toBe('已完成')
    expect(currentStatusText(stageRun({ status: 'pending' }))).toBe('等待执行')
  })

  it('derives execution budgets and review attempt numbers', () => {
    expect(maxExecutions(run({ maxNodeExecutions: 30, maxRounds: 2 }))).toBe(30)
    expect(maxExecutions(run({ maxNodeExecutions: undefined, maxRounds: 7 }))).toBe(7)

    expect(reviewMaxAttempts(stage({ kind: 'review', review: undefined }))).toBe(3)
    expect(reviewMaxAttempts(stage({ kind: 'review', review: { reviewerRoleIds: ['role-1'], instructions: '', maxAttempts: 2.7, onMaxAttempts: 'stop' } }))).toBe(2)
    expect(reviewMaxAttempts(stage({ kind: 'review', review: { reviewerRoleIds: ['role-1'], instructions: '', maxAttempts: 0, onMaxAttempts: 'stop' } }))).toBe(1)

    const attempts = run({
      stageRuns: [
        stageRun({ stageId: 'stage-3', kind: 'review' }),
        stageRun({ stageId: 'stage-3', kind: 'review', stageIndex: 1 }),
        stageRun({ stageId: 'stage-3', kind: 'roles', stageIndex: 2 }),
      ],
    })
    expect(reviewAttemptCount(attempts, 'stage-3')).toBe(2)
  })
})

describe('orchestration status text helpers', () => {
  it('joins role labels for stages and uses reviewers for review nodes', () => {
    const roles = rolesMap(role(), role({ id: 'role-2', name: '工程', chatSite: 'deepseek' }))
    const store = storeWith()

    expect(stageStatusLabel(stage({ roleIds: ['role-1', 'role-2'] }), roles, store)).toBe('产品（ChatGPT）、工程（DeepSeek）')
    expect(stageStatusLabel(
      stage({ id: 'stage-3', kind: 'review', roleIds: ['role-2'], review: { reviewerRoleIds: ['role-1'], instructions: '', maxAttempts: 3, onMaxAttempts: 'stop' } }),
      roles,
      store,
    )).toBe('产品（ChatGPT）')
    expect(stageStatusLabel(stage({ roleIds: ['role-ghost'] }), roles, store)).toBe('role-ghost')
    expect(stageStatusLabel(stage({ name: '空节点', roleIds: [] }), roles, store)).toBe('空节点')
  })

  it('formats mini node lines for single, multi, review, and missing roles', () => {
    const roles = rolesMap(role(), role({ id: 'role-2', name: '工程', chatSite: 'deepseek' }))
    const store = storeWith()
    const reviewRun = run({ stageRuns: [stageRun({ stageId: 'stage-3', kind: 'review' })] })

    expect(miniNodeLines(stage({ roleIds: ['role-1'] }), store, roles, reviewRun)).toEqual(['产品', 'ChatGPT'])
    expect(miniNodeLines(stage({ roleIds: ['role-1', 'role-2'] }), store, roles, reviewRun)).toEqual(['产品', '2 人 · ChatGPT'])
    expect(miniNodeLines(
      stage({ id: 'stage-3', kind: 'review', roleIds: [], review: { reviewerRoleIds: ['role-1'], instructions: '', maxAttempts: 3, onMaxAttempts: 'continue' } }),
      store,
      roles,
      reviewRun,
    )).toEqual(['产品', 'ChatGPT', '1/3'])
    expect(miniNodeLines(stage({ name: '占位', roleIds: ['role-ghost'] }), store, roles, reviewRun)).toEqual(['占位'])
  })

  it('reads the run task from the task-kind message of that run', () => {
    const store = storeWith()
    store.chatsById['chat-1'] = { id: 'chat-1', name: '群聊', mode: 'independent', roleIds: [], messageIds: ['msg-a', 'msg-b', 'msg-c'], nextMessageSeq: 4, status: 'ready', createdAt: 1, updatedAt: 1 } as GroupChat
    store.messagesById['msg-a'] = { id: 'msg-a', chatId: 'chat-1', seq: 1, type: 'user', content: '  编排目标  ', targetRoleIds: [], mentionedRoleIds: [], mentionsAll: false, orchestrationRunId: 'run-1', orchestrationKind: 'task', createdAt: 1, status: 'received' }
    store.messagesById['msg-b'] = { id: 'msg-b', chatId: 'chat-1', seq: 2, type: 'user', content: '非任务', targetRoleIds: [], mentionedRoleIds: [], mentionsAll: false, orchestrationRunId: 'run-1', orchestrationKind: 'status', createdAt: 2, status: 'received' }
    store.messagesById['msg-c'] = { id: 'msg-c', chatId: 'chat-1', seq: 3, type: 'user', content: '别的运行', targetRoleIds: [], mentionedRoleIds: [], mentionsAll: false, orchestrationRunId: 'run-2', orchestrationKind: 'task', createdAt: 3, status: 'received' }

    expect(runTaskText(run(), store)).toBe('编排目标')
    expect(runTaskText(run({ id: 'run-9' }), store)).toBeUndefined()
  })
})

describe('orchestration mini diagram geometry', () => {
  it('collects nodes from the graph snapshot with kind-based sizes', () => {
    const nodes = diagramNodes(graphFlow())

    expect(nodes.map(node => [node.x, node.y, node.width, node.height])).toEqual([
      [40, 70, 128, 64],
      [220, 70, 128, 64],
      [400, 60, 116, 90],
    ])
    // 无图快照时按顺序落位
    const plain = diagramNodes(flow({ stages: [stage({ id: 'a' }), stage({ id: 'b', kind: 'review', roleIds: [], review: { reviewerRoleIds: ['role-1'], instructions: '', maxAttempts: 3, onMaxAttempts: 'stop' } })] }))
    expect(plain.map(node => [node.x, node.y])).toEqual([[40, 64], [210, 52]])
  })

  it('falls back to sequential edges when the flow has no graph edges', () => {
    const plain = flow({ stages: [stage({ id: 'a' }), stage({ id: 'b' }), stage({ id: 'c' })] })
    expect(graphEdges(plain)).toEqual([
      { sourceStageId: 'a', targetStageId: 'b' },
      { sourceStageId: 'b', targetStageId: 'c' },
    ])
    expect(graphEdges(graphFlow())).toHaveLength(3)
  })

  it('bounds the diagram by nodes and vertices with fixed margins', () => {
    const nodes = diagramNodes(graphFlow())
    const edges = graphFlow().graph!.edges

    expect(diagramBounds(nodes, edges)).toEqual({ x: -36, y: -36, width: 588, height: 252 })
    expect(diagramBounds([], [])).toEqual({ x: -36, y: -36, width: 432, height: 252 })
  })

  it('draws straight lines for aligned nodes and bends at a midpoint otherwise', () => {
    const source = diagramNode()
    const aligned = diagramNode({ stage: stage({ id: 'b' }), x: 220 })
    const offset = diagramNode({ stage: stage({ id: 'b' }), x: 220, y: 140 })

    expect(edgePath(source, aligned, { sourceStageId: 'stage-1', targetStageId: 'b' })).toBe('M 168 102 L 220 102')
    expect(edgePath(source, offset, { sourceStageId: 'stage-1', targetStageId: 'b' })).toBe('M 168 102 L 202 102 L 202 172 L 220 172')
  })

  it('routes fail branches through a lane below both nodes', () => {
    const source = diagramNode({ x: 400, y: 60, width: 116, height: 90 })
    const target = diagramNode({ stage: stage({ id: 'b' }) })

    expect(edgePath(source, target, { sourceStageId: 'stage-3', targetStageId: 'b', sourcePort: 'fail' })).toBe('M 458 150 L 458 208 L 40 208 L 40 102')
  })

  it('honors saved vertices as orthogonal segments', () => {
    const source = diagramNode({ x: 400, y: 60, width: 116, height: 90 })
    const target = diagramNode({ stage: stage({ id: 'b' }) })
    const edge: OrchestrationGraphEdge = { sourceStageId: 'stage-3', targetStageId: 'b', sourcePort: 'fail', vertices: [{ x: 300, y: 130 }] }

    expect(edgePath(source, target, edge)).toBe('M 458 150 L 300 150 L 300 130 L 40 130 L 40 102')
    expect(edgeLabelPoint(source, target, edge)).toEqual({ x: 300, y: 130 })
    // 直线只有两点，标签取终点（目标左缘中点）
    expect(edgeLabelPoint(source, { ...target, y: 70 }, { sourceStageId: 'stage-3', targetStageId: 'b' })).toEqual({ x: 40, y: 102 })
  })

  it('classifies review edge branches and node highlight states', () => {
    const stages = graphFlow().stages
    expect(reviewEdgeBranch({ sourceStageId: 'stage-1', targetStageId: 'stage-2' }, stages)).toBeUndefined()
    expect(reviewEdgeBranch({ sourceStageId: 'stage-3', targetStageId: 'stage-2', sourcePort: 'fail' }, stages)).toBe('fail')
    expect(reviewEdgeBranch({ sourceStageId: 'stage-3', targetStageId: 'stage-2' }, stages)).toBe('pass')

    const runningRun = run({
      stageRuns: [
        stageRun({ status: 'completed' }),
        stageRun({ stageId: 'stage-2', stageIndex: 1, status: 'completed' }),
        stageRun({ stageId: 'stage-3', stageIndex: 2, kind: 'review', status: 'running' }),
      ],
    })
    expect(miniNodeState(runningRun, 'stage-3')).toEqual({ current: true, completed: false, error: false })
    expect(miniNodeState(runningRun, 'stage-1')).toEqual({ current: false, completed: true, error: false })
    expect(miniNodeState(run({ status: 'error', stageRuns: [stageRun({ status: 'error' })] }), 'stage-1')).toEqual({ current: true, completed: false, error: true })
  })
})

describe('orchestration status model assembly', () => {
  it('returns undefined without a visible run or without the run flow', () => {
    expect(buildOrchestrationStatusModel(storeWith(), { id: 'chat-1' } as GroupChat, [])).toBeUndefined()

    const store = storeWith({ orchestrationRunsById: { 'run-1': run() } })
    expect(buildOrchestrationStatusModel(store, { id: 'chat-1' } as GroupChat, [])).toBeUndefined()
  })

  it('assembles the full model with a role lookup map', () => {
    const graphed = graphFlow()
    const productRun = run()
    const store = storeWith({
      orchestrationFlowsById: { 'flow-1': graphed },
      orchestrationRunsById: { 'run-1': productRun },
    })
    const chat = { id: 'chat-1', name: '群聊' } as GroupChat

    const model = buildOrchestrationStatusModel(store, chat, [role(), role({ id: 'role-2', name: '工程', chatSite: 'deepseek' })])

    expect(model?.run.id).toBe('run-1')
    expect(model?.flow.id).toBe('flow-1')
    expect(model?.chat.id).toBe('chat-1')
    expect(model?.rolesById.get('role-2')?.name).toBe('工程')
    expect(model?.store).toBe(store)
  })
})
