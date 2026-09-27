import type { ChatSite, ExternalModelConfig, GroupChat, GroupRole, OpenTeamStore, OrchestrationFlow, OrchestrationGraphEdge, OrchestrationRun, OrchestrationStage, OrchestrationStageRun } from '../../../group/types'
import { DEFAULT_ORCHESTRATION_REVIEW_MAX_ATTEMPTS } from '../../../group/types'

/*
 * 编排状态浮层的纯模型层（原 orchestrationStatusView 的可见 run 选择、
 * 文案拼装与 SVG 迷你流程图几何计算）。DOM 构建由 OrchestrationStatusCard
 * 以 JSX 承担；本模块只输出数据与 path 字符串，便于单测锁定。
 */

export const STATUS_LABELS: Record<OrchestrationRun['status'], string> = {
  pending: '编排等待中',
  running: '编排运行中',
  completed: '编排已完成',
  stopped: '编排已停止',
  error: '编排出错',
}

export interface DiagramNode {
  stage: OrchestrationStage
  x: number
  y: number
  width: number
  height: number
}

export function getVisibleRun(store: OpenTeamStore, chatId: string): OrchestrationRun | undefined {
  const activeRunId = store.activeOrchestrationRunIdByChatId[chatId]
  const activeRun = activeRunId ? store.orchestrationRunsById[activeRunId] : undefined
  if (activeRun) return activeRun
  const latest = Object.values(store.orchestrationRunsById)
    .filter(run => run.chatId === chatId)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]
  return latest
}

export function currentStageRun(run: OrchestrationRun): OrchestrationStageRun | undefined {
  return [...run.stageRuns].reverse().find(stageRun => stageRun.status === 'running' || stageRun.status === 'error') ?? run.stageRuns[run.stageRuns.length - 1]
}

export function currentNodeText(run: OrchestrationRun, flow: OrchestrationFlow): string {
  const current = currentStageRun(run)
  const stage = current ? flow.stages[current.stageIndex] : undefined
  return stage?.kind === 'review' ? '审核' : stage?.name ?? '未开始'
}

export function currentStatusText(current: OrchestrationStageRun): string {
  if (current.status === 'running') return current.kind === 'review' ? '正在判断流程走向' : '正在执行'
  if (current.status === 'error') return current.kind === 'review' ? '审核失败' : '节点失败'
  if (current.status === 'skipped') return '已停止，等待继续'
  if (current.status === 'completed') return '已完成'
  return '等待执行'
}

export function maxExecutions(run: OrchestrationRun): number {
  return run.maxNodeExecutions ?? run.maxRounds
}

export function reviewMaxAttempts(stage: OrchestrationStage): number {
  const value = stage.review?.maxAttempts
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_ORCHESTRATION_REVIEW_MAX_ATTEMPTS
  return Math.max(1, Math.floor(value))
}

export function reviewAttemptCount(run: OrchestrationRun, stageId: string): number {
  return run.stageRuns.filter(stageRun => stageRun.stageId === stageId && stageRun.kind === 'review').length
}

export function reviewAttemptText(run: OrchestrationRun, stage: OrchestrationStage): string {
  return `${reviewAttemptCount(run, stage.id)}/${reviewMaxAttempts(stage)}`
}

export function stageStatusLabel(stage: OrchestrationStage, rolesById: Map<string, GroupRole>, store: OpenTeamStore): string {
  const roleIds = stage.kind === 'review' ? stage.review?.reviewerRoleIds ?? stage.roleIds : stage.roleIds
  const roleLabels = roleIds.map(roleId => roleStatusLabel(rolesById.get(roleId), roleId, store))
  return roleLabels.length > 0 ? roleLabels.join('、') : stage.name
}

export function miniNodeLines(stage: OrchestrationStage, store: OpenTeamStore, rolesById: Map<string, GroupRole>, run: OrchestrationRun): string[] {
  const roleIds = stage.kind === 'review' ? stage.review?.reviewerRoleIds ?? stage.roleIds : stage.roleIds
  const firstRole = roleIds[0] ? rolesById.get(roleIds[0]) : undefined
  const name = firstRole?.name ?? stage.name
  const site = firstRole ? roleModelLabel(firstRole, store) : ''
  if (stage.kind === 'review') return [name, site, reviewAttemptText(run, stage)].filter(Boolean)
  if (roleIds.length > 1) return [name, `${roleIds.length} 人 · ${site}`].filter(Boolean)
  return [name, site].filter(Boolean)
}

function roleStatusLabel(role: GroupRole | undefined, fallbackId: string, store: OpenTeamStore): string {
  if (!role) return fallbackId
  return `${role.name}（${roleModelLabel(role, store)}）`
}

function roleModelLabel(role: Pick<GroupRole, 'modelSource' | 'externalModelId' | 'chatSite'>, store: OpenTeamStore): string {
  if (role.modelSource === 'external' && role.externalModelId) return externalModelLabel(store.settings.externalModelsById[role.externalModelId])
  return siteLabel(role.chatSite ?? store.settings.defaultChatSite)
}

function externalModelLabel(model: ExternalModelConfig | undefined): string {
  return model?.name ?? 'API'
}

function siteLabel(site: ChatSite): string {
  if (site === 'chatgpt') return 'ChatGPT'
  if (site === 'claude') return 'Claude'
  if (site === 'deepseek') return 'DeepSeek'
  if (site === 'grok') return 'Grok'
  return 'Gemini'
}

export function runTaskText(run: OrchestrationRun, store: OpenTeamStore): string | undefined {
  const chat = store.chatsById[run.chatId]
  return chat?.messageIds
    .map(messageId => store.messagesById[messageId])
    .find(message => message?.orchestrationRunId === run.id && message.orchestrationKind === 'task')
    ?.content
    ?.trim()
}

export function diagramNodes(flow: OrchestrationFlow): DiagramNode[] {
  const stages = flow.graph?.stageNodes?.length ? flow.graph.stageNodes : flow.stages
  return stages.map((stage, index) => ({
    stage,
    x: stage.position?.x ?? 40 + index * 170,
    y: stage.position?.y ?? (stage.kind === 'review' ? 52 : 64),
    width: stage.kind === 'review' ? 116 : 128,
    height: stage.kind === 'review' ? 90 : 64,
  }))
}

export function diagramBounds(nodes: DiagramNode[], edges: OrchestrationGraphEdge[]): { x: number; y: number; width: number; height: number } {
  const xs: number[] = []
  const ys: number[] = []
  for (const node of nodes) {
    xs.push(node.x, node.x + node.width)
    ys.push(node.y, node.y + node.height)
  }
  for (const edge of edges) {
    for (const vertex of edge.vertices ?? []) {
      xs.push(vertex.x)
      ys.push(vertex.y)
    }
  }
  const minX = Math.min(...xs, 0) - 36
  const minY = Math.min(...ys, 0) - 36
  const maxX = Math.max(...xs, 360) + 36
  const maxY = Math.max(...ys, 180) + 36
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

export function graphEdges(flow: OrchestrationFlow): OrchestrationGraphEdge[] {
  if (flow.graph?.edges?.length) return flow.graph.edges
  return flow.stages.slice(0, -1).map((stage, index) => ({ sourceStageId: stage.id, targetStageId: flow.stages[index + 1].id }))
}

export function edgePath(source: DiagramNode, target: DiagramNode, edge: OrchestrationGraphEdge): string {
  return edgePoints(source, target, edge).map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
}

export function edgePoints(source: DiagramNode, target: DiagramNode, edge: OrchestrationGraphEdge): Array<{ x: number; y: number }> {
  const fail = edge.sourcePort === 'fail'
  const start = fail
    ? { x: source.x + source.width / 2, y: source.y + source.height }
    : { x: source.x + source.width, y: source.y + source.height / 2 }
  const end = { x: target.x, y: target.y + target.height / 2 }
  if (edge.vertices?.length) return orthogonalPoints(start, edge.vertices, end)
  if (fail) {
    const laneY = Math.max(source.y + source.height, target.y + target.height) + 58
    return [start, { x: start.x, y: laneY }, { x: end.x, y: laneY }, end]
  }
  if (Math.abs(start.y - end.y) < 8) return [start, end]
  const midX = start.x + Math.max(34, (end.x - start.x) / 2)
  return [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end]
}

function orthogonalPoints(start: { x: number; y: number }, vertices: Array<{ x: number; y: number }>, end: { x: number; y: number }): Array<{ x: number; y: number }> {
  const points = [start]
  let cursor = start
  for (const vertex of vertices) {
    if (cursor.x !== vertex.x && cursor.y !== vertex.y) points.push({ x: vertex.x, y: cursor.y })
    points.push(vertex)
    cursor = vertex
  }
  if (cursor.x !== end.x && cursor.y !== end.y) points.push({ x: end.x, y: cursor.y })
  points.push(end)
  return points
}

export function reviewEdgeBranch(edge: OrchestrationGraphEdge, stages: OrchestrationStage[]): 'pass' | 'fail' | undefined {
  const sourceStage = stages.find(stage => stage.id === edge.sourceStageId)
  if (sourceStage?.kind !== 'review') return undefined
  if (edge.sourcePort === 'fail') return 'fail'
  return 'pass'
}

/** 分支标签落点（原 edgeLabel 取折线中点） */
export function edgeLabelPoint(source: DiagramNode, target: DiagramNode, edge: OrchestrationGraphEdge): { x: number; y: number } {
  const points = edgePoints(source, target, edge)
  return points[Math.floor(points.length / 2)]
}

/** 迷你流程图中当前节点的高亮分类（原 classList 拼装逻辑） */
export function miniNodeState(run: OrchestrationRun, stageId: string): { current: boolean; completed: boolean; error: boolean } {
  const current = currentStageRun(run)
  const completedIds = new Set(run.stageRuns.filter(stageRun => stageRun.status === 'completed' || stageRun.status === 'skipped').map(stageRun => stageRun.stageId))
  const errorId = run.status === 'error' ? current?.stageId : undefined
  return {
    current: current?.stageId === stageId,
    completed: completedIds.has(stageId),
    error: errorId === stageId,
  }
}

/** 当前聊天可见 run 的完整视图模型（卡片渲染的全部输入） */
export interface OrchestrationStatusModel {
  run: OrchestrationRun
  flow: OrchestrationFlow
  chat: GroupChat
  rolesById: Map<string, GroupRole>
  store: OpenTeamStore
}

export function buildOrchestrationStatusModel(store: OpenTeamStore, chat: GroupChat, roles: GroupRole[]): OrchestrationStatusModel | undefined {
  const run = getVisibleRun(store, chat.id)
  if (!run) return undefined
  const flow = store.orchestrationFlowsById[run.flowId]
  if (!flow) return undefined
  return { run, flow, chat, rolesById: new Map(roles.map(role => [role.id, role])), store }
}
