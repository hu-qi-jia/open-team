import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type {
  ChatSite,
  GroupChat,
  GroupRole,
  OpenTeamStore,
  OrchestrationAutoPlanHistoryEntry,
  OrchestrationFlow,
  OrchestrationGraphSnapshot,
  OrchestrationStage,
} from '../../../../group/types'
import { DEFAULT_ORCHESTRATION_MAX_NODE_EXECUTIONS, DEFAULT_ORCHESTRATION_REVIEW_MAX_ATTEMPTS, MAX_ORCHESTRATION_MAX_NODE_EXECUTIONS } from '../../../../group/types'
import { getBuiltinOrchestrationTemplate, type BuiltinOrchestrationTemplate, type OrchestrationTemplateRole } from '../../../../group/orchestrationTemplates'
import { normalizeLanguage, translateUi } from '../../../../shared/i18n'
import { arrangeOrchestrationGraph } from '../../../orchestrationCanvas'
import { runCommandWithReconnect } from '../../../sendWithReconnect'
import { useServices } from '../../context/ServicesContext'
import { useStoreSelector } from '../../hooks/useStoreSelector'
import { getAppState, getAppStateVersion } from '../../lib/appStore'
import {
  autoGenerateSuccessMessage,
  cloneAutoPlanHistory,
  cloneGraphEdges,
  cloneStages,
  edgesCanvasKey,
  emptyDraft,
  findReusableTemplateRole,
  hasExternalApiConfigured,
  isBuiltinOrchestrationTemplateRoleName,
  isGeneratedEditableRole,
  newId,
  normalizedReviewConfig,
  clampMaxNodeExecutions,
  clampReviewAttempts,
  requireTemplateRoleId,
  roleInitial,
  roleModelDisplay,
  roleToneClass,
  selectedRoleIds,
  editableChatSites,
  visibleChatSite,
  siteLabel,
  stagesCanvasKey,
  draftFromFlow,
  filterGraphEdges,
  orderStagesByGraph,
} from '../../lib/orchestrationDraft'
import {
  beginOrchestrationAutoStream,
  endOrchestrationAutoStream,
  getOrchestrationAutoStreamState,
  pendingAutoStreamEntries,
  subscribeOrchestrationAutoStream,
} from '../../lib/orchestrationStreamStore'
import { showError, showSuccess } from '../../lib/toast'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../ui/alert-dialog'
import { CanvasPortal } from '../containers/CanvasPortal'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'
import { OrchestrationAutoModal } from './OrchestrationAutoModal'
import { OrchestrationTemplatePickerModal } from './OrchestrationTemplatePickerModal'

/** sendRuntimeMessage 的编排扩展字段（background 在 RuntimeResponse 顶层附加） */
interface OrchestrationCommandResponse {
  ok?: boolean
  error?: string
  store?: OpenTeamStore
  flow?: OrchestrationFlow
  roles?: GroupRole[]
  createdRoleIds?: string[]
  reusedRoleIds?: string[]
}

/*
 * 编排弹窗（原 orchestrationModalView 整体 React 化，P4c）。
 *
 * DOM id/类名与 legacyMarkup 逐字对应（#orchestration-modal /
 * #orchestration-auto-modal / #orchestration-template-modal 三层由本组件
 * 与两个子弹窗组件渲染，LegacySlot 字符串同步删除）。职责划分：
 * - 草稿状态 = flowId/task/stages/graphEdges/autoPlanHistory/maxRounds/
 *   selectedStageId 独立 useState（maxRounds 保留原始输入串——validateDraft
 *   校验原始 Number，buildFlow 再钳制，与原 input.value 语义一致）；
 * - store/角色读取全部经 getAppState() 即时取值（原 deps.getStore() 同义），
 *   写入只走 runCommand / sendRuntimeMessage + applyStore（background 推送
 *   的同一入口，仅用于回填命令响应自带的新 store）；
 * - 画布生命周期在 CanvasPortal（开弹窗挂载 / 关弹窗销毁），本组件只在
 *   open 时渲染它，避免页面启动即加载 X6；
 * - 套用模板的 window.confirm 以 AlertDialog 承接（pendingTemplate 暂存）；
 * - 模板/自动生成创建的人员 id 记入 templateManagedRoleIds（ref），再次套
 *   模板时先删后建（原 collectTemplateRoleIdsToDelete 对译）。
 * W1 起外壳换 Radix Dialog：本弹窗不响应 Escape/背板点击——原
 * teamUiController 的 Escape 处理只覆盖群模板弹窗，编排弹窗仅按钮可关
 * （行为保真：onEscapeKeyDown/onInteractOutside preventDefault + 无
 * onOpenChange，首开聚焦走 onOpenAutoFocus）。
 */
export function OrchestrationModal() {
  const services = useServices()
  const language = useStoreSelector(state => normalizeLanguage(state.store.settings.language))
  const ui = (source: string) => translateUi(source, language)
  const storeVersion = useStoreSelector(getAppStateVersion)
  const streamState = useSyncExternalStore(subscribeOrchestrationAutoStream, getOrchestrationAutoStreamState)

  const [open, setOpen] = useState(false)
  const [flowId, setFlowId] = useState<string | undefined>(undefined)
  const [task, setTask] = useState('')
  const [stages, setStages] = useState<OrchestrationStage[]>([])
  const [graphEdges, setGraphEdges] = useState<OrchestrationGraphSnapshot['edges']>([])
  const [autoPlanHistory, setAutoPlanHistory] = useState<OrchestrationAutoPlanHistoryEntry[]>([])
  const [maxRounds, setMaxRounds] = useState(String(DEFAULT_ORCHESTRATION_MAX_NODE_EXECUTIONS))
  const [selectedStageId, setSelectedStageId] = useState<string | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [autoGenerating, setAutoGenerating] = useState(false)
  const [applyingTemplate, setApplyingTemplate] = useState(false)
  const [autoPanelOpen, setAutoPanelOpen] = useState(false)
  const [autoInstruction, setAutoInstruction] = useState('')
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false)
  const [pendingTemplate, setPendingTemplate] = useState<BuiltinOrchestrationTemplate | undefined>(undefined)
  const templateManagedRoleIds = useRef(new Set<string>())

  const busy = autoGenerating || saving || running || applyingTemplate

  // 渲染期直读共享 appState（版本号订阅保证通知后重渲染）
  const store = getAppState().store
  const roles = currentRoles()
  const selectedStage = stages.find(stage => stage.id === selectedStageId)

  // 结构签名：描述/审核配置编辑不重画画布（与原 render 节奏一致，见 lib 注释）
  const canvasKey = useMemo(() => `${stagesCanvasKey(stages)}|${edgesCanvasKey(graphEdges)}`, [stages, graphEdges])

  // 自动编排聊天条目：历史 + 流式期间的两条占位（原 currentAutoChatEntries）
  const autoEntries = useMemo(() => {
    const entries = cloneAutoPlanHistory(autoPlanHistory)
    if (autoGenerating && streamState.pendingUserContent) entries.push(...pendingAutoStreamEntries(streamState))
    return entries
  }, [autoPlanHistory, autoGenerating, streamState])

  // uiBus 订阅只在装配期建立一次；handler 经 ref 取最新闭包
  const openRef = useRef(handleOpen)
  openRef.current = handleOpen
  useEffect(() => services.uiBus.on('open-orchestration', () => openRef.current()), [services])

  function handleOpen(): void {
    const appState = getAppState()
    const active = appState.selectedChatId ? appState.store.chatsById[appState.selectedChatId] : undefined
    if (!active) {
      showError(ui('请选择群聊后再编排任务'))
      return
    }
    const storedFlowId = appState.store.orchestrationFlowOrderByChatId[active.id]?.[0]
    const flow = storedFlowId ? appState.store.orchestrationFlowsById[storedFlowId] : undefined
    const draft = flow ? draftFromFlow(flow) : emptyDraft()
    setFlowId(draft.flowId)
    setTask(draft.task)
    setStages(draft.stages)
    setGraphEdges(draft.graphEdges)
    setAutoPlanHistory(draft.autoPlanHistory)
    setMaxRounds(String(draft.maxNodeExecutions))
    setSelectedStageId(undefined)
    setOpen(true)
    queueMicrotask(() => document.getElementById('orchestration-task')?.focus())
  }

  function close(): void {
    setOpen(false)
    setAutoPanelOpen(false)
    setAutoInstruction('')
    setTemplatePickerOpen(false)
    setPendingTemplate(undefined)
    endOrchestrationAutoStream()
    setFlowId(undefined)
    setTask('')
    setStages([])
    setGraphEdges([])
    setAutoPlanHistory([])
    setSelectedStageId(undefined)
    setMaxRounds(String(DEFAULT_ORCHESTRATION_MAX_NODE_EXECUTIONS))
  }

  function currentChat(): GroupChat | undefined {
    const appState = getAppState()
    return appState.selectedChatId ? appState.store.chatsById[appState.selectedChatId] : undefined
  }

  function currentRoles(): GroupRole[] {
    const active = currentChat()
    if (!active) return []
    const activeStore = getAppState().store
    return active.roleIds.map(roleId => activeStore.rolesById[roleId]).filter((role): role is GroupRole => Boolean(role))
  }

  function getRoleName(roleId: string): string {
    return getAppState().store.rolesById[roleId]?.name ?? '未知人员'
  }

  function ensureExternalApiConfigured(): boolean {
    if (hasExternalApiConfigured(getAppState().store)) return true
    showError(ui('编排依赖外部模型 API，请先配置一个外部模型。'))
    services.uiBus.emit('open-external-models')
    return false
  }

  function addRoleAsStage(roleId: string): void {
    const stage: OrchestrationStage = { id: newId('stage'), kind: 'roles', name: getRoleName(roleId), roleIds: [roleId] }
    setStages(previous => {
      const reviewIndex = previous.findIndex(item => item.kind === 'review')
      if (reviewIndex >= 0) return [...previous.slice(0, reviewIndex), stage, ...previous.slice(reviewIndex)]
      return [...previous, stage]
    })
    setSelectedStageId(undefined)
  }

  function changeStage(stageId: string, updater: (stage: OrchestrationStage) => OrchestrationStage): void {
    setStages(previous => previous.map(stage => (stage.id === stageId ? updater(stage) : stage)))
  }

  function setStageKind(stage: OrchestrationStage, kind: OrchestrationStage['kind']): void {
    if (stage.kind === kind) return
    changeStage(stage.id, current => {
      if (kind === 'review') {
        return { ...current, kind, name: current.name.trim() || '审核', roleIds: current.roleIds.slice(0, 1), review: normalizedReviewConfig(current) }
      }
      const { review: _review, ...rest } = current
      return { ...rest, kind, name: current.name.trim() || getRoleName(current.roleIds[0] ?? '') || '执行' }
    })
  }

  function removeStage(stageId: string): void {
    setStages(previous => previous.filter(stage => stage.id !== stageId))
    setGraphEdges(previous => previous.filter(edge => edge.sourceStageId !== stageId && edge.targetStageId !== stageId))
    setSelectedStageId(undefined)
  }

  function clearSelectedStage(): void {
    setSelectedStageId(undefined)
  }

  function arrangeCanvas(): void {
    const arranged = arrangeOrchestrationGraph(stages, graphEdges)
    setStages(arranged.stages)
    setGraphEdges(arranged.edges)
  }

  function openAutoPanel(): void {
    if (!ensureExternalApiConfigured()) return
    setAutoPanelOpen(true)
  }

  function closeAutoPanel(): void {
    setAutoPanelOpen(false)
    setAutoInstruction('')
    endOrchestrationAutoStream()
  }

  async function saveOrchestrationFlow(): Promise<void> {
    if (saving || running) return
    const current = currentChat()
    if (!current || !validateDraft(false)) return
    setSaving(true)
    try {
      const flow = buildFlow(current)
      await services.runCommand('GROUP_ORCHESTRATION_FLOW_SAVE', { chatId: current.id, flow })
      setFlowId(flow.id)
      showSuccess(ui('编排流程已保存'))
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  async function runOrchestration(): Promise<void> {
    if (running || saving) return
    const current = currentChat()
    if (current && !ensureExternalApiConfigured()) return
    if (!current || !validateDraft(true)) return
    setRunning(true)
    try {
      const flow = buildFlow(current)
      await runCommandWithReconnect(
        { reconnectRolesForSend: services.reconnectRolesForSend, runCommand: services.runCommand },
        { chat: current, roles: getDraftRoles(), type: 'GROUP_ORCHESTRATION_RUN', payload: { chatId: current.id, task: task.trim(), flow }, preconnectAll: true },
      )
      setFlowId(flow.id)
      showSuccess(ui('编排任务已开始'))
      close()
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error))
    } finally {
      setRunning(false)
    }
  }

  async function autoGenerate(): Promise<void> {
    if (autoGenerating || saving || running) return
    const current = currentChat()
    if (!current) return
    if (!ensureExternalApiConfigured()) return
    const currentTask = task.trim()
    if (!currentTask) {
      showError(ui('请输入编排任务'))
      return
    }
    const instruction = autoInstruction.trim()
    if (stages.length > 0 && !instruction) {
      showError(ui('请输入自动编排消息'))
      return
    }
    const userContent = instruction || currentTask
    const streamId = newId('auto-stream')
    setAutoGenerating(true)
    beginOrchestrationAutoStream(streamId, userContent)
    setAutoInstruction('')
    try {
      const flow = stages.length > 0 ? buildFlow(current) : undefined
      const payload: Record<string, unknown> = {
        chatId: current.id,
        task: currentTask,
        instruction: userContent,
        flowId,
        history: cloneAutoPlanHistory(autoPlanHistory),
        streamId,
      }
      if (flow) payload.flow = flow
      const response = (await services.sendRuntimeMessage('GROUP_ORCHESTRATION_AUTO_GENERATE', payload)) as OrchestrationCommandResponse
      if (response.ok === false) throw new Error(response.error || '自动编排失败')
      if (response.store) services.applyStore(response.store)
      const generatedFlow = response.flow
      if (!generatedFlow) throw new Error('自动编排没有返回流程')
      applyGeneratedFlow(generatedFlow)
      endOrchestrationAutoStream()
      showSuccess(ui(autoGenerateSuccessMessage(response.createdRoleIds?.length ?? 0, response.reusedRoleIds?.length ?? 0)))
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error))
    } finally {
      setAutoGenerating(false)
    }
  }

  function applyGeneratedFlow(flow: OrchestrationFlow): void {
    const nextStages = cloneStages(flow.graph?.stageNodes?.length ? flow.graph.stageNodes : flow.stages)
    const arranged = arrangeOrchestrationGraph(nextStages, flow.graph?.edges ? cloneGraphEdges(flow.graph.edges) : sequentialEdgesOf(nextStages))
    setFlowId(flow.id)
    setStages(arranged.stages)
    setGraphEdges(arranged.edges)
    setAutoPlanHistory(cloneAutoPlanHistory(flow.autoPlanHistory ?? []))
    setMaxRounds(String(clampMaxNodeExecutions(flow.maxNodeExecutions ?? DEFAULT_ORCHESTRATION_MAX_NODE_EXECUTIONS)))
    setSelectedStageId(undefined)
  }

  function sequentialEdgesOf(nextStages: OrchestrationStage[]): OrchestrationGraphSnapshot['edges'] {
    return nextStages.slice(1).map((stage, index) => ({ sourceStageId: nextStages[index].id, targetStageId: stage.id }))
  }

  function openTemplatePicker(): void {
    if (!open) return
    setTemplatePickerOpen(true)
  }

  function closeTemplatePicker(): void {
    setTemplatePickerOpen(false)
  }

  function requestApplyTemplate(templateId: string): void {
    const template = getBuiltinOrchestrationTemplate(templateId)
    if (!template) return
    if (saving || running || autoGenerating || applyingTemplate) return
    if (!currentChat()) return
    if (stages.length > 0) {
      setPendingTemplate(template)
      return
    }
    void applyTemplate(template)
  }

  async function applyTemplate(template: BuiltinOrchestrationTemplate): Promise<void> {
    const current = currentChat()
    if (!current) return
    setApplyingTemplate(true)
    try {
      await removeTemplateCreatedRoles(current)
      const roleIdsByKey = await resolveTemplateRoleIds(current, template)
      const stageIdByTemplateId = new Map(template.stages.map(stage => [stage.id, newId('stage')]))
      const nextStages = template.stages.map(stage => {
        const roleIds = stage.roleKeys.map(roleKey => requireTemplateRoleId(roleIdsByKey, roleKey, template.name))
        const review = stage.review
          ? {
              reviewerRoleIds: stage.review.reviewerRoleKeys.map(roleKey => requireTemplateRoleId(roleIdsByKey, roleKey, template.name)),
              instructions: stage.review.instructions,
              maxAttempts: stage.review.maxAttempts,
              onMaxAttempts: stage.review.onMaxAttempts,
            }
          : undefined
        return {
          id: stageIdByTemplateId.get(stage.id) ?? newId('stage'),
          kind: stage.kind,
          name: stage.name,
          description: stage.description,
          roleIds,
          ...(review ? { review } : {}),
        } satisfies OrchestrationStage
      })
      const edges = template.edges.flatMap(edge => {
        const sourceStageId = stageIdByTemplateId.get(edge.from)
        const targetStageId = stageIdByTemplateId.get(edge.to)
        if (!sourceStageId || !targetStageId) return []
        return [{ sourceStageId, targetStageId, ...(edge.sourcePort ? { sourcePort: edge.sourcePort } : {}) }]
      })
      const arranged = arrangeOrchestrationGraph(nextStages, edges)
      const nextTask = task.trim() || template.defaultTask
      setTask(nextTask)
      setStages(arranged.stages)
      setGraphEdges(arranged.edges)
      setAutoPlanHistory([])
      setMaxRounds(String(clampMaxNodeExecutions(template.maxNodeExecutions)))
      setSelectedStageId(undefined)
      showSuccess(ui(`已套用「${template.name}」模板`))
      setTemplatePickerOpen(false)
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error))
    } finally {
      setApplyingTemplate(false)
    }
  }

  async function removeTemplateCreatedRoles(chat: GroupChat): Promise<void> {
    const templateRoleIds = collectTemplateRoleIdsToDelete(chat)
    for (const roleId of templateRoleIds) {
      await services.runCommand('GROUP_ROLE_DELETE', { roleId })
      templateManagedRoleIds.current.delete(roleId)
    }
  }

  function collectTemplateRoleIdsToDelete(chat: GroupChat): string[] {
    const activeStore = getAppState().store
    const roleIds = new Set<string>()
    for (const roleId of templateManagedRoleIds.current) {
      const role = activeStore.rolesById[roleId]
      if (!role) {
        templateManagedRoleIds.current.delete(roleId)
        continue
      }
      if (role.chatId === chat.id) roleIds.add(roleId)
    }
    for (const roleId of chat.roleIds) {
      if (shouldRemoveRoleBeforeApplyingTemplate(roleId)) roleIds.add(roleId)
    }
    return [...roleIds]
  }

  function shouldRemoveRoleBeforeApplyingTemplate(roleId: string): boolean {
    const role = getAppState().store.rolesById[roleId]
    if (!role) return false
    if (role.createdBy === 'orchestration-template') return true
    if (role.createdBy !== 'orchestration-auto') return false
    if (draftGeneratedRoleIds().has(role.id)) return true
    return isBuiltinOrchestrationTemplateRoleName(role.name)
  }

  function draftGeneratedRoleIds(): Set<string> {
    const roleIds = new Set<string>()
    for (const stage of stages) {
      for (const roleId of stage.roleIds) roleIds.add(roleId)
      for (const roleId of stage.review?.reviewerRoleIds ?? []) roleIds.add(roleId)
    }
    return roleIds
  }

  async function resolveTemplateRoleIds(chat: GroupChat, template: BuiltinOrchestrationTemplate): Promise<Map<string, string>> {
    const roleIdsByKey = new Map<string, string>()
    const usedRoleIds = new Set<string>()
    const missingRoles: OrchestrationTemplateRole[] = []
    for (const templateRole of template.roles) {
      const reusable = findReusableTemplateRole(templateRole, currentRoles(), usedRoleIds)
      if (reusable) {
        roleIdsByKey.set(templateRole.key, reusable.id)
        usedRoleIds.add(reusable.id)
      } else {
        missingRoles.push(templateRole)
      }
    }
    if (missingRoles.length === 0) return roleIdsByKey

    const createdRoles = await createTemplateRoles(chat, missingRoles)
    missingRoles.forEach((templateRole, index) => {
      const createdRole = createdRoles[index]
      if (!createdRole) throw new Error(`模板「${template.name}」缺少人员：${templateRole.name}`)
      roleIdsByKey.set(templateRole.key, createdRole.id)
    })
    return roleIdsByKey
  }

  async function createTemplateRoles(chat: GroupChat, templateRoles: OrchestrationTemplateRole[]): Promise<GroupRole[]> {
    const response = (await services.sendRuntimeMessage('GROUP_ROLES_CREATE_BATCH', {
      chatId: chat.id,
      items: templateRoles.map(role => ({
        source: 'temporary',
        createdBy: 'orchestration-template',
        name: role.name,
        description: role.description,
        systemPrompt: role.systemPrompt,
        modelSource: 'site',
        chatSite: 'deepseek',
      })),
    })) as OrchestrationCommandResponse
    if (response.ok === false) throw new Error(response.error || '创建模板人员失败')
    if (response.store) services.applyStore(response.store)
    const createdRoles = response.roles ?? findCreatedTemplateRoles(templateRoles)
    if (createdRoles.length !== templateRoles.length) throw new Error('创建模板人员失败')
    for (const role of createdRoles) templateManagedRoleIds.current.add(role.id)
    return createdRoles
  }

  function findCreatedTemplateRoles(templateRoles: OrchestrationTemplateRole[]): GroupRole[] {
    const usedRoleIds = new Set<string>()
    return templateRoles.flatMap(role => {
      const reusable = findReusableTemplateRole(role, currentRoles(), usedRoleIds)
      if (!reusable) return []
      usedRoleIds.add(reusable.id)
      return [reusable]
    })
  }

  async function updateAutoGeneratedRoleSite(roleId: string, chatSite: ChatSite): Promise<void> {
    const role = getAppState().store.rolesById[roleId]
    if (!role || !isGeneratedEditableRole(role)) throw new Error('只有编排生成的人员可以在这里修改站点')
    if (role.modelSource === 'external') throw new Error('外部模型人员不能切换网页站点')
    await services.runCommand('GROUP_ROLE_UPDATE', { roleId, patch: { modelSource: 'site', chatSite } })
    showSuccess(ui('人员站点已更新'))
  }

  async function updateAutoGeneratedRolePrompt(roleId: string, systemPrompt: string): Promise<void> {
    const role = getAppState().store.rolesById[roleId]
    if (!role || !isGeneratedEditableRole(role)) throw new Error('只有编排生成的人员可以在这里修改人设')
    await services.runCommand('GROUP_ROLE_UPDATE', { roleId, patch: { systemPrompt } })
    showSuccess(ui('人员人设已更新'))
  }

  function getDraftRoles(): GroupRole[] {
    const rolesById = new Map(currentRoles().map(role => [role.id, role]))
    const roleIds = new Set<string>()
    for (const stage of stages) {
      for (const roleId of stage.roleIds) roleIds.add(roleId)
      if (stage.kind === 'review') {
        for (const roleId of stage.review?.reviewerRoleIds ?? []) roleIds.add(roleId)
      }
    }
    return [...roleIds].map(roleId => rolesById.get(roleId)).filter((role): role is GroupRole => Boolean(role))
  }

  function validateDraft(requireTask: boolean): boolean {
    if (currentRoles().length === 0) {
      showError(ui('当前群聊暂无人员，无法编排任务'))
      return false
    }
    if (requireTask && !task.trim()) {
      showError(ui('请输入编排任务'))
      return false
    }
    if (stages.length === 0) {
      showError(ui('请至少添加一个流程节点'))
      return false
    }
    if (stages.some(stage => stage.roleIds.length === 0)) {
      showError(ui('每个节点都需要至少一个人员'))
      return false
    }
    const review = stages.find(stage => stage.kind === 'review')
    if (review && (!review.review?.reviewerRoleIds.length || !review.review.instructions?.trim())) {
      showError(ui('审核节点需要审核人员和审核标准'))
      return false
    }
    const rawMaxNodeExecutions = Number(maxRounds)
    if (!Number.isFinite(rawMaxNodeExecutions) || rawMaxNodeExecutions < 1 || rawMaxNodeExecutions > MAX_ORCHESTRATION_MAX_NODE_EXECUTIONS) {
      showError(ui(`最大节点执行数需在 1-${MAX_ORCHESTRATION_MAX_NODE_EXECUTIONS} 之间`))
      return false
    }
    return true
  }

  function buildFlow(current: GroupChat): OrchestrationFlow {
    const now = Date.now()
    const validEdges = filterGraphEdges(graphEdges, stages)
    const orderedStages = orderStagesByGraph(cloneStages(stages), validEdges)
    const parsedMaxNodeExecutions = clampMaxNodeExecutions(Number(maxRounds || DEFAULT_ORCHESTRATION_MAX_NODE_EXECUTIONS))
    return {
      id: flowId ?? newId('flow'),
      chatId: current.id,
      name: `${current.name} 编排流程`,
      description: task.trim() || undefined,
      stages: orderedStages,
      graph: {
        stageNodes: orderedStages,
        edges: validEdges,
      },
      autoPlanHistory: cloneAutoPlanHistory(autoPlanHistory),
      maxNodeExecutions: parsedMaxNodeExecutions,
      maxRounds: parsedMaxNodeExecutions,
      createdAt: now,
      updatedAt: now,
    }
  }

  const editableAutoRoles = selectedStage
    ? selectedRoleIds(selectedStage)
        .map(roleId => store.rolesById[roleId])
        .filter((role): role is GroupRole => Boolean(role) && isGeneratedEditableRole(role) && role.modelSource !== 'external')
    : []

  return (
    <>
      <Dialog open={open}>
        <DialogContent
          id="orchestration-modal"
          aria-labelledby="orchestration-title"
          showCloseButton={false}
          className="orchestration-modal w-[min(1160px,calc(100vw-42px))] max-w-none sm:max-w-none gap-3.5 bg-popover"
          onEscapeKeyDown={event => event.preventDefault()}
          onInteractOutside={event => event.preventDefault()}
          onOpenAutoFocus={event => {
            event.preventDefault()
            document.getElementById('orchestration-task')?.focus()
          }}
        >
          <DialogHeader className="flex-row items-start justify-between gap-4 text-left">
            <div>
              <DialogTitle id="orchestration-title">{ui('编排任务')}</DialogTitle>
              <DialogDescription className="tiny">{ui('画布节点按连线顺序执行；同一个节点内的多个人员会并行工作。')}</DialogDescription>
            </div>
            <Button id="close-orchestration" variant="ghost" size="icon-sm" type="button" aria-label={ui('关闭编排任务')} onClick={close}>×</Button>
          </DialogHeader>
          <div className="orchestration-task-strip">
            <label className="field" htmlFor="orchestration-task">{ui('任务')}</label>
            <div className="orchestration-task-input-row">
              <textarea
                id="orchestration-task"
                value={task}
                placeholder={ui('描述要让编排流程完成的任务；不需要 @ 人员。')}
                onChange={event => setTask(event.target.value)}
              />
              <Button id="open-orchestration-template" variant="outline" size="sm" className="orchestration-template-trigger" type="button" disabled={busy} onClick={openTemplatePicker}>{ui('模板')}</Button>
              <Button id="auto-orchestration" variant="outline" size="sm" className="orchestration-auto" type="button" disabled={busy} onClick={openAutoPanel}>
                {autoGenerating ? ui('生成中...') : ui('自动编排')}
              </Button>
            </div>
          </div>
          <div className={`orchestration-layout${selectedStage ? '' : ' settings-hidden'}`}>
            <aside className="orchestration-sidebar">
              <div className="section-title">
                <h3>{ui('人员')}</h3>
                <span className="tiny">{ui('拖到画布创建节点')}</span>
              </div>
              <div id="orchestration-people-list" className="orchestration-people-list">
                {roles.length === 0 ? (
                  <div className="empty-card compact">{ui('当前群聊暂无人员，无法编排任务。')}</div>
                ) : roles.map(role => {
                  const model = roleModelDisplay(role, store)
                  return (
                    <div
                      key={role.id}
                      className="orchestration-person"
                      draggable
                      onDragStart={event => event.dataTransfer?.setData('application/x-openteam-role-id', role.id)}
                    >
                      <span className={`orchestration-person-avatar ${roleToneClass(role.id)}`}>{roleInitial(role.name)}</span>
                      <div className="orchestration-person-body">
                        <div className="orchestration-person-title">
                          <strong>{role.name}</strong>
                          <span className={`site-pill orchestration-person-site ${model.className}`}>{model.label}</span>
                        </div>
                        <span className="tiny">{role.description || ui('拖到画布创建节点')}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </aside>
            <section className="orchestration-workspace">
              <Button id="arrange-orchestration" variant="outline" size="sm" className="orchestration-arrange" type="button" onClick={arrangeCanvas}>{ui('整理')}</Button>
              {open && (
                <CanvasPortal
                  stages={stages}
                  selectedStageId={selectedStageId}
                  graphEdges={graphEdges}
                  canvasKey={canvasKey}
                  storeVersion={storeVersion}
                  onStageSelected={setSelectedStageId}
                  onRoleDropped={addRoleAsStage}
                  onGraphChanged={edges => setGraphEdges(cloneGraphEdges(edges))}
                />
              )}
              <p id="orchestration-empty-hint" className="orchestration-empty-hint" hidden={stages.length > 0}>
                {ui('把人员拖到画布生成节点，再从节点端口拖线编排执行关系。')}
              </p>
            </section>
            <aside className="orchestration-settings" hidden={!selectedStage}>
              <div className="orchestration-settings-heading">
                <h3>{ui('节点设置')}</h3>
                <span className="tiny">{ui('选择画布节点后编辑')}</span>
              </div>
              {selectedStage && (
                <div id="orchestration-stage-settings" className="orchestration-stage-settings" key={selectedStage.id}>
                  <div className="orchestration-node-editor-header">
                    <h3>{selectedStage.kind === 'review' ? ui('审核节点') : ui('执行节点')}</h3>
                    <button className="icon-btn orchestration-node-editor-close" type="button" aria-label={ui('关闭节点设置')} onClick={clearSelectedStage}>×</button>
                  </div>
                  <label className="field">
                    {ui('节点类型')}
                    <select
                      data-stage-kind="true"
                      value={selectedStage.kind}
                      onChange={event => setStageKind(selectedStage, event.target.value === 'review' ? 'review' : 'roles')}
                    >
                      <option value="roles">{ui('执行')}</option>
                      <option value="review">{ui('审核')}</option>
                    </select>
                  </label>
                  <label className="field">
                    {ui('节点名称')}
                    <input
                      defaultValue={selectedStage.name}
                      onInput={event => {
                        const value = event.currentTarget.value
                        changeStage(selectedStage.id, current => ({ ...current, name: value.trim() || (current.kind === 'review' ? '审核' : '执行节点') }))
                      }}
                    />
                  </label>
                  <label className="field">
                    {ui('任务描述')}
                    <textarea
                      defaultValue={selectedStage.description ?? ''}
                      placeholder={ui('给这个节点单独补充任务说明，例如：先澄清目标，只输出优先级和风险。')}
                      onInput={event => {
                        const value = event.currentTarget.value.trim()
                        changeStage(selectedStage.id, current => (value ? { ...current, description: value } : withoutDescription(current)))
                      }}
                    />
                  </label>
                  <div className="field">
                    {selectedStage.kind === 'review' ? ui('审核人员') : ui('执行人员')}
                    <div className="stage-role-chips">
                      {selectedRoleIds(selectedStage).map(roleId => (
                        <span key={roleId} className="stage-role-chip">{getRoleName(roleId)}</span>
                      ))}
                    </div>
                  </div>
                  {editableAutoRoles.length > 0 && (
                    <div className="field orchestration-auto-role-sites">
                      <span>{ui('自动人员设置')}</span>
                      {editableAutoRoles.map(role => (
                        <Fragment key={role.id}>
                          <label className="orchestration-auto-role-site-row">
                            <span>{role.name}</span>
                            <select
                              value={visibleChatSite(role.chatSite ?? store.settings.defaultChatSite)}
                              onChange={event => {
                                const value = event.target.value as ChatSite
                                updateAutoGeneratedRoleSite(role.id, value).catch(error => showError(error instanceof Error ? error.message : String(error)))
                              }}
                            >
                              {editableChatSites().map(site => (
                                <option key={site} value={site}>{ui(siteLabel(site))}</option>
                              ))}
                            </select>
                          </label>
                          <label className="orchestration-auto-role-prompt-row">
                            <span>{ui(`${role.name} 人设提示词`)}</span>
                            <textarea
                              className="orchestration-auto-role-prompt"
                              defaultValue={role.systemPrompt ?? ''}
                              placeholder={ui('只修改自动编排生成的人员人设；已有群成员不会在这里改。')}
                              onBlur={event => {
                                const value = event.currentTarget.value
                                if (value === (role.systemPrompt ?? '')) return
                                updateAutoGeneratedRolePrompt(role.id, value).catch(error => showError(error instanceof Error ? error.message : String(error)))
                              }}
                            />
                          </label>
                        </Fragment>
                      ))}
                    </div>
                  )}
                  <Button variant="destructive" size="sm" type="button" onClick={() => removeStage(selectedStage.id)}>{ui('删除节点')}</Button>
                </div>
              )}
              {selectedStage?.kind === 'review' && (
                <div id="orchestration-review-settings" className="orchestration-review-settings">
                  <p className="tiny orchestration-note">{ui('审核节点由一个群聊人员根据标准判断通过或不通过。')}</p>
                  <label className="field">
                    {ui('审核标准')}
                    <textarea
                      value={selectedStage.review?.instructions ?? ''}
                      placeholder={ui('例如：答案需要覆盖风险、方案和下一步行动。未满足时返回 fail。')}
                      onChange={event => {
                        const value = event.currentTarget.value
                        changeStage(selectedStage.id, current => ({ ...current, review: normalizedReviewConfig(current, { instructions: value }) }))
                      }}
                    />
                  </label>
                  <label className="field">
                    {ui('最大审核次数')}
                    <input
                      type="number"
                      min={1}
                      max={50}
                      defaultValue={String(selectedStage.review?.maxAttempts ?? DEFAULT_ORCHESTRATION_REVIEW_MAX_ATTEMPTS)}
                      onInput={event => {
                        const value = event.currentTarget.value
                        changeStage(selectedStage.id, current => ({ ...current, review: normalizedReviewConfig(current, { maxAttempts: clampReviewAttempts(Number(value || DEFAULT_ORCHESTRATION_REVIEW_MAX_ATTEMPTS)) }) }))
                      }}
                    />
                  </label>
                  <label className="field">
                    {ui('达到上限后')}
                    <select
                      value={selectedStage.review?.onMaxAttempts ?? 'stop'}
                      onChange={event => {
                        const value = event.target.value
                        changeStage(selectedStage.id, current => ({ ...current, review: normalizedReviewConfig(current, { onMaxAttempts: value === 'continue' ? 'continue' : 'stop' }) }))
                      }}
                    >
                      <option value="stop">{ui('停止流程')}</option>
                      <option value="continue">{ui('继续往下走')}</option>
                    </select>
                  </label>
                  <div className="orchestration-json-preview">
                    <span className="tiny">{ui('审核返回 JSON 预览')}</span>
                    <pre>{JSON_PREVIEW_TEXT}</pre>
                  </div>
                </div>
              )}
            </aside>
          </div>
          <div className="orchestration-footer">
            <label className="field orchestration-rounds-field" htmlFor="orchestration-max-rounds">
              <span>{ui('最大节点执行数')}</span>
              <input
                id="orchestration-max-rounds"
                type="number"
                min={1}
                max={MAX_ORCHESTRATION_MAX_NODE_EXECUTIONS}
                value={maxRounds}
                onChange={event => setMaxRounds(event.target.value)}
              />
            </label>
            <p className="tiny">{ui('默认 50 个，最多 200 个；用于防止循环流程无限执行，执行节点和审核节点都会计数。')}</p>
            <div className="template-actions orchestration-actions">
              <Button id="save-orchestration" variant="outline" size="sm" type="button" disabled={busy} onClick={() => void saveOrchestrationFlow()}>{ui('保存')}</Button>
              <Button id="run-orchestration" size="sm" type="button" disabled={busy} onClick={() => void runOrchestration()}>{ui('运行')}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <OrchestrationAutoModal
        open={open && autoPanelOpen}
        entries={autoEntries}
        instruction={autoInstruction}
        busy={autoGenerating || saving || running}
        generating={autoGenerating}
        inputPlaceholder={stages.length > 0 ? ui('继续修改当前编排...') : ui('输入自动编排需求...')}
        onInstructionChange={setAutoInstruction}
        onSubmit={() => void autoGenerate()}
        onClose={closeAutoPanel}
      />

      <OrchestrationTemplatePickerModal
        open={open && templatePickerOpen}
        disabled={busy}
        onApply={requestApplyTemplate}
        onClose={closeTemplatePicker}
      />

      <AlertDialog open={pendingTemplate !== undefined} onOpenChange={next => { if (!next) setPendingTemplate(undefined) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{ui('替换画布草稿')}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingTemplate ? ui(`用「${pendingTemplate.name}」替换当前画布草稿吗？`) : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{ui('取消')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const template = pendingTemplate
                setPendingTemplate(undefined)
                if (template) void applyTemplate(template)
              }}
            >{ui('替换')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function withoutDescription(stage: OrchestrationStage): OrchestrationStage {
  const { description: _description, ...rest } = stage
  return rest
}

const JSON_PREVIEW_TEXT = '{\n  "decision": "pass | fail",\n  "reason": "审核说明",\n  "failedCriteria": [],\n  "nextRoundInstruction": "不通过时的重试说明"\n}'
