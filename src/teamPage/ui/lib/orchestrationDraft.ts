import { BUILTIN_ORCHESTRATION_TEMPLATES, type BuiltinOrchestrationTemplate, type OrchestrationTemplateRole } from '../../../group/orchestrationTemplates'
import type { ChatSite, ExternalModelConfig, GroupRole, OpenTeamStore, OrchestrationAutoPlanHistoryEntry, OrchestrationFlow, OrchestrationGraphSnapshot, OrchestrationStage } from '../../../group/types'
import { DEFAULT_ORCHESTRATION_MAX_NODE_EXECUTIONS, DEFAULT_ORCHESTRATION_REVIEW_MAX_ATTEMPTS, MAX_ORCHESTRATION_MAX_NODE_EXECUTIONS } from '../../../group/types'

/*
 * 编排弹窗草稿的纯函数层（原 orchestrationModalView 内部的 clone/normalize/
 * order/filter 等工具整体外移）。全部函数无 DOM、无 React 依赖，便于单测；
 * 弹窗组件只做状态编排与事件接线。
 */

export interface FlowDraft {
  flowId?: string
  task: string
  stages: OrchestrationStage[]
  graphEdges: OrchestrationGraphSnapshot['edges']
  autoPlanHistory: OrchestrationAutoPlanHistoryEntry[]
  maxNodeExecutions: number
  selectedStageId?: string
}

export function emptyDraft(): FlowDraft {
  return { task: '', stages: [], graphEdges: [], autoPlanHistory: [], maxNodeExecutions: DEFAULT_ORCHESTRATION_MAX_NODE_EXECUTIONS }
}

export function draftFromFlow(flow: OrchestrationFlow): FlowDraft {
  const stages = cloneStages(flow.graph?.stageNodes?.length ? flow.graph.stageNodes : flow.stages)
  return {
    flowId: flow.id,
    task: flow.description?.trim() ?? '',
    stages,
    graphEdges: flow.graph?.edges ? cloneGraphEdges(flow.graph.edges) : sequentialGraphEdges(stages),
    autoPlanHistory: cloneAutoPlanHistory(flow.autoPlanHistory ?? []),
    maxNodeExecutions: clampMaxNodeExecutions(flow.maxNodeExecutions ?? DEFAULT_ORCHESTRATION_MAX_NODE_EXECUTIONS),
    selectedStageId: undefined,
  }
}

export function cloneStages(stages: OrchestrationStage[]): OrchestrationStage[] {
  return stages.map(stage => ({
    ...stage,
    position: stage.position ? { x: stage.position.x, y: stage.position.y } : undefined,
    roleIds: [...stage.roleIds],
    review: stage.review ? { ...stage.review, reviewerRoleIds: [...stage.review.reviewerRoleIds] } : undefined,
  }))
}

export function normalizedReviewConfig(stage: OrchestrationStage, patch: Partial<NonNullable<OrchestrationStage['review']>> = {}): NonNullable<OrchestrationStage['review']> {
  return {
    reviewerRoleIds: stage.review?.reviewerRoleIds?.length ? [...stage.review.reviewerRoleIds] : [...stage.roleIds.slice(0, 1)],
    instructions: stage.review?.instructions ?? '',
    maxAttempts: clampReviewAttempts(stage.review?.maxAttempts ?? DEFAULT_ORCHESTRATION_REVIEW_MAX_ATTEMPTS),
    onMaxAttempts: stage.review?.onMaxAttempts === 'continue' ? 'continue' : 'stop',
    ...patch,
  }
}

export function cloneGraphEdges(edges: OrchestrationGraphSnapshot['edges']): OrchestrationGraphSnapshot['edges'] {
  return edges.map(edge => ({
    sourceStageId: edge.sourceStageId,
    targetStageId: edge.targetStageId,
    ...(edge.sourcePort ? { sourcePort: edge.sourcePort } : {}),
    ...(edge.targetPort ? { targetPort: edge.targetPort } : {}),
    ...(edge.vertices && edge.vertices.length > 0 ? { vertices: edge.vertices.map(vertex => ({ x: vertex.x, y: vertex.y })) } : {}),
  }))
}

export function cloneAutoPlanHistory(history: OrchestrationAutoPlanHistoryEntry[]): OrchestrationAutoPlanHistoryEntry[] {
  return history.map(entry => ({ id: entry.id, role: entry.role, content: entry.content, createdAt: entry.createdAt }))
}

export function sequentialGraphEdges(stages: OrchestrationStage[]): OrchestrationGraphSnapshot['edges'] {
  return stages.slice(1).map((stage, index) => ({ sourceStageId: stages[index].id, targetStageId: stage.id }))
}

export function filterGraphEdges(edges: OrchestrationGraphSnapshot['edges'], stages: OrchestrationStage[]): OrchestrationGraphSnapshot['edges'] {
  const stageIds = new Set(stages.map(stage => stage.id))
  const seen = new Set<string>()
  const result: OrchestrationGraphSnapshot['edges'] = []
  for (const edge of edges) {
    if (!stageIds.has(edge.sourceStageId) || !stageIds.has(edge.targetStageId) || edge.sourceStageId === edge.targetStageId) continue
    const sourcePort = edge.sourcePort ?? ''
    const targetPort = edge.targetPort ?? ''
    const key = `${edge.sourceStageId}:${sourcePort}->${edge.targetStageId}:${targetPort}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({
      sourceStageId: edge.sourceStageId,
      targetStageId: edge.targetStageId,
      ...(edge.sourcePort ? { sourcePort: edge.sourcePort } : {}),
      ...(edge.targetPort ? { targetPort: edge.targetPort } : {}),
      ...(edge.vertices && edge.vertices.length > 0 ? { vertices: edge.vertices.map(vertex => ({ x: vertex.x, y: vertex.y })) } : {}),
    })
  }
  return result
}

export function orderStagesByGraph(stages: OrchestrationStage[], edges: OrchestrationGraphSnapshot['edges']): OrchestrationStage[] {
  const stageIds = new Set(stages.map(stage => stage.id))
  const validEdges = filterGraphEdges(edges, stages)
  if (validEdges.length === 0) return stages

  const outgoing = new Map<string, string[]>()
  const indegree = new Map(stages.map(stage => [stage.id, 0]))
  for (const edge of validEdges) {
    outgoing.set(edge.sourceStageId, [...outgoing.get(edge.sourceStageId) ?? [], edge.targetStageId])
    indegree.set(edge.targetStageId, (indegree.get(edge.targetStageId) ?? 0) + 1)
  }

  const byId = new Map(stages.map(stage => [stage.id, stage]))
  const queue = stages.filter(stage => (indegree.get(stage.id) ?? 0) === 0)
  const ordered: OrchestrationStage[] = []
  const emitted = new Set<string>()
  for (let index = 0; index < queue.length; index += 1) {
    const stage = queue[index]
    if (!stage || emitted.has(stage.id)) continue
    ordered.push(stage)
    emitted.add(stage.id)
    for (const targetId of outgoing.get(stage.id) ?? []) {
      if (!stageIds.has(targetId)) continue
      const nextIndegree = (indegree.get(targetId) ?? 0) - 1
      indegree.set(targetId, nextIndegree)
      const target = byId.get(targetId)
      if (target && nextIndegree === 0) queue.push(target)
    }
  }

  if (ordered.length === stages.length) return ordered
  return [...ordered, ...stages.filter(stage => !emitted.has(stage.id))]
}

/**
 * 画布结构签名：节点 id/kind/名称/人员/位置。任务描述、审核标准等纯草稿
 * 字段刻意不进签名——原视图只在节点名称输入时重画画布，描述与审核配置
 * 输入不重画；签名驱动 CanvasPortal 的 render effect 保持同一节奏。
 */
export function stagesCanvasKey(stages: OrchestrationStage[]): string {
  return stages
    .map(stage => `${stage.id}:${stage.kind}:${stage.name}:${stage.roleIds.join(',')}:${stage.position ? `${stage.position.x},${stage.position.y}` : ''}`)
    .join('|')
}

/** 边结构签名：端口拓扑。顶点拖拽由画布内部消化，不触发重渲染。 */
export function edgesCanvasKey(edges: OrchestrationGraphSnapshot['edges']): string {
  return edges.map(edge => `${edge.sourceStageId}:${edge.sourcePort ?? ''}->${edge.targetStageId}:${edge.targetPort ?? ''}`).join('|')
}

export function clampMaxNodeExecutions(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_ORCHESTRATION_MAX_NODE_EXECUTIONS
  return Math.min(MAX_ORCHESTRATION_MAX_NODE_EXECUTIONS, Math.max(1, Math.trunc(value)))
}

export function clampReviewAttempts(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_ORCHESTRATION_REVIEW_MAX_ATTEMPTS
  return Math.min(50, Math.max(1, Math.trunc(value)))
}

export function selectedRoleIds(stage: OrchestrationStage): string[] {
  if (stage.kind === 'review') return stage.review?.reviewerRoleIds.length ? stage.review.reviewerRoleIds : stage.roleIds
  return stage.roleIds
}

export function autoGenerateSuccessMessage(createdCount: number, reusedCount: number): string {
  if (createdCount > 0 && reusedCount > 0) return `已自动生成编排草稿，复用 ${reusedCount} 个成员，新增 ${createdCount} 个人员`
  if (createdCount > 0) return `已自动生成编排草稿，新增 ${createdCount} 个人员`
  return '已自动生成编排草稿，可继续调整后保存或运行'
}

export function templateCategoryLabel(category: BuiltinOrchestrationTemplate['category']): string {
  return category === 'structure' ? '编排类型' : '业务场景'
}

export function templateCapabilityLabel(capability: string): string {
  if (capability === 'sequential') return '顺序'
  if (capability === 'parallel') return '并行'
  if (capability === 'review') return '审核'
  if (capability === 'loop') return '循环'
  if (capability === 'merge') return '汇总'
  return capability
}

export function requireTemplateRoleId(roleIdsByKey: Map<string, string>, roleKey: string, templateName: string): string {
  const roleId = roleIdsByKey.get(roleKey)
  if (!roleId) throw new Error(`模板「${templateName}」缺少人员：${roleKey}`)
  return roleId
}

export function findReusableTemplateRole(templateRole: OrchestrationTemplateRole, roles: GroupRole[], usedRoleIds: Set<string>): GroupRole | undefined {
  const acceptableNames = new Set([templateRole.name, ...(templateRole.aliases ?? [])].map(normalizeTemplateRoleName))
  return roles.find(role => !usedRoleIds.has(role.id) && acceptableNames.has(normalizeTemplateRoleName(role.name)))
}

export function isGeneratedEditableRole(role: GroupRole): boolean {
  return role.createdBy === 'orchestration-auto' || role.createdBy === 'orchestration-template'
}

export function isBuiltinOrchestrationTemplateRoleName(name: string): boolean {
  const normalizedName = normalizeTemplateRoleName(name)
  return builtinOrchestrationTemplateRoleNames().has(normalizedName)
}

function builtinOrchestrationTemplateRoleNames(): Set<string> {
  return new Set(BUILTIN_ORCHESTRATION_TEMPLATES.flatMap(template => template.roles.map(role => normalizeTemplateRoleName(role.name))))
}

function normalizeTemplateRoleName(name: string): string {
  return name.trim().toLowerCase()
}

export function roleInitial(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || '员'
}

export function roleToneClass(seed: string): string {
  const tones = ['tone-blue', 'tone-green', 'tone-purple', 'tone-orange']
  const total = [...seed].reduce((sum, char) => sum + char.charCodeAt(0), 0)
  return tones[total % tones.length]
}

export function roleModelDisplay(role: Pick<GroupRole, 'modelSource' | 'externalModelId' | 'chatSite'>, store: OpenTeamStore): { label: string; className: string } {
  if (role.modelSource === 'external' && role.externalModelId) {
    return { label: externalModelLabel(store.settings.externalModelsById[role.externalModelId]), className: 'site-pill-external' }
  }
  const site = visibleChatSite(role.chatSite ?? store.settings.defaultChatSite)
  return { label: siteLabel(site), className: `site-pill-${site}` }
}

export function siteLabel(site: ChatSite): string {
  if (site === 'chatgpt') return 'ChatGPT'
  if (site === 'claude') return 'Claude'
  if (site === 'deepseek') return 'DeepSeek'
  if (site === 'grok') return 'Grok'
  return 'Gemini'
}

export function editableChatSites(): ChatSite[] {
  return ['deepseek', 'grok', 'chatgpt', 'gemini', 'claude']
}

function externalModelLabel(model: ExternalModelConfig | undefined): string {
  return model ? `API · ${model.name}` : 'API · 未配置'
}

export function visibleChatSite(site: ChatSite): ChatSite {
  return ['gemini', 'chatgpt', 'claude', 'deepseek', 'grok'].includes(site) ? site : 'gemini'
}

export function hasExternalApiConfigured(store: OpenTeamStore): boolean {
  return store.settings.externalModelOrder.some(modelId => {
    const model = store.settings.externalModelsById[modelId]
    return Boolean(model?.name.trim() && model.baseUrl.trim() && model.apiKey.trim() && model.modelName.trim())
  })
}

export function newId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `${prefix}-${crypto.randomUUID()}`
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}
